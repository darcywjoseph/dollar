// Headless-ish smoke test: exercises the whole main-process stack against a
// temp database, then boots the real UI and captures screenshots.
// Run with: DOLLAR_SMOKE=1 electron-vite dev (or preview).

import { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Database as DB } from 'better-sqlite3'
import { addMonthKey, currentMonthKey, monthRange, todayISO, addDaysISO } from '@shared/dates'
import { parseAmountToCents } from '@shared/money'
import { parseDateFlexible } from '@shared/importUtils'
import * as core from './db/core'
import * as tx from './db/transactions'
import * as recurring from './db/recurring'
import * as budgets from './db/budgets'
import * as goals from './db/goals'
import * as analytics from './db/analytics'
import * as backup from './db/backup'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`)
}

export async function runSmokeTest(db: DB, createWindow: () => BrowserWindow): Promise<void> {
  const outDir = process.env.DOLLAR_SMOKE_OUT || process.cwd()
  mkdirSync(outDir, { recursive: true })
  const results: Record<string, unknown> = {}

  // --- seeding ---
  const people = core.listPeople(db)
  assert(people.length === 2, 'two people seeded')
  const accounts = core.listAccounts(db)
  assert(accounts.length >= 2, 'accounts seeded')
  const categories = core.listCategories(db)
  assert(categories.length >= 15, 'categories seeded')
  const txCount0 = tx.listTransactions(db, {}).total
  assert(txCount0 === 0, 'no fake transactions on first run')
  results.seed = { people: people.length, accounts: accounts.length, categories: categories.length }

  // --- parsing utilities ---
  assert(parseAmountToCents('$1,234.56') === 123456, 'parse $1,234.56')
  assert(parseAmountToCents('(12.34)') === -1234, 'parse (12.34)')
  assert(parseAmountToCents('1.234,56') === 123456, 'parse decimal comma')
  assert(parseDateFlexible('2026-07-04') === '2026-07-04', 'parse ISO date')
  assert(parseDateFlexible('07/04/2026') === '2026-07-04', 'parse MDY date')
  assert(parseDateFlexible('04/07/2026', 'dmy') === '2026-07-04', 'parse DMY date')
  assert(parseDateFlexible('Jul 4, 2026') === '2026-07-04', 'parse textual date')

  // --- sample data: savings account, categories, several months of txs ---
  const groceries = categories.find((c) => c.name === 'Groceries')!
  const dining = categories.find((c) => c.name === 'Dining Out')!
  const salary = categories.find((c) => c.name === 'Salary')!
  const acct1 = accounts[0]
  const acct2 = accounts[1]
  core.createAccount(db, { name: 'Joint Savings', personId: null, type: 'savings', startingBalanceCents: 500000, currency: 'USD' })

  const nowMonth = currentMonthKey(1)
  for (let back = 4; back >= 0; back--) {
    const m = addMonthKey(nowMonth, -back)
    const { start } = monthRange(m, 1)
    if (start > todayISO()) continue
    tx.createTransaction(db, { date: start, amountCents: 400000, payee: 'Acme Corp Payroll', categoryId: salary.id, accountId: acct1.id, personId: 1 })
    tx.createTransaction(db, { date: start, amountCents: 380000, payee: 'Globex Payroll', categoryId: salary.id, accountId: acct2.id, personId: 2 })
    for (const [day, amount, payee, cat, person, acct] of [
      [2, -85043, 'Whole Foods', groceries.id, 1, acct1.id],
      [8, -12385, 'Thai Palace', dining.id, 2, acct2.id],
      [15, -76210, 'Trader Joes', groceries.id, 2, acct2.id],
      [20, -6450, 'Blue Bottle', dining.id, 1, acct1.id]
    ] as const) {
      const d = addDaysISO(start, day)
      if (d <= todayISO()) {
        tx.createTransaction(db, { date: d, amountCents: amount, payee, categoryId: cat, accountId: acct, personId: person })
      }
    }
  }

  // --- transaction CRUD ---
  const created = tx.createTransaction(db, {
    date: todayISO(), amountCents: -4599, payee: 'Test Coffee', categoryId: dining.id, accountId: acct1.id, personId: 1
  })
  const updated = tx.updateTransaction(db, created.id, { amountCents: -4999 })
  assert(updated.amountCents === -4999, 'transaction update')
  const filtered = tx.listTransactions(db, { search: 'Test Coffee' })
  assert(filtered.total === 1, 'search filter')
  assert(tx.deleteTransactions(db, [created.id]) === 1, 'transaction delete')

  // --- CSV import with dedupe ---
  const before = tx.listTransactions(db, {}).total
  const rows = [
    { date: '2026-06-10', amountCents: -2500, payee: 'Cinema', categoryId: null },
    { date: '2026-06-10', amountCents: -2500, payee: 'Cinema', categoryId: null }, // legit same-day duplicate
    { date: '2026-06-11', amountCents: -1500, payee: 'Bakery', categoryId: groceries.id }
  ]
  const r1 = tx.importTransactions(db, { rows, accountId: acct1.id, personId: 1 })
  assert(r1.imported === 3 && r1.skipped === 0, `first import keeps in-file duplicates (got ${JSON.stringify(r1)})`)
  const r2 = tx.importTransactions(db, { rows, accountId: acct1.id, personId: 1 })
  assert(r2.imported === 0 && r2.skipped === 3, `re-import is fully deduped (got ${JSON.stringify(r2)})`)
  assert(tx.listTransactions(db, {}).total === before + 3, 'import count')
  results.import = { first: r1, second: r2 }

  // --- recurring rules ---
  const rules = recurring.createRecurring(db, {
    name: 'Netflix', amountCents: -1599, categoryId: null, accountId: acct1.id, personId: 1,
    frequency: 'monthly', nextDue: addMonthKey(nowMonth, -2) + '-05'
  })
  assert(rules.length === 1, 'rule created')
  const instances = tx.listTransactions(db, { search: 'Netflix' })
  assert(instances.total >= 2, `past recurring instances generated (got ${instances.total})`)
  const upcoming = recurring.upcomingInstances(db, 30, null)
  assert(upcoming.length >= 1, 'upcoming instances expand')
  results.recurring = { generated: instances.total, upcoming: upcoming.length }

  // --- budgets ---
  budgets.setBudget(db, nowMonth, groceries.id, '1', 90000)
  budgets.setBudget(db, nowMonth, groceries.id, 'joint', 50000)
  budgets.setBudget(db, nowMonth, groceries.id, 'joint', 60000) // upsert, not duplicate
  const grid = budgets.getBudgetGrid(db, nowMonth)
  const gRow = grid.rows.find((r) => r.categoryId === groceries.id)!
  assert(gRow.budgeted['1'] === 90000 && gRow.budgeted['joint'] === 60000, 'budget upsert by scope')
  const nextMonth = addMonthKey(nowMonth, 1)
  assert(budgets.copyBudgetsFromPrevious(db, nextMonth) === 2, 'copy budgets forward')
  assert(budgets.setBudgetsFromAverage(db, nowMonth) > 0, 'set budgets from average')
  results.budgets = grid.rows.length

  // --- goals ---
  const savingsAcct = core.listAccounts(db).find((a) => a.name === 'Joint Savings')!
  const gp = goals.createGoal(db, { name: 'Vacation', targetCents: 1000000, targetDate: `${new Date().getFullYear() + 1}-06-01`, personId: null, accountIds: [savingsAcct.id] })
  assert(gp.length === 1 && gp[0].currentCents === 500000, 'goal progress from linked account')

  // --- analytics ---
  const dash = analytics.getDashboard(db, nowMonth, null)
  assert(dash.incomeCents > 0 && dash.spendingCents > 0, 'dashboard totals')
  assert(dash.trend.length === 12, 'trend series')
  const dashMe = analytics.getDashboard(db, nowMonth, 1)
  assert(dashMe.spendingCents <= dash.spendingCents, 'person filter narrows')
  const forecast = analytics.getForecast(db, 3)
  assert(forecast.months.length === 12, 'forecast months')
  assert(forecast.variableAverages.length > 0, 'variable averages computed')
  const report = analytics.getYearReport(db, forecast.year, null)
  assert(report.byMonth.length === 12, 'year report months')
  results.dashboard = { income: dash.incomeCents, spending: dash.spendingCents, savings: dash.savingsBalanceCents }
  results.forecast = { averages: forecast.variableAverages.length, recurringFlows: forecast.recurringFlows.length }

  // --- backup roundtrip ---
  const dump = backup.exportBackup(db)
  backup.importBackup(db, JSON.parse(JSON.stringify(dump)))
  const after = backup.exportBackup(db)
  assert(after.transactions.length === dump.transactions.length, 'backup roundtrip preserves transactions')
  assert(after.budgets.length === dump.budgets.length, 'backup roundtrip preserves budgets')
  results.backup = { transactions: after.transactions.length }

  // --- boot the UI and screenshot key pages ---
  const win = createWindow()
  await new Promise<void>((resolve, reject) => {
    win.webContents.once('did-finish-load', () => resolve())
    win.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(`renderer failed to load: ${code} ${desc}`)))
    setTimeout(() => reject(new Error('renderer load timeout')), 30000)
  })
  const crashed: string[] = []
  win.webContents.on('render-process-gone', (_e, details) => crashed.push(details.reason))

  const capture = async (nav: string | null, name: string): Promise<void> => {
    if (nav) {
      await win.webContents.executeJavaScript(
        `(() => { const el = document.querySelector('[data-nav="${nav}"]'); if (el) el.click(); return !!el })()`
      )
    }
    await new Promise((r) => setTimeout(r, 2200))
    const img = await win.webContents.capturePage()
    writeFileSync(join(outDir, `smoke-${name}.png`), img.toPNG())
  }
  await capture(null, 'dashboard')
  await capture('transactions', 'transactions')
  await capture('budgets', 'budgets')
  await capture('forecast', 'forecast')
  assert(crashed.length === 0, `renderer crashed: ${crashed.join(',')}`)

  const errors = await win.webContents.executeJavaScript('window.__ledgerErrors || []')
  results.rendererErrors = errors

  console.log('[smoke] PASS ' + JSON.stringify(results, null, 2))
  win.destroy()
}
