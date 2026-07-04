import React, { useEffect, useMemo, useState } from 'react'
import type { DashboardSummary } from '@shared/types'
import { currentMonthKey, formatDateDisplay } from '@shared/dates'
import { api } from '../api'
import { useApp } from '../appContext'
import { Button, Card, EmptyState, Money, MonthNav, ProgressBar, Spinner } from '../components/ui'
import { CategoryDonut, TrendChart } from '../components/charts'
import type { Page } from '../components/Layout'

export default function Dashboard({
  onNavigate
}: {
  onNavigate: (p: Page) => void
}): React.JSX.Element {
  const { settings, personFilter, fmt, toast, categoryById, personById, isDark } = useApp()
  const [month, setMonth] = useState(() => currentMonthKey(settings.firstDayOfMonth))
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .getDashboard(month, personFilter)
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((err) => toast(err.message, 'error'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [month, personFilter, toast])

  const donutData = useMemo(() => {
    if (!data) return []
    return data.byCategory.map((c) => {
      const cat = categoryById(c.categoryId)
      return {
        name: cat ? `${cat.icon} ${cat.name}`.trim() : 'Uncategorized',
        value: c.spentCents,
        color: cat?.color ?? '#94a3b8'
      }
    })
  }, [data, categoryById])

  const hasAnyActivity =
    data &&
    (data.trend.some((t) => t.incomeCents > 0 || t.spendingCents > 0) || data.upcoming.length > 0)

  if (loading && !data) return <Spinner />
  if (!data) return <></>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <MonthNav month={month} onChange={setMonth} />
        {month !== currentMonthKey(settings.firstDayOfMonth) && (
          <Button
            variant="ghost"
            onClick={() => setMonth(currentMonthKey(settings.firstDayOfMonth))}
          >
            Back to current month
          </Button>
        )}
      </div>

      {!hasAnyActivity ? (
        <Card>
          <EmptyState
            icon="🌱"
            title="Welcome to dollar"
            message="Add your first transaction or import a CSV from your bank to see your spending, budgets, and year-end forecast come to life."
            action={
              <Button variant="primary" onClick={() => onNavigate('transactions')}>
                Add a transaction
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* summary cards */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard
              label="Income this month"
              value={fmt(data.incomeCents)}
              accent="text-emerald-700 dark:text-emerald-400"
              note={
                data.expectedIncomeRemainingCents > 0
                  ? `+ ${fmt(data.expectedIncomeRemainingCents)} expected`
                  : undefined
              }
            />
            <StatCard
              label="Spending this month"
              value={fmt(data.spendingCents)}
              accent="text-red-600 dark:text-red-400"
            />
            <StatCard
              label="Net this month"
              value={fmt(data.netCents, { sign: true })}
              accent={
                data.netCents >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }
            />
            <StatCard
              label="Total savings balance"
              value={fmt(data.savingsBalanceCents)}
              accent="text-indigo-600 dark:text-indigo-400"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="Spending by category">
              {donutData.length === 0 ? (
                <EmptyState
                  icon="🧾"
                  title="No spending yet"
                  message="Expenses recorded this month will appear here."
                />
              ) : (
                <CategoryDonut data={donutData} fmt={fmt} dark={isDark} />
              )}
            </Card>

            <Card title="Spending vs budget">
              {data.budgetVsActual.length === 0 ? (
                <EmptyState
                  icon="◔"
                  title="No budgets set"
                  message="Set monthly budgets to track how each category is doing."
                  action={
                    <Button variant="secondary" onClick={() => onNavigate('budgets')}>
                      Set budgets
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-3">
                  {data.budgetVsActual.map((b) => {
                    const cat = categoryById(b.categoryId)
                    const over = b.actualCents > b.budgetedCents
                    return (
                      <li key={b.categoryId}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="font-medium">
                            {cat ? `${cat.icon} ${cat.name}` : 'Category'}
                            {over && (
                              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900 dark:text-red-300">
                                over budget
                              </span>
                            )}
                          </span>
                          <span className="tabular-nums text-slate-500 dark:text-slate-400">
                            {fmt(b.actualCents)} / {fmt(b.budgetedCents)}
                          </span>
                        </div>
                        <ProgressBar
                          value={b.actualCents}
                          max={b.budgetedCents}
                          color={cat?.color}
                          over={over}
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card title="Income vs spending — last 12 months" className="xl:col-span-2">
              <TrendChart data={data.trend} symbol={settings.currencySymbol} dark={isDark} />
            </Card>

            <Card title="Upcoming recurring (30 days)">
              {data.upcoming.length === 0 ? (
                <EmptyState
                  icon="🔁"
                  title="Nothing scheduled"
                  message="Recurring rules you create will show their next instances here."
                />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                  {data.upcoming.slice(0, 10).map((u, i) => {
                    const person = personById(u.personId)
                    return (
                      <li key={`${u.ruleId}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: person?.color ?? '#94a3b8' }}
                          title={person?.name}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{u.name}</div>
                          <div className="text-xs text-slate-400">{formatDateDisplay(u.date)}</div>
                        </div>
                        <Money cents={u.amountCents} fmt={fmt} colored sign />
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
  note
}: {
  label: string
  value: string
  accent: string
  note?: string
}): React.JSX.Element {
  return (
    <div className="card p-5">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{note}</div>}
    </div>
  )
}
