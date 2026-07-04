import React, { useState } from 'react'
import type { Account, AccountInput, AccountType, Category, CategoryInput } from '@shared/types'
import { parseAmountToCents } from '@shared/money'
import { api } from '../api'
import { useApp } from '../store'
import { Badge, Button, Card, Modal } from '../components/ui'

export default function Settings(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <GeneralSection />
      <PeopleSection />
      <AccountsSection />
      <CategoriesSection />
      <DataSection />
    </div>
  )
}

// ---------------------------------------------------------------------------

function GeneralSection(): React.JSX.Element {
  const { settings, updateSetting, toast } = useApp()
  const [symbol, setSymbol] = useState(settings.currencySymbol)

  const save = (key: 'currencySymbol' | 'firstDayOfMonth' | 'theme' | 'forecastWindow', value: string): void => {
    updateSetting(key, value).catch((err) => toast(err.message, 'error'))
  }

  return (
    <Card title="General">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <label className="label">Currency symbol</label>
          <input
            className="input"
            value={symbol}
            maxLength={4}
            onChange={(e) => setSymbol(e.target.value)}
            onBlur={() => {
              if (symbol.trim() && symbol !== settings.currencySymbol) save('currencySymbol', symbol.trim())
            }}
          />
        </div>
        <div>
          <label className="label">Month starts on day</label>
          <select
            className="input"
            value={settings.firstDayOfMonth}
            onChange={(e) => save('firstDayOfMonth', e.target.value)}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Theme</label>
          <select className="input" value={settings.theme} onChange={(e) => save('theme', e.target.value)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div>
          <label className="label">Forecast average window</label>
          <select className="input" value={settings.forecastWindow} onChange={(e) => save('forecastWindow', e.target.value)}>
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
          </select>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        “Month starts on day” shifts every monthly period — useful if you budget payday-to-payday rather than by calendar
        month.
      </p>
    </Card>
  )
}

// ---------------------------------------------------------------------------

function PeopleSection(): React.JSX.Element {
  const { people, refresh, toast } = useApp()
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(people.map((p) => [p.id, p.name])))

  const commitName = async (id: number): Promise<void> => {
    const name = (names[id] ?? '').trim()
    const current = people.find((p) => p.id === id)
    if (!current || !name || name === current.name) return
    try {
      await api.updatePerson(id, { name })
      await refresh()
      toast('Name updated', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const commitColor = async (id: number, color: string): Promise<void> => {
    try {
      await api.updatePerson(id, { color })
      await refresh()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <Card title="People">
      <div className="space-y-3">
        {people.map((p) => (
          <div key={p.id} className="flex items-center gap-3">
            <input
              type="color"
              aria-label={`${p.name} color`}
              className="h-9 w-12 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-600"
              value={p.color}
              onChange={(e) => commitColor(p.id, e.target.value)}
            />
            <input
              className="input max-w-60"
              value={names[p.id] ?? p.name}
              onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))}
              onBlur={() => commitName(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-400">Each person&apos;s color marks their transactions, budgets, and goals across the app.</p>
    </Card>
  )
}

// ---------------------------------------------------------------------------

const ACCOUNT_TYPES: AccountType[] = ['checking', 'savings', 'credit', 'cash']

function AccountsSection(): React.JSX.Element {
  const { accounts, people, balances, fmt, refresh, toast, confirm } = useApp()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)

  const remove = async (a: Account): Promise<void> => {
    const ok = await confirm({
      title: `Delete account “${a.name}”?`,
      message: 'Only accounts without transactions or recurring rules can be deleted — otherwise archive it instead.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await api.deleteAccount(a.id)
      await refresh()
      toast('Account deleted', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const toggleArchive = async (a: Account): Promise<void> => {
    try {
      await api.updateAccount(a.id, { archived: !a.archived })
      await refresh()
      toast(a.archived ? 'Account restored' : 'Account archived', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <Card
      title="Accounts"
      actions={
        <Button variant="secondary" onClick={() => setEditing('new')}>
          Add account
        </Button>
      }
    >
      <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
        {accounts.map((a) => {
          const owner = a.personId != null ? people.find((p) => p.id === a.personId) : null
          return (
            <li key={a.id} className={`flex items-center gap-3 py-2.5 ${a.archived ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {a.name}
                  <Badge>{a.type}</Badge>
                  {a.archived && <Badge tone="warn">archived</Badge>}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                  {owner ? (
                    <>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: owner.color }} />
                      {owner.name}
                    </>
                  ) : (
                    'Joint'
                  )}
                  <span>· balance {fmt(balances.get(a.id) ?? a.startingBalanceCents)}</span>
                </div>
              </div>
              <Button variant="ghost" onClick={() => setEditing(a)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => toggleArchive(a)}>
                {a.archived ? 'Restore' : 'Archive'}
              </Button>
              <Button variant="ghost" className="text-red-500" onClick={() => remove(a)}>
                Delete
              </Button>
            </li>
          )
        })}
      </ul>
      {editing && (
        <AccountModal
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </Card>
  )
}

function AccountModal({
  account,
  onClose,
  onSaved
}: {
  account: Account | null
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const { people, toast, settings } = useApp()
  const [name, setName] = useState(account?.name ?? '')
  const [personId, setPersonId] = useState<number | ''>(account?.personId ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking')
  const [startingBalance, setStartingBalance] = useState(account ? (account.startingBalanceCents / 100).toFixed(2) : '0.00')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const cents = parseAmountToCents(startingBalance)
    if (cents == null) {
      toast('Enter a valid starting balance', 'error')
      return
    }
    const payload: AccountInput = {
      name: name.trim(),
      personId: personId === '' ? null : personId,
      type,
      startingBalanceCents: cents,
      currency: 'USD'
    }
    setSaving(true)
    try {
      if (account) await api.updateAccount(account.id, payload)
      else await api.createAccount(payload)
      toast(account ? 'Account updated' : 'Account created', 'success')
      await onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  return (
    <Modal title={account ? 'Edit account' : 'New account'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="label">Name</label>
          <input className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Owner</label>
            <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Joint</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Starting balance ({settings.currencySymbol})</label>
            <input className="input text-right" inputMode="decimal" value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : account ? 'Save changes' : 'Create account'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function CategoriesSection(): React.JSX.Element {
  const { categories, refresh, toast, confirm } = useApp()
  const [editing, setEditing] = useState<Category | 'new' | null>(null)

  const remove = async (c: Category): Promise<void> => {
    const ok = await confirm({
      title: `Delete category “${c.name}”?`,
      message: 'Transactions in this category become Uncategorized and its budgets are removed. Consider archiving instead to keep history tidy.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await api.deleteCategory(c.id)
      await refresh()
      toast('Category deleted', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const toggleArchive = async (c: Category): Promise<void> => {
    try {
      await api.updateCategory(c.id, { archived: !c.archived })
      await refresh()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const groups: { label: string; items: Category[] }[] = [
    { label: 'Expenses', items: categories.filter((c) => c.type === 'expense') },
    { label: 'Income', items: categories.filter((c) => c.type === 'income') }
  ]

  return (
    <Card
      title="Categories"
      actions={
        <Button variant="secondary" onClick={() => setEditing('new')}>
          Add category
        </Button>
      }
    >
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.label}</h4>
            <ul className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
              {g.items.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-center gap-2.5 border-b border-slate-100 py-2 dark:border-slate-700/60 ${c.archived ? 'opacity-50' : ''}`}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {c.icon} {c.name} {c.archived && <Badge tone="warn">archived</Badge>}
                  </span>
                  <button className="text-xs text-slate-400 hover:text-indigo-600" onClick={() => setEditing(c)}>
                    Edit
                  </button>
                  <button className="text-xs text-slate-400 hover:text-amber-600" onClick={() => toggleArchive(c)}>
                    {c.archived ? 'Restore' : 'Archive'}
                  </button>
                  <button className="text-xs text-slate-400 hover:text-red-500" onClick={() => remove(c)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {editing && (
        <CategoryModal
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </Card>
  )
}

function CategoryModal({
  category,
  onClose,
  onSaved
}: {
  category: Category | null
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const { toast } = useApp()
  const [name, setName] = useState(category?.name ?? '')
  const [type, setType] = useState<'expense' | 'income'>(category?.type ?? 'expense')
  const [icon, setIcon] = useState(category?.icon ?? '📦')
  const [color, setColor] = useState(category?.color ?? '#6366f1')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const payload: CategoryInput = { name: name.trim(), type, icon: icon.trim(), color }
    setSaving(true)
    try {
      if (category) await api.updateCategory(category.id, payload)
      else await api.createCategory(payload)
      toast(category ? 'Category updated' : 'Category created', 'success')
      await onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  return (
    <Modal title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Emoji</label>
            <input className="input text-center" value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as 'expense' | 'income')}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div>
            <label className="label">Color</label>
            <input
              type="color"
              className="h-9 w-full cursor-pointer rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-600"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : category ? 'Save changes' : 'Create category'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function DataSection(): React.JSX.Element {
  const { toast, confirm, refresh } = useApp()
  const [busy, setBusy] = useState(false)

  const doExport = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await api.exportBackup()
      if (res.saved) toast(`Backup saved to ${res.path}`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Restore from backup?',
      message: 'Restoring replaces ALL current data — people, accounts, transactions, budgets, goals, and settings — with the backup contents. This cannot be undone.',
      confirmLabel: 'Choose backup file',
      danger: true
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await api.importBackup()
      if (res.restored) {
        await refresh()
        toast('Backup restored', 'success')
      }
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Data">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={doExport} disabled={busy}>
          Export JSON backup
        </Button>
        <Button onClick={doImport} disabled={busy}>
          Restore from backup…
        </Button>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Everything is stored locally in an SQLite database in your user-data folder. The JSON backup contains all data
        and can be restored on any machine running dollar.
      </p>
    </Card>
  )
}
