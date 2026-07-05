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

export type PayFrequency = 'weekly' | 'biweekly' | 'monthly'

export interface PaySchedule {
  id: number
  personId: number
  /** employer / label */
  name: string
  frequency: PayFrequency
  /** a known pay date; expected events repeat from here in both directions */
  anchorDate: string
  expectedNetCents: number
  expectedGrossCents: number
  /** account the pay lands in */
  accountId: number
  active: boolean
}

export type PayslipTransactionSource = 'created' | 'linked' | 'none'

export interface Payslip {
  id: number
  personId: number
  /** ISO date the pay hit (or should hit) the bank */
  payDate: string
  periodStart: string | null
  periodEnd: string | null
  employer: string
  /** pre-tax pay */
  grossCents: number
  /** income tax withheld */
  taxCents: number
  /** employer super guarantee */
  superCents: number
  /** salary sacrifice / voluntary super */
  superExtraCents: number
  hecsCents: number
  otherDeductionsCents: number
  /** take-home pay; owns one ledger transaction */
  netCents: number
  payScheduleId: number | null
  transactionId: number | null
  transactionSource: PayslipTransactionSource
  /** original filename of the attached PDF stored inside the database */
  pdfFilename: string | null
  notes: string | null
  createdAt: string
}

export type TrackedBalanceKind = 'super' | 'hecs'

export interface TrackedBalance {
  id: number
  personId: number
  kind: TrackedBalanceKind
  startingCents: number
  /** payslips on/after this date count toward the balance */
  startingDate: string
}

export interface BalanceAdjustment {
  id: number
  personId: number
  kind: TrackedBalanceKind
  date: string
  /** signed; HECS indexation is positive (debt goes up) */
  amountCents: number
  note: string | null
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
  /** When set, adjust the account's starting balance after the import so the
   *  account's balance equals this (a statement's closing balance). */
  reconcileBalanceCents?: number
}

export interface ImportResult {
  imported: number
  skipped: number
  /** Delta applied to the account's starting balance by reconciliation */
  startingBalanceAdjustedCents?: number
}

/** One row parsed out of a PDF bank statement. */
export interface StatementTransaction {
  /** ISO date; the year is inferred from the statement period */
  date: string
  /** Signed integer cents: deposits positive, withdrawals negative */
  amountCents: number
  description: string
}

export interface StatementParseResult {
  /** Statement period detected from the PDF header, when present */
  periodStart: string | null
  periodEnd: string | null
  /** Account balance at the start/end of the statement, when derivable */
  openingBalanceCents: number | null
  closingBalanceCents: number | null
  transactions: StatementTransaction[]
  /** Rows that could not be fully parsed, described for the user */
  warnings: string[]
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

export interface PayslipInput {
  personId: number
  payDate: string
  periodStart?: string | null
  periodEnd?: string | null
  employer: string
  grossCents: number
  taxCents: number
  superCents: number
  superExtraCents: number
  hecsCents: number
  otherDeductionsCents: number
  netCents: number
  notes?: string | null
}

export interface PayslipSaveOptions {
  /** account the net-pay transaction is created in (ignored when linking) */
  accountId: number
  categoryId: number | null
  /** adopt this existing bank transaction instead of creating one */
  linkTransactionId?: number | null
  /** read this file and store it inside the database as the payslip's PDF */
  pdfSourcePath?: string | null
}

/** Update payload: entity fields plus PDF handling. `pdfSourcePath` string =
 * attach/replace from that file, null = remove, absent = leave unchanged. */
export type PayslipPatch = Partial<PayslipInput> & { pdfSourcePath?: string | null }

export interface PayslipFilter {
  personId?: number
  from?: string
  to?: string
}

export interface PayScheduleInput {
  personId: number
  name: string
  frequency: PayFrequency
  anchorDate: string
  expectedNetCents: number
  expectedGrossCents?: number
  accountId: number
  active?: boolean
}

export interface BalanceAdjustmentInput {
  personId: number
  kind: TrackedBalanceKind
  date: string
  amountCents: number
  note?: string | null
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
  /** expected pay events later this month with no payslip yet */
  expectedIncomeRemainingCents: number
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

/** Expected pay per (month, person) from active pay schedules. */
export interface ExpectedPayFlow {
  month: string
  personId: number
  netCents: number
}

/** One expected pay event matched (or not) against an actual payslip. */
export interface PayEventRow {
  scheduleId: number
  scheduleName: string
  personId: number
  expectedDate: string
  expectedNetCents: number
  payslipId: number | null
  actualDate: string | null
  actualNetCents: number | null
  /** actual − expected; null until received */
  varianceCents: number | null
  status: 'received' | 'upcoming' | 'missed'
}

export interface IncomePersonTotals {
  personId: number
  expectedCents: number
  actualCents: number
  varianceCents: number
}

export interface IncomeSummary {
  month: string
  events: PayEventRow[]
  /** payslips in the month not matched to any schedule */
  unscheduledPayslips: Payslip[]
  totals: IncomePersonTotals[]
}

export interface TrackedBalancePanel {
  personId: number
  kind: TrackedBalanceKind
  /** null when not configured yet */
  config: TrackedBalance | null
  /** payslip flows since startingDate (super contributions / HECS deductions) */
  contributionsCents: number
  adjustmentsCents: number
  /** null when unconfigured */
  currentCents: number | null
  /** payslip flows in the current Australian FY (Jul–Jun) */
  fyContributionsCents: number
  adjustments: BalanceAdjustment[]
}

export interface FYPersonTotals {
  personId: number
  payslipCount: number
  grossCents: number
  taxCents: number
  superCents: number
  superExtraCents: number
  hecsCents: number
  otherDeductionsCents: number
  netCents: number
}

export interface FYIncomeReport {
  /** FY starting 1 July of this year */
  fyStartYear: number
  perPerson: FYPersonTotals[]
  byMonth: { month: string; personId: number; grossCents: number; netCents: number }[]
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
  /** expected pay for FUTURE months from active schedules */
  expectedPayFlows: ExpectedPayFlow[]
  /** expected pay events still to come in the current month (no payslip yet) */
  currentMonthRemainingExpectedPay: ExpectedPayFlow[]
  /** people whose income is projected from a pay schedule, not averages */
  scheduledPersonIds: number[]
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
  /** absent in v1 backups; default to [] on import */
  payslips?: Payslip[]
  paySchedules?: PaySchedule[]
  trackedBalances?: TrackedBalance[]
  balanceAdjustments?: BalanceAdjustment[]
  /** attached payslip PDFs, base64-encoded */
  payslipFiles?: { payslipId: number; filename: string; dataBase64: string }[]
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
  updateAccount(
    id: number,
    patch: Partial<AccountInput> & { archived?: boolean }
  ): Promise<Account[]>
  deleteAccount(id: number): Promise<Account[]>

  listCategories(): Promise<Category[]>
  createCategory(input: CategoryInput): Promise<Category[]>
  updateCategory(
    id: number,
    patch: Partial<CategoryInput> & { archived?: boolean }
  ): Promise<Category[]>
  deleteCategory(id: number): Promise<Category[]>

  listTransactions(filter: TransactionFilter): Promise<TransactionPage>
  createTransaction(input: TransactionInput): Promise<Transaction>
  updateTransaction(id: number, patch: Partial<TransactionInput>): Promise<Transaction>
  deleteTransactions(ids: number[]): Promise<number>
  getPayeeSuggestions(): Promise<PayeeSuggestion[]>
  importTransactions(req: ImportRequest): Promise<ImportResult>
  /** parse a PDF bank statement's text into candidate import rows */
  parseStatementPdf(data: ArrayBuffer): Promise<StatementParseResult>

  listPayslips(filter: PayslipFilter): Promise<Payslip[]>
  createPayslip(input: PayslipInput, opts: PayslipSaveOptions): Promise<Payslip>
  updatePayslip(id: number, patch: PayslipPatch): Promise<Payslip>
  deletePayslip(id: number): Promise<Payslip[]>
  /** native file picker for a payslip PDF; path is stored on the payslip */
  pickPayslipPdf(): Promise<{ path: string | null }>
  /** open a payslip's attached PDF in the system viewer */
  openPayslipPdf(id: number): Promise<{ opened: boolean; error?: string }>
  matchImportRowsToPayslips(
    rows: { date: string; amountCents: number }[],
    personId: number
  ): Promise<(number | null)[]>
  findBankMatchesForPayslip(
    personId: number,
    netCents: number,
    payDate: string
  ): Promise<Transaction[]>

  listPaySchedules(): Promise<PaySchedule[]>
  createPaySchedule(input: PayScheduleInput): Promise<PaySchedule[]>
  updatePaySchedule(id: number, patch: Partial<PayScheduleInput>): Promise<PaySchedule[]>
  deletePaySchedule(id: number): Promise<PaySchedule[]>
  getIncomeSummary(month: string): Promise<IncomeSummary>

  getTrackedBalances(): Promise<TrackedBalancePanel[]>
  setTrackedBalance(
    personId: number,
    kind: TrackedBalanceKind,
    startingCents: number,
    startingDate: string
  ): Promise<TrackedBalancePanel[]>
  createBalanceAdjustment(input: BalanceAdjustmentInput): Promise<TrackedBalancePanel[]>
  deleteBalanceAdjustment(id: number): Promise<TrackedBalancePanel[]>
  getFinancialYearIncome(fyStartYear: number, personId: number | null): Promise<FYIncomeReport>

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
