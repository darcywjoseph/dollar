import React, { useEffect, useMemo, useState } from 'react'
import type { ForecastData } from '@shared/types'
import { compareISO, formatMonthKey } from '@shared/dates'
import { parseAmountToCents } from '@shared/money'
import { api } from '../api'
import { useApp } from '../appContext'
import { Button, Card, EmptyState, Money, Spinner } from '../components/ui'
import { ForecastChart } from '../components/charts'

interface Hypothetical {
  id: number
  name: string
  amountCents: number // signed
  personId: number
}

let hypoSeq = 0

export default function Forecast(): React.JSX.Element {
  const { settings, people, categoryById, fmt, toast, updateSetting, isDark } = useApp()
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(true)
  // what-if state: overrides keyed by category id ('null' = uncategorized), value = signed cents/month
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map())
  const [hypotheticals, setHypotheticals] = useState<Hypothetical[]>([])

  const windowMonths = settings.forecastWindow

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .getForecast(windowMonths)
      .then((d) => alive && setData(d))
      .catch((err) => toast(err.message, 'error'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [windowMonths, toast])

  // ---- base aggregations -------------------------------------------------
  const catKey = (id: number | null): string => (id == null ? 'null' : String(id))

  const base = useMemo(() => {
    if (!data) return null
    // per person per category variable averages
    const perPerson = new Map<number, Map<string, number>>()
    const combined = new Map<string, number>()
    for (const v of data.variableAverages) {
      const k = catKey(v.categoryId)
      let m = perPerson.get(v.personId)
      if (!m) {
        m = new Map()
        perPerson.set(v.personId, m)
      }
      m.set(k, (m.get(k) ?? 0) + v.avgCents)
      combined.set(k, (combined.get(k) ?? 0) + v.avgCents)
    }
    return { perPerson, combined }
  }, [data])

  // adjusted variable flow per person, split into income/spending
  const adjusted = useMemo(() => {
    if (!data || !base) return null
    const personIds = people.map((p) => p.id)
    const perPerson = new Map<number, { net: number; income: number; spending: number }>()
    for (const pid of personIds) perPerson.set(pid, { net: 0, income: 0, spending: 0 })

    const keys = new Set<string>([...base.combined.keys(), ...overrides.keys()])
    for (const k of keys) {
      const total = base.combined.get(k) ?? 0
      const target = overrides.has(k) ? overrides.get(k)! : total
      for (const pid of personIds) {
        const own = base.perPerson.get(pid)?.get(k) ?? 0
        // proportional share of the override; even split when no history
        const share = total !== 0 ? own / total : 1 / personIds.length
        const val = Math.round(target * share)
        const agg = perPerson.get(pid)!
        agg.net += val
        if (val >= 0) agg.income += val
        else agg.spending += -val
      }
    }
    for (const h of hypotheticals) {
      const agg = perPerson.get(h.personId)
      if (!agg) continue
      agg.net += h.amountCents
      if (h.amountCents >= 0) agg.income += h.amountCents
      else agg.spending += -h.amountCents
    }
    return perPerson
  }, [data, base, overrides, hypotheticals, people])

  // ---- projection ---------------------------------------------------------
  const projection = useMemo(() => {
    if (!data || !adjusted) return null
    const personIds = people.map((p) => p.id)
    const recurringByMonth = new Map<string, Map<number, { income: number; spending: number }>>()
    for (const f of data.recurringFlows) {
      let m = recurringByMonth.get(f.month)
      if (!m) {
        m = new Map()
        recurringByMonth.set(f.month, m)
      }
      m.set(f.personId, { income: f.incomeCents, spending: f.spendingCents })
    }
    const remRecCur = new Map<number, { income: number; spending: number }>()
    for (const f of data.currentMonthRemainingRecurring)
      remRecCur.set(f.personId, { income: f.incomeCents, spending: f.spendingCents })

    // Expected pay from schedules: remaining events this month, all events in
    // future months (per-pay replacement of income averages).
    const expPayByMonth = new Map<string, Map<number, number>>()
    for (const f of data.expectedPayFlows) {
      let m = expPayByMonth.get(f.month)
      if (!m) {
        m = new Map()
        expPayByMonth.set(f.month, m)
      }
      m.set(f.personId, (m.get(f.personId) ?? 0) + f.netCents)
    }
    const expPayCur = new Map<number, number>()
    for (const f of data.currentMonthRemainingExpectedPay)
      expPayCur.set(f.personId, (expPayCur.get(f.personId) ?? 0) + f.netCents)

    const remainFrac = 1 - data.currentMonthElapsed

    interface MonthProj {
      month: string
      kind: 'past' | 'current' | 'future'
      incomeCents: number
      spendingCents: number
      netCents: number
      netByPerson: Map<number, number>
    }

    const rows: MonthProj[] = []
    for (const a of data.actuals) {
      const byP = new Map<number, number>()
      for (const pid of personIds) byP.set(pid, a.netByPerson[String(pid)] ?? 0)
      rows.push({
        month: a.month,
        kind: 'past',
        incomeCents: a.incomeCents,
        spendingCents: a.spendingCents,
        netCents: a.incomeCents - a.spendingCents,
        netByPerson: byP
      })
    }

    // current month: actual so far + recurring still due + prorated variable
    {
      const byP = new Map<number, number>()
      let income = data.currentMonthActual.incomeCents
      let spending = data.currentMonthActual.spendingCents
      for (const pid of personIds) {
        const actualNet = data.currentMonthActual.netByPerson[String(pid)] ?? 0
        const rec = remRecCur.get(pid) ?? { income: 0, spending: 0 }
        const expPay = expPayCur.get(pid) ?? 0
        const varAgg = adjusted.get(pid)!
        const net =
          actualNet + rec.income - rec.spending + expPay + Math.round(varAgg.net * remainFrac)
        byP.set(pid, net)
        income += rec.income + expPay + Math.round(varAgg.income * remainFrac)
        spending += rec.spending + Math.round(varAgg.spending * remainFrac)
      }
      rows.push({
        month: data.currentMonth,
        kind: 'current',
        incomeCents: income,
        spendingCents: spending,
        netCents: [...byP.values()].reduce((s, v) => s + v, 0),
        netByPerson: byP
      })
    }

    for (const m of data.months) {
      if (compareISO(m, data.currentMonth) <= 0) continue
      const byP = new Map<number, number>()
      let income = 0
      let spending = 0
      for (const pid of personIds) {
        const rec = recurringByMonth.get(m)?.get(pid) ?? { income: 0, spending: 0 }
        const expPay = expPayByMonth.get(m)?.get(pid) ?? 0
        const varAgg = adjusted.get(pid)!
        byP.set(pid, rec.income - rec.spending + expPay + varAgg.net)
        income += rec.income + expPay + varAgg.income
        spending += rec.spending + varAgg.spending
      }
      rows.push({
        month: m,
        kind: 'future',
        incomeCents: income,
        spendingCents: spending,
        netCents: [...byP.values()].reduce((s, v) => s + v, 0),
        netByPerson: byP
      })
    }

    // balances
    const balNow = Object.values(data.balancesByOwner).reduce((s, v) => s + v, 0)
    const actualNetCur = data.currentMonthActual.incomeCents - data.currentMonthActual.spendingCents
    const balStartCurrent = balNow - actualNetCur

    const endBal = new Map<string, number>()
    // backwards through past months
    let walk = balStartCurrent
    const pastRows = rows.filter((r) => r.kind === 'past')
    for (let i = pastRows.length - 1; i >= 0; i--) {
      endBal.set(pastRows[i].month, walk)
      walk -= pastRows[i].netCents
    }
    // forward from current
    let fwd = balStartCurrent
    for (const r of rows) {
      if (r.kind === 'past') continue
      fwd += r.netCents
      endBal.set(r.month, fwd)
    }

    // per-person EOY: own accounts + projected own nets from current month on
    const eoyByPerson = new Map<number, number>()
    for (const pid of personIds) {
      let bal = data.balancesByOwner[String(pid)] ?? 0
      // remove actual current-month net already reflected in balance, then add projections
      bal -= data.currentMonthActual.netByPerson[String(pid)] ?? 0
      for (const r of rows) {
        if (r.kind === 'past') continue
        bal += r.netByPerson.get(pid) ?? 0
      }
      eoyByPerson.set(pid, bal)
    }

    const eoyCombined = endBal.get(data.months[11]) ?? balNow
    return { rows, endBal, eoyByPerson, eoyCombined, balNow }
  }, [data, adjusted, people])

  // ---- what-if editing -----------------------------------------------------
  const whatIfCategories = useMemo(() => {
    if (!base) return []
    return [...base.combined.entries()]
      .map(([k, v]) => ({
        key: k,
        category: k === 'null' ? null : categoryById(Number(k)),
        baseCents: v
      }))
      .sort((a, b) => Math.abs(b.baseCents) - Math.abs(a.baseCents))
  }, [base, categoryById])

  const chartPoints = useMemo(() => {
    if (!data || !projection) return []
    return data.months.map((m) => {
      const bal = projection.endBal.get(m)
      const past = compareISO(m, data.currentMonth) < 0
      return {
        month: m,
        actual: past ? (bal ?? null) : null,
        projected: past ? null : (bal ?? null)
      }
    })
  }, [data, projection])

  // connect the actual and projected lines at the boundary
  const connectedPoints = useMemo(() => {
    const pts = chartPoints.map((p) => ({ ...p }))
    const lastActualIdx = pts.reduce((acc, p, i) => (p.actual != null ? i : acc), -1)
    if (lastActualIdx >= 0 && lastActualIdx + 1 < pts.length) {
      pts[lastActualIdx].projected = pts[lastActualIdx].actual
    }
    return pts
  }, [chartPoints])

  if (loading && !data) return <Spinner />
  if (!data || !projection || !adjusted) return <></>

  const hasHistory =
    data.variableAverages.length > 0 ||
    data.actuals.some((a) => a.incomeCents > 0 || a.spendingCents > 0)
  const whatIfActive = overrides.size > 0 || hypotheticals.length > 0
  const remainingNet = projection.rows
    .filter((r) => r.kind !== 'past')
    .reduce((s, r) => s + r.netCents, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Year forecast — {data.year}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Known recurring items plus variable spending estimated from your trailing {windowMonths}
            -month average.
            {data.scheduledPersonIds.length > 0 &&
              ' Income for people with a pay schedule uses expected pay, replaced by actual payslips as they arrive.'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500 dark:text-slate-400">Average window:</span>
          {[3, 6].map((w) => (
            <button
              key={w}
              onClick={() =>
                updateSetting('forecastWindow', String(w)).catch((e) => toast(e.message, 'error'))
              }
              className={`rounded-lg px-3 py-1.5 font-medium transition ${
                windowMonths === w
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {w} months
            </button>
          ))}
        </div>
      </div>

      {!hasHistory ? (
        <Card>
          <EmptyState
            icon="↗"
            title="Not enough history to forecast"
            message="Add or import transactions and set up recurring rules — the forecast projects every month through December from that data."
          />
        </Card>
      ) : (
        <>
          {/* summary cards */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <EoyCard
              label="Projected EOY balance — combined"
              value={fmt(projection.eoyCombined)}
              note="includes joint accounts"
            />
            {people.map((p) => (
              <EoyCard
                key={p.id}
                label={`Projected EOY — ${p.name}`}
                value={fmt(projection.eoyByPerson.get(p.id) ?? 0)}
                dotColor={p.color}
                note="own accounts only"
              />
            ))}
            <EoyCard
              label="Projected net, rest of year"
              value={fmt(remainingNet, { sign: true })}
              tone={remainingNet >= 0 ? 'good' : 'bad'}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card title="Balance through December" className="xl:col-span-2">
              <ForecastChart
                points={connectedPoints}
                symbol={settings.currencySymbol}
                dark={isDark}
              />
              {whatIfActive && (
                <p className="mt-2 text-xs text-indigo-500 dark:text-indigo-300">
                  What-if adjustments are applied to the dashed projection.
                </p>
              )}
            </Card>

            {/* what-if panel */}
            <Card
              title="What-if"
              actions={
                whatIfActive ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setOverrides(new Map())
                      setHypotheticals([])
                    }}
                  >
                    Reset
                  </Button>
                ) : undefined
              }
            >
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Adjust a category&apos;s monthly amount or add a hypothetical recurring item — the
                forecast updates live.
              </p>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {whatIfCategories.slice(0, 14).map(({ key, category, baseCents }) => (
                  <WhatIfRow
                    key={key}
                    label={category ? `${category.icon} ${category.name}` : 'Uncategorized'}
                    baseCents={baseCents}
                    overrideCents={overrides.get(key)}
                    symbol={settings.currencySymbol}
                    onChange={(v) => {
                      const next = new Map(overrides)
                      if (v == null) next.delete(key)
                      else next.set(key, v)
                      setOverrides(next)
                    }}
                  />
                ))}
                {whatIfCategories.length === 0 && (
                  <p className="text-sm text-slate-400">No variable spending history yet.</p>
                )}
              </div>
              <HypotheticalForm onAdd={(h) => setHypotheticals((hs) => [...hs, h])} />
              {hypotheticals.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {hypotheticals.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-700/50"
                    >
                      <span>
                        {h.name}{' '}
                        <span className="text-xs text-slate-400">
                          ({people.find((p) => p.id === h.personId)?.name}/mo)
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Money cents={h.amountCents} fmt={fmt} colored sign />
                        <button
                          className="text-slate-400 hover:text-red-500"
                          onClick={() => setHypotheticals((hs) => hs.filter((x) => x.id !== h.id))}
                          aria-label="Remove"
                        >
                          ✕
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* month-by-month table */}
          <Card title="Month by month" className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2 text-right">Income</th>
                  <th className="px-3 py-2 text-right">Spending</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  {people.map((p) => (
                    <th key={p.id} className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: p.color }}
                        />
                        {p.name} net
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">End balance</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {projection.rows.map((r) => (
                  <tr
                    key={r.month}
                    className={r.kind === 'past' ? 'text-slate-400 dark:text-slate-500' : ''}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      {formatMonthKey(r.month)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.incomeCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.spendingCents)}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      <Money cents={r.netCents} fmt={fmt} colored={r.kind !== 'past'} sign />
                    </td>
                    {people.map((p) => (
                      <td key={p.id} className="px-3 py-2 text-right tabular-nums">
                        {fmt(r.netByPerson.get(p.id) ?? 0, { sign: true })}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {fmt(projection.endBal.get(r.month) ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.kind === 'past' ? (
                        'actual'
                      ) : r.kind === 'current' ? (
                        <span className="text-indigo-500">partial + projected</span>
                      ) : (
                        <span className="text-indigo-400">projected</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}

function EoyCard({
  label,
  value,
  note,
  dotColor,
  tone
}: {
  label: string
  value: string
  note?: string
  dotColor?: string
  tone?: 'good' | 'bad'
}): React.JSX.Element {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        {dotColor && (
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} />
        )}
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === 'good'
            ? 'text-emerald-700 dark:text-emerald-400'
            : tone === 'bad'
              ? 'text-red-600 dark:text-red-400'
              : ''
        }`}
      >
        {value}
      </div>
      {note && <div className="mt-0.5 text-[11px] text-slate-400">{note}</div>}
    </div>
  )
}

function WhatIfRow({
  label,
  baseCents,
  overrideCents,
  symbol,
  onChange
}: {
  label: string
  baseCents: number
  overrideCents: number | undefined
  symbol: string
  onChange: (v: number | null) => void
}): React.JSX.Element {
  const isSpend = baseCents < 0
  const shown = overrideCents !== undefined ? Math.abs(overrideCents) : Math.abs(baseCents)
  const [text, setText] = useState((shown / 100).toFixed(0))

  useEffect(() => {
    setText((shown / 100).toFixed(0))
  }, [shown])

  const commit = (raw: string): void => {
    const cents = parseAmountToCents(raw)
    if (cents == null) return
    const signed = isSpend ? -Math.abs(cents) : Math.abs(cents)
    if (signed === baseCents) onChange(null)
    else onChange(signed)
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs text-slate-400">{isSpend ? 'spend' : 'income'}/mo</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
          {symbol}
        </span>
        <input
          className={`input h-8 w-24 pl-5 text-right ${overrideCents !== undefined ? 'border-indigo-400 ring-1 ring-indigo-300 dark:border-indigo-500' : ''}`}
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>
      {overrideCents !== undefined && (
        <button
          className="text-xs text-slate-400 hover:text-slate-600"
          onClick={() => onChange(null)}
          title="Reset to average"
        >
          ↺
        </button>
      )}
    </div>
  )
}

function HypotheticalForm({ onAdd }: { onAdd: (h: Hypothetical) => void }): React.JSX.Element {
  const { people, toast, settings } = useApp()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const [personId, setPersonId] = useState(people[0]?.id ?? 1)

  const add = (): void => {
    const cents = parseAmountToCents(amount)
    if (!name.trim() || cents == null || cents === 0) {
      toast('Give the item a name and a monthly amount', 'error')
      return
    }
    onAdd({
      id: ++hypoSeq,
      name: name.trim(),
      amountCents: kind === 'income' ? Math.abs(cents) : -Math.abs(cents),
      personId
    })
    setName('')
    setAmount('')
  }

  return (
    <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-700">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
        Add hypothetical monthly item
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input h-8 min-w-24 flex-1"
          placeholder="e.g. Gym membership"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <select
          className="input h-8 w-24"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'expense' | 'income')}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input
          className="input h-8 w-20 text-right"
          placeholder={`${settings.currencySymbol}/mo`}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <select
          className="input h-8 w-24"
          value={personId}
          onChange={(e) => setPersonId(Number(e.target.value))}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button type="button" variant="secondary" className="h-8" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  )
}
