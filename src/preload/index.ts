import { contextBridge, ipcRenderer } from 'electron'

// Whitelist of channels the renderer may invoke. Must match ipc.ts.
const CHANNELS = [
  'getBootstrap',
  'updatePerson',
  'listAccounts',
  'createAccount',
  'updateAccount',
  'deleteAccount',
  'listCategories',
  'createCategory',
  'updateCategory',
  'deleteCategory',
  'listTransactions',
  'createTransaction',
  'updateTransaction',
  'deleteTransactions',
  'getPayeeSuggestions',
  'importTransactions',
  'listPayslips',
  'createPayslip',
  'updatePayslip',
  'deletePayslip',
  'pickPayslipPdf',
  'openPayslipPdf',
  'matchImportRowsToPayslips',
  'findBankMatchesForPayslip',
  'listPaySchedules',
  'createPaySchedule',
  'updatePaySchedule',
  'deletePaySchedule',
  'getIncomeSummary',
  'getTrackedBalances',
  'setTrackedBalance',
  'createBalanceAdjustment',
  'deleteBalanceAdjustment',
  'getFinancialYearIncome',
  'listRecurring',
  'createRecurring',
  'updateRecurring',
  'deleteRecurring',
  'getBudgetGrid',
  'setBudget',
  'copyBudgetsFromPrevious',
  'setBudgetsFromAverage',
  'listGoals',
  'createGoal',
  'updateGoal',
  'deleteGoal',
  'getDashboard',
  'getForecast',
  'getYearReport',
  'getSettings',
  'setSetting',
  'exportBackup',
  'importBackup',
  'saveCsv'
] as const

const allowed = new Set<string>(CHANNELS)

contextBridge.exposeInMainWorld('ledgerIpc', {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  }
})
