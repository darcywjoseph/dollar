import type { Database as DB } from 'better-sqlite3'
import type {
  AccountInput,
  BalanceAdjustmentInput,
  CategoryInput,
  GoalInput,
  ImportRequest,
  PayScheduleInput,
  PayslipFilter,
  PayslipInput,
  PayslipPatch,
  PayslipSaveOptions,
  RecurringRuleInput,
  TrackedBalanceKind,
  TransactionFilter,
  TransactionInput
} from '@shared/types'
// Reused in place from the Electron main process during the migration; these
// modules import only better-sqlite3, node:crypto and @shared, so they run
// unchanged under plain Node. They move to server/src/db in the final phase.
import * as core from '../../src/main/db/core'
import * as tx from '../../src/main/db/transactions'
import * as recurring from '../../src/main/db/recurring'
import * as budgets from '../../src/main/db/budgets'
import * as goals from '../../src/main/db/goals'
import * as analytics from '../../src/main/db/analytics'
import * as backup from '../../src/main/db/backup'
import * as payslips from '../../src/main/db/payslips'
import * as income from '../../src/main/db/income'
import {
  getSettingsForUser,
  setSetting,
  setUserSetting,
  USER_SETTING_KEYS
} from '../../src/main/db/helpers'
import { parseStatementPdf } from '../../src/main/statementPdf'

/** Identity of the caller, resolved from the bearer token by the auth
 *  middleware. Stubbed to person 1 until auth lands (Phase 3). Only the
 *  user-scoped handlers read it; the rest ignore it. */
export interface RpcContext {
  userId: number
  personId: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcHandler = (ctx: RpcContext, ...args: any[]) => unknown

const SETTING_KEYS = new Set([
  'currencySymbol',
  'firstDayOfMonth',
  'theme',
  'viewMode',
  'forecastWindow'
])

// PDF bytes travel in the request body (base64 → Buffer via decodeBinary)
// instead of a local file path, since the server can't read a client's disk.
function toBuffer(data: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(data)) return data
  return Buffer.from(data as ArrayBuffer)
}

function currentUser(
  db: DB,
  userId: number
): { id: number; personId: number; username: string } | null {
  const row = db.prepare('SELECT id, person_id, username FROM users WHERE id = ?').get(userId) as
    { id: number; person_id: number; username: string } | undefined
  return row ? { id: row.id, personId: row.person_id, username: row.username } : null
}

/** Build the channel → handler map for a database. Mirrors the Electron IPC
 *  handlers one-to-one, minus the five native (dialog/shell) channels, plus
 *  the three server-side twins used for PDF/backup transfer over HTTP. */
export function buildHandlers(db: DB): Map<string, RpcHandler> {
  const h = new Map<string, RpcHandler>()

  h.set('getBootstrap', (ctx) => ({
    people: core.listPeople(db),
    accounts: core.listAccounts(db),
    categories: core.listCategories(db),
    settings: getSettingsForUser(db, ctx.userId),
    balances: core.accountBalances(db),
    currentUser: currentUser(db, ctx.userId)
  }))

  h.set('updatePerson', (_c, id: number, patch: { name?: string; color?: string }) =>
    core.updatePerson(db, id, patch)
  )

  h.set('listAccounts', () => core.listAccounts(db))
  h.set('createAccount', (_c, input: AccountInput) => core.createAccount(db, input))
  h.set('updateAccount', (_c, id: number, patch: Partial<AccountInput> & { archived?: boolean }) =>
    core.updateAccount(db, id, patch)
  )
  h.set('deleteAccount', (_c, id: number) => core.deleteAccount(db, id))

  h.set('listCategories', () => core.listCategories(db))
  h.set('createCategory', (_c, input: CategoryInput) => core.createCategory(db, input))
  h.set(
    'updateCategory',
    (_c, id: number, patch: Partial<CategoryInput> & { archived?: boolean }) =>
      core.updateCategory(db, id, patch)
  )
  h.set('deleteCategory', (_c, id: number) => core.deleteCategory(db, id))

  h.set('listTransactions', (_c, filter: TransactionFilter) =>
    tx.listTransactions(db, filter ?? {})
  )
  h.set('createTransaction', (_c, input: TransactionInput) => tx.createTransaction(db, input))
  h.set('updateTransaction', (_c, id: number, patch: Partial<TransactionInput>) =>
    tx.updateTransaction(db, id, patch)
  )
  h.set('deleteTransactions', (_c, ids: number[]) => tx.deleteTransactions(db, ids))
  h.set('getPayeeSuggestions', () => tx.getPayeeSuggestions(db))
  h.set('suggestCategories', (_c, ids: number[]) => tx.suggestCategories(db, ids ?? []))
  h.set('importTransactions', (_c, req: ImportRequest) => tx.importTransactions(db, req))
  h.set('parseStatementPdf', (_c, data: ArrayBuffer | Uint8Array) => parseStatementPdf(data))

  h.set('listPayslips', (_c, filter: PayslipFilter) => payslips.listPayslips(db, filter ?? {}))
  h.set('createPayslip', (_c, input: PayslipInput, opts: PayslipSaveOptions) => {
    const slip = payslips.createPayslip(db, input, opts)
    if (opts?.pdf) payslips.setPayslipPdf(db, slip.id, opts.pdf.filename, toBuffer(opts.pdf.data))
    return payslips.getPayslip(db, slip.id)
  })
  h.set('updatePayslip', (_c, id: number, patch: PayslipPatch) => {
    const { pdf, ...fields } = patch ?? {}
    payslips.updatePayslip(db, id, fields)
    if (pdf) payslips.setPayslipPdf(db, id, pdf.filename, toBuffer(pdf.data))
    else if (pdf === null) payslips.removePayslipPdf(db, id)
    return payslips.getPayslip(db, id)
  })
  h.set('deletePayslip', (_c, id: number) => payslips.deletePayslip(db, id))
  // Server-side twin of the native openPayslipPdf: return the bytes so the
  // client can hand them to its OS viewer.
  h.set('getPayslipPdf', (_c, id: number) => {
    const pdf = payslips.getPayslipPdf(db, id)
    return pdf ? { filename: pdf.filename, dataBase64: pdf.data.toString('base64') } : null
  })
  h.set(
    'matchImportRowsToPayslips',
    (_c, rows: { date: string; amountCents: number }[], personId: number) =>
      payslips.matchImportRowsToPayslips(db, rows ?? [], personId)
  )
  h.set('findBankMatchesForPayslip', (_c, personId: number, netCents: number, payDate: string) =>
    payslips.findBankMatchesForPayslip(db, personId, netCents, payDate)
  )

  h.set('listPaySchedules', () => payslips.listPaySchedules(db))
  h.set('createPaySchedule', (_c, input: PayScheduleInput) => payslips.createPaySchedule(db, input))
  h.set('updatePaySchedule', (_c, id: number, patch: Partial<PayScheduleInput>) =>
    payslips.updatePaySchedule(db, id, patch)
  )
  h.set('deletePaySchedule', (_c, id: number) => payslips.deletePaySchedule(db, id))
  h.set('getIncomeSummary', (_c, month: string) => payslips.getIncomeSummary(db, month))

  h.set('getTrackedBalances', () => income.getTrackedBalances(db))
  h.set(
    'setTrackedBalance',
    (_c, personId: number, kind: TrackedBalanceKind, startingCents: number, startingDate: string) =>
      income.setTrackedBalance(db, personId, kind, startingCents, startingDate)
  )
  h.set('createBalanceAdjustment', (_c, input: BalanceAdjustmentInput) =>
    income.createBalanceAdjustment(db, input)
  )
  h.set('deleteBalanceAdjustment', (_c, id: number) => income.deleteBalanceAdjustment(db, id))
  h.set('getFinancialYearIncome', (_c, fyStartYear: number, personId: number | null) =>
    income.getFinancialYearIncome(db, fyStartYear, personId)
  )

  h.set('listRecurring', () => recurring.listRecurring(db))
  h.set('createRecurring', (_c, input: RecurringRuleInput) => recurring.createRecurring(db, input))
  h.set('updateRecurring', (_c, id: number, patch: Partial<RecurringRuleInput>) =>
    recurring.updateRecurring(db, id, patch)
  )
  h.set('deleteRecurring', (_c, id: number, deleteInstances: boolean) =>
    recurring.deleteRecurring(db, id, deleteInstances)
  )

  h.set('getBudgetGrid', (_c, month: string) => budgets.getBudgetGrid(db, month))
  h.set('setBudget', (_c, month: string, categoryId: number, scope: string, amountCents: number) =>
    budgets.setBudget(db, month, categoryId, scope, amountCents)
  )
  h.set('copyBudgetsFromPrevious', (_c, month: string) =>
    budgets.copyBudgetsFromPrevious(db, month)
  )
  h.set('setBudgetsFromAverage', (_c, month: string) => budgets.setBudgetsFromAverage(db, month))

  h.set('listGoals', () => goals.listGoals(db))
  h.set('createGoal', (_c, input: GoalInput) => goals.createGoal(db, input))
  h.set('updateGoal', (_c, id: number, patch: Partial<GoalInput>) =>
    goals.updateGoal(db, id, patch)
  )
  h.set('deleteGoal', (_c, id: number) => goals.deleteGoal(db, id))

  h.set('getDashboard', (_c, month: string, personId: number | null) =>
    analytics.getDashboard(db, month, personId)
  )
  h.set('getForecast', (_c, windowMonths: number) => analytics.getForecast(db, windowMonths))
  h.set('getYearReport', (_c, year: number, personId: number | null) =>
    analytics.getYearReport(db, year, personId)
  )

  h.set('getSettings', (ctx) => getSettingsForUser(db, ctx.userId))
  h.set('setSetting', (ctx, key: string, value: string) => {
    if (!SETTING_KEYS.has(key)) throw new Error(`Unknown setting: ${key}`)
    if (USER_SETTING_KEYS.has(key)) setUserSetting(db, ctx.userId, key, value)
    else setSetting(db, key, value)
    return getSettingsForUser(db, ctx.userId)
  })

  // Server-side twins of exportBackup/importBackup: the file dialog stays on
  // the client; the server just produces/consumes the JSON payload.
  h.set('getBackupData', () => backup.exportBackup(db))
  h.set('restoreBackupData', (_c, data: unknown) => {
    backup.importBackup(db, data)
    return { restored: true }
  })

  return h
}
