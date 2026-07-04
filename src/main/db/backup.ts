import type { Database as DB } from 'better-sqlite3'
import type { BackupData } from '@shared/types'
import {
  getSettingsMap,
  rowToAccount,
  rowToBalanceAdjustment,
  rowToBudget,
  rowToCategory,
  rowToGoal,
  rowToPaySchedule,
  rowToPayslip,
  rowToPerson,
  rowToRule,
  rowToTrackedBalance,
  rowToTransaction
} from './helpers'

export const BACKUP_VERSION = 2

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
    savingsGoals: db.prepare('SELECT * FROM savings_goals ORDER BY id').all().map(rowToGoal),
    payslips: db.prepare('SELECT * FROM payslips ORDER BY id').all().map(rowToPayslip),
    paySchedules: db.prepare('SELECT * FROM pay_schedules ORDER BY id').all().map(rowToPaySchedule),
    trackedBalances: db
      .prepare('SELECT * FROM tracked_balances ORDER BY id')
      .all()
      .map(rowToTrackedBalance),
    balanceAdjustments: db
      .prepare('SELECT * FROM balance_adjustments ORDER BY id')
      .all()
      .map(rowToBalanceAdjustment)
  }
}

export function importBackup(db: DB, data: unknown): void {
  const d = data as BackupData
  // v1 backups predate payslips; their new arrays default to empty below.
  if (!d || typeof d !== 'object' || (d.version !== 1 && d.version !== BACKUP_VERSION)) {
    throw new Error('Not a valid dollar backup file')
  }
  for (const key of [
    'people',
    'accounts',
    'categories',
    'transactions',
    'recurringRules',
    'budgets',
    'savingsGoals'
  ] as const) {
    if (!Array.isArray(d[key])) throw new Error(`Backup is missing "${key}"`)
  }
  if (d.people.length !== 2) throw new Error('Backup must contain exactly two people')

  db.transaction(() => {
    db.prepare('DELETE FROM balance_adjustments').run()
    db.prepare('DELETE FROM tracked_balances').run()
    db.prepare('DELETE FROM payslips').run()
    db.prepare('DELETE FROM transactions').run()
    db.prepare('DELETE FROM pay_schedules').run()
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
      insAccount.run(
        a.id,
        a.name,
        a.personId,
        a.type,
        a.startingBalanceCents,
        a.currency,
        a.archived ? 1 : 0
      )
    }

    const insCategory = db.prepare(
      'INSERT INTO categories (id, name, type, icon, color, archived) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const c of d.categories)
      insCategory.run(c.id, c.name, c.type, c.icon, c.color, c.archived ? 1 : 0)

    const insRule = db.prepare(
      `INSERT INTO recurring_rules (id, name, amount_cents, category_id, account_id, person_id, frequency, next_due, end_date, notes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of d.recurringRules) {
      insRule.run(
        r.id,
        r.name,
        r.amountCents,
        r.categoryId,
        r.accountId,
        r.personId,
        r.frequency,
        r.nextDue,
        r.endDate,
        r.notes,
        r.active ? 1 : 0
      )
    }

    const insTx = db.prepare(
      `INSERT INTO transactions (id, date, amount_cents, payee, category_id, account_id, person_id, notes, tags,
         is_recurring_instance, recurring_rule_id, import_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const t of d.transactions) {
      insTx.run(
        t.id,
        t.date,
        t.amountCents,
        t.payee,
        t.categoryId,
        t.accountId,
        t.personId,
        t.notes,
        t.tags,
        t.isRecurringInstance ? 1 : 0,
        t.recurringRuleId,
        t.importHash,
        t.createdAt
      )
    }

    const insBudget = db.prepare(
      'INSERT INTO budgets (id, month, category_id, person_id, amount_cents) VALUES (?, ?, ?, ?, ?)'
    )
    for (const b of d.budgets) insBudget.run(b.id, b.month, b.categoryId, b.personId, b.amountCents)

    const insGoal = db.prepare(
      'INSERT INTO savings_goals (id, name, target_cents, target_date, person_id, account_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (const g of d.savingsGoals) {
      insGoal.run(
        g.id,
        g.name,
        g.targetCents,
        g.targetDate,
        g.personId,
        JSON.stringify(g.accountIds),
        g.createdAt
      )
    }

    const insSchedule = db.prepare(
      `INSERT INTO pay_schedules (id, person_id, name, frequency, anchor_date, expected_net_cents, expected_gross_cents, account_id, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const s of d.paySchedules ?? []) {
      insSchedule.run(
        s.id,
        s.personId,
        s.name,
        s.frequency,
        s.anchorDate,
        s.expectedNetCents,
        s.expectedGrossCents,
        s.accountId,
        s.active ? 1 : 0
      )
    }

    const insPayslip = db.prepare(
      `INSERT INTO payslips (id, person_id, pay_date, period_start, period_end, employer, gross_cents, tax_cents,
         super_cents, super_extra_cents, hecs_cents, other_deductions_cents, net_cents,
         pay_schedule_id, transaction_id, transaction_source, pdf_path, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const p of d.payslips ?? []) {
      insPayslip.run(
        p.id,
        p.personId,
        p.payDate,
        p.periodStart,
        p.periodEnd,
        p.employer,
        p.grossCents,
        p.taxCents,
        p.superCents,
        p.superExtraCents,
        p.hecsCents,
        p.otherDeductionsCents,
        p.netCents,
        p.payScheduleId,
        p.transactionId,
        p.transactionSource,
        p.pdfPath,
        p.notes,
        p.createdAt
      )
    }

    const insBalance = db.prepare(
      'INSERT INTO tracked_balances (id, person_id, kind, starting_cents, starting_date) VALUES (?, ?, ?, ?, ?)'
    )
    for (const b of d.trackedBalances ?? [])
      insBalance.run(b.id, b.personId, b.kind, b.startingCents, b.startingDate)

    const insAdj = db.prepare(
      'INSERT INTO balance_adjustments (id, person_id, kind, date, amount_cents, note) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const a of d.balanceAdjustments ?? [])
      insAdj.run(a.id, a.personId, a.kind, a.date, a.amountCents, a.note)

    const insSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    for (const [k, v] of Object.entries(d.settings ?? {})) insSetting.run(k, String(v))
  })()
}
