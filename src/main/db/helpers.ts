import type { Database as DB } from 'better-sqlite3'
import { createHash } from 'crypto'
import type {
  Account,
  AppSettings,
  BalanceAdjustment,
  Budget,
  Category,
  PaySchedule,
  Payslip,
  Person,
  RecurringRule,
  SavingsGoal,
  TrackedBalance,
  Transaction
} from '@shared/types'

// Row mappers

/* eslint-disable @typescript-eslint/no-explicit-any */

export function rowToPerson(r: any): Person {
  return { id: r.id, name: r.name, color: r.color }
}

export function rowToAccount(r: any): Account {
  return {
    id: r.id,
    name: r.name,
    personId: r.person_id,
    type: r.type,
    startingBalanceCents: r.starting_balance_cents,
    currency: r.currency,
    archived: !!r.archived
  }
}

export function rowToCategory(r: any): Category {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    icon: r.icon,
    color: r.color,
    archived: !!r.archived
  }
}

export function rowToTransaction(r: any): Transaction {
  return {
    id: r.id,
    date: r.date,
    amountCents: r.amount_cents,
    payee: r.payee,
    categoryId: r.category_id,
    accountId: r.account_id,
    personId: r.person_id,
    notes: r.notes,
    tags: r.tags,
    isRecurringInstance: !!r.is_recurring_instance,
    recurringRuleId: r.recurring_rule_id,
    importHash: r.import_hash,
    createdAt: r.created_at
  }
}

export function rowToRule(r: any): RecurringRule {
  return {
    id: r.id,
    name: r.name,
    amountCents: r.amount_cents,
    categoryId: r.category_id,
    accountId: r.account_id,
    personId: r.person_id,
    frequency: r.frequency,
    nextDue: r.next_due,
    endDate: r.end_date,
    notes: r.notes,
    active: !!r.active
  }
}

export function rowToBudget(r: any): Budget {
  return {
    id: r.id,
    month: r.month,
    categoryId: r.category_id,
    personId: r.person_id,
    amountCents: r.amount_cents
  }
}

export function rowToGoal(r: any): SavingsGoal {
  let ids: number[] = []
  try {
    const parsed = JSON.parse(r.account_ids)
    if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === 'number')
  } catch {
    // ignore malformed json
  }
  return {
    id: r.id,
    name: r.name,
    targetCents: r.target_cents,
    targetDate: r.target_date,
    personId: r.person_id,
    accountIds: ids,
    createdAt: r.created_at
  }
}

export function rowToPayslip(r: any): Payslip {
  return {
    id: r.id,
    personId: r.person_id,
    payDate: r.pay_date,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    employer: r.employer,
    grossCents: r.gross_cents,
    taxCents: r.tax_cents,
    superCents: r.super_cents,
    superExtraCents: r.super_extra_cents,
    hecsCents: r.hecs_cents,
    otherDeductionsCents: r.other_deductions_cents,
    netCents: r.net_cents,
    payScheduleId: r.pay_schedule_id,
    transactionId: r.transaction_id,
    transactionSource: r.transaction_source,
    pdfFilename: r.pdf_filename ?? null,
    notes: r.notes,
    createdAt: r.created_at
  }
}

export function rowToPaySchedule(r: any): PaySchedule {
  return {
    id: r.id,
    personId: r.person_id,
    name: r.name,
    frequency: r.frequency,
    anchorDate: r.anchor_date,
    expectedNetCents: r.expected_net_cents,
    expectedGrossCents: r.expected_gross_cents,
    accountId: r.account_id,
    active: !!r.active
  }
}

export function rowToTrackedBalance(r: any): TrackedBalance {
  return {
    id: r.id,
    personId: r.person_id,
    kind: r.kind,
    startingCents: r.starting_cents,
    startingDate: r.starting_date
  }
}

export function rowToBalanceAdjustment(r: any): BalanceAdjustment {
  return {
    id: r.id,
    personId: r.person_id,
    kind: r.kind,
    date: r.date,
    amountCents: r.amount_cents,
    note: r.note
  }
}

// Settings

export function getSettingsMap(db: DB): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export function getSettings(db: DB): AppSettings {
  const m = getSettingsMap(db)
  const firstDay = Math.min(28, Math.max(1, parseInt(m.firstDayOfMonth ?? '1', 10) || 1))
  const win = m.forecastWindow === '6' ? 6 : 3
  const theme = m.theme === 'light' || m.theme === 'dark' ? m.theme : 'system'
  return {
    currencySymbol: m.currencySymbol ?? '$',
    firstDayOfMonth: firstDay,
    theme,
    viewMode: m.viewMode ?? 'combined',
    forecastWindow: win
  }
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function baseImportHash(date: string, amountCents: number, payee: string): string {
  const norm = payee.trim().toLowerCase().replace(/\s+/g, ' ')
  return createHash('sha1').update(`${date}|${amountCents}|${norm}`).digest('hex')
}

/** Count of existing transactions whose hash derives from this base. */
export function existingHashCount(db: DB, base: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE import_hash = ? OR import_hash LIKE ? || ':%'"
    )
    .get(base, base) as { n: number }
  return row.n
}

export function hashWithOccurrence(base: string, occurrence: number): string {
  return occurrence === 0 ? base : `${base}:${occurrence}`
}

/** SQL condition excluding transactions categorised as internal transfers,
 *  which move money between own accounts and are neither income nor spending. */
export function notTransferSql(alias = ''): string {
  const col = alias ? `${alias}.category_id` : 'category_id'
  return `(${col} IS NULL OR ${col} NOT IN (SELECT id FROM categories WHERE type = 'transfer'))`
}

/** SQL expression mapping a tx date to its budget-month key for firstDay. */
export function monthKeySql(firstDay: number, column = 'date'): string {
  const shift = firstDay - 1
  return shift === 0
    ? `substr(${column}, 1, 7)`
    : `strftime('%Y-%m', date(${column}, '-${shift} days'))`
}
