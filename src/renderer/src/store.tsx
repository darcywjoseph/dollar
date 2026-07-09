import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings, Bootstrap } from '@shared/types'
import { formatCents } from '@shared/money'
import {
  api,
  checkHealth,
  getServerUrl,
  login as apiLogin,
  logout as apiLogout,
  ServerUnreachableError,
  setServerUrl,
  setSessionToken
} from './api'
import { nativeApi } from './nativeApi'
import { ConnectionGate, type ConnectionPhase } from './components/ConnectionGate'
import { Ctx, type AppState, type ConfirmOptions, type Toast, type ViewMode } from './appContext'

const EMPTY: never[] = []

const DEFAULT_SETTINGS: AppSettings = {
  currencySymbol: '$',
  firstDayOfMonth: 1,
  theme: 'system',
  viewMode: 'combined',
  forecastWindow: 3
}

let toastSeq = 0

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState<ConnectionPhase | 'ready'>('checking')
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [viewMode, setViewModeState] = useState<ViewMode>('combined')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [isDark, setIsDark] = useState(false)
  const [confirmState, setConfirmState] = useState<
    (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  >(null)

  const refresh = useCallback(async () => {
    const data = await api.getBootstrap()
    setBoot(data)
  }, [])

  // Boot sequence: resolve the configured server, confirm it's reachable, then
  // load. Each failure lands on a specific gate screen (setup / unreachable).
  const connect = useCallback(async () => {
    setPhase('checking')
    const cfg = await nativeApi.getClientConfig()
    if (!cfg.serverUrl) {
      setPhase('needs-config')
      return
    }
    setServerUrl(cfg.serverUrl)
    const token = await nativeApi.getSessionToken()
    setSessionToken(token)
    if (!(await checkHealth(cfg.serverUrl))) {
      setPhase('unreachable')
      return
    }
    if (!token) {
      setPhase('needs-login')
      return
    }
    try {
      await refresh()
      setReady(true)
      setPhase('ready')
    } catch (err) {
      if (err instanceof ServerUnreachableError) {
        setPhase('unreachable')
      } else {
        // Most likely an expired/invalid token → bounce to login.
        await nativeApi.setSessionToken(null)
        setSessionToken(null)
        setPhase('needs-login')
      }
    }
  }, [refresh])

  const configureServer = useCallback(
    async (url: string) => {
      await nativeApi.setClientConfig({ serverUrl: url })
      await connect()
    },
    [connect]
  )

  const doLogin = useCallback(
    async (username: string, password: string) => {
      const url = getServerUrl()
      if (!url) throw new Error('No server configured')
      const { token } = await apiLogin(url, username, password)
      await nativeApi.setSessionToken(token)
      setSessionToken(token)
      await connect()
    },
    [connect]
  )

  const logout = useCallback(async () => {
    const url = getServerUrl()
    const token = await nativeApi.getSessionToken()
    if (url && token) await apiLogout(url, token)
    await nativeApi.setSessionToken(null)
    setSessionToken(null)
    setReady(false)
    setBoot(null)
    setPhase('needs-login')
  }, [])

  useEffect(() => {
    connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A 401 mid-session (expired/revoked token) bounces back to login.
  useEffect(() => {
    const onExpired = (): void => {
      setSessionToken(null)
      void nativeApi.setSessionToken(null)
      setReady(false)
      setPhase('needs-login')
    }
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
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

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    api
      .setSetting('viewMode', mode === 'combined' ? 'combined' : String(mode))
      .catch(() => undefined)
  }, [])

  const updateSetting = useCallback(
    async (key: keyof AppSettings, value: string) => {
      await api.setSetting(key, value)
      await refresh()
    },
    [refresh]
  )

  const settings = boot?.settings ?? DEFAULT_SETTINGS
  const people = boot?.people ?? EMPTY
  const accounts = boot?.accounts ?? EMPTY
  const categories = boot?.categories ?? EMPTY
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
      currentUser: boot?.currentUser ?? null,
      logout,
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
    [
      ready,
      people,
      accounts,
      categories,
      balances,
      settings,
      boot,
      logout,
      viewMode,
      isDark,
      setViewMode,
      fmt,
      toast,
      confirm,
      refresh,
      updateSetting
    ]
  )

  if (phase !== 'ready') {
    return (
      <ConnectionGate
        phase={phase}
        onConfigure={configureServer}
        onLogin={doLogin}
        onRetry={connect}
        onChangeServer={() => setPhase('needs-config')}
      />
    )
  }

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
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal
        >
          <div className="card w-full max-w-md p-6">
            <h3 className="text-base font-semibold">{confirmState.title}</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {confirmState.message}
            </p>
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
                  confirmState.danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
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
