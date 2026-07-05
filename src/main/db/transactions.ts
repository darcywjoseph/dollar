import type { Database as DB } from 'better-sqlite3'
import type {
  ImportRequest,
  ImportResult,
  PayeeSuggestion,
  Transaction,
  TransactionFilter,
  TransactionInput,
  TransactionPage
} from '@shared/types'
import { isValidISO } from '@shared/dates'
import { baseImportHash, existingHashCount, hashWithOccurrence, rowToTransaction } from './helpers'

function validateInput(db: DB, input: TransactionInput): void {
  if (!isValidISO(input.date)) throw new Error(`Invalid date: ${input.date}`)
  if (!Number.isFinite(input.amountCents)) throw new Error('Invalid amount')
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(input.accountId)
  if (!account) throw new Error('Account not found')
  const person = db.prepare('SELECT id FROM people WHERE id = ?').get(input.personId)
  if (!person) throw new Error('Person not found')
  if (input.categoryId != null) {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(input.categoryId)
    if (!cat) throw new Error('Category not found')
  }
}

function insertTransaction(
  db: DB,
  input: TransactionInput,
  opts?: { isRecurringInstance?: boolean; recurringRuleId?: number; occurrenceBump?: number }
): number {
  const base = baseImportHash(input.date, Math.round(input.amountCents), input.payee)
  const occurrence = existingHashCount(db, base) + (opts?.occurrenceBump ?? 0)
  const info = db
    .prepare(
      `INSERT INTO transactions
         (date, amount_cents, payee, category_id, account_id, person_id, notes, tags,
          is_recurring_instance, recurring_rule_id, import_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.date,
      Math.round(input.amountCents),
      input.payee.trim(),
      input.categoryId,
      input.accountId,
      input.personId,
      input.notes ?? null,
      input.tags ?? null,
      opts?.isRecurringInstance ? 1 : 0,
      opts?.recurringRuleId ?? null,
      hashWithOccurrence(base, occurrence)
    )
  return Number(info.lastInsertRowid)
}

export function createTransaction(
  db: DB,
  input: TransactionInput,
  opts?: { isRecurringInstance?: boolean; recurringRuleId?: number }
): Transaction {
  validateInput(db, input)
  const id = insertTransaction(db, input, opts)
  return rowToTransaction(db.prepare('SELECT * FROM transactions WHERE id = ?').get(id))
}

export function updateTransaction(
  db: DB,
  id: number,
  patch: Partial<TransactionInput>
): Transaction {
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id)
  if (!row) throw new Error('Transaction not found')
  const current = rowToTransaction(row)
  const merged: TransactionInput = {
    date: patch.date ?? current.date,
    amountCents: patch.amountCents ?? current.amountCents,
    payee: patch.payee ?? current.payee,
    categoryId: patch.categoryId !== undefined ? patch.categoryId : current.categoryId,
    accountId: patch.accountId ?? current.accountId,
    personId: patch.personId ?? current.personId,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    tags: patch.tags !== undefined ? patch.tags : current.tags
  }
  validateInput(db, merged)
  db.prepare(
    `UPDATE transactions SET date = ?, amount_cents = ?, payee = ?, category_id = ?,
       account_id = ?, person_id = ?, notes = ?, tags = ? WHERE id = ?`
  ).run(
    merged.date,
    Math.round(merged.amountCents),
    merged.payee.trim(),
    merged.categoryId,
    merged.accountId,
    merged.personId,
    merged.notes ?? null,
    merged.tags ?? null,
    id
  )
  return rowToTransaction(db.prepare('SELECT * FROM transactions WHERE id = ?').get(id))
}

export function deleteTransactions(db: DB, ids: number[]): number {
  if (ids.length === 0) return 0
  const unlinkPayslip = db.prepare(
    "UPDATE payslips SET transaction_id = NULL, transaction_source = 'none' WHERE transaction_id = ?"
  )
  const del = db.prepare('DELETE FROM transactions WHERE id = ?')
  let n = 0
  db.transaction(() => {
    for (const id of ids) {
      unlinkPayslip.run(id)
      n += del.run(id).changes
    }
  })()
  return n
}

function buildFilterSql(filter: TransactionFilter): { where: string; params: unknown[] } {
  const conds: string[] = []
  const params: unknown[] = []
  if (filter.personId != null) {
    conds.push('t.person_id = ?')
    params.push(filter.personId)
  }
  if (filter.accountId != null) {
    conds.push('t.account_id = ?')
    params.push(filter.accountId)
  }
  if (filter.categoryId != null) {
    if (filter.categoryId === -1) {
      conds.push('t.category_id IS NULL')
    } else {
      conds.push('t.category_id = ?')
      params.push(filter.categoryId)
    }
  }
  if (filter.dateFrom) {
    conds.push('t.date >= ?')
    params.push(filter.dateFrom)
  }
  if (filter.dateTo) {
    conds.push('t.date <= ?')
    params.push(filter.dateTo)
  }
  if (filter.search) {
    conds.push(
      "(t.payee LIKE '%' || ? || '%' OR t.notes LIKE '%' || ? || '%' OR t.tags LIKE '%' || ? || '%')"
    )
    params.push(filter.search, filter.search, filter.search)
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params }
}

const SORT_FIELDS = new Set(['date', 'amount_cents', 'payee', 'created_at'])

export function listTransactions(db: DB, filter: TransactionFilter): TransactionPage {
  const { where, params } = buildFilterSql(filter)
  const sortField = SORT_FIELDS.has(filter.sortField ?? '') ? filter.sortField : 'date'
  const sortDir = filter.sortDir === 'asc' ? 'ASC' : 'DESC'
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000)
  const offset = Math.max(filter.offset ?? 0, 0)

  const rows = db
    .prepare(
      `SELECT t.* FROM transactions t ${where}
       ORDER BY t.${sortField} ${sortDir}, t.id ${sortDir} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)
    .map(rowToTransaction)
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(t.amount_cents), 0) AS s FROM transactions t ${where}`
    )
    .get(...params) as { n: number; s: number }
  return { rows, total: agg.n, sumCents: agg.s }
}

export function getPayeeSuggestions(db: DB): PayeeSuggestion[] {
  // Most frequent payees, with their most recent category & account.
  const rows = db
    .prepare(
      `SELECT payee,
              (SELECT t2.category_id FROM transactions t2
                 WHERE t2.payee = t.payee AND t2.category_id IS NOT NULL
                 ORDER BY t2.date DESC, t2.id DESC LIMIT 1) AS category_id,
              (SELECT t3.account_id FROM transactions t3
                 WHERE t3.payee = t.payee
                 ORDER BY t3.date DESC, t3.id DESC LIMIT 1) AS account_id,
              COUNT(*) AS count
       FROM transactions t
       WHERE payee != ''
       GROUP BY payee
       ORDER BY count DESC, MAX(date) DESC
       LIMIT 500`
    )
    .all() as { payee: string; category_id: number | null; account_id: number; count: number }[]
  return rows.map((r) => ({
    payee: r.payee,
    categoryId: r.category_id,
    accountId: r.account_id,
    count: r.count
  }))
}

export function importTransactions(db: DB, req: ImportRequest): ImportResult {
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(req.accountId)
  if (!account) throw new Error('Account not found')
  const person = db.prepare('SELECT id FROM people WHERE id = ?').get(req.personId)
  if (!person) throw new Error('Person not found')

  let imported = 0
  let skipped = 0
  let adjusted = 0
  db.transaction(() => {
    // Track occurrences within this batch so identical rows in one file are
    // kept, while rows already in the db (from a prior import) are skipped.
    const batchCounts = new Map<string, number>()
    for (const row of req.rows) {
      if (!isValidISO(row.date) || !Number.isFinite(row.amountCents)) {
        skipped++
        continue
      }
      const base = baseImportHash(row.date, Math.round(row.amountCents), row.payee)
      const seenInBatch = batchCounts.get(base) ?? 0
      const existing = existingHashCount(db, base)
      if (existing > seenInBatch) {
        // this occurrence already exists in the db -> duplicate, skip
        skipped++
        batchCounts.set(base, seenInBatch + 1)
        continue
      }
      insertTransaction(db, {
        date: row.date,
        amountCents: row.amountCents,
        payee: row.payee,
        categoryId: row.categoryId,
        accountId: req.accountId,
        personId: req.personId
      })
      imported++
      batchCounts.set(base, seenInBatch + 1)
    }

    // Reconcile: shift the starting balance so the account's balance equals
    // the statement's closing balance (a statement only covers a period; the
    // account may have held money before it).
    if (req.reconcileBalanceCents != null) {
      const { balance } = db
        .prepare(
          `SELECT a.starting_balance_cents + COALESCE(SUM(t.amount_cents), 0) AS balance
           FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
           WHERE a.id = ? GROUP BY a.id`
        )
        .get(req.accountId) as { balance: number }
      adjusted = Math.round(req.reconcileBalanceCents) - balance
      if (adjusted !== 0) {
        db.prepare(
          'UPDATE accounts SET starting_balance_cents = starting_balance_cents + ? WHERE id = ?'
        ).run(adjusted, req.accountId)
      }
    }
  })()
  return { imported, skipped, startingBalanceAdjustedCents: adjusted }
}
