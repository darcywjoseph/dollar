import type { Database as DB } from 'better-sqlite3'
import type { GoalInput, GoalProgress, SavingsGoal } from '@shared/types'
import { addMonthsISO, compareISO, isValidISO, todayISO } from '@shared/dates'
import { rowToGoal } from './helpers'

function computeProgress(db: DB, goal: SavingsGoal): GoalProgress {
  let currentCents = 0
  let monthlyContributionCents = 0

  if (goal.accountIds.length > 0) {
    const placeholders = goal.accountIds.map(() => '?').join(',')
    const bal = db
      .prepare(
        `SELECT COALESCE(SUM(a.starting_balance_cents), 0) +
                COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id IN (${placeholders})), 0) AS total
         FROM accounts a WHERE a.id IN (${placeholders})`
      )
      .get(...goal.accountIds, ...goal.accountIds) as { total: number }
    currentCents = bal.total

    // Average net flow into the linked accounts over the trailing 90 days.
    const since = addMonthsISO(todayISO(), -3)
    const flow = db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS net FROM transactions
         WHERE account_id IN (${placeholders}) AND date >= ?`
      )
      .get(...goal.accountIds, since) as { net: number }
    monthlyContributionCents = Math.round(flow.net / 3)
  }

  let projectedDate: string | null = null
  const remaining = goal.targetCents - currentCents
  if (remaining <= 0) {
    projectedDate = todayISO()
  } else if (monthlyContributionCents > 0) {
    const months = Math.ceil(remaining / monthlyContributionCents)
    if (months <= 600) projectedDate = addMonthsISO(todayISO(), months)
  }

  let onTrack: boolean | null = null
  if (goal.targetDate) {
    onTrack = projectedDate != null && compareISO(projectedDate, goal.targetDate) <= 0
  }

  return { goal, currentCents, monthlyContributionCents, projectedDate, onTrack }
}

export function listGoals(db: DB): GoalProgress[] {
  return db
    .prepare('SELECT * FROM savings_goals ORDER BY created_at, id')
    .all()
    .map((r) => computeProgress(db, rowToGoal(r)))
}

function validate(db: DB, input: GoalInput): void {
  if (!input.name.trim()) throw new Error('Goal name is required')
  if (!Number.isFinite(input.targetCents) || input.targetCents <= 0)
    throw new Error('Target must be positive')
  if (input.targetDate != null && input.targetDate !== '' && !isValidISO(input.targetDate)) {
    throw new Error('Invalid target date')
  }
  for (const id of input.accountIds) {
    if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(id))
      throw new Error('Linked account not found')
  }
}

export function createGoal(db: DB, input: GoalInput): GoalProgress[] {
  validate(db, input)
  db.prepare(
    'INSERT INTO savings_goals (name, target_cents, target_date, person_id, account_ids) VALUES (?, ?, ?, ?, ?)'
  ).run(
    input.name.trim(),
    Math.round(input.targetCents),
    input.targetDate || null,
    input.personId,
    JSON.stringify(input.accountIds)
  )
  return listGoals(db)
}

export function updateGoal(db: DB, id: number, patch: Partial<GoalInput>): GoalProgress[] {
  const row = db.prepare('SELECT * FROM savings_goals WHERE id = ?').get(id)
  if (!row) throw new Error('Goal not found')
  const current = rowToGoal(row)
  const merged: GoalInput = {
    name: patch.name ?? current.name,
    targetCents: patch.targetCents ?? current.targetCents,
    targetDate: patch.targetDate !== undefined ? patch.targetDate : current.targetDate,
    personId: patch.personId !== undefined ? patch.personId : current.personId,
    accountIds: patch.accountIds ?? current.accountIds
  }
  validate(db, merged)
  db.prepare(
    'UPDATE savings_goals SET name = ?, target_cents = ?, target_date = ?, person_id = ?, account_ids = ? WHERE id = ?'
  ).run(
    merged.name.trim(),
    Math.round(merged.targetCents),
    merged.targetDate || null,
    merged.personId,
    JSON.stringify(merged.accountIds),
    id
  )
  return listGoals(db)
}

export function deleteGoal(db: DB, id: number): GoalProgress[] {
  db.prepare('DELETE FROM savings_goals WHERE id = ?').run(id)
  return listGoals(db)
}
