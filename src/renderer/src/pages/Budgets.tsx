import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { BudgetGrid } from '@shared/types'
import { currentMonthKey } from '@shared/dates'
import { parseAmountToCents } from '@shared/money'
import { api } from '../api'
import { useApp } from '../store'
import { Button, Card, EmptyState, MonthNav, ProgressBar, Spinner } from '../components/ui'

export default function Budgets(): React.JSX.Element {
  const { settings, people, categories, viewMode, personFilter, fmt, toast, confirm } = useApp()
  const [month, setMonth] = useState(() => currentMonthKey(settings.firstDayOfMonth))
  const [grid, setGrid] = useState<BudgetGrid | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setGrid(await api.getBudgetGrid(month))
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [month, toast])

  useEffect(() => {
    load()
  }, [load])

  const expenseCategories = useMemo(() => categories.filter((c) => c.type === 'expense' && !c.archived), [categories])
  const rowByCat = useMemo(() => new Map((grid?.rows ?? []).map((r) => [r.categoryId, r])), [grid])

  // scopes shown as editable columns
  const scopes: { key: string; label: string; color?: string }[] =
    personFilter == null
      ? [
          ...people.map((p) => ({ key: String(p.id), label: p.name, color: p.color })),
          { key: 'joint', label: 'Joint' }
        ]
      : [{ key: String(personFilter), label: people.find((p) => p.id === personFilter)?.name ?? '', color: people.find((p) => p.id === personFilter)?.color }]

  const budgetedTotal = (categoryId: number): number => {
    const row = rowByCat.get(categoryId)
    if (!row) return 0
    return scopes.reduce((s, sc) => s + (row.budgeted[sc.key] ?? 0), 0)
  }
  const actualTotal = (categoryId: number): number => {
    const row = rowByCat.get(categoryId)
    if (!row) return 0
    if (personFilter != null) return row.actual[String(personFilter)] ?? 0
    return Object.values(row.actual).reduce((s, v) => s + v, 0)
  }

  const setCell = async (categoryId: number, scope: string, raw: string): Promise<void> => {
    const cents = raw.trim() === '' ? 0 : parseAmountToCents(raw)
    if (cents == null || cents < 0) {
      toast('Enter a valid amount', 'error')
      return
    }
    try {
      await api.setBudget(month, categoryId, scope, cents)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const copyPrevious = async (): Promise<void> => {
    try {
      const n = await api.copyBudgetsFromPrevious(month)
      toast(n > 0 ? `Copied ${n} budget${n > 1 ? 's' : ''} from last month` : 'Nothing new to copy', n > 0 ? 'success' : 'info')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const setFromAverage = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Set budgets from 3-month average?',
      message:
        'Each expense category gets a budget equal to its average actual spending over the last three months (per person). Existing budgets for this month are overwritten.',
      confirmLabel: 'Set budgets'
    })
    if (!ok) return
    try {
      const n = await api.setBudgetsFromAverage(month)
      toast(n > 0 ? `Set ${n} budget${n > 1 ? 's' : ''}` : 'No spending history found in the last 3 months', n > 0 ? 'success' : 'info')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const anyBudget = (grid?.rows ?? []).some((r) => Object.keys(r.budgeted).length > 0)
  const totals = expenseCategories.reduce(
    (acc, c) => {
      acc.budgeted += budgetedTotal(c.id)
      acc.actual += actualTotal(c.id)
      return acc
    },
    { budgeted: 0, actual: 0 }
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} onChange={setMonth} />
        <div className="flex gap-2">
          <Button onClick={copyPrevious}>Copy previous month</Button>
          <Button onClick={setFromAverage}>Set from 3-month average</Button>
        </div>
      </div>

      {loading && !grid ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto !p-0">
          {expenseCategories.length === 0 ? (
            <EmptyState icon="◔" title="No expense categories" message="Create expense categories in Settings to budget against them." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                  <th className="px-4 py-3">Category</th>
                  {scopes.map((s) => (
                    <th key={s.key} className="px-3 py-3 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {s.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />}
                        {s.label}
                      </span>
                    </th>
                  ))}
                  {personFilter == null && <th className="px-3 py-3 text-right">Total budget</th>}
                  <th className="px-3 py-3 text-right">Actual</th>
                  <th className="px-3 py-3 text-right">Remaining</th>
                  <th className="w-44 px-4 py-3">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {expenseCategories.map((c) => {
                  const row = rowByCat.get(c.id)
                  const budgeted = budgetedTotal(c.id)
                  const actual = actualTotal(c.id)
                  const remaining = budgeted - actual
                  const over = budgeted > 0 && actual > budgeted
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="whitespace-nowrap px-4 py-2 font-medium">
                        {c.icon} {c.name}
                      </td>
                      {scopes.map((s) => (
                        <td key={s.key} className="px-3 py-2 text-right">
                          <BudgetCell
                            valueCents={row?.budgeted[s.key] ?? 0}
                            symbol={settings.currencySymbol}
                            onCommit={(raw) => setCell(c.id, s.key, raw)}
                          />
                        </td>
                      ))}
                      {personFilter == null && (
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{budgeted > 0 ? fmt(budgeted) : '—'}</td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {actual > 0 ? fmt(actual) : '—'}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-medium tabular-nums ${
                          budgeted === 0 ? 'text-slate-400' : over ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {budgeted > 0 ? fmt(remaining) : '—'}
                      </td>
                      <td className="px-4 py-2">
                        {budgeted > 0 && <ProgressBar value={actual} max={budgeted} color={c.color} over={over} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
                  <td className="px-4 py-3">Total</td>
                  {personFilter == null ? (
                    <>
                      <td className="px-3 py-3" colSpan={scopes.length} />
                      <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.budgeted)}</td>
                    </>
                  ) : (
                    <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.budgeted)}</td>
                  )}
                  <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.actual)}</td>
                  <td
                    className={`px-3 py-3 text-right tabular-nums ${
                      totals.actual > totals.budgeted && totals.budgeted > 0 ? 'text-red-600 dark:text-red-400' : ''
                    }`}
                  >
                    {fmt(totals.budgeted - totals.actual)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          )}
        </Card>
      )}

      {!anyBudget && !loading && (
        <p className="text-center text-sm text-slate-400">
          Tip: type an amount into any column to set a budget{viewMode === 'combined' ? ' — per person, or shared under Joint' : ''}. Use the
          quick actions above to fill the month in one go.
        </p>
      )}
    </div>
  )
}

function BudgetCell({
  valueCents,
  symbol,
  onCommit
}: {
  valueCents: number
  symbol: string
  onCommit: (raw: string) => Promise<void>
}): React.JSX.Element {
  const [text, setText] = useState(valueCents > 0 ? (valueCents / 100).toFixed(2) : '')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setText(valueCents > 0 ? (valueCents / 100).toFixed(2) : '')
    setDirty(false)
  }, [valueCents])

  const commit = async (): Promise<void> => {
    if (!dirty) return
    await onCommit(text)
    setDirty(false)
  }

  return (
    <div className="relative inline-block">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{symbol}</span>
      <input
        className="input h-8 w-24 pl-5 text-right"
        placeholder="—"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </div>
  )
}
