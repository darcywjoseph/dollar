import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Per-machine client settings, stored in the Electron userData dir. The
 *  session token is encrypted at rest via safeStorage where available. */
interface StoredConfig {
  serverUrl?: string
  /** base64 of the (encrypted) session token */
  tokenEnc?: string
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function read(): StoredConfig {
  try {
    if (!existsSync(configPath())) return {}
    return JSON.parse(readFileSync(configPath(), 'utf8')) as StoredConfig
  } catch {
    return {}
  }
}

function write(cfg: StoredConfig): void {
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

/** The configured server URL. `DOLLAR_SERVER_URL` (set in dev) wins. */
export function getClientConfig(): { serverUrl: string | null } {
  const fromEnv = process.env.DOLLAR_SERVER_URL
  if (fromEnv) return { serverUrl: fromEnv }
  return { serverUrl: read().serverUrl ?? null }
}

export function setClientConfig(cfg: { serverUrl: string }): { serverUrl: string | null } {
  const current = read()
  current.serverUrl = cfg.serverUrl.replace(/\/+$/, '')
  write(current)
  return getClientConfig()
}

export function getSessionToken(): string | null {
  const { tokenEnc } = read()
  if (!tokenEnc) return null
  try {
    const buf = Buffer.from(tokenEnc, 'base64')
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8')
  } catch {
    return null
  }
}

export function setSessionToken(token: string | null): void {
  const current = read()
  if (token == null) {
    delete current.tokenEnc
  } else {
    const enc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(token)
      : Buffer.from(token, 'utf8')
    current.tokenEnc = enc.toString('base64')
  }
  write(current)
}
