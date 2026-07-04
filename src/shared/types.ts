// Entities

export interface Person {
  id: number
  name: string
  color: string
}

export type AccountType = 'checking' | 'savings' | 'credit' | 'cash'

export interface Account {
  id: number
  name: string
  /** null = joint account */
  personId: number | null
  type: AccountType
  startingBalanceCents: number
  currency: string
  archived: boolean
}

export type CategoryType = 'expense' | 'income'

export interface Category {
  id: number
  name: string
  type: CategoryType
  icon: string
  color: string
  archived: boolean
}

export interface Transaction {
  id: number
  /** ISO date YYYY-MM-DD */
  date: string
  /** Signed integer cents: income positive, expenses negative */
  amountCents: number
  payee: string
  categoryId: number | null
  accountId: number
  personId: number
  notes: string | null
  tags: string | null
  isRecurringInstance: boolean
  recurringRuleId: number | null
  importHash: string
  createdAt: string
}

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly'

export interface RecurringRule {
  id: number
  name: string
  /** Signed integer cents: income positive, expenses negative */
  amountCents: number
  categoryId: number | null
  accountId: number
  personId: number
  frequency: Frequency
  /** ISO date of the next instance to generate */
  nextDue: string
  endDate: string | null
  notes: string | null
  active: boolean
}

export interface Budget {
  id: number
  /** YYYY-MM period key */
  month: string
  categoryId: number
  /** null = joint budget */
  personId: number | null
  amountCents: number
}

export interface SavingsGoal {
  id: number
  name: string
  targetCents: number
  targetDate: string | null
  /** null = joint goal */
  personId: number | null
  accountIds: number[]
  createdAt: string
}

export interface AppSettings {
  currencySymbol: string
  /** 1..28 — day the budgeting month begins */
  firstDayOfMonth: number
  theme: 'light' | 'dark' | 'system'
  /** 'combined' or a person id as string */
  viewMode: string
  /** trailing months used for forecast variable-spend averages */
  forecastWindow: 3 | 6
}

// Payloads

export interface TransactionInput {
  date: string
  amountCents: number
  payee: string
  categoryId: number | null
  accountId: number
  personId: number
  notes?: string | null
  tags?: string | null
}

export interface TransactionFilter {
  personId?: number
  accountId?: number
  categoryId?: number
  dateFrom?: string
  dateTo?: string
  search?: string
  sortField?: 'date' | 'amount_cents' | 'payee' | 'created_at'
  sortDir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface TransactionPage {
  rows: Transaction[]
  total: number
  /** Sum of amountCents across ALL rows matching the filter (not just the page) */
  sumCents: number
}

export interface PayeeSuggestion {
  payee: string
  categoryId: number | null
  accountId: number
  count: number
}

export interface ImportRow {
  date: string
  amountCents: number
  payee: string
  categoryId: number | null
}

export interface ImportRequest {
  rows: ImportRow[]
  accountId: number
  personId: number
}

export interface ImportResult {
  imported: number
  skipped: number
}

export interface RecurringRuleInput {
  name: string
  amountCents: number
  categoryId: number | null
  accountId: number
  personId: number
  frequency: Frequency
  nextDue: string
  endDate?: string | null
  notes?: string | null
  active?: boolean
}

export interface AccountInput {
  name: string
  personId: number | null
  type: AccountType
  startingBalanceCents: number
  currency: string
}

export interface CategoryInput {
  name: string
  type: CategoryType
  icon: string
  color: string
}

export interface GoalInput {
  name: string
  targetCents: number
  targetDate: string | null
  personId: number | null
  accountIds: number[]
}

// Analytics / computed results

export interface CategorySpend {
  categoryId: number | null
  spentCents: number
}

export interface BudgetVsActual {
  categoryId: number
  budgetedCents: number
  actualCents: number
}

export interface MonthPoint {
  month: string
  incomeCents: number
  spendingCents: number
}

export interface UpcomingInstance {
  ruleId: number
  name: string
  date: string
  amountCents: number
  categoryId: number | null
  personId: number
  accountId: number
}

export interface DashboardSummary {
  incomeCents: number
  spendingCents: number
  netCents: number
  savingsBalanceCents: number
  byCategory: CategorySpend[]
  budgetVsActual: BudgetVsActual[]
  trend: MonthPoint[]
  upcoming: UpcomingInstance[]
}

export interface AccountBalance {
  accountId: number
  balanceCents: number
}

export interface BudgetRow {
  categoryId: number
  /** budget amount per scope; key is person id as string, or 'joint' */
  budgeted: Record<string, number>
  /** actual spending per person id (string key) */
  actual: Record<string, number>
}

export interface BudgetGrid {
  month: string
  rows: BudgetRow[]
}

export interface GoalProgress {
  goal: SavingsGoal
  currentCents: number
  /** average net contribution per month over last 3 months */
  monthlyContributionCents: number
  /** ISO date or null if never at current rate */
  projectedDate: string | null
  onTrack: boolean | null
}

/** Trailing-average variable (non-recurring) flow for one person+category. */
export interface VariableAverage {
  personId: number
  categoryId: number | null
  /** average monthly amount, signed cents (spending negative) */
  avgCents: number
}

export interface RecurringMonthFlow {
  month: string
  personId: number
  incomeCents: number
  spendingCents: number
}

export interface ForecastActualMonth {
  month: string
  /** per person id (string key) net cents; income/spending combined below */
  netByPerson: Record<string, number>
  incomeCents: number
  spendingCents: number
}

export interface ForecastData {
  year: number
  months: string[]
  currentMonth: string
  /** fraction of the current budget month already elapsed, 0..1 */
  currentMonthElapsed: number
  actuals: ForecastActualMonth[]
  /** activity so far in the current (partial) month */
  currentMonthActual: ForecastActualMonth
  /** recurring instances still due in the current month, per person */
  currentMonthRemainingRecurring: RecurringMonthFlow[]
  variableAverages: VariableAverage[]
  /** expanded recurring flows for FUTURE months (after the current one) */
  recurringFlows: RecurringMonthFlow[]
  /** current total balance per person id (string key) plus 'joint' */
  balancesByOwner: Record<string, number>
  windowMonths: number
}

export interface YearReport {
  year: number
  byMonth: { month: string; incomeCents: number; spendingCents: number }[]
  /** stacked spending by category by month */
  categoryByMonth: { month: string; categoryId: number | null; spentCents: number }[]
  /** spending and income per person per month */
  personByMonth: { month: string; personId: number; incomeCents: number; spendingCents: number }[]
}

export interface BackupData {
  version: number
  exportedAt: string
  settings: Record<string, string>
  people: Person[]
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  recurringRules: RecurringRule[]
  budgets: Budget[]
  savingsGoals: SavingsGoal[]
}

export interface Bootstrap {
  people: Person[]
  accounts: Account[]
  categories: Category[]
  settings: AppSettings
  balances: AccountBalance[]
}

// IPC API surface (implemented in main, exposed via preload, consumed by renderer)

export interface LedgerApi {
  getBootstrap(): Promise<Bootstrap>

  updatePerson(id: number, patch: { name?: string; color?: string }): Promise<Person[]>

  listAccounts(): Promise<Account[]>
  createAccount(input: AccountInput): Promise<Account[]>
  updateAccount(id: number, patch: Partial<AccountInput> & { archived?: boolean }): Promise<Account[]>
  deleteAccount(id: number): Promise<Account[]>

  listCategories(): Promise<Category[]>
  createCategory(input: CategoryInput): Promise<Category[]>
  updateCategory(id: number, patch: Partial<CategoryInput> & { archived?: boolean }): Promise<Category[]>
  deleteCategory(id: number): Promise<Category[]>

  listTransactions(filter: TransactionFilter): Promise<TransactionPage>
  createTransaction(input: TransactionInput): Promise<Transaction>
  updateTransaction(id: number, patch: Partial<TransactionInput>): Promise<Transaction>
  deleteTransactions(ids: number[]): Promise<number>
  getPayeeSuggestions(): Promise<PayeeSuggestion[]>
  importTransactions(req: ImportRequest): Promise<ImportResult>

  listRecurring(): Promise<RecurringRule[]>
  createRecurring(input: RecurringRuleInput): Promise<RecurringRule[]>
  updateRecurring(id: number, patch: Partial<RecurringRuleInput>): Promise<RecurringRule[]>
  deleteRecurring(id: number, deleteInstances: boolean): Promise<RecurringRule[]>

  getBudgetGrid(month: string): Promise<BudgetGrid>
  setBudget(month: string, categoryId: number, scope: string, amountCents: number): Promise<void>
  copyBudgetsFromPrevious(month: string): Promise<number>
  setBudgetsFromAverage(month: string): Promise<number>

  listGoals(): Promise<GoalProgress[]>
  createGoal(input: GoalInput): Promise<GoalProgress[]>
  updateGoal(id: number, patch: Partial<GoalInput>): Promise<GoalProgress[]>
  deleteGoal(id: number): Promise<GoalProgress[]>

  getDashboard(month: string, personId: number | null): Promise<DashboardSummary>
  getForecast(windowMonths: number): Promise<ForecastData>
  getYearReport(year: number, personId: number | null): Promise<YearReport>

  getSettings(): Promise<AppSettings>
  setSetting(key: keyof AppSettings, value: string): Promise<AppSettings>

  exportBackup(): Promise<{ saved: boolean; path?: string }>
  importBackup(): Promise<{ restored: boolean }>
  saveCsv(defaultName: string, content: string): Promise<{ saved: boolean; path?: string }>
}
