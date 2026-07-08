import { contextBridge, ipcRenderer } from 'electron'

// Whitelist of native IPC channels the renderer may invoke. Everything else
// (the data layer) now goes to the shared server over HTTP, not IPC. Must match
// the handlers registered in src/main/native.ts.
const CHANNELS = [
  'pickPayslipPdf',
  'openPdf',
  'saveTextFile',
  'pickJsonFile',
  'getClientConfig',
  'setClientConfig',
  'getSessionToken',
  'setSessionToken'
] as const

const allowed = new Set<string>(CHANNELS)

contextBridge.exposeInMainWorld('dollarIpc', {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  }
})
