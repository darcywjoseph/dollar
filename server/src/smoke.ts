// End-to-end smoke test for the server, driven over real HTTP. Exercises auth,
// the $bin binary path, per-user settings, and the backup round-trip (with a
// user present, which is the deferred-FK edge case). Run: npm run smoke.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import { openDatabase } from '../../src/main/db/connection'
import { buildHandlers } from './rpc'
import { createAuth, hashPassword } from './auth'
import { createHttpServer } from './router'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`)
}

async function readJson(res: Response): Promise<any> {
  return res.json()
}

// A minimal one-page PDF with some text (not a bank statement), built at runtime.
const TINY_PDF_TEXT =
  '%PDF-1.1\n' +
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
  '4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 20 100 Td (Hello 12.34) Tj ET\nendstream endobj\n' +
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF'
const TINY_PDF_BASE64 = Buffer.from(TINY_PDF_TEXT, 'latin1').toString('base64')

async function main(): Promise<void> {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'dollar-smoke-')), 'dollar.db')
  const db = openDatabase(dbPath)

  // Seed a login directly (the CLI is interactive).
  db.prepare('INSERT INTO users (person_id, username, password_hash) VALUES (?, ?, ?)').run(
    1,
    'tester',
    hashPassword('pw1234')
  )

  const server = createHttpServer(buildHandlers(db), createAuth(db))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const base = `http://127.0.0.1:${port}`

  const rpc = (channel: string, args: unknown[], token?: string): Promise<Response> =>
    fetch(`${base}/rpc/${channel}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ args })
    })

  // 1. Unauthenticated RPC is rejected.
  assert((await rpc('getBootstrap', [])).status === 401, 'getBootstrap without token → 401')

  // 2. Login.
  const loginRes = await readJson(
    await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tester', password: 'pw1234' })
    })
  )
  assert(loginRes.ok && loginRes.data.token, 'login returns a token')
  const token = loginRes.data.token as string

  // 3. Bootstrap carries seeded data + current user.
  const boot = await readJson(await rpc('getBootstrap', [], token))
  assert(boot.ok, 'getBootstrap ok')
  assert(boot.data.people.length === 2, 'two people seeded')
  assert(boot.data.currentUser?.username === 'tester', 'currentUser is the logged-in user')

  // 4. Transaction round-trip.
  const created = await readJson(
    await rpc(
      'createTransaction',
      [
        {
          date: '2026-07-01',
          amountCents: -999,
          payee: 'Smoke Cafe',
          categoryId: null,
          accountId: 1,
          personId: 1,
          notes: null,
          tags: null
        }
      ],
      token
    )
  )
  assert(created.ok && created.data.id, 'createTransaction ok')
  const listed = await readJson(await rpc('listTransactions', [{}], token))
  assert(
    listed.data.total === 1 && listed.data.rows[0].payee === 'Smoke Cafe',
    'transaction listed'
  )

  // 5. Binary path: a PDF travels as {$bin} and reaches pdfjs.
  const parsed = await readJson(await rpc('parseStatementPdf', [{ $bin: TINY_PDF_BASE64 }], token))
  // A non-statement PDF yields no rows (ok:false is the domain response) — the
  // point is that the bytes decoded and pdfjs ran without crashing.
  assert(
    parsed.ok === false && /transaction/i.test(parsed.error),
    'parseStatementPdf ran on $bin bytes'
  )

  // 6. Per-user setting override.
  await rpc('setSetting', ['theme', 'dark'], token)
  const settings = await readJson(await rpc('getSettings', [], token))
  assert(settings.data.theme === 'dark', 'per-user theme override applied')

  // 7. Backup round-trip with a user present (deferred-FK path).
  const backup = await readJson(await rpc('getBackupData', [], token))
  assert(backup.ok && backup.data.people.length === 2, 'getBackupData ok')
  const restored = await readJson(await rpc('restoreBackupData', [backup.data], token))
  assert(restored.ok && restored.data.restored, 'restoreBackupData ok with a login present')

  // 8. Logout invalidates the token.
  await fetch(`${base}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })
  assert((await rpc('getBootstrap', [], token)).status === 401, 'token rejected after logout')

  server.close()
  db.close()
  console.log('[smoke] PASS')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
