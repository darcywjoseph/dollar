# dollar

[![CI](https://github.com/darcywjoseph/dollar/actions/workflows/ci.yml/badge.svg)](https://github.com/darcywjoseph/dollar/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/darcywjoseph/dollar)](https://github.com/darcywjoseph/dollar/blob/main/package.json)
[![License: MIT](https://img.shields.io/github/license/darcywjoseph/dollar)](LICENSE)

A budgeting tool for two people to track savings together, per-person or jointly, with a
month-by-month forecast through to the end of the year.

dollar runs as an **Electron desktop app on each person's laptop**, talking over HTTP to a
**shared Node server** that owns the single SQLite database. Run the server on an always-on
machine at home and reach it from anywhere over [Tailscale](https://tailscale.com), so both of
you work against the same combined data with your own login.

Built with Electron, React 18, Tailwind CSS, and SQLite (`better-sqlite3`).

## Architecture

```
Darcy's laptop ─┐                                 ┌─ Partner's laptop
 Electron app   │   Tailscale (WireGuard tailnet) │   Electron app
 api.ts → HTTP ─┼──► https://<host>.<tailnet>.ts.net ◄┼── api.ts → HTTP
 native IPC:    │      tailscale serve → :8420        │
 dialogs, shell │   dollar-server (plain Node 20+)    │
                │    POST /rpc/:channel (bearer)      │
                │    /auth/login|logout|me, /health   │
                │    better-sqlite3 → ~/.dollar/dollar.db
                └──  daily db.backup() snapshots  ────┘
```

- The renderer calls the server through one typed seam: `src/renderer/src/api.ts` turns
  `api.foo(args)` into `POST /rpc/foo` with a `{ok,data}|{ok,error}` envelope. The server
  (`server/src/rpc.ts`) dispatches each channel into the reused query modules in `src/main/db/`.
- Native operations that can't move to the server — file dialogs, opening a PDF, storing the
  server URL and session token — stay in the Electron client over a small IPC bridge
  (`window.dollarIpc`, wrapped by `src/renderer/src/nativeApi.ts`).
- Binary payloads (statement/payslip PDFs) travel as `{ "$bin": "<base64>" }` inside the JSON
  body and are decoded to Buffers on the server.

```
src/
├── shared/          type defs (the DollarApi/NativeApi contract) and pure utils
├── main/            thin Electron main: window, native handlers, client config
│   ├── db/          SQLite schema, migrations, seed, typed query modules (used by the server)
│   ├── native.ts    residual native IPC (dialogs, open PDF, config/token)
│   └── clientConfig.ts
├── preload/         contextBridge exposing only the native channels
└── renderer/        React UI
server/
├── src/index.ts     server entry: config, open db, http, background jobs
├── src/rpc.ts       channel → handler map
├── src/router.ts    POST /rpc/:channel, /auth/*, /health (plain node:http, CORS)
├── src/auth.ts      scrypt password hashing, bearer sessions
├── src/cli.ts       add-user / reset-password / list-users
└── deploy/          launchd + systemd service templates
```

## Development

Requires Node.js 20+.

```bash
npm install                 # Electron app deps
npm install --prefix server # server deps (its own native better-sqlite3 build)
npm run dev                 # runs the server + Electron together (server on :8420)
```

`npm run dev` starts the server (against `~/.dollar/dollar.db`) and the Electron app, pointing the
app at `http://127.0.0.1:8420` via `DOLLAR_SERVER_URL`. Use `npm run dev:server` / `npm run dev:app`
to run them separately.

On first launch the app asks for the server URL, then a login. Create a login (see below) before
signing in.

## Running the shared server on a home machine

On an always-on machine (a Mac, mini PC, or Raspberry Pi):

```bash
git clone <repo> && cd dollar
npm ci --prefix server
npm --prefix server run build          # → server/dist/index.cjs
```

Configuration is via environment variables:

| Variable         | Default               | Purpose                         |
| ---------------- | --------------------- | ------------------------------- |
| `DOLLAR_PORT`    | `8420`                | listen port                     |
| `DOLLAR_BIND`    | `127.0.0.1`           | bind address (keep on loopback) |
| `DOLLAR_DB_PATH` | `~/.dollar/dollar.db` | database file                   |

**Create the two logins** (one per person; person 1 and 2 are seeded in the database):

```bash
npm --prefix server run cli -- add-user --username darcy --person 1
npm --prefix server run cli -- add-user --username partner --person 2
```

Each user gets their own `theme` and default view; all financial data is shared.
`reset-password --username <name>` and `list-users` are also available.

**Keep it running** with the templates in `server/deploy/` — `com.dollar.server.plist` (launchd,
macOS) or `dollar-server.service` (systemd, Linux). Edit the paths, install, and enable. Logs go to
`~/.dollar/server.log` (launchd) or `journalctl -u dollar-server` (systemd).

**Expose it over Tailscale.** Put all three machines on the same tailnet, then on the server run:

```bash
tailscale serve --bg http://127.0.0.1:8420
```

This gives a real TLS URL like `https://<host>.<tailnet>.ts.net` reachable only inside your tailnet
(the Node server stays bound to loopback). Point each app at that URL on first launch. If
`tailscale serve` isn't available, bind `DOLLAR_BIND` to the machine's Tailscale IP and use
`http://<magicdns-name>:8420` — WireGuard already encrypts the traffic.

### Granting your partner access

Two safe ways to let a second person's laptop reach the server:

- **Invite them onto your tailnet (simplest).** In the Tailscale admin console, invite them; they
  install Tailscale and sign in, and their laptop joins as a node that can reach the server URL.
  Trade-off: they're on your whole tailnet.
- **Share only the server (least privilege).** Use Tailscale node **sharing**, or an **ACL** so
  their device can reach only the server on port 8420 and nothing else:

  ```jsonc
  // Tailscale ACL — this device may reach only the dollar server
  "acls": [
    { "action": "accept", "src": ["partner@example.com"], "dst": ["homeserver:8420"] }
  ]
  ```

  Prefer this when you have other machines on the tailnet you'd rather keep private.

## Security model

The server is **never exposed to the public internet**. It binds to `127.0.0.1` (loopback) and is
reachable only through Tailscale — a private [WireGuard](https://www.wireguard.com/) mesh. There is
no open inbound port on your home router, so there's nothing for the public internet to scan or
brute-force. Access is defended in four layers:

1. **Loopback bind** — the server accepts connections only from its own machine.
2. **Tailscale / WireGuard** — only devices you've admitted to your tailnet can connect, and all
   traffic is end-to-end encrypted.
3. **TLS** — `tailscale serve` provides a real HTTPS certificate on the `.ts.net` URL.
4. **App auth** — scrypt-hashed passwords, bearer sessions, timing-safe comparison, and a ~300 ms
   delay on failed logins.

**Do not port-forward the server to the internet** — that's the one dangerous shortcut, putting
financial data behind only a password on the open internet. If Tailscale is ever unavailable, a
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
(no open inbound ports) is the next-safest option.

### Moving existing data onto the server

If you already have a local `dollar.db` from the old desktop-only version:

1. Quit the app so the database is flushed.
2. Copy `~/Library/Application Support/dollar/dollar.db` (plus any `-wal`/`-shm` files) to the
   server's `DOLLAR_DB_PATH`.
3. Start the server once — it runs the migration that adds the login tables.
4. Create the two logins as above.

(Alternatively, export a JSON backup from **Settings → Data** and restore it from another client
after connecting.)

### Backups

The server writes a daily snapshot to `<db dir>/backups/dollar-YYYY-MM-DD.db` (30 kept) and prunes
expired sessions. For off-machine safety, sync that folder somewhere (e.g. a cron `rsync`). Manual
JSON export/restore lives in **Settings → Data**.

## Building the desktop app

```bash
npm run build       # typechecked bundle + installer
npm run build:dir   # unpacked app in dist/ without an installer
```

On macOS this produces a single **universal** (Apple Silicon + Intel), **unsigned** `.dmg` and
`.zip` in `dist/` — one file that runs natively on either kind of Mac. Windows and Linux targets
are configured in `electron-builder.yml`. The client bundles no native modules, so no rebuild or
signing setup is needed.

The app icon is generated from `build/icon.svg`. To change it, edit the SVG and run
`npm run icons` (regenerates `build/icon.png` and `resources/icon.png`); electron-builder derives
the platform `.icns`/`.ico` from `build/icon.png`.

### Installing on another Mac

Since the app is a client of the shared server, the person installing it needs tailnet access and
a login first. One-time setup:

1. **Join the tailnet** — install [Tailscale](https://tailscale.com), sign in, and accept the
   invite/share (see _Granting your partner access_ above) so `https://<host>.<tailnet>.ts.net`
   resolves.
2. **Install** — open the `.dmg` and drag **dollar** to Applications.
3. **First launch (unsigned app)** — right-click the app → **Open** → **Open**. macOS only prompts
   this way once. (Equivalent: `xattr -cr /Applications/dollar.app` in Terminal.)
4. **Connect** — launch it, enter the server URL, then sign in with the login created via
   `npm --prefix server run cli -- add-user`.

Distribution is manual (AirDrop / file share) and there's no auto-update — a new version means
rebuilding and re-sending the `.dmg`.

## Features

- **Transactions** — manual keyboard entry, filtering, sorting, inline editing (double-click a
  row), multi-select delete, CSV export.
- **CSV & PDF import** — a wizard to map columns, auto-detect the date format, flip sign
  conventions, and pick person + account; duplicates are skipped on re-import. Text-based PDF bank
  statements (e.g. CommBank) are parsed directly.
- **Recurring rules** — weekly / biweekly / monthly / yearly spending or income.
- **Income & payslips** — record gross/tax/super/HECS, attach the payslip PDF, and match net pay to
  bank deposits so income isn't double-counted.
- **Dashboard** — monthly income / spending / net, savings balance, category donut, budget-vs-actual
  bars, 12-month trend, upcoming recurring items.
- **Budgets** — monthly grid per category with per-person and joint columns and progress bars.
- **Savings goals** — progress, projected completion, and on-/off-track status.
- **Forecast** — every month through end-of-year.
- **Reports** — monthly/yearly summaries, category breakdown, person comparison.
- **Settings** — currency, first day of the budgeting month, people, categories, accounts, theme
  (per-user), account/log-out, and data backup/restore.

## Testing

```bash
npm run typecheck                # Electron app
npm --prefix server run typecheck
npm --prefix server run smoke    # end-to-end HTTP smoke: auth, RPC, binary path, backup
```

CI (`.github/workflows/ci.yml`) runs format, lint, both typechecks, the server smoke, and both
builds on every push and PR.
