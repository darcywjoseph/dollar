import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { decodeBinary } from './binary'
import type { Auth } from './auth'
import type { RpcHandler } from './rpc'

const MAX_BODY_BYTES = 64 * 1024 * 1024
const SERVER_VERSION = '0.1.0'
const FAILED_LOGIN_DELAY_MS = 300

type Envelope = { ok: true; data: unknown } | { ok: false; error: string }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function sendJson(res: ServerResponse, status: number, body: Envelope): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    // Packaged renderer runs on file://, so browser CORS applies. Bearer-token
    // auth (no cookies) makes a wildcard origin safe.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type'
  })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function createHttpServer(handlers: Map<string, RpcHandler>, auth: Auth): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      })
      res.end()
      return
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        data: { name: 'dollar-server', version: SERVER_VERSION, dbOk: true }
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/auth/login') {
      let raw: string
      try {
        raw = await readBody(req)
      } catch {
        sendJson(res, 413, { ok: false, error: 'Request body too large' })
        return
      }
      let creds: { username?: string; password?: string }
      try {
        creds = JSON.parse(raw || '{}')
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
        return
      }
      try {
        const result = auth.login(creds.username ?? '', creds.password ?? '')
        console.log(`[auth] login ${result.user.username}`)
        sendJson(res, 200, { ok: true, data: result })
      } catch (err) {
        await sleep(FAILED_LOGIN_DELAY_MS)
        sendJson(res, 200, {
          ok: false,
          error: err instanceof Error ? err.message : 'Login failed'
        })
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      auth.logout(req)
      sendJson(res, 200, { ok: true, data: { loggedOut: true } })
      return
    }

    if (req.method === 'GET' && url.pathname === '/auth/me') {
      sendJson(res, 200, { ok: true, data: auth.me(req) })
      return
    }

    if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
      const channel = decodeURIComponent(url.pathname.slice('/rpc/'.length))
      const handler = handlers.get(channel)
      if (!handler) {
        sendJson(res, 404, { ok: false, error: `Unknown channel: ${channel}` })
        return
      }

      const ctx = auth.resolve(req)
      if (!ctx) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' })
        return
      }

      let raw: string
      try {
        raw = await readBody(req)
      } catch {
        sendJson(res, 413, { ok: false, error: 'Request body too large' })
        return
      }

      let args: unknown[] = []
      if (raw.length > 0) {
        try {
          const parsed = JSON.parse(raw) as { args?: unknown }
          const decoded = decodeBinary(parsed.args ?? [])
          args = Array.isArray(decoded) ? decoded : []
        } catch {
          sendJson(res, 400, { ok: false, error: 'Invalid JSON body' })
          return
        }
      }

      try {
        const data = await handler(ctx, ...args)
        console.log(`[rpc] ${channel} (user ${ctx.userId})`)
        sendJson(res, 200, { ok: true, data })
      } catch (err) {
        console.error(`[rpc:${channel}]`, err)
        sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    sendJson(res, 404, { ok: false, error: 'Not found' })
  })
}
