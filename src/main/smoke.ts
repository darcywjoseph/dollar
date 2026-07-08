// Headless-ish smoke test: exercises the whole main-process stack against a
// temp database, then boots the real UI and captures screenshots.
// Run with: DOLLAR_SMOKE=1 electron-vite dev (or preview).

import { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Database as DB } from 'better-sqlite3'
import {
  addMonthKey,
  currentMonthKey,
  monthKeyOf,
  monthRange,
  todayISO,
  addDaysISO
} from '@shared/dates'
import { parseAmountToCents } from '@shared/money'
import { parseDateFlexible } from '@shared/importUtils'
import { parseBankStatement } from '@shared/bankStatement'
import { parseStatementPdf } from './statementPdf'
import * as core from './db/core'
import * as tx from './db/transactions'
import * as recurring from './db/recurring'
import * as budgets from './db/budgets'
import * as goals from './db/goals'
import * as analytics from './db/analytics'
import * as backup from './db/backup'
import * as payslips from './db/payslips'
import * as income from './db/income'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`)
}

/** Minimal one-page PDF drawing each line of text on its own baseline. */
function buildTestPdf(lines: string[]): Buffer {
  const content =
    'BT /F1 10 Tf\n' +
    lines
      .map((l, i) => `1 0 0 1 40 ${760 - i * 14} Tm (${l.replace(/([\\()])/g, '\\$1')}) Tj`)
      .join('\n') +
    '\nET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out, 'latin1')
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

  // --- PDF bank statement parsing ---
  const stmtLines = [
    'Your Statement',
    'Statement Period 2 Dec 2025 - 3 Jun 2026',
    'Date Transaction Debit Credit Balance',
    '02 Dec 2025 OPENING BALANCE Nil',
    '23 Dec Transfer from savings 30.00 30.00 CR',
    '30 Dec WOOLWORTHS 5547 WALKERVILLE',
    'Card xx6122',
    'Value Date 29/12/2025 8.50 21.50 CR',
    '18 Apr BUPA HI PTY LTD 53.13 31.63 DR',
    '19 Apr Salary deposit 331.63 300.00 CR',
    '03 Jun 2026 CLOSING BALANCE 300.00 CR'
  ]
  const checkStatement = (parsed: ReturnType<typeof parseBankStatement>, label: string): void => {
    assert(
      parsed.periodStart === '2025-12-02' && parsed.periodEnd === '2026-06-03',
      `${label}: statement period detected (got ${parsed.periodStart}..${parsed.periodEnd})`
    )
    assert(parsed.warnings.length === 0, `${label}: no warnings (got ${parsed.warnings[0]})`)
    assert(
      parsed.transactions.length === 4,
      `${label}: row count (got ${parsed.transactions.length})`
    )
    const [a, b, c, d] = parsed.transactions
    // year inferred per row from the period; sign from the balance movement
    assert(a.date === '2025-12-23' && a.amountCents === 3000, `${label}: credit row`)
    assert(
      b.date === '2025-12-30' &&
        b.amountCents === -850 &&
        b.description === 'WOOLWORTHS 5547 WALKERVILLE',
      `${label}: multi-line debit row drops card metadata (got ${JSON.stringify(b)})`
    )
    assert(c.date === '2026-04-18' && c.amountCents === -5313, `${label}: overdrawn (DR) balance`)
    assert(d.date === '2026-04-19' && d.amountCents === 33163, `${label}: deposit from DR balance`)
    assert(
      parsed.openingBalanceCents === 0 && parsed.closingBalanceCents === 30000,
      `${label}: opening/closing balances (got ${parsed.openingBalanceCents}/${parsed.closingBalanceCents})`
    )
  }
  checkStatement(parseBankStatement(stmtLines), 'statement lines')
  // through a real PDF: exercises pdf.js text extraction end to end
  checkStatement(await parseStatementPdf(buildTestPdf(stmtLines)), 'statement pdf')

  // --- NetBank "Transaction Summary" letter format ---
  const summaryLines = [
    'Account Number 067873 23355473',
    'Here is your account information and a list of transactions from 01/05/26-04/07/26.',
    'Date Transaction details Amount Balance',
    '07 May 2026 Transfer from xxxx CommBank app $650.00 $250.00',
    '09 May 2026 Transfer To Henley Beach Rentals -$1,300.00 -$1,050.00',
    'CommBank App Rent',
    'Value Date: 10/05/2026',
    '21 May 2026 CRUNCHY BITES ADELAIDE AU -$12.64 -$1,062.64',
    'Created 04/07/26 11:15pm (Sydney/Melbourne time)',
    'While this letter is accurate, we are not responsible for reliance on it.',
    'Date Transaction details Amount Balance',
    '22 May 2026 Transfer from xxxx CommBank app $1,100.00 $37.36',
    'Rent',
    'Any pending transactions have not been included in this list.',
    'This line is footer text that must not attach to a transaction.'
  ]
  const summary = parseBankStatement(summaryLines)
  assert(
    summary.periodStart === '2026-05-01' && summary.periodEnd === '2026-07-04',
    `summary: period from slash dates (got ${summary.periodStart}..${summary.periodEnd})`
  )
  assert(summary.warnings.length === 0, `summary: no warnings (got ${summary.warnings[0]})`)
  assert(
    summary.transactions.length === 4,
    `summary: row count (got ${summary.transactions.length})`
  )
  const [sa, sb, sc, sd] = summary.transactions
  assert(sa.date === '2026-05-07' && sa.amountCents === 65000, 'summary: credit row')
  assert(
    sb.amountCents === -130000 &&
      sb.description === 'Transfer To Henley Beach Rentals CommBank App Rent',
    `summary: trailing description attaches, value date dropped (got ${JSON.stringify(sb)})`
  )
  assert(sc.amountCents === -1264, 'summary: negative balance row')
  assert(
    sd.amountCents === 110000 && sd.description === 'Transfer from xxxx CommBank app Rent',
    `summary: footer text not attached (got ${JSON.stringify(sd)})`
  )
  assert(
    // the account held -$400.00 before the period (first balance minus amount)
    summary.openingBalanceCents === -40000 && summary.closingBalanceCents === 3736,
    `summary: opening/closing balances (got ${summary.openingBalanceCents}/${summary.closingBalanceCents})`
  )
  results.statementPdf = 'ok'

  // --- sample data: savings account, categories, several months of txs ---
  const groceries = categories.find((c) => c.name === 'Groceries')!
  const dining = categories.find((c) => c.name === 'Dining Out')!
  const salary = categories.find((c) => c.name === 'Salary')!
  const acct1 = accounts[0]
  const acct2 = accounts[1]
  core.createAccount(db, {
    name: 'Joint Savings',
    personId: null,
    type: 'savings',
    startingBalanceCents: 500000,
    currency: 'USD'
  })

  const nowMonth = currentMonthKey(1)
  for (let back = 4; back >= 0; back--) {
    const m = addMonthKey(nowMonth, -back)
    const { start } = monthRange(m, 1)
    if (start > todayISO()) continue
    tx.createTransaction(db, {
      date: start,
      amountCents: 400000,
      payee: 'Acme Corp Payroll',
      categoryId: salary.id,
      accountId: acct1.id,
      personId: 1
    })
    tx.createTransaction(db, {
      date: start,
      amountCents: 380000,
      payee: 'Globex Payroll',
      categoryId: salary.id,
      accountId: acct2.id,
      personId: 2
    })
    for (const [day, amount, payee, cat, person, acct] of [
      [2, -85043, 'Whole Foods', groceries.id, 1, acct1.id],
      [8, -12385, 'Thai Palace', dining.id, 2, acct2.id],
      [15, -76210, 'Trader Joes', groceries.id, 2, acct2.id],
      [20, -6450, 'Blue Bottle', dining.id, 1, acct1.id]
    ] as const) {
      const d = addDaysISO(start, day)
      if (d <= todayISO()) {
        tx.createTransaction(db, {
          date: d,
          amountCents: amount,
          payee,
          categoryId: cat,
          accountId: acct,
          personId: person
        })
      }
    }
  }

  // --- transaction CRUD ---
  const created = tx.createTransaction(db, {
    date: todayISO(),
    amountCents: -4599,
    payee: 'Test Coffee',
    categoryId: dining.id,
    accountId: acct1.id,
    personId: 1
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
  assert(
    r1.imported === 3 && r1.skipped === 0,
    `first import keeps in-file duplicates (got ${JSON.stringify(r1)})`
  )
  const r2 = tx.importTransactions(db, { rows, accountId: acct1.id, personId: 1 })
  assert(
    r2.imported === 0 && r2.skipped === 3,
    `re-import is fully deduped (got ${JSON.stringify(r2)})`
  )
  assert(tx.listTransactions(db, {}).total === before + 3, 'import count')

  // --- reconcile against a statement closing balance ---
  const balBefore = core.accountBalances(db).find((b) => b.accountId === acct1.id)!.balanceCents
  const r3 = tx.importTransactions(db, {
    rows,
    accountId: acct1.id,
    personId: 1,
    reconcileBalanceCents: balBefore + 12345
  })
  assert(
    r3.imported === 0 && r3.startingBalanceAdjustedCents === 12345,
    `reconcile adjusts starting balance (got ${JSON.stringify(r3)})`
  )
  const balAfter = core.accountBalances(db).find((b) => b.accountId === acct1.id)!.balanceCents
  assert(balAfter === balBefore + 12345, `reconciled balance (got ${balAfter})`)
  const r4 = tx.importTransactions(db, {
    rows,
    accountId: acct1.id,
    personId: 1,
    reconcileBalanceCents: balBefore + 12345
  })
  assert(r4.startingBalanceAdjustedCents === 0, 'reconcile with matching balance is a no-op')
  results.import = { first: r1, second: r2, reconciled: r3.startingBalanceAdjustedCents }

  // --- transfer category & post-import categorisation aids ---
  const transferCat = core.listCategories(db).find((c) => c.type === 'transfer')
  assert(transferCat != null, 'Internal Transfer category seeded')
  assert(
    r1.uncategorized.length === 2 && r1.uncategorized.every((t) => t.categoryId == null),
    `import surfaces its uncategorised rows (got ${r1.uncategorized.length})`
  )
  assert(r2.uncategorized.length === 0, 'a fully deduped import surfaces none')

  // history: normalised payee match (digits stripped) suggests the prior category
  const histTx = tx.createTransaction(db, {
    date: todayISO(),
    amountCents: -8123,
    payee: 'WHOLE FOODS 4412',
    categoryId: null,
    accountId: acct1.id,
    personId: 1
  })
  // transfer: opposite-amount legs in different accounts around the same day
  const legOut = tx.createTransaction(db, {
    date: todayISO(),
    amountCents: -50000,
    payee: 'Transfer to xx1234 CommBank app',
    categoryId: null,
    accountId: acct1.id,
    personId: 1
  })
  const legIn = tx.createTransaction(db, {
    date: todayISO(),
    amountCents: 50000,
    payee: 'Direct Credit 555555',
    categoryId: null,
    accountId: acct2.id,
    personId: 2
  })
  const suggested = new Map(
    tx.suggestCategories(db, [histTx.id, legOut.id, legIn.id]).map((s) => [s.transactionId, s])
  )
  assert(
    suggested.get(histTx.id)?.categoryId === groceries.id &&
      suggested.get(histTx.id)?.reason === 'history',
    `payee history suggestion (got ${JSON.stringify(suggested.get(histTx.id))})`
  )
  assert(
    suggested.get(legOut.id)?.categoryId === transferCat.id &&
      suggested.get(legOut.id)?.reason === 'transfer',
    `outgoing transfer leg detected (got ${JSON.stringify(suggested.get(legOut.id))})`
  )
  assert(
    suggested.get(legIn.id)?.categoryId === transferCat.id,
    `incoming transfer leg detected (got ${JSON.stringify(suggested.get(legIn.id))})`
  )

  // transfers count as neither income nor spending, but balances still move
  const dashPre = analytics.getDashboard(db, nowMonth, null)
  tx.updateTransaction(db, legOut.id, { categoryId: transferCat.id })
  tx.updateTransaction(db, legIn.id, { categoryId: transferCat.id })
  const dashPost = analytics.getDashboard(db, nowMonth, null)
  assert(
    dashPost.incomeCents === dashPre.incomeCents - 50000 &&
      dashPost.spendingCents === dashPre.spendingCents - 50000,
    `transfers excluded from totals (income ${dashPre.incomeCents}->${dashPost.incomeCents}, spending ${dashPre.spendingCents}->${dashPost.spendingCents})`
  )
  assert(
    !analytics
      .getDashboard(db, nowMonth, null)
      .byCategory.some((c) => c.categoryId === transferCat.id),
    'transfer category absent from spend-by-category'
  )
  assert(
    !budgets.getBudgetGrid(db, nowMonth).rows.some((r) => r.categoryId === transferCat.id),
    'transfer spending creates no budget row'
  )
  results.transfers = { suggested: suggested.size }

  // deleting a category re-queues its transactions for categorisation
  const doomed = core
    .createCategory(db, {
      name: 'Doomed',
      type: 'expense',
      icon: '💣',
      color: '#000000'
    })
    .find((c) => c.name === 'Doomed')!
  tx.updateTransaction(db, histTx.id, { categoryId: doomed.id })
  core.deleteCategory(db, doomed.id)
  assert(
    tx.listTransactions(db, { search: 'WHOLE FOODS 4412' }).rows[0].categoryId === null,
    'deleted category leaves its transactions uncategorised'
  )

  // --- recurring rules ---
  const rules = recurring.createRecurring(db, {
    name: 'Netflix',
    amountCents: -1599,
    categoryId: null,
    accountId: acct1.id,
    personId: 1,
    frequency: 'monthly',
    nextDue: addMonthKey(nowMonth, -2) + '-05'
  })
  assert(rules.length === 1, 'rule created')
  const instances = tx.listTransactions(db, { search: 'Netflix' })
  assert(instances.total >= 2, `past recurring instances generated (got ${instances.total})`)
  // 32-day horizon: after catch-up the next monthly instance can be a full
  // 31-day month away (e.g. running on Jul 5 puts it on Aug 5)
  const upcoming = recurring.upcomingInstances(db, 32, null)
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
  const gp = goals.createGoal(db, {
    name: 'Vacation',
    targetCents: 1000000,
    targetDate: `${new Date().getFullYear() + 1}-06-01`,
    personId: null,
    accountIds: [savingsAcct.id]
  })
  assert(gp.length === 1 && gp[0].currentCents === 500000, 'goal progress from linked account')

  // --- payslips & expected pay ---
  const schedules = payslips.createPaySchedule(db, {
    personId: 1,
    name: 'Acme fortnightly',
    frequency: 'biweekly',
    anchorDate: addDaysISO(todayISO(), -28),
    expectedNetCents: 380000,
    accountId: acct1.id
  })
  assert(schedules.length === 1, 'pay schedule created')
  assert(
    payslips.getIncomeSummary(db, nowMonth).events.length >= 2,
    'expected pay events expand for the month'
  )

  const txBeforeSlip = tx.listTransactions(db, {}).total
  const slip = payslips.createPayslip(
    db,
    {
      personId: 1,
      payDate: addDaysISO(todayISO(), -14),
      employer: 'Acme Corp',
      grossCents: 500000,
      taxCents: 100000,
      superCents: 57500,
      superExtraCents: 5000,
      hecsCents: 20000,
      otherDeductionsCents: 0,
      netCents: 375000
    },
    { accountId: acct1.id, categoryId: salary.id }
  )
  assert(
    slip.transactionId != null && slip.transactionSource === 'created',
    'payslip creates its ledger transaction'
  )
  assert(slip.payScheduleId === schedules[0].id, 'payslip auto-matched to schedule')
  assert(tx.listTransactions(db, {}).total === txBeforeSlip + 1, 'exactly one ledger row added')

  const slipMonth = monthKeyOf(slip.payDate, 1)
  const slipEvent = payslips
    .getIncomeSummary(db, slipMonth)
    .events.find((e) => e.payslipId === slip.id)
  assert(
    slipEvent?.status === 'received' && slipEvent.varianceCents === 375000 - 380000,
    `expected-vs-actual variance (got ${JSON.stringify(slipEvent)})`
  )

  // CSV rows matching the payslip's net pay are flagged for exclusion
  const rowMatches = payslips.matchImportRowsToPayslips(
    db,
    [
      { date: addDaysISO(slip.payDate, 1), amountCents: 375000 },
      { date: slip.payDate, amountCents: 12345 }
    ],
    1
  )
  assert(
    rowMatches[0] === slip.id && rowMatches[1] === null,
    'import rows match payslip net pay only'
  )

  // Reverse order: bank deposit imported first, payslip linked to it
  const bankTx = tx.createTransaction(db, {
    date: todayISO(),
    amountCents: 390000,
    payee: 'GLOBEX SALARY',
    categoryId: null,
    accountId: acct2.id,
    personId: 2
  })
  assert(
    payslips.findBankMatchesForPayslip(db, 2, 390000, todayISO()).some((t) => t.id === bankTx.id),
    'existing bank deposit found for new payslip'
  )
  const txBeforeLink = tx.listTransactions(db, {}).total
  const linked = payslips.createPayslip(
    db,
    {
      personId: 2,
      payDate: todayISO(),
      employer: 'Globex',
      grossCents: 520000,
      taxCents: 110000,
      superCents: 59800,
      superExtraCents: 0,
      hecsCents: 0,
      otherDeductionsCents: 20000,
      netCents: 390000
    },
    { accountId: acct2.id, categoryId: salary.id, linkTransactionId: bankTx.id }
  )
  assert(
    linked.transactionSource === 'linked' && tx.listTransactions(db, {}).total === txBeforeLink,
    'linking adopts the existing transaction instead of creating one'
  )
  payslips.deletePayslip(db, linked.id)
  assert(
    tx.listTransactions(db, {}).total === txBeforeLink,
    'deleting a linked payslip keeps the bank transaction'
  )

  // Deleting a payslip-created slip removes its ledger row too
  const throwaway = payslips.createPayslip(
    db,
    {
      personId: 2,
      payDate: todayISO(),
      employer: 'One-off',
      grossCents: 150000,
      taxCents: 30000,
      superCents: 17250,
      superExtraCents: 0,
      hecsCents: 0,
      otherDeductionsCents: 0,
      netCents: 120000
    },
    { accountId: acct2.id, categoryId: salary.id }
  )
  const pdfBytes = Buffer.from('%PDF-1.4 smoke test payslip')
  payslips.setPayslipPdf(db, throwaway.id, 'one-off-payslip.pdf', pdfBytes)
  assert(
    payslips.getPayslip(db, throwaway.id).pdfFilename === 'one-off-payslip.pdf',
    'pdf filename surfaces on the payslip'
  )
  const storedPdf = payslips.getPayslipPdf(db, throwaway.id)
  assert(storedPdf != null && storedPdf.data.equals(pdfBytes), 'pdf bytes roundtrip through sqlite')
  payslips.removePayslipPdf(db, throwaway.id)
  assert(payslips.getPayslip(db, throwaway.id).pdfFilename === null, 'pdf can be detached')
  payslips.setPayslipPdf(db, throwaway.id, 'one-off-payslip.pdf', pdfBytes)
  const txBeforeDelete = tx.listTransactions(db, {}).total
  payslips.deletePayslip(db, throwaway.id)
  assert(
    payslips.getPayslipPdf(db, throwaway.id) === null,
    'deleting a payslip cascades to its stored pdf'
  )
  // leave a PDF on the surviving payslip so the backup roundtrip covers it
  payslips.setPayslipPdf(db, slip.id, 'acme-payslip.pdf', pdfBytes)
  assert(
    tx.listTransactions(db, {}).total === txBeforeDelete - 1,
    'deleting a created payslip removes its ledger row'
  )

  // --- super & HECS balances, FY report ---
  income.setTrackedBalance(db, 1, 'super', 10000000, slip.payDate)
  let panels = income.createBalanceAdjustment(db, {
    personId: 1,
    kind: 'super',
    date: todayISO(),
    amountCents: -50000,
    note: 'market dip'
  })
  const superPanel = panels.find((p) => p.personId === 1 && p.kind === 'super')!
  assert(
    superPanel.currentCents === 10000000 + 62500 - 50000,
    `super balance math (got ${superPanel.currentCents})`
  )
  income.setTrackedBalance(db, 1, 'hecs', 5000000, slip.payDate)
  panels = income.createBalanceAdjustment(db, {
    personId: 1,
    kind: 'hecs',
    date: todayISO(),
    amountCents: 100000,
    note: 'Indexation'
  })
  const hecsPanel = panels.find((p) => p.personId === 1 && p.kind === 'hecs')!
  assert(
    hecsPanel.currentCents === 5000000 - 20000 + 100000,
    `HECS paydown math (got ${hecsPanel.currentCents})`
  )
  const fy = income.getFinancialYearIncome(db, income.fyStartYearOf(slip.payDate), 1)
  const fyMe = fy.perPerson.find((p) => p.personId === 1)!
  assert(
    fyMe.grossCents === 500000 && fyMe.hecsCents === 20000 && fyMe.netCents === 375000,
    'financial-year totals from payslips'
  )
  results.payslips = { variance: slipEvent.varianceCents, superBalance: superPanel.currentCents }

  // --- analytics ---
  const dash = analytics.getDashboard(db, nowMonth, null)
  assert(dash.incomeCents > 0 && dash.spendingCents > 0, 'dashboard totals')
  assert(dash.trend.length === 12, 'trend series')
  const dashMe = analytics.getDashboard(db, nowMonth, 1)
  assert(dashMe.spendingCents <= dash.spendingCents, 'person filter narrows')
  const forecast = analytics.getForecast(db, 3)
  assert(forecast.months.length === 12, 'forecast months')
  assert(forecast.variableAverages.length > 0, 'variable averages computed')
  assert(forecast.scheduledPersonIds.includes(1), 'scheduled person flagged in forecast')
  assert(
    !forecast.variableAverages.some((v) => v.personId === 1 && v.categoryId === salary.id),
    'schedule supersedes salary trailing average'
  )
  assert(
    forecast.variableAverages.some((v) => v.personId === 2 && v.categoryId === salary.id),
    'unscheduled person keeps salary trailing average'
  )
  const report = analytics.getYearReport(db, forecast.year, null)
  assert(report.byMonth.length === 12, 'year report months')
  results.dashboard = {
    income: dash.incomeCents,
    spending: dash.spendingCents,
    savings: dash.savingsBalanceCents
  }
  results.forecast = {
    averages: forecast.variableAverages.length,
    recurringFlows: forecast.recurringFlows.length
  }

  // --- backup roundtrip ---
  const dump = backup.exportBackup(db)
  // a v1 backup (pre-payslips) must still restore
  const v1 = JSON.parse(JSON.stringify(dump))
  v1.version = 1
  delete v1.payslips
  delete v1.paySchedules
  delete v1.trackedBalances
  delete v1.balanceAdjustments
  delete v1.payslipFiles
  backup.importBackup(db, v1)
  assert(backup.exportBackup(db).payslips!.length === 0, 'v1 backup restores without payslips')
  backup.importBackup(db, JSON.parse(JSON.stringify(dump)))
  const after = backup.exportBackup(db)
  assert(
    after.transactions.length === dump.transactions.length,
    'backup roundtrip preserves transactions'
  )
  assert(after.budgets.length === dump.budgets.length, 'backup roundtrip preserves budgets')
  assert(
    after.payslips!.length === dump.payslips!.length &&
      after.paySchedules!.length === dump.paySchedules!.length &&
      after.trackedBalances!.length === dump.trackedBalances!.length &&
      after.balanceAdjustments!.length === dump.balanceAdjustments!.length,
    'backup roundtrip preserves payslip tables'
  )
  assert(
    after.payslipFiles!.length === 1 &&
      after.payslipFiles![0].dataBase64 === dump.payslipFiles![0].dataBase64,
    'backup roundtrip preserves attached pdf bytes'
  )
  const restoredPdf = payslips.getPayslipPdf(db, slip.id)
  assert(
    restoredPdf != null && restoredPdf.data.equals(pdfBytes),
    'restored pdf matches the original bytes'
  )
  results.backup = {
    transactions: after.transactions.length,
    payslips: after.payslips!.length,
    payslipFiles: after.payslipFiles!.length
  }

  // --- boot the UI and screenshot key pages ---
  const win = createWindow()
  await new Promise<void>((resolve, reject) => {
    win.webContents.once('did-finish-load', () => resolve())
    win.webContents.once('did-fail-load', (_e, code, desc) =>
      reject(new Error(`renderer failed to load: ${code} ${desc}`))
    )
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
  await capture('income', 'income')
  await capture('budgets', 'budgets')
  await capture('forecast', 'forecast')
  assert(crashed.length === 0, `renderer crashed: ${crashed.join(',')}`)

  const errors = await win.webContents.executeJavaScript('window.__dollarErrors || []')
  results.rendererErrors = errors

  console.log('[smoke] PASS ' + JSON.stringify(results, null, 2))
  win.destroy()
}
