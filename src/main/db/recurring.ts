import type { Database as DB } from 'better-sqlite3'
import type { RecurringRule, RecurringRuleInput, UpcomingInstance } from '@shared/types'
import { addDaysISO, advanceDate, compareISO, isValidISO, todayISO } from '@shared/dates'
import { rowToRule } from './helpers'
import { createTransaction } from './transactions'

export function listRecurring(db: DB): RecurringRule[] {
  return db
    .prepare('SELECT * FROM recurring_rules ORDER BY active DESC, next_due')
    .all()
    .map(rowToRule)
}

function validate(db: DB, input: RecurringRuleInput): void {
  if (!input.name.trim()) throw new Error('Name is required')
  if (!Number.isFinite(input.amountCents)) throw new Error('Invalid amount')
  if (!isValidISO(input.nextDue)) throw new Error('Invalid next due date')
  if (input.endDate != null && input.endDate !== '' && !isValidISO(input.endDate))
    throw new Error('Invalid end date')
  if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(input.accountId))
    throw new Error('Account not found')
  if (!db.prepare('SELECT id FROM people WHERE id = ?').get(input.personId))
    throw new Error('Person not found')
  if (
    input.categoryId != null &&
    !db.prepare('SELECT id FROM categories WHERE id = ?').get(input.categoryId)
  ) {
    throw new Error('Category not found')
  }
}

export function createRecurring(db: DB, input: RecurringRuleInput): RecurringRule[] {
  validate(db, input)
  db.prepare(
    `INSERT INTO recurring_rules (name, amount_cents, category_id, account_id, person_id, frequency, next_due, end_date, notes, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.name.trim(),
    Math.round(input.amountCents),
    input.categoryId,
    input.accountId,
    input.personId,
    input.frequency,
    input.nextDue,
    input.endDate || null,
    input.notes ?? null,
    input.active === false ? 0 : 1
  )
  // Newly created rules may already be due (e.g. next due = today).
  generateDueInstances(db)
  return listRecurring(db)
}

export function updateRecurring(
  db: DB,
  id: number,
  patch: Partial<RecurringRuleInput>
): RecurringRule[] {
  const row = db.prepare('SELECT * FROM recurring_rules WHERE id = ?').get(id)
  if (!row) throw new Error('Recurring rule not found')
  const current = rowToRule(row)
  const merged: RecurringRuleInput = {
    name: patch.name ?? current.name,
    amountCents: patch.amountCents ?? current.amountCents,
    categoryId: patch.categoryId !== undefined ? patch.categoryId : current.categoryId,
    accountId: patch.accountId ?? current.accountId,
    personId: patch.personId ?? current.personId,
    frequency: patch.frequency ?? current.frequency,
    nextDue: patch.nextDue ?? current.nextDue,
    endDate: patch.endDate !== undefined ? patch.endDate : current.endDate,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    active: patch.active !== undefined ? patch.active : current.active
  }
  validate(db, merged)
  db.prepare(
    `UPDATE recurring_rules SET name = ?, amount_cents = ?, category_id = ?, account_id = ?, person_id = ?,
       frequency = ?, next_due = ?, end_date = ?, notes = ?, active = ? WHERE id = ?`
  ).run(
    merged.name.trim(),
    Math.round(merged.amountCents),
    merged.categoryId,
    merged.accountId,
    merged.personId,
    merged.frequency,
    merged.nextDue,
    merged.endDate || null,
    merged.notes ?? null,
    merged.active === false ? 0 : 1,
    id
  )
  generateDueInstances(db)
  return listRecurring(db)
}

export function deleteRecurring(db: DB, id: number, deleteInstances: boolean): RecurringRule[] {
  db.transaction(() => {
    if (deleteInstances) {
      db.prepare('DELETE FROM transactions WHERE recurring_rule_id = ?').run(id)
    } else {
      db.prepare(
        'UPDATE transactions SET recurring_rule_id = NULL WHERE recurring_rule_id = ?'
      ).run(id)
    }
    db.prepare('DELETE FROM recurring_rules WHERE id = ?').run(id)
  })()
  return listRecurring(db)
}

/**
 * Generate transaction instances for every active rule whose next_due is in
 * the past (or today), advancing next_due as we go. Called on app launch and
 * after rule changes. Returns number of instances created.
 */
export function generateDueInstances(db: DB): number {
  const today = todayISO()
  const rules = listRecurring(db).filter((r) => r.active)
  let created = 0
  db.transaction(() => {
    for (const rule of rules) {
      let due = rule.nextDue
      let guard = 0
      while (compareISO(due, today) <= 0 && guard < 1000) {
        if (rule.endDate && compareISO(due, rule.endDate) > 0) break
        createTransaction(
          db,
          {
            date: due,
            amountCents: rule.amountCents,
            payee: rule.name,
            categoryId: rule.categoryId,
            accountId: rule.accountId,
            personId: rule.personId,
            notes: null,
            tags: null
          },
          { isRecurringInstance: true, recurringRuleId: rule.id }
        )
        created++
        due = advanceDate(due, rule.frequency)
        guard++
      }
      if (due !== rule.nextDue) {
        db.prepare('UPDATE recurring_rules SET next_due = ? WHERE id = ?').run(due, rule.id)
      }
    }
  })()
  return created
}

/** Expand upcoming instances for the next `days` days (not yet generated). */
export function upcomingInstances(
  db: DB,
  days: number,
  personId: number | null
): UpcomingInstance[] {
  const today = todayISO()
  const horizon = addDaysISO(today, days)
  const out: UpcomingInstance[] = []
  for (const rule of listRecurring(db)) {
    if (!rule.active) continue
    if (personId != null && rule.personId !== personId) continue
    let due = rule.nextDue
    let guard = 0
    while (compareISO(due, horizon) <= 0 && guard < 200) {
      if (rule.endDate && compareISO(due, rule.endDate) > 0) break
      if (compareISO(due, today) >= 0) {
        out.push({
          ruleId: rule.id,
          name: rule.name,
          date: due,
          amountCents: rule.amountCents,
          categoryId: rule.categoryId,
          personId: rule.personId,
          accountId: rule.accountId
        })
      }
      due = advanceDate(due, rule.frequency)
      guard++
    }
  }
  out.sort((a, b) => compareISO(a.date, b.date))
  return out
}

/** Expand recurring flows per (month, person) between two dates (inclusive start, exclusive end). */
export function expandRecurringFlows(
  db: DB,
  start: string,
  end: string,
  monthKeyOfDate: (iso: string) => string
): { month: string; personId: number; incomeCents: number; spendingCents: number }[] {
  const totals = new Map<string, { income: number; spending: number }>()
  for (const rule of listRecurring(db)) {
    if (!rule.active) continue
    let due = rule.nextDue
    let guard = 0
    while (compareISO(due, end) < 0 && guard < 500) {
      if (rule.endDate && compareISO(due, rule.endDate) > 0) break
      if (compareISO(due, start) >= 0) {
        const key = `${monthKeyOfDate(due)}|${rule.personId}`
        const t = totals.get(key) ?? { income: 0, spending: 0 }
        if (rule.amountCents >= 0) t.income += rule.amountCents
        else t.spending += -rule.amountCents
        totals.set(key, t)
      }
      due = advanceDate(due, rule.frequency)
      guard++
    }
  }
  return Array.from(totals.entries()).map(([key, t]) => {
    const [month, pid] = key.split('|')
    return { month, personId: Number(pid), incomeCents: t.income, spendingCents: t.spending }
  })
}
