import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import type { IncomingMessage } from 'http'
import type { Database as DB } from 'better-sqlite3'
import type { RpcContext } from './rpc'

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000
const SLIDE_AFTER_MS = 60 * 60 * 1000

export interface AuthUser {
  id: number
  personId: number
  username: string
}

/** Hash a password as `scrypt$N=..,r=..,p=..$<salt b64>$<hash b64>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p
  })
  return `scrypt$N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, params, saltB64, hashB64] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const m = Object.fromEntries(params.split(',').map((kv) => kv.split('='))) as Record<
      string,
      string
    >
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(m.N),
      r: Number(m.r),
      p: Number(m.p)
    })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization']
  if (!header || Array.isArray(header)) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

interface UserRow {
  id: number
  person_id: number
  username: string
  password_hash: string
}

export interface Auth {
  /** resolve the caller from the request's bearer token, or null if invalid */
  resolve(req: IncomingMessage): RpcContext | null
  /** verify credentials and start a session; throws on bad credentials */
  login(username: string, password: string): { token: string; user: AuthUser }
  /** end the session named by the request's bearer token */
  logout(req: IncomingMessage): void
  /** the current user, or null if unauthenticated */
  me(req: IncomingMessage): AuthUser | null
}

export function createAuth(db: DB): Auth {
  const findSession = db.prepare(
    `SELECT s.user_id, s.expires_at, s.last_used_at, u.person_id, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  )
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?')
  const slideSession = db.prepare(
    'UPDATE sessions SET expires_at = ?, last_used_at = ? WHERE token_hash = ?'
  )

  function lookup(req: IncomingMessage): {
    ctx: RpcContext
    user: AuthUser
  } | null {
    const token = bearerToken(req)
    if (!token) return null
    const th = tokenHash(token)
    const row = findSession.get(th) as
      | {
          user_id: number
          expires_at: string
          last_used_at: string
          person_id: number
          username: string
        }
      | undefined
    if (!row) return null
    if (new Date(row.expires_at).getTime() < Date.now()) {
      deleteSession.run(th)
      return null
    }
    // Sliding expiry: extend at most hourly to avoid a write per request.
    if (Date.now() - new Date(row.last_used_at).getTime() > SLIDE_AFTER_MS) {
      const now = new Date()
      slideSession.run(
        new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
        now.toISOString(),
        th
      )
    }
    return {
      ctx: { userId: row.user_id, personId: row.person_id },
      user: { id: row.user_id, personId: row.person_id, username: row.username }
    }
  }

  return {
    resolve: (req) => lookup(req)?.ctx ?? null,
    me: (req) => lookup(req)?.user ?? null,
    login(username, password) {
      const user = db
        .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
        .get(username) as UserRow | undefined
      // Always run a hash so timing doesn't reveal whether the user exists.
      const ok = user
        ? verifyPassword(password, user.password_hash)
        : (hashPassword(password), false)
      if (!user || !ok) throw new Error('Invalid username or password')
      const token = randomBytes(32).toString('hex')
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
        tokenHash(token),
        user.id,
        new Date(Date.now() + SESSION_TTL_MS).toISOString()
      )
      return { token, user: { id: user.id, personId: user.person_id, username: user.username } }
    },
    logout(req) {
      const token = bearerToken(req)
      if (token) deleteSession.run(tokenHash(token))
    }
  }
}

/** Remove expired sessions. Called from the daily job. */
export function pruneSessions(db: DB): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run()
}
