import React, { useEffect, useMemo, useState } from 'react'
import type { Category, CategorySuggestion, CategoryType, Transaction } from '@shared/types'
import { formatDateDisplay } from '@shared/dates'
import { api } from '../api'
import { useApp } from '../appContext'
import { Button, EmptyState, Modal, Money, ProgressBar } from '../components/ui'

/** Mirror of the main-side normalisation: bank payees carry receipt numbers
 *  and card suffixes; strip digits/punctuation so similar rows group. */
function normalizePayee(payee: string): string {
  return payee
    .toUpperCase()
    .replace(/[0-9]/g, '')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Card-by-card categorisation of uncategorised transactions. Every pick is
 * saved immediately, so closing part-way keeps the progress.
 */
export default function CategoriseFlow({
  transactions,
  onClose
}: {
  transactions: Transaction[]
  /** called when the flow closes; the parent should refresh its data */
  onClose: () => void
}): React.JSX.Element {
  const { categories, fmt, toast, accountById, categoryById, refresh } = useApp()
  const queue = useMemo(() => transactions.filter((t) => t.categoryId == null), [transactions])

  const [suggestions, setSuggestions] = useState<Map<number, CategorySuggestion>>(new Map())
  // transaction id -> assigned category id, or null when skipped
  const [results, setResults] = useState<Map<number, number | null>>(new Map())
  // indices of cards shown, for Back
  const [trail, setTrail] = useState<number[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [applySimilar, setApplySimilar] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finished, setFinished] = useState(queue.length === 0)
  // inline "new category" form
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('📦')
  const [newType, setNewType] = useState<CategoryType>('expense')
  const [newColor, setNewColor] = useState('#6366f1')

  const current = !finished && index < queue.length ? queue[index] : null

  useEffect(() => {
    if (queue.length === 0) return
    let alive = true
    api
      .suggestCategories(queue.map((t) => t.id))
      .then((list) => {
        if (alive) setSuggestions(new Map(list.map((s) => [s.transactionId, s])))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [queue])

  // preselect the suggestion (or an earlier pick when revisiting) per card
  useEffect(() => {
    if (!current) return
    setSelected(results.get(current.id) ?? suggestions.get(current.id)?.categoryId ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, suggestions])

  const similar = useMemo(() => {
    if (!current) return []
    const key = normalizePayee(current.payee)
    if (!key) return []
    return queue.filter(
      (t) => t.id !== current.id && !results.has(t.id) && normalizePayee(t.payee) === key
    )
  }, [current, queue, results])

  const advance = (nextResults: Map<number, number | null>): void => {
    setCreating(false)
    setTrail((t) => [...t, index])
    let i = index + 1
    while (i < queue.length && nextResults.has(queue[i].id)) i++
    if (i >= queue.length) setFinished(true)
    else setIndex(i)
  }

  // save the pick (and any same-payee rows), then move to the next card
  const assign = async (categoryId: number): Promise<void> => {
    if (!current) return
    const also = applySimilar ? similar : []
    await api.updateTransaction(current.id, { categoryId })
    for (const t of also) await api.updateTransaction(t.id, { categoryId })
    const next = new Map(results)
    next.set(current.id, categoryId)
    for (const t of also) next.set(t.id, categoryId)
    setResults(next)
    advance(next)
  }

  const choose = async (categoryId: number): Promise<void> => {
    if (!current || saving) return
    setSaving(true)
    try {
      await assign(categoryId)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const openCreate = (): void => {
    setNewName('')
    setNewIcon('📦')
    setNewType(current && current.amountCents > 0 ? 'income' : 'expense')
    setNewColor('#6366f1')
    setCreating(true)
  }

  const createAndAssign = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const name = newName.trim()
    if (!name || !current || saving) return
    setSaving(true)
    try {
      const list = await api.createCategory({
        name,
        type: newType,
        icon: newIcon.trim() || '📦',
        color: newColor
      })
      // createCategory returns the full list; the new one has the highest id
      const created = list.filter((c) => c.name === name).sort((a, b) => b.id - a.id)[0]
      refresh().catch(() => undefined)
      setCreating(false)
      if (created) await assign(created.id)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const skip = (): void => {
    if (!current || saving) return
    const next = new Map(results)
    next.set(current.id, null)
    setResults(next)
    advance(next)
  }

  const back = (): void => {
    if (trail.length === 0 || saving) return
    const t = [...trail]
    setIndex(t.pop()!)
    setTrail(t)
    setFinished(false)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return
      if (!current || creating) return
      if (e.key === 'Enter' && selected != null) {
        e.preventDefault()
        void choose(selected)
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        skip()
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const categorized = [...results.values()].filter((v) => v != null).length
  const skipped = results.size - categorized
  const suggestion = current ? suggestions.get(current.id) : undefined
  const suggestionCat = suggestion ? categoryById(suggestion.categoryId) : undefined

  const active = categories.filter((c) => !c.archived)
  const primaryType = current && current.amountCents > 0 ? 'income' : 'expense'
  const primary = active.filter((c) => c.type === primaryType)
  const secondary = [
    ...active.filter((c) => c.type === 'transfer'),
    ...active.filter((c) => c.type !== primaryType && c.type !== 'transfer')
  ]

  const chip = (c: Category): React.JSX.Element => {
    const isSelected = selected === c.id
    return (
      <button
        key={c.id}
        type="button"
        disabled={saving}
        onClick={() => {
          setSelected(c.id)
          void choose(c.id)
        }}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-sm transition disabled:opacity-50 ${
          isSelected
            ? 'border-transparent bg-indigo-50 font-medium dark:bg-indigo-950/40'
            : 'border-slate-200 hover:border-slate-400 dark:border-slate-600 dark:hover:border-slate-400'
        }`}
        style={isSelected ? { boxShadow: `0 0 0 2px ${c.color}` } : undefined}
      >
        <span>{c.icon}</span>
        <span className="truncate">{c.name}</span>
      </button>
    )
  }

  return (
    <Modal title="Categorise transactions" onClose={onClose} wide>
      {finished ? (
        queue.length === 0 ? (
          <EmptyState
            icon="✨"
            title="Nothing to categorise"
            message="All transactions already have a category."
            action={
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            }
          />
        ) : (
          <div className="space-y-5 text-center">
            <div className="text-4xl">✅</div>
            <p className="text-lg font-semibold">
              {categorized} categorised{skipped > 0 ? ` · ${skipped} skipped` : ''}
            </p>
            <div className="flex justify-center gap-2">
              <Button onClick={back}>Back</Button>
              <Button variant="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )
      ) : current ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {Math.min(results.size + 1, queue.length)} of {queue.length}
            </span>
            <ProgressBar value={results.size} max={queue.length} />
          </div>

          <div className="rounded-xl border border-slate-200 px-5 py-4 text-center dark:border-slate-700">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {formatDateDisplay(current.date)} · {accountById(current.accountId)?.name ?? '?'}
            </div>
            <div className="mt-1 truncate text-lg font-semibold" title={current.payee}>
              {current.payee || <span className="text-slate-400">(no description)</span>}
            </div>
            <Money
              cents={current.amountCents}
              fmt={fmt}
              colored
              sign
              className="mt-0.5 block text-2xl font-semibold"
            />
          </div>

          {suggestion && suggestionCat && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              <span>
                {suggestion.reason === 'transfer'
                  ? `Looks like an internal transfer — ${suggestion.detail}`
                  : `You've filed this payee as ${suggestionCat.icon} ${suggestionCat.name} before`}
              </span>
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => void choose(suggestion.categoryId)}
              >
                {suggestionCat.icon} {suggestionCat.name} ⏎
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {primary.map(chip)}
            {!creating && (
              <button
                type="button"
                disabled={saving}
                onClick={openCreate}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-sm text-slate-500 transition hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400"
              >
                ＋ New category
              </button>
            )}
          </div>
          {secondary.length > 0 && (
            <div className="border-t border-slate-100 pt-3 dark:border-slate-700/60">
              <div className="flex flex-wrap gap-2">{secondary.map(chip)}</div>
            </div>
          )}

          {creating && (
            <form
              className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600"
              onSubmit={createAndAssign}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setCreating(false)
                }
              }}
            >
              <div className="min-w-40 flex-1">
                <label className="label">Name</label>
                <input
                  className="input"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Emoji</label>
                <input
                  className="input w-16 text-center"
                  maxLength={4}
                  value={newIcon}
                  onChange={(e) => setNewIcon(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as CategoryType)}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
              <div>
                <label className="label">Color</label>
                <input
                  type="color"
                  className="h-9 w-14 cursor-pointer rounded-lg border border-slate-300 bg-transparent p-1 dark:border-slate-600"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={saving || !newName.trim()}>
                  Create &amp; assign
                </Button>
                <Button type="button" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {similar.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={applySimilar}
                onChange={(e) => setApplySimilar(e.target.checked)}
              />
              Also apply to {similar.length} more “{current.payee}” transaction
              {similar.length > 1 ? 's' : ''}
            </label>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Enter accepts the highlighted category · S skips · Backspace goes back
            </span>
            <div className="flex gap-2">
              <Button onClick={back} disabled={trail.length === 0 || saving}>
                Back
              </Button>
              <Button onClick={skip} disabled={saving}>
                Skip
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Done for now
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
