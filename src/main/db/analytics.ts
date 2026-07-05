import type { Database as DB } from 'better-sqlite3'
import type {
  DashboardSummary,
  ExpectedPayFlow,
  ForecastActualMonth,
  ForecastData,
  MonthPoint,
  RecurringMonthFlow,
  VariableAverage,
  YearReport
} from '@shared/types'
import {
  addMonthKey,
  compareISO,
  currentMonthKey,
  lastNMonthKeys,
  monthKeyOf,
  monthKeysOfYear,
  monthRange,
  todayISO
} from '@shared/dates'
import { getSettings, monthKeySql, notTransferSql } from './helpers'
import { expandRecurringFlows, upcomingInstances } from './recurring'
import { expandPayEvents, listPaySchedules, pairedPayEvents } from './payslips'

// Dashboard

export function getDashboard(db: DB, month: string, personId: number | null): DashboardSummary {
  const settings = getSettings(db)
  const firstDay = settings.firstDayOfMonth
  const { start, end } = monthRange(month, firstDay)

  const personCond = personId != null ? 'AND person_id = ?' : ''
  const personParams = personId != null ? [personId] : []
  const notTransfer = notTransferSql()

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS spending
       FROM transactions WHERE date >= ? AND date < ? AND ${notTransfer} ${personCond}`
    )
    .get(start, end, ...personParams) as { income: number; spending: number }

  const byCategory = (
    db
      .prepare(
        `SELECT category_id, -SUM(amount_cents) AS spent
         FROM transactions
         WHERE amount_cents < 0 AND date >= ? AND date < ? AND ${notTransfer} ${personCond}
         GROUP BY category_id ORDER BY spent DESC`
      )
      .all(start, end, ...personParams) as { category_id: number | null; spent: number }[]
  ).map((r) => ({ categoryId: r.category_id, spentCents: r.spent }))

  // Budgets in scope: person view -> that person's budgets; combined -> all scopes summed.
  const budgetCond = personId != null ? 'WHERE month = ? AND person_id = ?' : 'WHERE month = ?'
  const budgetParams = personId != null ? [month, personId] : [month]
  const budgetRows = db
    .prepare(
      `SELECT category_id, SUM(amount_cents) AS budgeted FROM budgets ${budgetCond} GROUP BY category_id`
    )
    .all(...budgetParams) as { category_id: number; budgeted: number }[]

  const actualByCat = new Map(byCategory.map((c) => [c.categoryId, c.spentCents]))
  const budgetVsActual = budgetRows
    .map((b) => ({
      categoryId: b.category_id,
      budgetedCents: b.budgeted,
      actualCents: actualByCat.get(b.category_id) ?? 0
    }))
    .sort((a, b) => b.budgetedCents - a.budgetedCents)

  // Last 12 months (including this one) income vs spending
  const trendStart = monthRange(addMonthKey(month, -11), firstDay).start
  const mk = monthKeySql(firstDay)
  const trendRows = db
    .prepare(
      `SELECT ${mk} AS m,
              COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS spending
       FROM transactions WHERE date >= ? AND date < ? AND ${notTransfer} ${personCond}
       GROUP BY m ORDER BY m`
    )
    .all(trendStart, end, ...personParams) as { m: string; income: number; spending: number }[]
  const trendMap = new Map(trendRows.map((r) => [r.m, r]))
  const trend: MonthPoint[] = []
  for (let i = 11; i >= 0; i--) {
    const key = addMonthKey(month, -i)
    const r = trendMap.get(key)
    trend.push({ month: key, incomeCents: r?.income ?? 0, spendingCents: r?.spending ?? 0 })
  }

  // Savings balance: savings-type accounts. Person view: accounts owned by
  // that person; combined: all accounts including joint.
  const savCond = personId != null ? 'AND a.person_id = ?' : ''
  const savings = db
    .prepare(
      `SELECT COALESCE(SUM(a.starting_balance_cents + COALESCE(tx.total, 0)), 0) AS balance
       FROM accounts a
       LEFT JOIN (SELECT account_id, SUM(amount_cents) AS total FROM transactions GROUP BY account_id) tx
         ON tx.account_id = a.id
       WHERE a.type = 'savings' AND a.archived = 0 ${savCond}`
    )
    .get(...personParams) as { balance: number }

  // Expected pay events later this month that have no payslip yet.
  const expectedIncomeRemainingCents = pairedPayEvents(db, start, end)
    .filter((e) => e.status === 'upcoming' && (personId == null || e.personId === personId))
    .reduce((s, e) => s + e.expectedNetCents, 0)

  return {
    incomeCents: totals.income,
    spendingCents: totals.spending,
    netCents: totals.income - totals.spending,
    savingsBalanceCents: savings.balance,
    expectedIncomeRemainingCents,
    byCategory,
    budgetVsActual,
    trend,
    upcoming: upcomingInstances(db, 30, personId)
  }
}

// Forecast

export function getForecast(db: DB, windowMonths: number): ForecastData {
  const settings = getSettings(db)
  const firstDay = settings.firstDayOfMonth
  const win = windowMonths === 6 ? 6 : 3
  const today = todayISO()
  const nowMonth = currentMonthKey(firstDay)
  const year = Number(nowMonth.slice(0, 4))
  const months = monthKeysOfYear(year)
  const mk = monthKeySql(firstDay)

  // Actual income/spending/net per month of this year, up to and including now.
  const yearStart = monthRange(months[0], firstDay).start
  const { start: curStart, end: curEnd } = monthRange(nowMonth, firstDay)
  const actualRows = db
    .prepare(
      `SELECT ${mk} AS m, person_id,
              COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS spending
       FROM transactions WHERE date >= ? AND date <= ? AND ${notTransferSql()}
       GROUP BY m, person_id ORDER BY m`
    )
    .all(yearStart, today) as { m: string; person_id: number; income: number; spending: number }[]

  const actualsByMonth = new Map<string, ForecastActualMonth>()
  for (const r of actualRows) {
    let a = actualsByMonth.get(r.m)
    if (!a) {
      a = { month: r.m, netByPerson: {}, incomeCents: 0, spendingCents: 0 }
      actualsByMonth.set(r.m, a)
    }
    a.netByPerson[String(r.person_id)] =
      (a.netByPerson[String(r.person_id)] ?? 0) + r.income - r.spending
    a.incomeCents += r.income
    a.spendingCents += r.spending
  }
  const actuals = months
    .filter((m) => compareISO(m, nowMonth) < 0)
    .map(
      (m) =>
        actualsByMonth.get(m) ?? { month: m, netByPerson: {}, incomeCents: 0, spendingCents: 0 }
    )
  const currentMonthActual = actualsByMonth.get(nowMonth) ?? {
    month: nowMonth,
    netByPerson: {},
    incomeCents: 0,
    spendingCents: 0
  }

  // People with an active pay schedule get their income projected from the
  // schedule instead of trailing averages.
  const scheduledPersonIds = [
    ...new Set(
      listPaySchedules(db)
        .filter((s) => s.active)
        .map((s) => s.personId)
    )
  ]

  // Trailing-average variable (non-recurring) flows per person+category.
  // Scheduled people's income is excluded — expected pay supersedes it.
  const winMonths = lastNMonthKeys(nowMonth, win)
  const winStart = monthRange(winMonths[0], firstDay).start
  const schedPlaceholders = scheduledPersonIds.map(() => '?').join(', ')
  const schedExclusion = scheduledPersonIds.length
    ? `AND NOT (t.person_id IN (${schedPlaceholders})
           AND (c.type = 'income' OR (t.category_id IS NULL AND t.amount_cents > 0)))`
    : ''
  const varRows = db
    .prepare(
      `SELECT t.person_id, t.category_id, SUM(t.amount_cents) AS total
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.is_recurring_instance = 0 AND t.date >= ? AND t.date < ?
         AND ${notTransferSql('t')} ${schedExclusion}
       GROUP BY t.person_id, t.category_id`
    )
    .all(winStart, curStart, ...scheduledPersonIds) as {
    person_id: number
    category_id: number | null
    total: number
  }[]
  const variableAverages: VariableAverage[] = varRows.map((r) => ({
    personId: r.person_id,
    categoryId: r.category_id,
    avgCents: Math.round(r.total / win)
  }))

  // Recurring flows for future months of this year, plus what's still due
  // in the current month.
  const yearEnd = monthRange(months[11], firstDay).end
  const flows = expandRecurringFlows(db, today, yearEnd, (iso) => monthKeyOf(iso, firstDay))
  const recurringFlows: RecurringMonthFlow[] = flows.filter(
    (f) => compareISO(f.month, nowMonth) > 0
  )
  const currentMonthRemainingRecurring: RecurringMonthFlow[] = flows.filter(
    (f) => f.month === nowMonth
  )

  // Expected pay: per-pay replacement. In the current month only events that
  // are still ahead and have no payslip count (entered payslips are already
  // in currentMonthActual); future months take every scheduled event.
  const currentMonthRemainingExpectedPay: ExpectedPayFlow[] = []
  {
    const byPerson = new Map<number, number>()
    for (const e of pairedPayEvents(db, curStart, curEnd)) {
      if (e.status !== 'upcoming') continue
      byPerson.set(e.personId, (byPerson.get(e.personId) ?? 0) + e.expectedNetCents)
    }
    for (const [personId, netCents] of byPerson) {
      currentMonthRemainingExpectedPay.push({ month: nowMonth, personId, netCents })
    }
  }
  const expectedPayFlows: ExpectedPayFlow[] = []
  {
    const totals = new Map<string, number>()
    for (const s of listPaySchedules(db)) {
      if (!s.active) continue
      for (const e of expandPayEvents(s, curEnd, yearEnd)) {
        const key = `${monthKeyOf(e.date, firstDay)}|${s.personId}`
        totals.set(key, (totals.get(key) ?? 0) + e.expectedNetCents)
      }
    }
    for (const [key, netCents] of totals) {
      const [month, pid] = key.split('|')
      if (compareISO(month, nowMonth) > 0) {
        expectedPayFlows.push({ month, personId: Number(pid), netCents })
      }
    }
  }

  // Elapsed fraction of the current budget month.
  const msPerDay = 86400000
  const elapsedDays = (Date.parse(today) - Date.parse(curStart)) / msPerDay + 1
  const totalDays = (Date.parse(curEnd) - Date.parse(curStart)) / msPerDay
  const currentMonthElapsed = Math.min(1, Math.max(0, elapsedDays / totalDays))

  // Current balances grouped by owner ('1', '2', 'joint').
  const balRows = db
    .prepare(
      `SELECT a.person_id, SUM(a.starting_balance_cents + COALESCE(tx.total, 0)) AS balance
       FROM accounts a
       LEFT JOIN (SELECT account_id, SUM(amount_cents) AS total FROM transactions GROUP BY account_id) tx
         ON tx.account_id = a.id
       WHERE a.archived = 0
       GROUP BY a.person_id`
    )
    .all() as { person_id: number | null; balance: number }[]
  const balancesByOwner: Record<string, number> = {}
  for (const r of balRows)
    balancesByOwner[r.person_id == null ? 'joint' : String(r.person_id)] = r.balance

  return {
    year,
    months,
    currentMonth: nowMonth,
    currentMonthElapsed,
    actuals,
    currentMonthActual,
    currentMonthRemainingRecurring,
    variableAverages,
    recurringFlows,
    expectedPayFlows,
    currentMonthRemainingExpectedPay,
    scheduledPersonIds,
    balancesByOwner,
    windowMonths: win
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function getYearReport(db: DB, year: number, personId: number | null): YearReport {
  const settings = getSettings(db)
  const firstDay = settings.firstDayOfMonth
  const months = monthKeysOfYear(year)
  const start = monthRange(months[0], firstDay).start
  const end = monthRange(months[11], firstDay).end
  const mk = monthKeySql(firstDay)

  const personCond = personId != null ? 'AND person_id = ?' : ''
  const personParams = personId != null ? [personId] : []
  const notTransfer = notTransferSql()

  const byMonthRows = db
    .prepare(
      `SELECT ${mk} AS m,
              COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS spending
       FROM transactions WHERE date >= ? AND date < ? AND ${notTransfer} ${personCond}
       GROUP BY m`
    )
    .all(start, end, ...personParams) as { m: string; income: number; spending: number }[]
  const byMonthMap = new Map(byMonthRows.map((r) => [r.m, r]))
  const byMonth = months.map((m) => ({
    month: m,
    incomeCents: byMonthMap.get(m)?.income ?? 0,
    spendingCents: byMonthMap.get(m)?.spending ?? 0
  }))

  const categoryByMonth = (
    db
      .prepare(
        `SELECT ${mk} AS m, category_id, -SUM(amount_cents) AS spent
         FROM transactions
         WHERE amount_cents < 0 AND date >= ? AND date < ? AND ${notTransfer} ${personCond}
         GROUP BY m, category_id`
      )
      .all(start, end, ...personParams) as {
      m: string
      category_id: number | null
      spent: number
    }[]
  ).map((r) => ({ month: r.m, categoryId: r.category_id, spentCents: r.spent }))

  const personByMonth = (
    db
      .prepare(
        `SELECT ${mk} AS m, person_id,
                COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS spending
         FROM transactions WHERE date >= ? AND date < ? AND ${notTransfer}
         GROUP BY m, person_id`
      )
      .all(start, end) as { m: string; person_id: number; income: number; spending: number }[]
  ).map((r) => ({
    month: r.m,
    personId: r.person_id,
    incomeCents: r.income,
    spendingCents: r.spending
  }))

  return { year, byMonth, categoryByMonth, personByMonth }
}
