import { createContext, useContext } from 'react'
import type { Account, AppSettings, Category, Person } from '@shared/types'

export type ViewMode = 'combined' | number

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

export interface AppState {
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

export const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}
