import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { openDatabase } from '../../src/main/db/connection'
import { loadConfig } from './config'
import { buildHandlers } from './rpc'
import { createHttpServer } from './router'
import { startJobs } from './jobs'
import { createAuth } from './auth'

const config = loadConfig()
mkdirSync(dirname(config.dbPath), { recursive: true })

const db = openDatabase(config.dbPath)
const handlers = buildHandlers(db)
const auth = createAuth(db)
startJobs(db, config.dbPath)

const server = createHttpServer(handlers, auth)
server.listen(config.port, config.bind, () => {
  console.log(
    `[dollar-server] listening on http://${config.bind}:${config.port} (db: ${config.dbPath})`
  )
})

function shutdown(): void {
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
