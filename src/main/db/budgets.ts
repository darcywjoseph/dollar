import type { Database as DB } from 'better-sqlite3'
import type { BudgetGrid, BudgetRow } from '@shared/types'
import { addMonthKey, lastNMonthKeys, monthRange } from '@shared/dates'
import { getSettings, rowToBudget } from './helpers'

/** scope is 'joint' or a person id as string */
function scopeToPersonId(scope: string): number | null {
  return scope === 'joint' ? null : Number(scope)
}

export function getBudgetGrid(db: DB, month: string): BudgetGrid {
  const settings = getSettings(db)
  const { start, end } = monthRange(month, settings.firstDayOfMonth)

  const budgets = db.prepare('SELECT * FROM budgets WHERE month = ?').all(month).map(rowToBudget)
  const actuals = db
    .prepare(
      `SELECT category_id, person_id, -SUM(amount_cents) AS spent
       FROM transactions
       WHERE amount_cents < 0 AND date >= ? AND date < ?
       GROUP BY category_id, person_id`
    )
    .all(start, end) as { category_id: number | null; person_id: number; spent: number }[]

  const rowsByCat = new Map<number, BudgetRow>()
  const ensure = (categoryId: number): BudgetRow => {
    let row = rowsByCat.get(categoryId)
    if (!row) {
      row = { categoryId, budgeted: {}, actual: {} }
      rowsByCat.set(categoryId, row)
    }
    return row
  }

  for (const b of budgets) {
    ensure(b.categoryId).budgeted[b.personId == null ? 'joint' : String(b.personId)] = b.amountCents
  }
  for (const a of actuals) {
    if (a.category_id == null) continue
    const row = ensure(a.category_id)
    row.actual[String(a.person_id)] = (row.actual[String(a.person_id)] ?? 0) + a.spent
  }

  return { month, rows: Array.from(rowsByCat.values()) }
}

export function setBudget(db: DB, month: string, categoryId: number, scope: string, amountCents: number): void {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month')
  const personId = scopeToPersonId(scope)
  if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) throw new Error('Category not found')
  const rounded = Math.round(amountCents)
  if (rounded <= 0) {
    // person_id may be NULL; "IS" makes the comparison null-safe
    db.prepare('DELETE FROM budgets WHERE month = ? AND category_id = ? AND person_id IS ?').run(
      month,
      categoryId,
      personId
    )
    return
  }
  db.prepare(
    `INSERT INTO budgets (month, category_id, person_id, amount_cents) VALUES (?, ?, ?, ?)
     ON CONFLICT (month, category_id, COALESCE(person_id, 0)) DO UPDATE SET amount_cents = excluded.amount_cents`
  ).run(month, categoryId, personId, rounded)
}

export function copyBudgetsFromPrevious(db: DB, month: string): number {
  const prev = addMonthKey(month, -1)
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO budgets (month, category_id, person_id, amount_cents)
       SELECT ?, category_id, person_id, amount_cents FROM budgets WHERE month = ?`
    )
    .run(month, prev)
  return info.changes
}

/** Set budgets for `month` from the 3-month average actual spending per category+person. */
export function setBudgetsFromAverage(db: DB, month: string): number {
  const settings = getSettings(db)
  const months = lastNMonthKeys(month, 3)
  const { start } = monthRange(months[0], settings.firstDayOfMonth)
  const { start: end } = monthRange(month, settings.firstDayOfMonth)

  const rows = db
    .prepare(
      `SELECT t.category_id, t.person_id, -SUM(t.amount_cents) AS spent
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.amount_cents < 0 AND c.type = 'expense' AND t.date >= ? AND t.date < ?
       GROUP BY t.category_id, t.person_id`
    )
    .all(start, end) as { category_id: number; person_id: number; spent: number }[]

  let changed = 0
  const upsert = db.prepare(
    `INSERT INTO budgets (month, category_id, person_id, amount_cents) VALUES (?, ?, ?, ?)
     ON CONFLICT (month, category_id, COALESCE(person_id, 0)) DO UPDATE SET amount_cents = excluded.amount_cents`
  )
  db.transaction(() => {
    for (const r of rows) {
      // round the monthly average up to the nearest dollar
      const avg = Math.ceil(r.spent / 3 / 100) * 100
      if (avg <= 0) continue
      upsert.run(month, r.category_id, r.person_id, avg)
      changed++
    }
  })()
  return changed
}
