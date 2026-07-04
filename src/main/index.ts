import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import type { Database as DB } from 'better-sqlite3'
import { openDatabase } from './db/connection'
import { generateDueInstances } from './db/recurring'
import { registerIpcHandlers } from './ipc'
import { runSmokeTest } from './smoke'

const isSmoke = process.env.DOLLAR_SMOKE === '1'
if (isSmoke) {
  // Smoke tests run against a throwaway data directory.
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'dollar-smoke-')))
}

let mainWindow: BrowserWindow | null = null
let db: DB | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'dollar',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(async () => {
  const dbPath = join(app.getPath('userData'), 'dollar.db')
  db = openDatabase(dbPath)
  const created = generateDueInstances(db)
  if (created > 0) console.log(`[dollar] generated ${created} recurring transaction(s)`)

  registerIpcHandlers(db, () => mainWindow)

  if (isSmoke) {
    try {
      await runSmokeTest(db, createWindow)
      app.exit(0)
    } catch (err) {
      console.error('[smoke] FAILED:', err)
      app.exit(1)
    }
    return
  }

  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || isSmoke) app.quit()
})

app.on('quit', () => {
  db?.close()
})
