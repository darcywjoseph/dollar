import React, { useEffect, useMemo, useState } from 'react'
import type { YearReport } from '@shared/types'
import { formatMonthKey } from '@shared/dates'
import { api } from '../api'
import { useApp } from '../store'
import { Button, Card, EmptyState, Money, Spinner } from '../components/ui'
import { PersonBarChart, StackedCategoryChart } from '../components/charts'

type Tab = 'summary' | 'categories' | 'people'

export default function Reports(): React.JSX.Element {
  const { personFilter, settings, people, categoryById, fmt, toast, isDark } = useApp()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [tab, setTab] = useState<Tab>('summary')
  const [report, setReport] = useState<YearReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .getYearReport(year, tab === 'people' ? null : personFilter)
      .then((r) => alive && setReport(r))
      .catch((err) => toast(err.message, 'error'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [year, personFilter, tab, toast])

  const months = useMemo(() => report?.byMonth.map((m) => m.month) ?? [], [report])

  // top categories by yearly spend; the rest folds into "Other"
  const categorySeries = useMemo(() => {
    if (!report) return []
    const totals = new Map<string, number>()
    for (const c of report.categoryByMonth) {
      const k = c.categoryId == null ? 'null' : String(c.categoryId)
      totals.set(k, (totals.get(k) ?? 0) + c.spentCents)
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1])
    const top = ranked.slice(0, 8).map(([k]) => k)
    const series = top.map((k) => {
      const cat = k === 'null' ? null : categoryById(Number(k))
      return {
        key: k,
        name: cat ? cat.name : 'Uncategorized',
        color: cat?.color ?? '#94a3b8',
        values: months.map(() => 0)
      }
    })
    const other = { key: '__other', name: 'Other', color: '#cbd5e1', values: months.map(() => 0) }
    const idxByMonth = new Map(months.map((m, i) => [m, i]))
    for (const c of report.categoryByMonth) {
      const k = c.categoryId == null ? 'null' : String(c.categoryId)
      const mi = idxByMonth.get(c.month)
      if (mi == null) continue
      const s = series.find((x) => x.key === k)
      if (s) s.values[mi] += c.spentCents
      else other.values[mi] += c.spentCents
    }
    return other.values.some((v) => v > 0) ? [...series, other] : series
  }, [report, months, categoryById])

  const personSeries = useMemo(() => {
    if (!report) return []
    const idxByMonth = new Map(months.map((m, i) => [m, i]))
    return people.map((p) => {
      const values = months.map(() => 0)
      for (const r of report.personByMonth) {
        if (r.personId !== p.id) continue
        const mi = idxByMonth.get(r.month)
        if (mi != null) values[mi] = r.spendingCents
      }
      return { name: p.name, color: p.color, values }
    })
  }, [report, months, people])

  const yearTotals = useMemo(() => {
    if (!report) return { income: 0, spending: 0 }
    return report.byMonth.reduce(
      (acc, m) => {
        acc.income += m.incomeCents
        acc.spending += m.spendingCents
        return acc
      },
      { income: 0, spending: 0 }
    )
  }, [report])

  const hasData = report && (yearTotals.income > 0 || yearTotals.spending > 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
          {(
            [
              ['summary', 'Monthly summary'],
              ['categories', 'Categories over time'],
              ['people', 'Person comparison']
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                tab === t
                  ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
            ‹
          </Button>
          <span className="w-14 text-center text-sm font-semibold tabular-nums">{year}</span>
          <Button variant="ghost" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
            ›
          </Button>
        </div>
      </div>

      {loading && !report ? (
        <Spinner />
      ) : !hasData ? (
        <Card>
          <EmptyState
            icon="▤"
            title={`No activity in ${year}`}
            message="Transactions recorded in this year will be summarized here."
          />
        </Card>
      ) : (
        <>
          {tab === 'summary' && report && (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                    <th className="px-3 py-2">Month</th>
                    <th className="px-3 py-2 text-right">Income</th>
                    <th className="px-3 py-2 text-right">Spending</th>
                    <th className="px-3 py-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {report.byMonth.map((m) => (
                    <tr key={m.month} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="px-3 py-2 font-medium">{formatMonthKey(m.month)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {m.incomeCents > 0 ? fmt(m.incomeCents) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {m.spendingCents > 0 ? fmt(m.spendingCents) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {m.incomeCents === 0 && m.spendingCents === 0 ? (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        ) : (
                          <Money cents={m.incomeCents - m.spendingCents} fmt={fmt} colored sign />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
                    <td className="px-3 py-2.5">Total {year}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmt(yearTotals.income)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmt(yearTotals.spending)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Money
                        cents={yearTotals.income - yearTotals.spending}
                        fmt={fmt}
                        colored
                        sign
                      />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          )}

          {tab === 'categories' && (
            <Card title="Spending by category, stacked by month">
              <StackedCategoryChart
                months={months}
                series={categorySeries}
                symbol={settings.currencySymbol}
                dark={isDark}
              />
            </Card>
          )}

          {tab === 'people' && report && (
            <div className="space-y-4">
              <Card title="Monthly spending by person">
                <PersonBarChart
                  months={months}
                  series={personSeries}
                  symbol={settings.currencySymbol}
                  dark={isDark}
                />
              </Card>
              <Card title={`Totals for ${year}`}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                      <th className="px-3 py-2">Person</th>
                      <th className="px-3 py-2 text-right">Income</th>
                      <th className="px-3 py-2 text-right">Spending</th>
                      <th className="px-3 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {people.map((p) => {
                      const rows = report.personByMonth.filter((r) => r.personId === p.id)
                      const income = rows.reduce((s, r) => s + r.incomeCents, 0)
                      const spending = rows.reduce((s, r) => s + r.spendingCents, 0)
                      return (
                        <tr key={p.id}>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: p.color }}
                              />
                              {p.name}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(income)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmt(spending)}</td>
                          <td className="px-3 py-2 text-right font-medium">
                            <Money cents={income - spending} fmt={fmt} colored sign />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}
      <p className="text-xs text-slate-400">
        Looking for exports? Transactions can be exported to CSV from the Transactions page; full
        JSON backup lives in Settings → Data.
      </p>
    </div>
  )
}
