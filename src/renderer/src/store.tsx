import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Account, AppSettings, Bootstrap, Category, Person } from '@shared/types'
import { formatCents } from '@shared/money'
import { api } from './api'

export type ViewMode = 'combined' | number

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

interface AppState {
  ready: boolean
  people: Person[]
  accounts: Account[]
  categories: Category[]
  balances: Map<number, number>
  settings: AppSettings
  viewMode: ViewMode
  isDark: boolean
  setViewMode: (mode: ViewMode) => void
  /** person id for queries: null in combined mode */
  personFilter: number | null
  fmt: (cents: number, opts?: { sign?: boolean }) => string
  toast: (message: string, type?: Toast['type']) => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  refresh: () => Promise<void>
  updateSetting: (key: keyof AppSettings, value: string) => Promise<void>
  personById: (id: number | null) => Person | undefined
  categoryById: (id: number | null) => Category | undefined
  accountById: (id: number) => Account | undefined
}

const DEFAULT_SETTINGS: AppSettings = {
  currencySymbol: '$',
  firstDayOfMonth: 1,
  theme: 'system',
  viewMode: 'combined',
  forecastWindow: 3
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}

let toastSeq = 0

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [viewMode, setViewModeState] = useState<ViewMode>('combined')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [isDark, setIsDark] = useState(false)
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const loadFailed = useRef(false)

  const refresh = useCallback(async () => {
    const data = await api.getBootstrap()
    setBoot(data)
  }, [])

  useEffect(() => {
    refresh()
      .then(() => setReady(true))
      .catch((err) => {
        loadFailed.current = true
        console.error(err)
        toast(`Failed to load: ${err.message}`, 'error')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // sync view mode from persisted settings once loaded
  useEffect(() => {
    if (!boot) return
    const vm = boot.settings.viewMode
    setViewModeState(vm === 'combined' || vm === '' ? 'combined' : Number(vm))
  }, [boot])

  // theme
  const theme = boot?.settings.theme ?? 'system'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
      setIsDark(dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastSeq
    setToasts((ts) => [...ts, { id, message, type }])
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4200)
  }, [])

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => setConfirmState({ ...opts, resolve }))
  }, [])

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode)
      api.setSetting('viewMode', mode === 'combined' ? 'combined' : String(mode)).catch(() => undefined)
    },
    []
  )

  const updateSetting = useCallback(
    async (key: keyof AppSettings, value: string) => {
      await api.setSetting(key, value)
      await refresh()
    },
    [refresh]
  )

  const settings = boot?.settings ?? DEFAULT_SETTINGS
  const people = boot?.people ?? []
  const accounts = boot?.accounts ?? []
  const categories = boot?.categories ?? []
  const balances = useMemo(
    () => new Map((boot?.balances ?? []).map((b) => [b.accountId, b.balanceCents])),
    [boot]
  )

  const fmt = useCallback(
    (cents: number, opts?: { sign?: boolean }) => formatCents(cents, settings.currencySymbol, opts),
    [settings.currencySymbol]
  )

  const value: AppState = useMemo(
    () => ({
      ready,
      people,
      accounts,
      categories,
      balances,
      settings,
      viewMode,
      isDark,
      setViewMode,
      personFilter: viewMode === 'combined' ? null : viewMode,
      fmt,
      toast,
      confirm,
      refresh,
      updateSetting,
      personById: (id) => people.find((p) => p.id === id),
      categoryById: (id) => categories.find((c) => c.id === id),
      accountById: (id) => accounts.find((a) => a.id === id)
    }),
    [ready, people, accounts, categories, balances, settings, viewMode, isDark, setViewMode, fmt, toast, confirm, refresh, updateSetting]
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* toasts */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg ${
              t.type === 'error'
                ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                : t.type === 'success'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                  : 'border-slate-300 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
      {/* confirm dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal>
          <div className="card w-full max-w-md p-6">
            <h3 className="text-base font-semibold">{confirmState.title}</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{confirmState.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
                onClick={() => {
                  confirmState.resolve(false)
                  setConfirmState(null)
                }}
                autoFocus
              >
                Cancel
              </button>
              <button
                className={`h-9 rounded-lg px-4 text-sm font-medium text-white ${
                  confirmState.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
                onClick={() => {
                  confirmState.resolve(true)
                  setConfirmState(null)
                }}
              >
                {confirmState.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
