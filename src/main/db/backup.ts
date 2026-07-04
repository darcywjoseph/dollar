import type { Database as DB } from 'better-sqlite3'
import type { BackupData } from '@shared/types'
import {
  getSettingsMap,
  rowToAccount,
  rowToBudget,
  rowToCategory,
  rowToGoal,
  rowToPerson,
  rowToRule,
  rowToTransaction
} from './helpers'

export const BACKUP_VERSION = 1

export function exportBackup(db: DB): BackupData {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: getSettingsMap(db),
    people: db.prepare('SELECT * FROM people ORDER BY id').all().map(rowToPerson),
    accounts: db.prepare('SELECT * FROM accounts ORDER BY id').all().map(rowToAccount),
    categories: db.prepare('SELECT * FROM categories ORDER BY id').all().map(rowToCategory),
    transactions: db.prepare('SELECT * FROM transactions ORDER BY id').all().map(rowToTransaction),
    recurringRules: db.prepare('SELECT * FROM recurring_rules ORDER BY id').all().map(rowToRule),
    budgets: db.prepare('SELECT * FROM budgets ORDER BY id').all().map(rowToBudget),
    savingsGoals: db.prepare('SELECT * FROM savings_goals ORDER BY id').all().map(rowToGoal)
  }
}

export function importBackup(db: DB, data: unknown): void {
  const d = data as BackupData
  if (!d || typeof d !== 'object' || d.version !== BACKUP_VERSION) {
    throw new Error('Not a valid dollar backup file')
  }
  for (const key of ['people', 'accounts', 'categories', 'transactions', 'recurringRules', 'budgets', 'savingsGoals'] as const) {
    if (!Array.isArray(d[key])) throw new Error(`Backup is missing "${key}"`)
  }
  if (d.people.length !== 2) throw new Error('Backup must contain exactly two people')

  db.transaction(() => {
    db.prepare('DELETE FROM transactions').run()
    db.prepare('DELETE FROM budgets').run()
    db.prepare('DELETE FROM savings_goals').run()
    db.prepare('DELETE FROM recurring_rules').run()
    db.prepare('DELETE FROM accounts').run()
    db.prepare('DELETE FROM categories').run()
    db.prepare('DELETE FROM people').run()
    db.prepare('DELETE FROM settings').run()

    const insPerson = db.prepare('INSERT INTO people (id, name, color, sort) VALUES (?, ?, ?, ?)')
    d.people.forEach((p, i) => insPerson.run(p.id, p.name, p.color, i))

    const insAccount = db.prepare(
      'INSERT INTO accounts (id, name, person_id, type, starting_balance_cents, currency, archived) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (const a of d.accounts) {
      insAccount.run(a.id, a.name, a.personId, a.type, a.startingBalanceCents, a.currency, a.archived ? 1 : 0)
    }

    const insCategory = db.prepare(
      'INSERT INTO categories (id, name, type, icon, color, archived) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const c of d.categories) insCategory.run(c.id, c.name, c.type, c.icon, c.color, c.archived ? 1 : 0)

    const insRule = db.prepare(
      `INSERT INTO recurring_rules (id, name, amount_cents, category_id, account_id, person_id, frequency, next_due, end_date, notes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of d.recurringRules) {
      insRule.run(
        r.id, r.name, r.amountCents, r.categoryId, r.accountId, r.personId,
        r.frequency, r.nextDue, r.endDate, r.notes, r.active ? 1 : 0
      )
    }

    const insTx = db.prepare(
      `INSERT INTO transactions (id, date, amount_cents, payee, category_id, account_id, person_id, notes, tags,
         is_recurring_instance, recurring_rule_id, import_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const t of d.transactions) {
      insTx.run(
        t.id, t.date, t.amountCents, t.payee, t.categoryId, t.accountId, t.personId, t.notes, t.tags,
        t.isRecurringInstance ? 1 : 0, t.recurringRuleId, t.importHash, t.createdAt
      )
    }

    const insBudget = db.prepare('INSERT INTO budgets (id, month, category_id, person_id, amount_cents) VALUES (?, ?, ?, ?, ?)')
    for (const b of d.budgets) insBudget.run(b.id, b.month, b.categoryId, b.personId, b.amountCents)

    const insGoal = db.prepare(
      'INSERT INTO savings_goals (id, name, target_cents, target_date, person_id, account_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (const g of d.savingsGoals) {
      insGoal.run(g.id, g.name, g.targetCents, g.targetDate, g.personId, JSON.stringify(g.accountIds), g.createdAt)
    }

    const insSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    for (const [k, v] of Object.entries(d.settings ?? {})) insSetting.run(k, String(v))
  })()
}
