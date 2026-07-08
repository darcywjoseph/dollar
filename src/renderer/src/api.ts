import type { DollarApi } from '@shared/types'

/** Thrown when the server can't be reached (network error, or no server
 *  configured yet). The connection gate uses this to show a retry screen. */
export class ServerUnreachableError extends Error {
  constructor(message = 'Could not reach the server') {
    super(message)
    this.name = 'ServerUnreachableError'
  }
}

/** Thrown on HTTP 401 — the session token is missing or expired. Also emits an
 *  `auth:expired` window event so the app can bounce to the login screen. */
export class AuthExpiredError extends Error {
  constructor(message = 'Your session has expired') {
    super(message)
    this.name = 'AuthExpiredError'
  }
}

type IpcResponse = { ok: true; data: unknown } | { ok: false; error: string }

let serverUrl: string | null = null
let sessionToken: string | null = null

export function setServerUrl(url: string | null): void {
  serverUrl = url ? url.replace(/\/+$/, '') : null
}
export function getServerUrl(): string | null {
  return serverUrl
}
export function setSessionToken(token: string | null): void {
  sessionToken = token
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Recursively encode binary args as `{ $bin }` markers so they survive JSON. */
function encodeBinary(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { $bin: bytesToBase64(new Uint8Array(value)) }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return { $bin: bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)) }
  }
  if (Array.isArray(value)) return value.map(encodeBinary)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = encodeBinary(v)
    return out
  }
  return value
}

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  if (!serverUrl) throw new ServerUnreachableError('No server configured')

  let res: Response
  try {
    res = await fetch(`${serverUrl}/rpc/${channel}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
      },
      body: JSON.stringify({ args: encodeBinary(args) })
    })
  } catch (err) {
    throw new ServerUnreachableError((err as Error).message)
  }

  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:expired'))
    throw new AuthExpiredError()
  }

  const body = (await res.json()) as IpcResponse
  if (!body.ok) throw new Error(body.error)
  return body.data
}

/** Typed client over the HTTP RPC transport. Every method rejects with a plain
 *  Error on domain failure, ServerUnreachableError on network failure, or
 *  AuthExpiredError on 401. */
export const api: DollarApi = new Proxy({} as DollarApi, {
  get(_target, prop: string) {
    return (...args: unknown[]) => call(prop, ...args)
  }
})

/** Probe a server's /health endpoint. Used by the setup and reconnect flows. */
export async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/health`)
    return res.ok
  } catch {
    return false
  }
}

/** POST /auth/login — returns the session token and user, or throws. Used by
 *  the login screen (auth arrives in Phase 3; the endpoint 404s until then). */
export async function login(
  url: string,
  username: string,
  password: string
): Promise<{ token: string; user: { id: number; personId: number; username: string } }> {
  let res: Response
  try {
    res = await fetch(`${url.replace(/\/+$/, '')}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
  } catch (err) {
    throw new ServerUnreachableError((err as Error).message)
  }
  const body = (await res.json()) as IpcResponse
  if (!body.ok) throw new Error(body.error)
  return body.data as { token: string; user: { id: number; personId: number; username: string } }
}

/** POST /auth/logout — best-effort; ignores network/auth errors. */
export async function logout(url: string, token: string): Promise<void> {
  try {
    await fetch(`${url.replace(/\/+$/, '')}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
  } catch {
    // logging out locally is what matters
  }
}
