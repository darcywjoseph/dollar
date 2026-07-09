import { mkdirSync, readdirSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import type { Database as DB } from 'better-sqlite3'
import { generateDueInstances } from '../../src/main/db/recurring'
import { pruneSessions } from './auth'

const SIX_HOURS = 6 * 60 * 60 * 1000
const ONE_DAY = 24 * 60 * 60 * 1000
const KEEP_BACKUPS = 30

function runRecurring(db: DB): void {
  try {
    const created = generateDueInstances(db)
    if (created > 0) console.log(`[dollar-server] generated ${created} recurring transaction(s)`)
  } catch (err) {
    console.error('[dollar-server] recurring generation failed:', err)
  }
}

async function runBackup(db: DB, dbPath: string): Promise<void> {
  try {
    pruneSessions(db)
    const dir = join(dirname(dbPath), 'backups')
    mkdirSync(dir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const dest = join(dir, `dollar-${date}.db`)
    await db.backup(dest)
    const snapshots = readdirSync(dir)
      .filter((f) => /^dollar-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
    for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - KEEP_BACKUPS))) {
      unlinkSync(join(dir, stale))
    }
  } catch (err) {
    console.error('[dollar-server] backup snapshot failed:', err)
  }
}

/** Kick off the two recurring background jobs: generating due recurring
 *  transactions (was done once at Electron launch) and daily DB snapshots. */
export function startJobs(db: DB, dbPath: string): void {
  runRecurring(db)
  setInterval(() => runRecurring(db), SIX_HOURS).unref()

  void runBackup(db, dbPath)
  setInterval(() => void runBackup(db, dbPath), ONE_DAY).unref()
}
