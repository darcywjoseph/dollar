import type { Database as DB } from 'better-sqlite3'
import type {
  IncomePersonTotals,
  IncomeSummary,
  PayEventRow,
  PayFrequency,
  PaySchedule,
  PayScheduleInput,
  Payslip,
  PayslipFilter,
  PayslipInput,
  PayslipSaveOptions,
  Transaction
} from '@shared/types'
import {
  addDaysISO,
  addMonthsISO,
  compareISO,
  isValidISO,
  monthRange,
  todayISO
} from '@shared/dates'
import { getSettings, rowToPaySchedule, rowToPayslip, rowToTransaction } from './helpers'
import { createTransaction, updateTransaction } from './transactions'

/** Days either side of the pay date a bank deposit may land and still match. */
export const PAYSLIP_MATCH_TOLERANCE_DAYS = 3

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------

export function listPayslips(db: DB, filter: PayslipFilter): Payslip[] {
  const conds: string[] = []
  const params: unknown[] = []
  if (filter.personId != null) {
    conds.push('person_id = ?')
    params.push(filter.personId)
  }
  if (filter.from) {
    conds.push('pay_date >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    conds.push('pay_date < ?')
    params.push(filter.to)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  return db
    .prepare(`SELECT * FROM payslips ${where} ORDER BY pay_date DESC, id DESC`)
    .all(...params)
    .map(rowToPayslip)
}

function getPayslip(db: DB, id: number): Payslip {
  const row = db.prepare('SELECT * FROM payslips WHERE id = ?').get(id)
  if (!row) throw new Error('Payslip not found')
  return rowToPayslip(row)
}

function validatePayslip(db: DB, input: PayslipInput): void {
  if (!isValidISO(input.payDate)) throw new Error(`Invalid pay date: ${input.payDate}`)
  for (const [label, d] of [
    ['period start', input.periodStart],
    ['period end', input.periodEnd]
  ] as const) {
    if (d != null && d !== '' && !isValidISO(d)) throw new Error(`Invalid ${label} date`)
  }
  if (!db.prepare('SELECT id FROM people WHERE id = ?').get(input.personId))
    throw new Error('Person not found')
  const amounts: [string, number][] = [
    ['gross', input.grossCents],
    ['tax', input.taxCents],
    ['super', input.superCents],
    ['extra super', input.superExtraCents],
    ['HECS', input.hecsCents],
    ['other deductions', input.otherDeductionsCents],
    ['net', input.netCents]
  ]
  for (const [label, cents] of amounts) {
    if (!Number.isFinite(cents) || cents < 0) throw new Error(`Invalid ${label} amount`)
  }
}

export function createPayslip(db: DB, input: PayslipInput, opts: PayslipSaveOptions): Payslip {
  validatePayslip(db, input)
  const id = db.transaction(() => {
    let transactionId: number
    let source: 'created' | 'linked'
    if (opts.linkTransactionId != null) {
      const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(opts.linkTransactionId)
      if (!row) throw new Error('Transaction to link not found')
      const linked = rowToTransaction(row)
      if (linked.amountCents <= 0) throw new Error('Linked transaction must be income')
      const taken = db
        .prepare('SELECT id FROM payslips WHERE transaction_id = ?')
        .get(opts.linkTransactionId)
      if (taken) throw new Error('Transaction is already linked to another payslip')
      if (linked.categoryId == null && opts.categoryId != null) {
        updateTransaction(db, linked.id, { categoryId: opts.categoryId })
      }
      transactionId = linked.id
      source = 'linked'
    } else {
      const created = createTransaction(db, {
        date: input.payDate,
        amountCents: Math.round(input.netCents),
        payee: input.employer.trim() ? `Payslip — ${input.employer.trim()}` : 'Payslip',
        categoryId: opts.categoryId,
        accountId: opts.accountId,
        personId: input.personId,
        notes: null,
        tags: null
      })
      transactionId = created.id
      source = 'created'
    }
    const scheduleId = matchPayslipToSchedule(db, input.personId, input.payDate)
    const info = db
      .prepare(
        `INSERT INTO payslips
           (person_id, pay_date, period_start, period_end, employer, gross_cents, tax_cents,
            super_cents, super_extra_cents, hecs_cents, other_deductions_cents, net_cents,
            pay_schedule_id, transaction_id, transaction_source, pdf_path, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.personId,
        input.payDate,
        input.periodStart || null,
        input.periodEnd || null,
        input.employer.trim(),
        Math.round(input.grossCents),
        Math.round(input.taxCents),
        Math.round(input.superCents),
        Math.round(input.superExtraCents),
        Math.round(input.hecsCents),
        Math.round(input.otherDeductionsCents),
        Math.round(input.netCents),
        scheduleId,
        transactionId,
        source,
        input.pdfPath || null,
        input.notes ?? null
      )
    return Number(info.lastInsertRowid)
  })()
  return getPayslip(db, id)
}

export function updatePayslip(db: DB, id: number, patch: Partial<PayslipInput>): Payslip {
  const current = getPayslip(db, id)
  const merged: PayslipInput = {
    personId: patch.personId ?? current.personId,
    payDate: patch.payDate ?? current.payDate,
    periodStart: patch.periodStart !== undefined ? patch.periodStart : current.periodStart,
    periodEnd: patch.periodEnd !== undefined ? patch.periodEnd : current.periodEnd,
    employer: patch.employer ?? current.employer,
    grossCents: patch.grossCents ?? current.grossCents,
    taxCents: patch.taxCents ?? current.taxCents,
    superCents: patch.superCents ?? current.superCents,
    superExtraCents: patch.superExtraCents ?? current.superExtraCents,
    hecsCents: patch.hecsCents ?? current.hecsCents,
    otherDeductionsCents: patch.otherDeductionsCents ?? current.otherDeductionsCents,
    netCents: patch.netCents ?? current.netCents,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    pdfPath: patch.pdfPath !== undefined ? patch.pdfPath : current.pdfPath
  }
  validatePayslip(db, merged)
  db.transaction(() => {
    const scheduleId = matchPayslipToSchedule(db, merged.personId, merged.payDate, id)
    db.prepare(
      `UPDATE payslips SET person_id = ?, pay_date = ?, period_start = ?, period_end = ?,
         employer = ?, gross_cents = ?, tax_cents = ?, super_cents = ?, super_extra_cents = ?,
         hecs_cents = ?, other_deductions_cents = ?, net_cents = ?, pay_schedule_id = ?,
         pdf_path = ?, notes = ? WHERE id = ?`
    ).run(
      merged.personId,
      merged.payDate,
      merged.periodStart || null,
      merged.periodEnd || null,
      merged.employer.trim(),
      Math.round(merged.grossCents),
      Math.round(merged.taxCents),
      Math.round(merged.superCents),
      Math.round(merged.superExtraCents),
      Math.round(merged.hecsCents),
      Math.round(merged.otherDeductionsCents),
      Math.round(merged.netCents),
      scheduleId,
      merged.pdfPath || null,
      merged.notes ?? null,
      id
    )
    // Keep the payslip-created ledger row in sync with the slip it represents.
    if (current.transactionSource === 'created' && current.transactionId != null) {
      updateTransaction(db, current.transactionId, {
        date: merged.payDate,
        amountCents: Math.round(merged.netCents),
        personId: merged.personId,
        payee: merged.employer.trim() ? `Payslip — ${merged.employer.trim()}` : 'Payslip'
      })
    }
  })()
  return getPayslip(db, id)
}

export function deletePayslip(db: DB, id: number): Payslip[] {
  const current = getPayslip(db, id)
  db.transaction(() => {
    db.prepare('DELETE FROM payslips WHERE id = ?').run(id)
    if (current.transactionSource === 'created' && current.transactionId != null) {
      db.prepare('DELETE FROM transactions WHERE id = ?').run(current.transactionId)
    }
  })()
  return listPayslips(db, {})
}

// ---------------------------------------------------------------------------
// Bank-statement matching (dedup, both directions)
// ---------------------------------------------------------------------------

/**
 * For each CSV row, the id of the payslip whose net pay it duplicates, or
 * null. A payslip claims at most one row per batch; nearest date wins.
 */
export function matchImportRowsToPayslips(
  db: DB,
  rows: { date: string; amountCents: number }[],
  personId: number
): (number | null)[] {
  const claimed = new Set<number>()
  const findCandidates = db.prepare(
    `SELECT id, pay_date FROM payslips
     WHERE person_id = ? AND net_cents = ? AND pay_date >= ? AND pay_date <= ?
     ORDER BY pay_date`
  )
  return rows.map((row) => {
    if (!isValidISO(row.date) || row.amountCents <= 0) return null
    const candidates = findCandidates.all(
      personId,
      Math.round(row.amountCents),
      addDaysISO(row.date, -PAYSLIP_MATCH_TOLERANCE_DAYS),
      addDaysISO(row.date, PAYSLIP_MATCH_TOLERANCE_DAYS)
    ) as { id: number; pay_date: string }[]
    let best: { id: number; dist: number } | null = null
    for (const c of candidates) {
      if (claimed.has(c.id)) continue
      const dist = Math.abs(Date.parse(c.pay_date) - Date.parse(row.date))
      if (!best || dist < best.dist) best = { id: c.id, dist }
    }
    if (!best) return null
    claimed.add(best.id)
    return best.id
  })
}

/**
 * Existing bank-imported income transactions a new payslip could adopt
 * instead of creating a duplicate ledger row.
 */
export function findBankMatchesForPayslip(
  db: DB,
  personId: number,
  netCents: number,
  payDate: string
): Transaction[] {
  if (!isValidISO(payDate) || !Number.isFinite(netCents) || netCents <= 0) return []
  return db
    .prepare(
      `SELECT * FROM transactions
       WHERE person_id = ? AND amount_cents = ? AND date >= ? AND date <= ?
         AND is_recurring_instance = 0
         AND id NOT IN (SELECT transaction_id FROM payslips WHERE transaction_id IS NOT NULL)
       ORDER BY ABS(julianday(date) - julianday(?))`
    )
    .all(
      personId,
      Math.round(netCents),
      addDaysISO(payDate, -PAYSLIP_MATCH_TOLERANCE_DAYS),
      addDaysISO(payDate, PAYSLIP_MATCH_TOLERANCE_DAYS),
      payDate
    )
    .map(rowToTransaction)
}

// ---------------------------------------------------------------------------
// Pay schedules (expected pay)
// ---------------------------------------------------------------------------

export function listPaySchedules(db: DB): PaySchedule[] {
  return db
    .prepare('SELECT * FROM pay_schedules ORDER BY active DESC, person_id, id')
    .all()
    .map(rowToPaySchedule)
}

function validateSchedule(db: DB, input: PayScheduleInput): void {
  if (!input.name.trim()) throw new Error('Name is required')
  if (!isValidISO(input.anchorDate)) throw new Error('Invalid anchor date')
  if (!Number.isFinite(input.expectedNetCents) || input.expectedNetCents <= 0)
    throw new Error('Invalid expected net amount')
  if (!db.prepare('SELECT id FROM people WHERE id = ?').get(input.personId))
    throw new Error('Person not found')
  if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(input.accountId))
    throw new Error('Account not found')
}

export function createPaySchedule(db: DB, input: PayScheduleInput): PaySchedule[] {
  validateSchedule(db, input)
  db.prepare(
    `INSERT INTO pay_schedules (person_id, name, frequency, anchor_date, expected_net_cents, expected_gross_cents, account_id, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.personId,
    input.name.trim(),
    input.frequency,
    input.anchorDate,
    Math.round(input.expectedNetCents),
    Math.round(input.expectedGrossCents ?? 0),
    input.accountId,
    input.active === false ? 0 : 1
  )
  rematchPayslips(db)
  return listPaySchedules(db)
}

export function updatePaySchedule(
  db: DB,
  id: number,
  patch: Partial<PayScheduleInput>
): PaySchedule[] {
  const row = db.prepare('SELECT * FROM pay_schedules WHERE id = ?').get(id)
  if (!row) throw new Error('Pay schedule not found')
  const current = rowToPaySchedule(row)
  const merged: PayScheduleInput = {
    personId: patch.personId ?? current.personId,
    name: patch.name ?? current.name,
    frequency: patch.frequency ?? current.frequency,
    anchorDate: patch.anchorDate ?? current.anchorDate,
    expectedNetCents: patch.expectedNetCents ?? current.expectedNetCents,
    expectedGrossCents: patch.expectedGrossCents ?? current.expectedGrossCents,
    accountId: patch.accountId ?? current.accountId,
    active: patch.active !== undefined ? patch.active : current.active
  }
  validateSchedule(db, merged)
  db.prepare(
    `UPDATE pay_schedules SET person_id = ?, name = ?, frequency = ?, anchor_date = ?,
       expected_net_cents = ?, expected_gross_cents = ?, account_id = ?, active = ? WHERE id = ?`
  ).run(
    merged.personId,
    merged.name.trim(),
    merged.frequency,
    merged.anchorDate,
    Math.round(merged.expectedNetCents),
    Math.round(merged.expectedGrossCents ?? 0),
    merged.accountId,
    merged.active === false ? 0 : 1,
    id
  )
  rematchPayslips(db)
  return listPaySchedules(db)
}

export function deletePaySchedule(db: DB, id: number): PaySchedule[] {
  db.transaction(() => {
    db.prepare('UPDATE payslips SET pay_schedule_id = NULL WHERE pay_schedule_id = ?').run(id)
    db.prepare('DELETE FROM pay_schedules WHERE id = ?').run(id)
  })()
  return listPaySchedules(db)
}

/** Re-derive every payslip's schedule match after schedule changes. */
function rematchPayslips(db: DB): void {
  const slips = db.prepare('SELECT id, person_id, pay_date FROM payslips').all() as {
    id: number
    person_id: number
    pay_date: string
  }[]
  const upd = db.prepare('UPDATE payslips SET pay_schedule_id = ? WHERE id = ?')
  db.transaction(() => {
    for (const s of slips) {
      upd.run(matchPayslipToSchedule(db, s.person_id, s.pay_date, s.id), s.id)
    }
  })()
}

const HALF_PERIOD_DAYS: Record<PayFrequency, number> = { weekly: 3, biweekly: 7, monthly: 15 }

/** Dates a schedule expects pay on, within [start, end). */
export function expandPayEvents(
  schedule: PaySchedule,
  start: string,
  end: string
): { scheduleId: number; personId: number; date: string; expectedNetCents: number }[] {
  // Always step from the anchor so monthly day-of-month clamping never drifts.
  const at = (k: number): string =>
    schedule.frequency === 'monthly'
      ? addMonthsISO(schedule.anchorDate, k)
      : addDaysISO(schedule.anchorDate, (schedule.frequency === 'weekly' ? 7 : 14) * k)
  let k = 0
  let guard = 0
  while (compareISO(at(k), start) >= 0 && guard++ < 2000) k--
  while (compareISO(at(k), start) < 0 && guard++ < 4000) k++
  const out: { scheduleId: number; personId: number; date: string; expectedNetCents: number }[] = []
  while (compareISO(at(k), end) < 0 && guard++ < 6000) {
    out.push({
      scheduleId: schedule.id,
      personId: schedule.personId,
      date: at(k),
      expectedNetCents: schedule.expectedNetCents
    })
    k++
  }
  return out
}

/**
 * The active schedule whose nearest expected event falls within half a pay
 * period of the pay date, or null. `excludePayslipId` lets updates rematch.
 */
export function matchPayslipToSchedule(
  db: DB,
  personId: number,
  payDate: string,
  excludePayslipId?: number
): number | null {
  const schedules = listPaySchedules(db).filter((s) => s.active && s.personId === personId)
  let best: { scheduleId: number; dist: number } | null = null
  for (const s of schedules) {
    const half = HALF_PERIOD_DAYS[s.frequency]
    const events = expandPayEvents(s, addDaysISO(payDate, -half), addDaysISO(payDate, half + 1))
    for (const e of events) {
      const dist = Math.abs(Date.parse(e.date) - Date.parse(payDate))
      if (dist > half * 86400000) continue
      // Another payslip already sitting on this event keeps its claim.
      const taken = db
        .prepare(
          `SELECT id FROM payslips WHERE pay_schedule_id = ? AND pay_date >= ? AND pay_date <= ?
             AND (? IS NULL OR id != ?) LIMIT 1`
        )
        .get(
          s.id,
          addDaysISO(e.date, -half),
          addDaysISO(e.date, half),
          excludePayslipId ?? null,
          excludePayslipId ?? null
        )
      if (taken) continue
      if (!best || dist < best.dist) best = { scheduleId: s.id, dist }
    }
  }
  return best?.scheduleId ?? null
}

// ---------------------------------------------------------------------------
// Expected-vs-actual summary
// ---------------------------------------------------------------------------

/**
 * Pair expected events in [start, end) with actual payslips. Each payslip
 * satisfies at most one event; nearest date wins.
 */
export function pairedPayEvents(db: DB, start: string, end: string): PayEventRow[] {
  const today = todayISO()
  const schedules = listPaySchedules(db).filter((s) => s.active)
  const rows: PayEventRow[] = []
  for (const s of schedules) {
    const half = HALF_PERIOD_DAYS[s.frequency]
    const events = expandPayEvents(s, start, end)
    if (events.length === 0) continue
    const slips = db
      .prepare(
        `SELECT * FROM payslips WHERE pay_schedule_id = ? AND pay_date >= ? AND pay_date < ?
         ORDER BY pay_date`
      )
      .all(s.id, addDaysISO(start, -half), addDaysISO(end, half))
      .map(rowToPayslip)
    const used = new Set<number>()
    for (const e of events) {
      let best: { slip: Payslip; dist: number } | null = null
      for (const slip of slips) {
        if (used.has(slip.id)) continue
        const dist = Math.abs(Date.parse(slip.payDate) - Date.parse(e.date))
        if (dist > half * 86400000) continue
        if (!best || dist < best.dist) best = { slip, dist }
      }
      if (best) used.add(best.slip.id)
      rows.push({
        scheduleId: s.id,
        scheduleName: s.name,
        personId: s.personId,
        expectedDate: e.date,
        expectedNetCents: e.expectedNetCents,
        payslipId: best ? best.slip.id : null,
        actualDate: best ? best.slip.payDate : null,
        actualNetCents: best ? best.slip.netCents : null,
        varianceCents: best ? best.slip.netCents - e.expectedNetCents : null,
        status: best ? 'received' : compareISO(e.date, today) >= 0 ? 'upcoming' : 'missed'
      })
    }
  }
  rows.sort((a, b) => compareISO(a.expectedDate, b.expectedDate) || a.personId - b.personId)
  return rows
}

export function getIncomeSummary(db: DB, month: string): IncomeSummary {
  const { firstDayOfMonth } = getSettings(db)
  const { start, end } = monthRange(month, firstDayOfMonth)
  const events = pairedPayEvents(db, start, end)
  const unscheduledPayslips = db
    .prepare(
      'SELECT * FROM payslips WHERE pay_schedule_id IS NULL AND pay_date >= ? AND pay_date < ? ORDER BY pay_date'
    )
    .all(start, end)
    .map(rowToPayslip)
  const byPerson = new Map<number, IncomePersonTotals>()
  const bucket = (personId: number): IncomePersonTotals => {
    let t = byPerson.get(personId)
    if (!t) {
      t = { personId, expectedCents: 0, actualCents: 0, varianceCents: 0 }
      byPerson.set(personId, t)
    }
    return t
  }
  for (const e of events) {
    const t = bucket(e.personId)
    t.expectedCents += e.expectedNetCents
    if (e.actualNetCents != null) {
      t.actualCents += e.actualNetCents
      t.varianceCents += e.actualNetCents - e.expectedNetCents
    }
  }
  return { month, events, unscheduledPayslips, totals: [...byPerson.values()] }
}
