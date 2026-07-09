import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { getClientConfig, getSessionToken, setClientConfig, setSessionToken } from './clientConfig'

/** Residual native operations that must run in the desktop client: file
 *  dialogs, opening a file in the OS viewer, and persisted client config.
 *  These replace the five Electron-only channels that used to live in ipc.ts;
 *  everything else now goes to the shared server over HTTP. */
export function registerNativeHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('pickPayslipPdf', async () => {
    const win = getWindow()
    if (!win) throw new Error('No window')
    const res = await dialog.showOpenDialog(win, {
      title: 'Attach payslip PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const path = res.filePaths[0]
    const data = await readFile(path)
    if (data.length === 0) throw new Error('The chosen PDF file is empty')
    // Copy into a standalone ArrayBuffer so IPC ships exactly these bytes.
    return { filename: basename(path), data: new Uint8Array(data).buffer }
  })

  ipcMain.handle('openPdf', async (_e, filename: string, dataBase64: string) => {
    const data = Buffer.from(dataBase64, 'base64')
    const safeName = basename(filename).replace(/[^\w.\-() ]+/g, '_') || 'document.pdf'
    const tempPath = join(app.getPath('temp'), `dollar-${Date.now()}-${safeName}`)
    await writeFile(tempPath, data)
    const error = await shell.openPath(tempPath)
    return error ? { opened: false, error } : { opened: true }
  })

  ipcMain.handle(
    'saveTextFile',
    async (_e, defaultName: string, content: string, kind: 'csv' | 'json') => {
      const win = getWindow()
      if (!win) throw new Error('No window')
      const filterName = kind === 'csv' ? 'CSV' : 'JSON'
      const res = await dialog.showSaveDialog(win, {
        title: `Export ${filterName}`,
        defaultPath: defaultName,
        filters: [{ name: filterName, extensions: [kind] }]
      })
      if (res.canceled || !res.filePath) return { saved: false }
      await writeFile(res.filePath, content, 'utf8')
      return { saved: true, path: res.filePath }
    }
  )

  ipcMain.handle('pickJsonFile', async () => {
    const win = getWindow()
    if (!win) throw new Error('No window')
    const res = await dialog.showOpenDialog(win, {
      title: 'Restore dollar backup',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const content = await readFile(res.filePaths[0], 'utf8')
    return { content }
  })

  ipcMain.handle('getClientConfig', () => getClientConfig())
  ipcMain.handle('setClientConfig', (_e, cfg: { serverUrl: string }) => setClientConfig(cfg))
  ipcMain.handle('getSessionToken', () => getSessionToken())
  ipcMain.handle('setSessionToken', (_e, token: string | null) => setSessionToken(token))
}
