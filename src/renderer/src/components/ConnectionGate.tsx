import React, { useState } from 'react'
import { checkHealth, getServerUrl } from '../api'
import { Spinner } from './ui'

export type ConnectionPhase = 'checking' | 'needs-config' | 'unreachable' | 'needs-login'

interface Props {
  phase: ConnectionPhase
  onConfigure: (url: string) => Promise<void>
  onLogin: (username: string, password: string) => Promise<void>
  onRetry: () => void
  onChangeServer: () => void
}

function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
      <div className="card w-full max-w-md p-6">{children}</div>
    </div>
  )
}

function ServerSetup({
  onConfigure
}: {
  onConfigure: (url: string) => Promise<void>
}): React.JSX.Element {
  const [url, setUrl] = useState(getServerUrl() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmed = url.trim().replace(/\/+$/, '')
    if (!trimmed) {
      setError('Enter the server address')
      return
    }
    setBusy(true)
    setError(null)
    const healthy = await checkHealth(trimmed)
    if (!healthy) {
      setBusy(false)
      setError("Couldn't reach a dollar server at that address")
      return
    }
    await onConfigure(trimmed)
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-lg font-semibold">Connect to your dollar server</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Enter the address of your shared server. This is usually a Tailscale URL like{' '}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
          https://homebox.tailnet.ts.net
        </code>
        .
      </p>
      <input
        className="mt-4 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600 dark:bg-slate-800"
        placeholder="https://…"
        value={url}
        autoFocus
        spellCheck={false}
        onChange={(e) => setUrl(e.target.value)}
      />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="mt-4 h-10 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? 'Connecting…' : 'Test & connect'}
      </button>
    </form>
  )
}

function Login({
  onLogin,
  onChangeServer
}: {
  onLogin: (username: string, password: string) => Promise<void>
  onChangeServer: () => void
}): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onLogin(username.trim(), password)
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Connected to{' '}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{getServerUrl()}</code>
      </p>
      <input
        className="mt-4 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600 dark:bg-slate-800"
        placeholder="Username"
        value={username}
        autoFocus
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        className="mt-3 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600 dark:bg-slate-800"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !username || !password}
        className="mt-4 h-10 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <button
        type="button"
        onClick={onChangeServer}
        className="mt-3 w-full text-center text-xs text-slate-500 hover:underline dark:text-slate-400"
      >
        Change server
      </button>
    </form>
  )
}

export function ConnectionGate({
  phase,
  onConfigure,
  onLogin,
  onRetry,
  onChangeServer
}: Props): React.JSX.Element {
  if (phase === 'checking') {
    return (
      <Shell>
        <div className="flex items-center gap-3">
          <Spinner />
          <span className="text-sm text-slate-600 dark:text-slate-300">Connecting to server…</span>
        </div>
      </Shell>
    )
  }

  if (phase === 'unreachable') {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Can’t reach the server</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          The dollar server at{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{getServerUrl()}</code>{' '}
          isn’t responding. Check that it’s running and that you’re connected to your tailnet.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onRetry}
            className="h-10 flex-1 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Retry
          </button>
          <button
            onClick={onChangeServer}
            className="h-10 flex-1 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
          >
            Change server
          </button>
        </div>
      </Shell>
    )
  }

  if (phase === 'needs-login') {
    return (
      <Shell>
        <Login onLogin={onLogin} onChangeServer={onChangeServer} />
      </Shell>
    )
  }

  return (
    <Shell>
      <ServerSetup onConfigure={onConfigure} />
    </Shell>
  )
}
