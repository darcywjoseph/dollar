import React from 'react'
import { useApp } from '../store'

export type Page =
  'dashboard' | 'transactions' | 'budgets' | 'goals' | 'forecast' | 'reports' | 'settings'

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◧' },
  { id: 'transactions', label: 'Transactions', icon: '⇄' },
  { id: 'budgets', label: 'Budgets', icon: '◔' },
  { id: 'goals', label: 'Goals', icon: '◎' },
  { id: 'forecast', label: 'Forecast', icon: '↗' },
  { id: 'reports', label: 'Reports', icon: '▤' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
]

export function Layout({
  page,
  onNavigate,
  children
}: {
  page: Page
  onNavigate: (p: Page) => void
  children: React.ReactNode
}): React.JSX.Element {
  const { people, viewMode, setViewMode } = useApp()

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-base font-bold text-white">
            $
          </div>
          <span className="text-lg font-semibold tracking-tight">dollar</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((item) => (
            <button
              key={item.id}
              data-nav={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                page === item.id
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-slate-700 dark:text-indigo-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/60'
              }`}
            >
              <span className="w-4 text-center text-base leading-none">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 text-[11px] text-slate-400">Local &amp; offline</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-700 dark:bg-slate-800">
          <h1 className="text-base font-semibold capitalize">{page}</h1>
          {/* Me / Partner / Combined toggle — persists app-wide */}
          <div className="flex items-center rounded-lg border border-slate-200 p-0.5 dark:border-slate-600">
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => setViewMode(p.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === p.id
                    ? 'bg-slate-100 text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                {p.name}
              </button>
            ))}
            <button
              onClick={() => setViewMode('combined')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                viewMode === 'combined'
                  ? 'bg-slate-100 text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Combined
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
