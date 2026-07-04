import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import type { PayeeSuggestion, Transaction, TransactionFilter } from '@shared/types'
import { formatDateDisplay, todayISO } from '@shared/dates'
import { parseAmountToCents } from '@shared/money'
import { api } from '../api'
import { useApp } from '../appContext'
import { Button, EmptyState, Money, Spinner } from '../components/ui'
import ImportWizard from './ImportWizard'
import RecurringTab from './RecurringTab'

const PAGE_SIZE = 100

export default function Transactions(): React.JSX.Element {
  const [tab, setTab] = useState<'transactions' | 'recurring'>('transactions')
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {(['transactions', 'recurring'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize transition ${
              tab === t
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t === 'recurring' ? 'Recurring rules' : 'Transactions'}
          </button>
        ))}
      </div>
      {tab === 'transactions' ? <TransactionsTab /> : <RecurringTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function TransactionsTab(): React.JSX.Element {
  const {
    personFilter,
    toast,
    confirm,
    fmt,
    refresh,
    categoryById,
    accountById,
    personById,
    categories,
    accounts
  } = useApp()
  const [rows, setRows] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [sumCents, setSumCents] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [suggestions, setSuggestions] = useState<PayeeSuggestion[]>([])

  // filters
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortField, setSortField] = useState<'date' | 'amount_cents' | 'payee'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [limit, setLimit] = useState(PAGE_SIZE)

  useEffect(() => {
    const h = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(h)
  }, [search])

  const filter: TransactionFilter = useMemo(
    () => ({
      personId: personFilter ?? undefined,
      accountId: accountId === '' ? undefined : accountId,
      categoryId: categoryId === '' ? undefined : categoryId,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      search: debouncedSearch || undefined,
      sortField,
      sortDir,
      limit
    }),
    [
      personFilter,
      accountId,
      categoryId,
      dateFrom,
      dateTo,
      debouncedSearch,
      sortField,
      sortDir,
      limit
    ]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await api.listTransactions(filter)
      setRows(page.rows)
      setTotal(page.total)
      setSumCents(page.sumCents)
      setSelected(new Set())
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [filter, toast])

  useEffect(() => {
    load()
  }, [load])

  const loadSuggestions = useCallback(() => {
    api
      .getPayeeSuggestions()
      .then(setSuggestions)
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    loadSuggestions()
  }, [loadSuggestions])

  const afterChange = useCallback(async () => {
    await load()
    loadSuggestions()
    refresh().catch(() => undefined) // account balances
  }, [load, loadSuggestions, refresh])

  const deleteSelected = async (): Promise<void> => {
    const n = selected.size
    if (n === 0) return
    const ok = await confirm({
      title: `Delete ${n} transaction${n > 1 ? 's' : ''}?`,
      message: 'This permanently removes the selected transactions. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await api.deleteTransactions([...selected])
      toast(`Deleted ${n} transaction${n > 1 ? 's' : ''}`, 'success')
      await afterChange()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const exportCsv = async (): Promise<void> => {
    try {
      // fetch all matching rows in pages
      const all: Transaction[] = []
      let offset = 0
      for (;;) {
        const page = await api.listTransactions({ ...filter, limit: 1000, offset })
        all.push(...page.rows)
        offset += page.rows.length
        if (page.rows.length < 1000 || offset >= page.total) break
      }
      const csv = Papa.unparse(
        all.map((t) => ({
          date: t.date,
          amount: (t.amountCents / 100).toFixed(2),
          payee: t.payee,
          category: categoryById(t.categoryId)?.name ?? '',
          account: accountById(t.accountId)?.name ?? '',
          person: personById(t.personId)?.name ?? '',
          notes: t.notes ?? '',
          tags: t.tags ?? ''
        }))
      )
      const res = await api.saveCsv(`dollar-transactions-${todayISO()}.csv`, csv)
      if (res.saved) toast(`Exported ${all.length} transactions`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const toggleSort = (field: 'date' | 'amount_cents' | 'payee'): void => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortField(field)
      setSortDir(field === 'payee' ? 'asc' : 'desc')
    }
  }

  const sortIcon = (field: string): string =>
    sortField !== field ? '' : sortDir === 'asc' ? ' ↑' : ' ↓'
  const activeCategories = categories.filter((c) => !c.archived)
  const activeAccounts = accounts.filter((a) => !a.archived)

  return (
    <div className="space-y-4">
      <EntryForm suggestions={suggestions} onSaved={afterChange} />

      {/* filter bar */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-44 flex-1">
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="Payee, notes, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Account</label>
          <select
            className="input w-40"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">All accounts</option>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Category</label>
          <select
            className="input w-40"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">All categories</option>
            <option value={-1}>Uncategorized</option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input
            type="date"
            className="input w-36"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">To</label>
          <input
            type="date"
            className="input w-36"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setShowImport(true)}>Import CSV</Button>
          <Button onClick={exportCsv} disabled={total === 0}>
            Export CSV
          </Button>
          {selected.size > 0 && (
            <Button variant="danger" onClick={deleteSelected}>
              Delete ({selected.size})
            </Button>
          )}
        </div>
      </div>

      {/* table */}
      <div className="card overflow-hidden">
        {loading && rows.length === 0 ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🗒️"
            title="No transactions found"
            message={
              total === 0 &&
              !debouncedSearch &&
              !dateFrom &&
              !dateTo &&
              accountId === '' &&
              categoryId === ''
                ? 'Add your first transaction above, or import a CSV from your bank.'
                : 'Nothing matches the current filters. Try broadening them.'
            }
          />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                  <th className="w-8 px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                      }
                    />
                  </th>
                  <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('date')}>
                    Date{sortIcon('date')}
                  </th>
                  <th className="cursor-pointer px-3 py-2.5" onClick={() => toggleSort('payee')}>
                    Payee{sortIcon('payee')}
                  </th>
                  <th className="px-3 py-2.5">Category</th>
                  <th className="px-3 py-2.5">Account</th>
                  <th className="px-3 py-2.5">Person</th>
                  <th
                    className="cursor-pointer px-3 py-2.5 text-right"
                    onClick={() => toggleSort('amount_cents')}
                  >
                    Amount{sortIcon('amount_cents')}
                  </th>
                  <th className="w-16 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {rows.map((t) =>
                  editingId === t.id ? (
                    <EditRow
                      key={t.id}
                      tx={t}
                      onCancel={() => setEditingId(null)}
                      onSaved={async () => {
                        setEditingId(null)
                        await afterChange()
                      }}
                    />
                  ) : (
                    <tr
                      key={t.id}
                      className="group hover:bg-slate-50 dark:hover:bg-slate-700/40"
                      onDoubleClick={() => setEditingId(t.id)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={selected.has(t.id)}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(t.id)
                            else next.delete(t.id)
                            setSelected(next)
                          }}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">
                        {formatDateDisplay(t.date)}
                      </td>
                      <td className="max-w-64 truncate px-3 py-2 font-medium">
                        {t.payee || <span className="text-slate-400">—</span>}
                        {t.isRecurringInstance && (
                          <span
                            className="ml-1.5 text-xs text-slate-400"
                            title="Generated from a recurring rule"
                          >
                            🔁
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                        {(() => {
                          const c = categoryById(t.categoryId)
                          return c ? (
                            `${c.icon} ${c.name}`
                          ) : (
                            <span className="text-slate-400">Uncategorized</span>
                          )
                        })()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-slate-400">
                        {accountById(t.accountId)?.name ?? '?'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {(() => {
                          const p = personById(t.personId)
                          return p ? (
                            <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: p.color }}
                              />
                              {p.name}
                            </span>
                          ) : (
                            '?'
                          )
                        })()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        <Money cents={t.amountCents} fmt={fmt} colored />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          className="invisible rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-200 hover:text-slate-700 group-hover:visible dark:hover:bg-slate-600 dark:hover:text-slate-200"
                          onClick={() => setEditingId(t.id)}
                          title="Edit (or double-click the row)"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <span>
                {rows.length} of {total} shown · net{' '}
                <Money cents={sumCents} fmt={fmt} colored sign />
              </span>
              {rows.length < total && (
                <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {showImport && (
        <ImportWizard
          onClose={() => setShowImport(false)}
          onImported={async () => {
            await afterChange()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fast entry form with payee autocomplete + category auto-suggestion
// ---------------------------------------------------------------------------

function EntryForm({
  suggestions,
  onSaved
}: {
  suggestions: PayeeSuggestion[]
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const { people, accounts, categories, viewMode, toast, settings } = useApp()
  const activeAccounts = accounts.filter((a) => !a.archived)
  const activeCategories = categories.filter((c) => !c.archived)

  const [date, setDate] = useState(todayISO())
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [accountId, setAccountId] = useState<number | ''>(activeAccounts[0]?.id ?? '')
  const [personId, setPersonId] = useState<number>(
    viewMode === 'combined' ? (people[0]?.id ?? 1) : viewMode
  )
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSuggest, setShowSuggest] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const payeeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (viewMode !== 'combined') setPersonId(viewMode)
  }, [viewMode])

  const matches = useMemo(() => {
    const q = payee.trim().toLowerCase()
    if (!q) return []
    return suggestions
      .filter((s) => s.payee.toLowerCase().includes(q) && s.payee.toLowerCase() !== q)
      .slice(0, 6)
  }, [payee, suggestions])

  const applySuggestion = (s: PayeeSuggestion): void => {
    setPayee(s.payee)
    if (s.categoryId != null) setCategoryId(s.categoryId)
    if (activeAccounts.some((a) => a.id === s.accountId)) setAccountId(s.accountId)
    setShowSuggest(false)
  }

  // auto-suggest category on exact payee match
  useEffect(() => {
    const exact = suggestions.find((s) => s.payee.toLowerCase() === payee.trim().toLowerCase())
    if (exact && exact.categoryId != null && categoryId === '') setCategoryId(exact.categoryId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payee, suggestions])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const cents = parseAmountToCents(amount)
    if (cents == null || cents === 0) {
      toast('Enter a valid amount', 'error')
      return
    }
    if (accountId === '') {
      toast('Create an account in Settings first', 'error')
      return
    }
    const cat = categoryId === '' ? null : activeCategories.find((c) => c.id === categoryId)
    // sign comes from the category type unless the user typed an explicit minus
    let amountCents: number
    if (amount.trim().startsWith('-') || amount.trim().startsWith('(')) {
      amountCents = -Math.abs(cents)
    } else if (cat?.type === 'income') {
      amountCents = Math.abs(cents)
    } else {
      amountCents = -Math.abs(cents)
    }
    setSaving(true)
    try {
      await api.createTransaction({
        date,
        amountCents,
        payee: payee.trim(),
        categoryId: cat?.id ?? null,
        accountId,
        personId,
        notes: notes.trim() || null
      })
      toast('Transaction added', 'success')
      setPayee('')
      setAmount('')
      setCategoryId('')
      setNotes('')
      await onSaved()
      payeeRef.current?.focus()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card flex flex-wrap items-end gap-3 p-4" onSubmit={submit}>
      <div>
        <label className="label" htmlFor="entry-date">
          Date
        </label>
        <input
          id="entry-date"
          type="date"
          required
          className="input w-36"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div className="relative min-w-44 flex-1">
        <label className="label" htmlFor="entry-payee">
          Payee
        </label>
        <input
          id="entry-payee"
          ref={payeeRef}
          autoFocus
          autoComplete="off"
          className="input"
          placeholder="e.g. Grocery store"
          value={payee}
          onChange={(e) => {
            setPayee(e.target.value)
            setShowSuggest(true)
            setHighlight(0)
          }}
          onBlur={() => window.setTimeout(() => setShowSuggest(false), 150)}
          onKeyDown={(e) => {
            if (!showSuggest || matches.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((h) => Math.min(h + 1, matches.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              applySuggestion(matches[highlight])
            } else if (e.key === 'Escape') {
              setShowSuggest(false)
            }
          }}
        />
        {showSuggest && matches.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
            {matches.map((s, i) => (
              <li key={s.payee}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    i === highlight ? 'bg-indigo-50 dark:bg-slate-700' : ''
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applySuggestion(s)
                  }}
                >
                  <span>{s.payee}</span>
                  <span className="text-xs text-slate-400">{s.count}×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <label className="label" htmlFor="entry-amount">
          Amount ({settings.currencySymbol})
        </label>
        <input
          id="entry-amount"
          className="input w-28 text-right"
          placeholder="0.00"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="entry-category">
          Category
        </label>
        <select
          id="entry-category"
          className="input w-44"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Uncategorized</option>
          <optgroup label="Expenses">
            {activeCategories
              .filter((c) => c.type === 'expense')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Income">
            {activeCategories
              .filter((c) => c.type === 'income')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
          </optgroup>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="entry-account">
          Account
        </label>
        <select
          id="entry-account"
          className="input w-40"
          value={accountId}
          onChange={(e) => setAccountId(Number(e.target.value))}
        >
          {activeAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="entry-person">
          Person
        </label>
        <select
          id="entry-person"
          className="input w-32"
          value={personId}
          onChange={(e) => setPersonId(Number(e.target.value))}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-36 flex-1">
        <label className="label" htmlFor="entry-notes">
          Notes
        </label>
        <input
          id="entry-notes"
          className="input"
          placeholder="optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <Button type="submit" variant="primary" disabled={saving}>
        {saving ? 'Saving…' : 'Add'}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Inline edit row
// ---------------------------------------------------------------------------

function EditRow({
  tx,
  onCancel,
  onSaved
}: {
  tx: Transaction
  onCancel: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const { people, accounts, categories, toast } = useApp()
  const [date, setDate] = useState(tx.date)
  const [payee, setPayee] = useState(tx.payee)
  const [amount, setAmount] = useState((tx.amountCents / 100).toFixed(2))
  const [categoryId, setCategoryId] = useState<number | ''>(tx.categoryId ?? '')
  const [accountId, setAccountId] = useState(tx.accountId)
  const [personId, setPersonId] = useState(tx.personId)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    const cents = parseAmountToCents(amount)
    if (cents == null) {
      toast('Enter a valid amount', 'error')
      return
    }
    setSaving(true)
    try {
      await api.updateTransaction(tx.id, {
        date,
        payee: payee.trim(),
        amountCents: cents,
        categoryId: categoryId === '' ? null : categoryId,
        accountId,
        personId
      })
      toast('Saved', 'success')
      await onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  return (
    <tr
      className="bg-indigo-50/50 dark:bg-slate-700/50"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
    >
      <td className="px-3 py-2" />
      <td className="px-2 py-1.5">
        <input
          type="date"
          className="input h-8 w-36"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          autoFocus
        />
      </td>
      <td className="px-2 py-1.5">
        <input className="input h-8" value={payee} onChange={(e) => setPayee(e.target.value)} />
      </td>
      <td className="px-2 py-1.5">
        <select
          className="input h-8"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Uncategorized</option>
          {categories
            .filter((c) => !c.archived || c.id === tx.categoryId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          className="input h-8"
          value={accountId}
          onChange={(e) => setAccountId(Number(e.target.value))}
        >
          {accounts
            .filter((a) => !a.archived || a.id === tx.accountId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select
          className="input h-8"
          value={personId}
          onChange={(e) => setPersonId(Number(e.target.value))}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input
          className="input h-8 w-28 text-right"
          value={amount}
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          title="Signed amount: negative = expense, positive = income"
        />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        <button
          className="mr-1 rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 dark:text-indigo-300 dark:hover:bg-slate-600"
          onClick={save}
          disabled={saving}
        >
          Save
        </button>
        <button
          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-600"
          onClick={onCancel}
        >
          Cancel
        </button>
      </td>
    </tr>
  )
}
