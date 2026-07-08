import type { NativeApi } from '@shared/types'

/** Typed client over the residual Electron IPC bridge (`window.dollarIpc`) for
 *  native operations that can't move to the server: file dialogs, opening
 *  files in the OS viewer, and persisted client config / session token.
 *  Unlike the server api, these resolve to the handler's value directly and
 *  reject with the handler's error (no {ok,data} envelope). */
export const nativeApi: NativeApi = new Proxy({} as NativeApi, {
  get(_target, prop: string) {
    return (...args: unknown[]) => window.dollarIpc.invoke(prop, ...args)
  }
})
