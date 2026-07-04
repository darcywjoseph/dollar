import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'

const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    person_id INTEGER REFERENCES people(id),
    type TEXT NOT NULL CHECK (type IN ('checking','savings','credit','cash')),
    starting_balance_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('expense','income')),
    icon TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#94a3b8',
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE recurring_rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    person_id INTEGER NOT NULL REFERENCES people(id),
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','yearly')),
    next_due TEXT NOT NULL,
    end_date TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    payee TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    person_id INTEGER NOT NULL REFERENCES people(id),
    notes TEXT,
    tags TEXT,
    is_recurring_instance INTEGER NOT NULL DEFAULT 0,
    recurring_rule_id INTEGER REFERENCES recurring_rules(id),
    import_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_tx_date ON transactions(date);
  CREATE INDEX idx_tx_account ON transactions(account_id);
  CREATE INDEX idx_tx_category ON transactions(category_id);
  CREATE INDEX idx_tx_person ON transactions(person_id);
  CREATE INDEX idx_tx_hash ON transactions(import_hash);

  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY,
    month TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    person_id INTEGER REFERENCES people(id),
    amount_cents INTEGER NOT NULL DEFAULT 0
  );
  -- NULL person_id means "joint"; COALESCE makes uniqueness apply to it too
  CREATE UNIQUE INDEX idx_budgets_unique ON budgets(month, category_id, COALESCE(person_id, 0));

  CREATE TABLE savings_goals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    target_cents INTEGER NOT NULL,
    target_date TEXT,
    person_id INTEGER REFERENCES people(id),
    account_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2 — payslips, expected pay schedules, super/HECS balance tracking
  `
  CREATE TABLE pay_schedules (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id),
    name TEXT NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly')),
    anchor_date TEXT NOT NULL,
    expected_net_cents INTEGER NOT NULL,
    expected_gross_cents INTEGER NOT NULL DEFAULT 0,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE payslips (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id),
    pay_date TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    employer TEXT NOT NULL DEFAULT '',
    gross_cents INTEGER NOT NULL,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    super_cents INTEGER NOT NULL DEFAULT 0,
    super_extra_cents INTEGER NOT NULL DEFAULT 0,
    hecs_cents INTEGER NOT NULL DEFAULT 0,
    other_deductions_cents INTEGER NOT NULL DEFAULT 0,
    net_cents INTEGER NOT NULL,
    pay_schedule_id INTEGER REFERENCES pay_schedules(id),
    transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    transaction_source TEXT NOT NULL DEFAULT 'created'
      CHECK (transaction_source IN ('created','linked','none')),
    pdf_path TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_payslips_person_date ON payslips(person_id, pay_date);
  CREATE UNIQUE INDEX idx_payslips_tx ON payslips(transaction_id) WHERE transaction_id IS NOT NULL;

  CREATE TABLE tracked_balances (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id),
    kind TEXT NOT NULL CHECK (kind IN ('super','hecs')),
    starting_cents INTEGER NOT NULL DEFAULT 0,
    starting_date TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_tracked_balances_unique ON tracked_balances(person_id, kind);

  CREATE TABLE balance_adjustments (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id),
    kind TEXT NOT NULL CHECK (kind IN ('super','hecs')),
    date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    note TEXT
  );
  CREATE INDEX idx_bal_adj_person_kind ON balance_adjustments(person_id, kind);
  `
]

const DEFAULT_CATEGORIES: [string, 'expense' | 'income', string, string][] = [
  ['Groceries', 'expense', '🛒', '#22c55e'],
  ['Rent/Mortgage', 'expense', '🏠', '#6366f1'],
  ['Utilities', 'expense', '💡', '#eab308'],
  ['Transport', 'expense', '🚗', '#0ea5e9'],
  ['Dining Out', 'expense', '🍽️', '#f97316'],
  ['Subscriptions', 'expense', '📺', '#a855f7'],
  ['Health', 'expense', '⚕️', '#ef4444'],
  ['Entertainment', 'expense', '🎬', '#ec4899'],
  ['Shopping', 'expense', '🛍️', '#14b8a6'],
  ['Travel', 'expense', '✈️', '#06b6d4'],
  ['Insurance', 'expense', '🛡️', '#64748b'],
  ['Gifts', 'expense', '🎁', '#f43f5e'],
  ['Personal Care', 'expense', '🧴', '#8b5cf6'],
  ['Other', 'expense', '📦', '#94a3b8'],
  ['Salary', 'income', '💼', '#16a34a'],
  ['Interest', 'income', '🏦', '#65a30d'],
  ['Other Income', 'income', '💰', '#84cc16']
]

export const DEFAULT_SETTINGS: Record<string, string> = {
  currencySymbol: '$',
  firstDayOfMonth: '1',
  theme: 'system',
  viewMode: 'combined',
  forecastWindow: '3'
}

export function openDatabase(filePath: string): DB {
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  seed(db)
  return db
}

function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

function seed(db: DB): void {
  const peopleCount = (db.prepare('SELECT COUNT(*) AS n FROM people').get() as { n: number }).n
  if (peopleCount === 0) {
    const insertPerson = db.prepare(
      'INSERT INTO people (id, name, color, sort) VALUES (?, ?, ?, ?)'
    )
    insertPerson.run(1, 'Me', '#6366f1', 0)
    insertPerson.run(2, 'Partner', '#f59e0b', 1)

    const insertAccount = db.prepare(
      'INSERT INTO accounts (name, person_id, type, starting_balance_cents, currency) VALUES (?, ?, ?, ?, ?)'
    )
    insertAccount.run('My Checking', 1, 'checking', 0, 'USD')
    insertAccount.run("Partner's Checking", 2, 'checking', 0, 'USD')
  }

  const catCount = (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n
  if (catCount === 0) {
    const ins = db.prepare('INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)')
    for (const [name, type, icon, color] of DEFAULT_CATEGORIES) ins.run(name, type, icon, color)
  }

  const setIfMissing = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setIfMissing.run(k, v)
}
