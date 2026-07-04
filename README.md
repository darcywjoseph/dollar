# dollar

A local and offline budget tool for designed for two people to track savings together, either per-person or jointly. Users can see a month-by-month forecast of finances through to the end of year.

Built with:
- Electron
- React 18 
- Tailwind CSS
- SQLite

## Getting started

Requires Node.js 20+.

```bash
npm install     # installs dependencies for Electron
npm run dev     # launches the app with hot reload
```

## Building a distributable

```bash
npm run build       # typechecked bundle + installer
npm run build:dir   # build unpacked app in dist/ without an installer
```

On mac this produces an unsigned `.dmg` and `.zip` in `dist/`. 
Windows and Linux targets are configured in `electron-builder.yml`.

## Data

A single SQLite file at `<userData>/dollar.db`:

- macOS: `~/Library/Application Support/dollar/dollar.db`
- Linux: `~/.config/dollar/dollar.db`
- Windows: `%APPDATA%/dollar/dollar.db`

## Features

- **Transactions** — manual keyboard entry, filtering, sorting, inline editing (double-click a row), multi-select delete,
  CSV export.
- **CSV import wizard** — map columns, auto-detect or choose the date format, flip sign
  conventions, pick person + account; duplicates (same date/amount/description) are skipped
  automatically on re-import.
- **Recurring rules** — define weekly / biweekly / monthly / yearly recurring transaction (spending or income).
- **Dashboard** — monthly income / spending / net, savings balance, category donut chart,
  budget-vs-actual bars, 12-month trend, upcoming recurring items.
- **Budgets** — monthly grid per category with per-person and joint columns plus progress bars
- **Savings goals** — track progress, projected completion date and on-track/off-track status from your recent contribution rate.
- **Forecast** — every month through to end-of-year.
- **Reports** — monthly/yearly summaries, category breakdown, person comparison.
- **Settings** — currency symbol, first day of the budgeting month (payday-to-payday budgeting),
  rename people and their colors, manage categories and accounts, light/dark/system theme.

## Architecture

```
src/
├── shared/          types defs and utils helpers.
├── main/            Electron main process.
│   ├── db/          SQLite schema, migrations, seed, typed query modules.
│   ├── ipc.ts       IPC handlers.
│   └── smoke.ts
├── preload/         contextBridge with a whitelisted invoke() only.
└── renderer/        React UI.
```

### Smoke test

```bash
npm run dev # only to ensure a build exists — or: npx electron-vite build
DOLLAR_SMOKE=1 npx electron .
```
