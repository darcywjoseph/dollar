import React, { useEffect, useState } from 'react'
import type { Frequency, RecurringRule } from '@shared/types'
import { formatDateDisplay, todayISO } from '@shared/dates'
import { parseAmountToCents } from '@shared/money'
import { api } from '../api'
import { useApp } from '../appContext'
import { Badge, Button, EmptyState, Modal, Money, Spinner } from '../components/ui'

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' }
]

export default function RecurringTab(): React.JSX.Element {
  const { toast, confirm, fmt, categoryById, accountById, personById, refresh } = useApp()
  const [rules, setRules] = useState<RecurringRule[] | null>(null)
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null)

  const load = async (): Promise<void> => {
    try {
      setRules(await api.listRecurring())
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remove = async (rule: RecurringRule): Promise<void> => {
    const ok = await confirm({
      title: `Delete “${rule.name}”?`,
      message:
        'The rule stops generating new transactions. Existing generated transactions are kept unless you delete them separately from the Transactions tab.',
      confirmLabel: 'Delete rule',
      danger: true
    })
    if (!ok) return
    try {
      setRules(await api.deleteRecurring(rule.id, false))
      toast('Rule deleted', 'success')
      refresh().catch(() => undefined)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  if (!rules) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing('new')}>
          New recurring rule
        </Button>
      </div>
      <div className="card overflow-hidden">
        {rules.length === 0 ? (
          <EmptyState
            icon="🔁"
            title="No recurring rules yet"
            message="Rules generate transactions automatically when they come due — rent, salary, subscriptions. Due instances are created every time the app starts."
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                Create your first rule
              </Button>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Frequency</th>
                <th className="px-4 py-2.5">Next due</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Account</th>
                <th className="px-4 py-2.5">Person</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {rules.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <td className="px-4 py-2.5 font-medium">
                    {r.name} {!r.active && <Badge>paused</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                    {FREQUENCIES.find((f) => f.value === r.frequency)?.label}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-500 dark:text-slate-400">
                    {formatDateDisplay(r.nextDue)}
                    {r.endDate && (
                      <span className="block text-xs">until {formatDateDisplay(r.endDate)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                    {(() => {
                      const c = categoryById(r.categoryId)
                      return c ? `${c.icon} ${c.name}` : '—'
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                    {accountById(r.accountId)?.name}
                  </td>
                  <td className="px-4 py-2.5">
                    {(() => {
                      const p = personById(r.personId)
                      return p ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: p.color }}
                          />
                          {p.name}
                        </span>
                      ) : null
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">
                    <Money cents={r.amountCents} fmt={fmt} colored sign />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <Button variant="ghost" onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                    <Button variant="ghost" className="text-red-500" onClick={() => remove(r)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <RuleModal
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (updated) => {
            setRules(updated)
            setEditing(null)
            refresh().catch(() => undefined)
          }}
        />
      )}
    </div>
  )
}

function RuleModal({
  rule,
  onClose,
  onSaved
}: {
  rule: RecurringRule | null
  onClose: () => void
  onSaved: (rules: RecurringRule[]) => Promise<void>
}): React.JSX.Element {
  const { people, accounts, categories, toast, settings } = useApp()
  const activeAccounts = accounts.filter((a) => !a.archived)
  const activeCategories = categories.filter((c) => !c.archived)

  const [name, setName] = useState(rule?.name ?? '')
  const [amount, setAmount] = useState(rule ? (Math.abs(rule.amountCents) / 100).toFixed(2) : '')
  const [kind, setKind] = useState<'expense' | 'income'>(
    rule && rule.amountCents > 0 ? 'income' : 'expense'
  )
  const [categoryId, setCategoryId] = useState<number | ''>(rule?.categoryId ?? '')
  const [accountId, setAccountId] = useState<number | ''>(
    rule?.accountId ?? activeAccounts[0]?.id ?? ''
  )
  const [personId, setPersonId] = useState<number>(rule?.personId ?? people[0]?.id ?? 1)
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? 'monthly')
  const [nextDue, setNextDue] = useState(rule?.nextDue ?? todayISO())
  const [endDate, setEndDate] = useState(rule?.endDate ?? '')
  const [active, setActive] = useState(rule?.active ?? true)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const cents = parseAmountToCents(amount)
    if (cents == null || cents === 0) {
      toast('Enter a valid amount', 'error')
      return
    }
    if (accountId === '') {
      toast('Choose an account', 'error')
      return
    }
    const signed = kind === 'income' ? Math.abs(cents) : -Math.abs(cents)
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        amountCents: signed,
        categoryId: categoryId === '' ? null : categoryId,
        accountId,
        personId,
        frequency,
        nextDue,
        endDate: endDate || null,
        active
      }
      const updated = rule
        ? await api.updateRecurring(rule.id, payload)
        : await api.createRecurring(payload)
      toast(rule ? 'Rule updated' : 'Rule created — due instances were generated', 'success')
      await onSaved(updated)
    } catch (err) {
      toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  return (
    <Modal title={rule ? 'Edit recurring rule' : 'New recurring rule'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="label">Name / payee</label>
          <input
            className="input"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rent"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'expense' | 'income')}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div>
            <label className="label">Amount ({settings.currencySymbol})</label>
            <input
              className="input text-right"
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Frequency</label>
            <select
              className="input"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Next due</label>
            <input
              type="date"
              className="input"
              required
              value={nextDue}
              onChange={(e) => setNextDue(e.target.value)}
            />
          </div>
          <div>
            <label className="label">End date (optional)</label>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Category</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">Uncategorized</option>
              {activeCategories
                .filter((c) => c.type === kind)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="label">Account</label>
            <select
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(Number(e.target.value))}
            >
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Person</label>
            <select
              className="input"
              value={personId}
              onChange={(e) => setPersonId(Number(e.target.value))}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          If the next due date is in the past, all missed instances up to today are generated
          immediately.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : rule ? 'Save changes' : 'Create rule'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
