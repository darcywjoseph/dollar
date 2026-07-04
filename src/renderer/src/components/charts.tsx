import React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { formatMonthKey } from '@shared/dates'
import { formatCentsCompact } from '@shared/money'

// Chart chrome + the validated income/spending pair (see dataviz palette check):
// light surface #ffffff -> income #008300 / spending #e34948
// dark  surface #1e293b -> income #0ca30c / spending #e66767
export function chartTheme(dark: boolean): {
  income: string
  spending: string
  accent: string
  accentSoft: string
  grid: string
  ink: string
  surface: string
} {
  return dark
    ? {
        income: '#0ca30c',
        spending: '#e66767',
        accent: '#3987e5',
        accentSoft: '#86b6ef',
        grid: '#334155',
        ink: '#94a3b8',
        surface: '#1e293b'
      }
    : {
        income: '#008300',
        spending: '#e34948',
        accent: '#2a78d6',
        accentSoft: '#6da7ec',
        grid: '#e2e8f0',
        ink: '#64748b',
        surface: '#ffffff'
      }
}

export function tooltipStyle(dark: boolean): React.CSSProperties {
  return {
    backgroundColor: dark ? '#0f172a' : '#ffffff',
    border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
    borderRadius: 8,
    fontSize: 12,
    color: dark ? '#f1f5f9' : '#0f172a'
  }
}

// ---------------------------------------------------------------------------
// Donut: spending by category. Colors follow the category entity.
// ---------------------------------------------------------------------------

export interface DonutDatum {
  name: string
  value: number
  color: string
}

export function CategoryDonut({
  data,
  fmt,
  dark
}: {
  data: DonutDatum[]
  fmt: (c: number) => string
  dark: boolean
}): React.JSX.Element {
  const total = data.reduce((s, d) => s + d.value, 0)
  const t = chartTheme(dark)
  return (
    <div className="flex items-center gap-4">
      <div className="h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="95%"
              paddingAngle={2}
              stroke={t.surface}
              strokeWidth={2}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle(dark)} formatter={(v) => fmt(v as number)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {data.slice(0, 8).map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: d.color }}
            />
            <span className="truncate text-slate-600 dark:text-slate-300">{d.name}</span>
            <span className="ml-auto tabular-nums text-slate-800 dark:text-slate-100">
              {fmt(d.value)}
            </span>
            <span className="w-10 text-right text-xs tabular-nums text-slate-400">
              {total > 0 ? Math.round((d.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
        {data.length > 8 && (
          <li className="text-xs text-slate-400">+ {data.length - 8} more in tooltip</li>
        )}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 12-month income vs spending trend
// ---------------------------------------------------------------------------

export function TrendChart({
  data,
  symbol,
  dark
}: {
  data: { month: string; incomeCents: number; spendingCents: number }[]
  symbol: string
  dark: boolean
}): React.JSX.Element {
  const t = chartTheme(dark)
  const rows = data.map((d) => ({
    name: formatMonthKey(d.month).split(' ')[0],
    Income: d.incomeCents / 100,
    Spending: d.spendingCents / 100
  }))
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: t.ink, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: t.grid }}
          />
          <YAxis
            tick={{ fill: t.ink, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatCentsCompact(v * 100, symbol)}
            width={64}
          />
          <Tooltip
            contentStyle={tooltipStyle(dark)}
            formatter={(v) =>
              `${symbol}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="Income"
            stroke={t.income}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="Spending"
            stroke={t.spending}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Forecast: projected end-of-month balance, actual solid + projected dashed
// ---------------------------------------------------------------------------

export function ForecastChart({
  points,
  symbol,
  dark
}: {
  points: { month: string; actual: number | null; projected: number | null }[]
  symbol: string
  dark: boolean
}): React.JSX.Element {
  const t = chartTheme(dark)
  const rows = points.map((p) => ({
    name: formatMonthKey(p.month).split(' ')[0],
    Actual: p.actual == null ? null : p.actual / 100,
    Projected: p.projected == null ? null : p.projected / 100
  }))
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: t.ink, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: t.grid }}
          />
          <YAxis
            tick={{ fill: t.ink, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatCentsCompact(v * 100, symbol)}
            width={70}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={tooltipStyle(dark)}
            formatter={(v) =>
              `${symbol}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="Actual"
            stroke={t.accent}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="Projected"
            stroke={t.accentSoft}
            strokeWidth={2.5}
            strokeDasharray="6 4"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stacked category spending by month (reports)
// ---------------------------------------------------------------------------

export function StackedCategoryChart({
  months,
  series,
  symbol,
  dark
}: {
  months: string[]
  /** one entry per category: name, color, cents per month (aligned with months) */
  series: { name: string; color: string; values: number[] }[]
  symbol: string
  dark: boolean
}): React.JSX.Element {
  const t = chartTheme(dark)
  const rows = months.map((m, i) => {
    const row: Record<string, number | string> = { name: formatMonthKey(m).split(' ')[0] }
    for (const s of series) row[s.name] = s.values[i] / 100
    return row
  })
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: t.ink, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: t.grid }}
          />
          <YAxis
            tick={{ fill: t.ink, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatCentsCompact(v * 100, symbol)}
            width={64}
          />
          <Tooltip
            contentStyle={tooltipStyle(dark)}
            formatter={(v) =>
              `${symbol}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Bar
              key={s.name}
              dataKey={s.name}
              stackId="spend"
              fill={s.color}
              stroke={t.surface}
              strokeWidth={1}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Person comparison: grouped bars, colors follow the person entity
// ---------------------------------------------------------------------------

export function PersonBarChart({
  months,
  series,
  symbol,
  dark
}: {
  months: string[]
  series: { name: string; color: string; values: number[] }[]
  symbol: string
  dark: boolean
}): React.JSX.Element {
  const t = chartTheme(dark)
  const rows = months.map((m, i) => {
    const row: Record<string, number | string> = { name: formatMonthKey(m).split(' ')[0] }
    for (const s of series) row[s.name] = s.values[i] / 100
    return row
  })
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: t.ink, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: t.grid }}
          />
          <YAxis
            tick={{ fill: t.ink, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatCentsCompact(v * 100, symbol)}
            width={64}
          />
          <Tooltip
            contentStyle={tooltipStyle(dark)}
            formatter={(v) =>
              `${symbol}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Bar key={s.name} dataKey={s.name} fill={s.color} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
