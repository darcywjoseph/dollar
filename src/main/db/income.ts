import type { Database as DB } from 'better-sqlite3'
import type {
  BalanceAdjustmentInput,
  FYIncomeReport,
  FYPersonTotals,
  TrackedBalanceKind,
  TrackedBalancePanel
} from '@shared/types'
import { isValidISO, todayISO } from '@shared/dates'
import { rowToBalanceAdjustment, rowToTrackedBalance } from './helpers'

/** 1 July on/before the given date starts the current Australian FY. */
export function fyStartYearOf(iso: string): number {
  const [y, m] = iso.split('-').map(Number)
  return m >= 7 ? y : y - 1
}

const KINDS: TrackedBalanceKind[] = ['super', 'hecs']

export function getTrackedBalances(db: DB): TrackedBalancePanel[] {
  const fyStart = `${fyStartYearOf(todayISO())}-07-01`
  const people = db.prepare('SELECT id FROM people ORDER BY sort, id').all() as { id: number }[]
  const panels: TrackedBalancePanel[] = []
  for (const p of people) {
    for (const kind of KINDS) {
      const flowSql = kind === 'super' ? 'super_cents + super_extra_cents' : 'hecs_cents'
      const configRow = db
        .prepare('SELECT * FROM tracked_balances WHERE person_id = ? AND kind = ?')
        .get(p.id, kind)
      const config = configRow ? rowToTrackedBalance(configRow) : null
      const sumFlows = (from: string): number =>
        (
          db
            .prepare(
              `SELECT COALESCE(SUM(${flowSql}), 0) AS s FROM payslips WHERE person_id = ? AND pay_date >= ?`
            )
            .get(p.id, from) as { s: number }
        ).s
      const contributionsCents = config ? sumFlows(config.startingDate) : 0
      const adjustments = db
        .prepare(
          'SELECT * FROM balance_adjustments WHERE person_id = ? AND kind = ? ORDER BY date DESC, id DESC'
        )
        .all(p.id, kind)
        .map(rowToBalanceAdjustment)
      const adjustmentsCents = adjustments.reduce((s, a) => s + a.amountCents, 0)
      const currentCents = config
        ? kind === 'super'
          ? config.startingCents + contributionsCents + adjustmentsCents
          : config.startingCents - contributionsCents + adjustmentsCents
        : null
      panels.push({
        personId: p.id,
        kind,
        config,
        contributionsCents,
        adjustmentsCents,
        currentCents,
        fyContributionsCents: sumFlows(fyStart),
        adjustments
      })
    }
  }
  return panels
}

export function setTrackedBalance(
  db: DB,
  personId: number,
  kind: TrackedBalanceKind,
  startingCents: number,
  startingDate: string
): TrackedBalancePanel[] {
  if (!KINDS.includes(kind)) throw new Error(`Unknown balance kind: ${kind}`)
  if (!isValidISO(startingDate)) throw new Error('Invalid starting date')
  if (!Number.isFinite(startingCents)) throw new Error('Invalid starting balance')
  if (!db.prepare('SELECT id FROM people WHERE id = ?').get(personId))
    throw new Error('Person not found')
  db.prepare(
    `INSERT INTO tracked_balances (person_id, kind, starting_cents, starting_date)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(person_id, kind) DO UPDATE SET
       starting_cents = excluded.starting_cents, starting_date = excluded.starting_date`
  ).run(personId, kind, Math.round(startingCents), startingDate)
  return getTrackedBalances(db)
}

export function createBalanceAdjustment(
  db: DB,
  input: BalanceAdjustmentInput
): TrackedBalancePanel[] {
  if (!KINDS.includes(input.kind)) throw new Error(`Unknown balance kind: ${input.kind}`)
  if (!isValidISO(input.date)) throw new Error('Invalid date')
  if (!Number.isFinite(input.amountCents) || input.amountCents === 0)
    throw new Error('Invalid adjustment amount')
  if (!db.prepare('SELECT id FROM people WHERE id = ?').get(input.personId))
    throw new Error('Person not found')
  db.prepare(
    'INSERT INTO balance_adjustments (person_id, kind, date, amount_cents, note) VALUES (?, ?, ?, ?, ?)'
  ).run(input.personId, input.kind, input.date, Math.round(input.amountCents), input.note ?? null)
  return getTrackedBalances(db)
}

export function deleteBalanceAdjustment(db: DB, id: number): TrackedBalancePanel[] {
  db.prepare('DELETE FROM balance_adjustments WHERE id = ?').run(id)
  return getTrackedBalances(db)
}

export function getFinancialYearIncome(
  db: DB,
  fyStartYear: number,
  personId: number | null
): FYIncomeReport {
  const start = `${fyStartYear}-07-01`
  const end = `${fyStartYear + 1}-07-01`
  const personCond = personId != null ? 'AND person_id = ?' : ''
  const personParams = personId != null ? [personId] : []

  const perPerson = db
    .prepare(
      `SELECT person_id,
              COUNT(*) AS n,
              COALESCE(SUM(gross_cents), 0) AS gross,
              COALESCE(SUM(tax_cents), 0) AS tax,
              COALESCE(SUM(super_cents), 0) AS sup,
              COALESCE(SUM(super_extra_cents), 0) AS sup_extra,
              COALESCE(SUM(hecs_cents), 0) AS hecs,
              COALESCE(SUM(other_deductions_cents), 0) AS other,
              COALESCE(SUM(net_cents), 0) AS net
       FROM payslips WHERE pay_date >= ? AND pay_date < ? ${personCond}
       GROUP BY person_id ORDER BY person_id`
    )
    .all(start, end, ...personParams) as {
    person_id: number
    n: number
    gross: number
    tax: number
    sup: number
    sup_extra: number
    hecs: number
    other: number
    net: number
  }[]

  const byMonth = db
    .prepare(
      `SELECT substr(pay_date, 1, 7) AS m, person_id,
              COALESCE(SUM(gross_cents), 0) AS gross, COALESCE(SUM(net_cents), 0) AS net
       FROM payslips WHERE pay_date >= ? AND pay_date < ? ${personCond}
       GROUP BY m, person_id ORDER BY m`
    )
    .all(start, end, ...personParams) as {
    m: string
    person_id: number
    gross: number
    net: number
  }[]

  const totals: FYPersonTotals[] = perPerson.map((r) => ({
    personId: r.person_id,
    payslipCount: r.n,
    grossCents: r.gross,
    taxCents: r.tax,
    superCents: r.sup,
    superExtraCents: r.sup_extra,
    hecsCents: r.hecs,
    otherDeductionsCents: r.other,
    netCents: r.net
  }))

  return {
    fyStartYear,
    perPerson: totals,
    byMonth: byMonth.map((r) => ({
      month: r.m,
      personId: r.person_id,
      grossCents: r.gross,
      netCents: r.net
    }))
  }
}
