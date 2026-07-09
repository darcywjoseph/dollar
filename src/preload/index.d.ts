export {}

declare global {
  interface Window {
    dollarIpc: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    }
    __dollarErrors?: string[]
  }
}
