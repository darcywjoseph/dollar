import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'
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
import * as core from './db/core'
import * as tx from './db/transactions'
import * as recurring from './db/recurring'
import * as budgets from './db/budgets'
import * as goals from './db/goals'
import * as analytics from './db/analytics'
import * as backup from './db/backup'
import * as payslips from './db/payslips'
import * as income from './db/income'
import { getSettings, setSetting } from './db/helpers'

const SETTING_KEYS = new Set([
  'currencySymbol',
  'firstDayOfMonth',
  'theme',
  'viewMode',
  'forecastWindow'
])

type IpcResponse = { ok: true; data: unknown } | { ok: false; error: string }

export function registerIpcHandlers(db: DB, getWindow: () => BrowserWindow | null): void {
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, async (_event, ...args): Promise<IpcResponse> => {
      try {
        const data = await (fn as (...a: unknown[]) => unknown)(...args)
        return { ok: true, data }
      } catch (err) {
        console.error(`[ipc:${channel}]`, err)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  handle('getBootstrap', () => ({
    people: core.listPeople(db),
    accounts: core.listAccounts(db),
    categories: core.listCategories(db),
    settings: getSettings(db),
    balances: core.accountBalances(db)
  }))

  handle('updatePerson', (id: number, patch: { name?: string; color?: string }) =>
    core.updatePerson(db, id, patch)
  )

  handle('listAccounts', () => core.listAccounts(db))
  handle('createAccount', (input: AccountInput) => core.createAccount(db, input))
  handle('updateAccount', (id: number, patch: Partial<AccountInput> & { archived?: boolean }) =>
    core.updateAccount(db, id, patch)
  )
  handle('deleteAccount', (id: number) => core.deleteAccount(db, id))

  handle('listCategories', () => core.listCategories(db))
  handle('createCategory', (input: CategoryInput) => core.createCategory(db, input))
  handle('updateCategory', (id: number, patch: Partial<CategoryInput> & { archived?: boolean }) =>
    core.updateCategory(db, id, patch)
  )
  handle('deleteCategory', (id: number) => core.deleteCategory(db, id))

  handle('listTransactions', (filter: TransactionFilter) => tx.listTransactions(db, filter ?? {}))
  handle('createTransaction', (input: TransactionInput) => tx.createTransaction(db, input))
  handle('updateTransaction', (id: number, patch: Partial<TransactionInput>) =>
    tx.updateTransaction(db, id, patch)
  )
  handle('deleteTransactions', (ids: number[]) => tx.deleteTransactions(db, ids))
  handle('getPayeeSuggestions', () => tx.getPayeeSuggestions(db))
  handle('importTransactions', (req: ImportRequest) => tx.importTransactions(db, req))

  // Reads the picked file's bytes so failures surface before anything is saved.
  const readPdfSource = async (sourcePath: string): Promise<{ filename: string; data: Buffer }> => {
    const data = await readFile(sourcePath)
    if (data.length === 0) throw new Error('The chosen PDF file is empty')
    return { filename: basename(sourcePath), data }
  }

  handle('listPayslips', (filter: PayslipFilter) => payslips.listPayslips(db, filter ?? {}))
  handle('createPayslip', async (input: PayslipInput, opts: PayslipSaveOptions) => {
    const pdf = opts.pdfSourcePath ? await readPdfSource(opts.pdfSourcePath) : null
    const slip = payslips.createPayslip(db, input, opts)
    if (pdf) payslips.setPayslipPdf(db, slip.id, pdf.filename, pdf.data)
    return payslips.getPayslip(db, slip.id)
  })
  handle('updatePayslip', async (id: number, patch: PayslipPatch) => {
    const { pdfSourcePath, ...fields } = patch ?? {}
    const pdf = pdfSourcePath ? await readPdfSource(pdfSourcePath) : null
    payslips.updatePayslip(db, id, fields)
    if (pdf) payslips.setPayslipPdf(db, id, pdf.filename, pdf.data)
    else if (pdfSourcePath === null) payslips.removePayslipPdf(db, id)
    return payslips.getPayslip(db, id)
  })
  handle('deletePayslip', (id: number) => payslips.deletePayslip(db, id))
  handle('pickPayslipPdf', async () => {
    const win = getWindow()
    if (!win) throw new Error('No window')
    const res = await dialog.showOpenDialog(win, {
      title: 'Attach payslip PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    return { path: res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0] }
  })
  handle('openPayslipPdf', async (id: number) => {
    const pdf = payslips.getPayslipPdf(db, id)
    if (!pdf) return { opened: false, error: 'No PDF attached to this payslip' }
    // Extract to a temp file; the OS viewer can't read blobs out of SQLite.
    const safeName = basename(pdf.filename).replace(/[^\w.\-() ]+/g, '_') || 'payslip.pdf'
    const tempPath = join(app.getPath('temp'), `dollar-payslip-${id}-${safeName}`)
    await writeFile(tempPath, pdf.data)
    const error = await shell.openPath(tempPath)
    return error ? { opened: false, error } : { opened: true }
  })
  handle(
    'matchImportRowsToPayslips',
    (rows: { date: string; amountCents: number }[], personId: number) =>
      payslips.matchImportRowsToPayslips(db, rows ?? [], personId)
  )
  handle('findBankMatchesForPayslip', (personId: number, netCents: number, payDate: string) =>
    payslips.findBankMatchesForPayslip(db, personId, netCents, payDate)
  )

  handle('listPaySchedules', () => payslips.listPaySchedules(db))
  handle('createPaySchedule', (input: PayScheduleInput) => payslips.createPaySchedule(db, input))
  handle('updatePaySchedule', (id: number, patch: Partial<PayScheduleInput>) =>
    payslips.updatePaySchedule(db, id, patch)
  )
  handle('deletePaySchedule', (id: number) => payslips.deletePaySchedule(db, id))
  handle('getIncomeSummary', (month: string) => payslips.getIncomeSummary(db, month))

  handle('getTrackedBalances', () => income.getTrackedBalances(db))
  handle(
    'setTrackedBalance',
    (personId: number, kind: TrackedBalanceKind, startingCents: number, startingDate: string) =>
      income.setTrackedBalance(db, personId, kind, startingCents, startingDate)
  )
  handle('createBalanceAdjustment', (input: BalanceAdjustmentInput) =>
    income.createBalanceAdjustment(db, input)
  )
  handle('deleteBalanceAdjustment', (id: number) => income.deleteBalanceAdjustment(db, id))
  handle('getFinancialYearIncome', (fyStartYear: number, personId: number | null) =>
    income.getFinancialYearIncome(db, fyStartYear, personId)
  )

  handle('listRecurring', () => recurring.listRecurring(db))
  handle('createRecurring', (input: RecurringRuleInput) => recurring.createRecurring(db, input))
  handle('updateRecurring', (id: number, patch: Partial<RecurringRuleInput>) =>
    recurring.updateRecurring(db, id, patch)
  )
  handle('deleteRecurring', (id: number, deleteInstances: boolean) =>
    recurring.deleteRecurring(db, id, deleteInstances)
  )

  handle('getBudgetGrid', (month: string) => budgets.getBudgetGrid(db, month))
  handle('setBudget', (month: string, categoryId: number, scope: string, amountCents: number) =>
    budgets.setBudget(db, month, categoryId, scope, amountCents)
  )
  handle('copyBudgetsFromPrevious', (month: string) => budgets.copyBudgetsFromPrevious(db, month))
  handle('setBudgetsFromAverage', (month: string) => budgets.setBudgetsFromAverage(db, month))

  handle('listGoals', () => goals.listGoals(db))
  handle('createGoal', (input: GoalInput) => goals.createGoal(db, input))
  handle('updateGoal', (id: number, patch: Partial<GoalInput>) => goals.updateGoal(db, id, patch))
  handle('deleteGoal', (id: number) => goals.deleteGoal(db, id))

  handle('getDashboard', (month: string, personId: number | null) =>
    analytics.getDashboard(db, month, personId)
  )
  handle('getForecast', (windowMonths: number) => analytics.getForecast(db, windowMonths))
  handle('getYearReport', (year: number, personId: number | null) =>
    analytics.getYearReport(db, year, personId)
  )

  handle('getSettings', () => getSettings(db))
  handle('setSetting', (key: string, value: string) => {
    if (!SETTING_KEYS.has(key)) throw new Error(`Unknown setting: ${key}`)
    setSetting(db, key, value)
    return getSettings(db)
  })

  handle('exportBackup', async () => {
    const win = getWindow()
    if (!win) throw new Error('No window')
    const date = new Date().toISOString().slice(0, 10)
    const res = await dialog.showSaveDialog(win, {
      title: 'Export dollar backup',
      defaultPath: `dollar-backup-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    await writeFile(res.filePath, JSON.stringify(backup.exportBackup(db), null, 2), 'utf8')
    return { saved: true, path: res.filePath }
  })

  handle('importBackup', async () => {
    const win = getWindow()
    if (!win) throw new Error('No window')
    const res = await dialog.showOpenDialog(win, {
      title: 'Restore dollar backup',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { restored: false }
    const raw = await readFile(res.filePaths[0], 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('File is not valid JSON')
    }
    backup.importBackup(db, parsed)
    return { restored: true }
  })

  handle('saveCsv', async (defaultName: string, content: string) => {
    const win = getWindow()
    if (!win) throw new Error('No window')
    const res = await dialog.showSaveDialog(win, {
      title: 'Export CSV',
      defaultPath: defaultName,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    await writeFile(res.filePath, content, 'utf8')
    return { saved: true, path: res.filePath }
  })
}
