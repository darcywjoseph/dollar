import type { Database as DB } from 'better-sqlite3'
import type { Account, AccountBalance, AccountInput, Category, CategoryInput, Person } from '@shared/types'
import { rowToAccount, rowToCategory, rowToPerson } from './helpers'

// ------------------------------- People -----------------------------------

export function listPeople(db: DB): Person[] {
  return db.prepare('SELECT * FROM people ORDER BY sort, id').all().map(rowToPerson)
}

export function updatePerson(db: DB, id: number, patch: { name?: string; color?: string }): Person[] {
  const existing = db.prepare('SELECT * FROM people WHERE id = ?').get(id)
  if (!existing) throw new Error('Person not found')
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('Name cannot be empty')
    db.prepare('UPDATE people SET name = ? WHERE id = ?').run(name, id)
  }
  if (patch.color !== undefined) db.prepare('UPDATE people SET color = ? WHERE id = ?').run(patch.color, id)
  return listPeople(db)
}

// ------------------------------ Accounts ----------------------------------

export function listAccounts(db: DB): Account[] {
  return db.prepare('SELECT * FROM accounts ORDER BY archived, name').all().map(rowToAccount)
}

export function createAccount(db: DB, input: AccountInput): Account[] {
  const name = input.name.trim()
  if (!name) throw new Error('Account name is required')
  db.prepare(
    'INSERT INTO accounts (name, person_id, type, starting_balance_cents, currency) VALUES (?, ?, ?, ?, ?)'
  ).run(name, input.personId, input.type, Math.round(input.startingBalanceCents), input.currency || 'USD')
  return listAccounts(db)
}

export function updateAccount(
  db: DB,
  id: number,
  patch: Partial<AccountInput> & { archived?: boolean }
): Account[] {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!existing) throw new Error('Account not found')
  const sets: string[] = []
  const vals: unknown[] = []
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('Account name is required')
    sets.push('name = ?')
    vals.push(name)
  }
  if (patch.personId !== undefined) {
    sets.push('person_id = ?')
    vals.push(patch.personId)
  }
  if (patch.type !== undefined) {
    sets.push('type = ?')
    vals.push(patch.type)
  }
  if (patch.startingBalanceCents !== undefined) {
    sets.push('starting_balance_cents = ?')
    vals.push(Math.round(patch.startingBalanceCents))
  }
  if (patch.currency !== undefined) {
    sets.push('currency = ?')
    vals.push(patch.currency)
  }
  if (patch.archived !== undefined) {
    sets.push('archived = ?')
    vals.push(patch.archived ? 1 : 0)
  }
  if (sets.length > 0) db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return listAccounts(db)
}

export function deleteAccount(db: DB, id: number): Account[] {
  const used = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?').get(id) as { n: number }
  const ruleUse = db.prepare('SELECT COUNT(*) AS n FROM recurring_rules WHERE account_id = ?').get(id) as { n: number }
  if (used.n > 0 || ruleUse.n > 0) {
    throw new Error('Account has transactions or recurring rules. Archive it instead, or delete those first.')
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  return listAccounts(db)
}

export function accountBalances(db: DB): AccountBalance[] {
  const rows = db
    .prepare(
      `SELECT a.id AS account_id,
              a.starting_balance_cents + COALESCE(SUM(t.amount_cents), 0) AS balance
       FROM accounts a
       LEFT JOIN transactions t ON t.account_id = a.id
       GROUP BY a.id`
    )
    .all() as { account_id: number; balance: number }[]
  return rows.map((r) => ({ accountId: r.account_id, balanceCents: r.balance }))
}

// ----------------------------- Categories ---------------------------------

export function listCategories(db: DB): Category[] {
  return db.prepare("SELECT * FROM categories ORDER BY archived, type = 'income', name").all().map(rowToCategory)
}

export function createCategory(db: DB, input: CategoryInput): Category[] {
  const name = input.name.trim()
  if (!name) throw new Error('Category name is required')
  db.prepare('INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)').run(
    name,
    input.type,
    input.icon || '',
    input.color || '#94a3b8'
  )
  return listCategories(db)
}

export function updateCategory(
  db: DB,
  id: number,
  patch: Partial<CategoryInput> & { archived?: boolean }
): Category[] {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id)
  if (!existing) throw new Error('Category not found')
  const sets: string[] = []
  const vals: unknown[] = []
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('Category name is required')
    sets.push('name = ?')
    vals.push(name)
  }
  if (patch.type !== undefined) {
    sets.push('type = ?')
    vals.push(patch.type)
  }
  if (patch.icon !== undefined) {
    sets.push('icon = ?')
    vals.push(patch.icon)
  }
  if (patch.color !== undefined) {
    sets.push('color = ?')
    vals.push(patch.color)
  }
  if (patch.archived !== undefined) {
    sets.push('archived = ?')
    vals.push(patch.archived ? 1 : 0)
  }
  if (sets.length > 0) db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  return listCategories(db)
}

export function deleteCategory(db: DB, id: number): Category[] {
  // Reassign is destructive-ish; keep it safe: uncategorize transactions, drop budgets.
  db.transaction(() => {
    db.prepare('UPDATE transactions SET category_id = NULL WHERE category_id = ?').run(id)
    db.prepare('UPDATE recurring_rules SET category_id = NULL WHERE category_id = ?').run(id)
    db.prepare('DELETE FROM budgets WHERE category_id = ?').run(id)
    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  })()
  return listCategories(db)
}
