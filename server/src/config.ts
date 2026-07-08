import { homedir } from 'os'
import { join } from 'path'

export interface ServerConfig {
  port: number
  bind: string
  dbPath: string
}

/** Server configuration from the environment, with sensible local defaults. */
export function loadConfig(): ServerConfig {
  const port = parseInt(process.env.DOLLAR_PORT ?? '8420', 10) || 8420
  const bind = process.env.DOLLAR_BIND ?? '127.0.0.1'
  const dbPath = process.env.DOLLAR_DB_PATH ?? join(homedir(), '.dollar', 'dollar.db')
  return { port, bind, dbPath }
}
