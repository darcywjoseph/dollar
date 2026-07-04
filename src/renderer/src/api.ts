import type { LedgerApi } from '@shared/types'

type IpcResponse = { ok: true; data: unknown } | { ok: false; error: string }

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const res = (await window.ledgerIpc.invoke(channel, ...args)) as IpcResponse
  if (!res.ok) throw new Error(res.error)
  return res.data
}

/** Typed client over the IPC bridge. Every method rejects with a plain Error on failure. */
export const api: LedgerApi = new Proxy({} as LedgerApi, {
  get(_target, prop: string) {
    return (...args: unknown[]) => call(prop, ...args)
  }
})
