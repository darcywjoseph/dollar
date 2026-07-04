import React, { useEffect, useState } from 'react'
import type { GoalProgress, SavingsGoal } from '@shared/types'
import { formatDateDisplay } from '@shared/dates'
import { parseAmountToCents } from '@shared/money'
import { api } from '../api'
import { useApp } from '../store'
import { Badge, Button, Card, EmptyState, Modal, ProgressBar, Spinner } from '../components/ui'

export default function Goals(): React.JSX.Element {
  const { toast, confirm, fmt, personFilter, personById } = useApp()
  const [goals, setGoals] = useState<GoalProgress[] | null>(null)
  const [editing, setEditing] = useState<SavingsGoal | 'new' | null>(null)

  const load = async (): Promise<void> => {
    try {
      setGoals(await api.listGoals())
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remove = async (g: SavingsGoal): Promise<void> => {
    const ok = await confirm({
      title: `Delete goal “${g.name}”?`,
      message: 'This removes the goal. Accounts and transactions are not affected.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      setGoals(await api.deleteGoal(g.id))
      toast('Goal deleted', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  if (!goals) return <Spinner />

  const visible =
    personFilter == null
      ? goals
      : goals.filter((g) => g.goal.personId === personFilter || g.goal.personId == null)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing('new')}>
          New goal
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="◎"
            title="No savings goals yet"
            message="Set a target — a holiday, an emergency fund, a down payment — and link the accounts you're saving into. dollar tracks progress and projects your finish date."
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                Create a goal
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {visible.map((gp) => {
            const g = gp.goal
            const person = g.personId != null ? personById(g.personId) : null
            const done = gp.currentCents >= g.targetCents
            return (
              <Card key={g.id}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{g.name}</h3>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {person ? (
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: person.color }}
                          />
                          {person.name}
                        </span>
                      ) : (
                        'Joint'
                      )}
                      {g.targetDate && <> · target {formatDateDisplay(g.targetDate)}</>}
                    </div>
                  </div>
                  {done ? (
                    <Badge tone="good">reached 🎉</Badge>
                  ) : gp.onTrack == null ? (
                    <Badge>no target date</Badge>
                  ) : gp.onTrack ? (
                    <Badge tone="good">on track</Badge>
                  ) : (
                    <Badge tone="bad">off track</Badge>
                  )}
                </div>
                <div className="mb-2 mt-3 flex items-baseline justify-between">
                  <span className="text-xl font-semibold tabular-nums">{fmt(gp.currentCents)}</span>
                  <span className="text-sm text-slate-400">of {fmt(g.targetCents)}</span>
                </div>
                <ProgressBar
                  value={gp.currentCents}
                  max={g.targetCents}
                  color={done ? '#0ca30c' : (person?.color ?? '#6366f1')}
                />
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <div>
                    <div className="font-medium text-slate-400">Avg monthly contribution</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                      {fmt(gp.monthlyContributionCents)}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-slate-400">Projected completion</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {done ? 'Done' : gp.projectedDate ? formatDateDisplay(gp.projectedDate) : '—'}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-1">
                  <Button variant="ghost" onClick={() => setEditing(g)}>
                    Edit
                  </Button>
                  <Button variant="ghost" className="text-red-500" onClick={() => remove(g)}>
                    Delete
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {editing && (
        <GoalModal
          goal={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setGoals(updated)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function GoalModal({
  goal,
  onClose,
  onSaved
}: {
  goal: SavingsGoal | null
  onClose: () => void
  onSaved: (goals: GoalProgress[]) => void
}): React.JSX.Element {
  const { people, accounts, toast, settings, balances, fmt } = useApp()
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState(goal ? (goal.targetCents / 100).toFixed(2) : '')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [personId, setPersonId] = useState<number | ''>(goal?.personId ?? '')
  const [accountIds, setAccountIds] = useState<Set<number>>(new Set(goal?.accountIds ?? []))
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const cents = parseAmountToCents(target)
    if (cents == null || cents <= 0) {
      toast('Enter a valid target amount', 'error')
      return
    }
    if (accountIds.size === 0) {
      toast('Link at least one account so progress can be tracked', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        targetCents: cents,
        targetDate: targetDate || null,
        personId: personId === '' ? null : personId,
        accountIds: [...accountIds]
      }
      const updated = goal ? await api.updateGoal(goal.id, payload) : await api.createGoal(payload)
      toast(goal ? 'Goal updated' : 'Goal created', 'success')
      onSaved(updated)
    } catch (err) {
      toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  const sorted = [...accounts]
    .filter((a) => !a.archived)
    .sort((a, b) => Number(b.type === 'savings') - Number(a.type === 'savings'))

  return (
    <Modal title={goal ? 'Edit goal' : 'New savings goal'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Emergency fund"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Target ({settings.currencySymbol})</label>
            <input
              className="input text-right"
              required
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Target date (optional)</label>
            <input
              type="date"
              className="input"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Whose goal?</label>
            <select
              className="input"
              value={personId}
              onChange={(e) => setPersonId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">Joint</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">
            Linked accounts (their combined balance is the goal&apos;s progress)
          </label>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-600">
            {sorted.map((a) => (
              <label
                key={a.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40"
              >
                <input
                  type="checkbox"
                  checked={accountIds.has(a.id)}
                  onChange={(e) => {
                    const next = new Set(accountIds)
                    if (e.target.checked) next.add(a.id)
                    else next.delete(a.id)
                    setAccountIds(next)
                  }}
                />
                <span className="flex-1">
                  {a.name} <span className="text-xs text-slate-400">({a.type})</span>
                </span>
                <span className="tabular-nums text-slate-500 dark:text-slate-400">
                  {fmt(balances.get(a.id) ?? 0)}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : goal ? 'Save changes' : 'Create goal'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
