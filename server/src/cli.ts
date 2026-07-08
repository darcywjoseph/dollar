import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { createInterface } from 'readline'
import { Writable } from 'stream'
import { openDatabase } from '../../src/main/db/connection'
import { loadConfig } from './config'
import { hashPassword } from './auth'

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      out[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[(i += 1)] : 'true'
    }
  }
  return out
}

// A single readline over stdin with a line queue, so piped input (all lines at
// once) doesn't race ahead of the prompts. Echoed keystrokes go through a
// mutable stream so hidden entry isn't shown.
let muted = false
const maskedOut = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk)
    cb()
  }
})
const rl = createInterface({
  input: process.stdin,
  output: maskedOut,
  terminal: Boolean(process.stdin.isTTY)
})

const lineQueue: string[] = []
const waiters: ((line: string) => void)[] = []
rl.on('line', (line) => {
  const clean = line.replace(/\r$/, '')
  const waiter = waiters.shift()
  if (waiter) waiter(clean)
  else lineQueue.push(clean)
})

function nextLine(): Promise<string> {
  const queued = lineQueue.shift()
  if (queued !== undefined) return Promise.resolve(queued)
  return new Promise((resolve) => waiters.push(resolve))
}

function prompt(query: string, hidden = false): Promise<string> {
  process.stdout.write(query)
  muted = hidden
  return nextLine().then((line) => {
    muted = false
    if (hidden) process.stdout.write('\n')
    return line
  })
}

async function readPassword(): Promise<string> {
  const p1 = await prompt('New password: ', true)
  if (p1.length < 4) throw new Error('Password must be at least 4 characters')
  const p2 = await prompt('Confirm password: ', true)
  if (p1 !== p2) throw new Error('Passwords do not match')
  return p1
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const flags = parseFlags(rest)
  const config = loadConfig()
  mkdirSync(dirname(config.dbPath), { recursive: true })
  const db = openDatabase(config.dbPath)

  if (command === 'add-user') {
    const username = flags.username
    const personId = Number(flags.person)
    if (!username || !Number.isInteger(personId)) {
      throw new Error('Usage: cli add-user --username <name> --person <id>')
    }
    const person = db.prepare('SELECT id, name FROM people WHERE id = ?').get(personId) as
      { id: number; name: string } | undefined
    if (!person) throw new Error(`No person with id ${personId}`)
    if (db.prepare('SELECT 1 FROM users WHERE person_id = ?').get(personId)) {
      throw new Error(`Person ${personId} (${person.name}) already has a login`)
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
      throw new Error(`Username "${username}" is taken`)
    }
    const password = await readPassword()
    db.prepare('INSERT INTO users (person_id, username, password_hash) VALUES (?, ?, ?)').run(
      personId,
      username,
      hashPassword(password)
    )
    console.log(`Created login "${username}" for ${person.name} (person ${personId}).`)
  } else if (command === 'reset-password') {
    const username = flags.username
    if (!username) throw new Error('Usage: cli reset-password --username <name>')
    const user = db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as { id: number } | undefined
    if (!user) throw new Error(`No user "${username}"`)
    const password = await readPassword()
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      hashPassword(password),
      user.id
    )
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
    console.log(`Password reset for "${username}". Existing sessions were revoked.`)
  } else if (command === 'list-users') {
    const rows = db
      .prepare(
        `SELECT u.username, u.person_id, p.name
           FROM users u JOIN people p ON p.id = u.person_id ORDER BY u.id`
      )
      .all() as { username: string; person_id: number; name: string }[]
    if (rows.length === 0) {
      console.log('No users yet. Create one with: add-user --username <name> --person <id>')
    }
    for (const r of rows) console.log(`- ${r.username} → ${r.name} (person ${r.person_id})`)
  } else {
    console.log('Commands: add-user, reset-password, list-users')
    process.exit(command ? 1 : 0)
  }

  db.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
