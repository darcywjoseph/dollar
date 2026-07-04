export {}

declare global {
  interface Window {
    ledgerIpc: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    }
    __ledgerErrors?: string[]
  }
}
