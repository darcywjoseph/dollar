import React, { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import type { ImportResult, ImportRow, StatementParseResult } from '@shared/types'
import { parseAmountToCents } from '@shared/money'
import { formatDateDisplay } from '@shared/dates'
import { guessColumn, parseDateFlexible, type DateConvention } from '@shared/importUtils'
import { api } from '../api'
import { useApp } from '../appContext'
import { Badge, Button, Modal } from '../components/ui'

type Step = 'upload' | 'map' | 'done'

export default function ImportWizard({
  onClose,
  onImported
}: {
  onClose: () => void
  onImported: () => Promise<void>
}): React.JSX.Element {
  const { people, accounts, categories, toast, fmt, viewMode } = useApp()
  const activeAccounts = accounts.filter((a) => !a.archived)

  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [hasHeader, setHasHeader] = useState(true)
  // set when the rows came from a PDF bank statement rather than a CSV
  const [statement, setStatement] = useState<StatementParseResult | null>(null)
  const [readingPdf, setReadingPdf] = useState(false)

  // mapping
  const [dateCol, setDateCol] = useState(-1)
  const [amountCol, setAmountCol] = useState(-1)
  const [descCol, setDescCol] = useState(-1)
  const [categoryCol, setCategoryCol] = useState(-1)
  const [dateConvention, setDateConvention] = useState<DateConvention>('auto')
  const [flipSigns, setFlipSigns] = useState(false)
  const [personId, setPersonId] = useState<number>(
    viewMode === 'combined' ? (people[0]?.id ?? 1) : viewMode
  )
  const [accountId, setAccountId] = useState<number | ''>(activeAccounts[0]?.id ?? '')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<
    (ImportResult & { invalid: number; payslipExcluded: number }) | null
  >(null)
  // per parsed-row index: id of the payslip whose net pay the row duplicates
  const [payslipMatches, setPayslipMatches] = useState<(number | null)[]>([])
  // matched rows the user chose to import anyway
  const [includeAnyway, setIncludeAnyway] = useState<Set<number>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)

  const loadFile = (file: File): void => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: (res) => {
        if (res.errors.length > 0 && res.data.length === 0) {
          toast(`Could not parse the file: ${res.errors[0].message}`, 'error')
          return
        }
        const data = res.data.filter(
          (r) => Array.isArray(r) && r.some((c) => String(c).trim() !== '')
        )
        if (data.length === 0) {
          toast('The file appears to be empty', 'error')
          return
        }
        setFileName(file.name)
        const first = data[0].map(String)
        // header detection: any cell in the first row that parses as an amount or date suggests data, not header
        const looksLikeHeader = !first.some(
          (c) => parseDateFlexible(c) != null || /^\s*-?\$?\d/.test(c)
        )
        setHasHeader(looksLikeHeader)
        applyRows(data, looksLikeHeader)
        setStep('map')
      },
      error: (err) => toast(`Could not read the file: ${err.message}`, 'error')
    })
  }

  const applyRows = (data: string[][], headerRow: boolean): void => {
    const hdrs = headerRow ? data[0].map(String) : data[0].map((_, i) => `Column ${i + 1}`)
    const body = headerRow ? data.slice(1) : data
    setHeaders(hdrs)
    setRows(body.map((r) => r.map(String)))
    setDateCol(guessColumn(hdrs, 'date'))
    setAmountCol(guessColumn(hdrs, 'amount'))
    setDescCol(guessColumn(hdrs, 'description'))
    setCategoryCol(guessColumn(hdrs, 'category'))
  }

  const loadPdf = async (file: File): Promise<void> => {
    setReadingPdf(true)
    try {
      const res = await api.parseStatementPdf(await file.arrayBuffer())
      // Present the statement as a pre-mapped three-column table so the
      // existing mapping/preview/dedup flow applies unchanged.
      const data = [
        ['Date', 'Amount', 'Description'],
        ...res.transactions.map((t) => [t.date, (t.amountCents / 100).toFixed(2), t.description])
      ]
      rawData.current = data
      setStatement(res)
      setFileName(file.name)
      setHasHeader(true)
      applyRows(data, true)
      setStep('map')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setReadingPdf(false)
    }
  }

  // full raw data kept so the header toggle can re-derive
  const rawData = useRef<string[][]>([])
  const onFile = (file: File): void => {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      void loadPdf(file)
      return
    }
    setStatement(null)
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: (res) => {
        rawData.current = (res.data as unknown[][])
          .filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ''))
          .map((r) => (r as unknown[]).map(String))
      }
    })
    loadFile(file)
  }

  const categoryByName = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of categories) m.set(c.name.trim().toLowerCase(), c.id)
    return m
  }, [categories])

  interface ParsedRow {
    raw: string[]
    date: string | null
    amountCents: number | null
    payee: string
    categoryId: number | null
  }

  const parsed: ParsedRow[] = useMemo(() => {
    if (dateCol < 0 || amountCol < 0) return []
    return rows.map((r) => {
      const date = parseDateFlexible(r[dateCol] ?? '', dateConvention)
      let amountCents = parseAmountToCents(r[amountCol] ?? '')
      if (amountCents != null && flipSigns) amountCents = -amountCents
      const payee = descCol >= 0 ? (r[descCol] ?? '').trim() : ''
      const categoryId =
        categoryCol >= 0
          ? (categoryByName.get((r[categoryCol] ?? '').trim().toLowerCase()) ?? null)
          : null
      return { raw: r, date, amountCents, payee, categoryId }
    })
  }, [rows, dateCol, amountCol, descCol, categoryCol, dateConvention, flipSigns, categoryByName])

  const validRows = parsed.filter((p) => p.date != null && p.amountCents != null)
  const invalidCount = parsed.length - validRows.length

  // Flag deposits that duplicate a recorded payslip's net pay. Excluded by
  // default; the per-row checkbox overrides.
  useEffect(() => {
    if (step !== 'map' || parsed.length === 0) {
      setPayslipMatches([])
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      api
        .matchImportRowsToPayslips(
          parsed.map((p) => ({ date: p.date ?? '', amountCents: p.amountCents ?? 0 })),
          personId
        )
        .then((m) => {
          if (alive) {
            setPayslipMatches(m)
            setIncludeAnyway(new Set())
          }
        })
        .catch(() => alive && setPayslipMatches([]))
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [step, parsed, personId])

  const isExcluded = (parsedIndex: number): boolean =>
    payslipMatches[parsedIndex] != null && !includeAnyway.has(parsedIndex)
  const excludedCount = parsed.reduce(
    (n, p, i) => n + (p.date != null && p.amountCents != null && isExcluded(i) ? 1 : 0),
    0
  )
  const importCount = validRows.length - excludedCount

  const runImport = async (): Promise<void> => {
    if (accountId === '') {
      toast('Choose an account', 'error')
      return
    }
    setImporting(true)
    try {
      const payload: ImportRow[] = parsed
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => p.date != null && p.amountCents != null && !isExcluded(i))
        .map(({ p }) => ({
          date: p.date!,
          amountCents: p.amountCents!,
          payee: p.payee,
          categoryId: p.categoryId
        }))
      const res = await api.importTransactions({ rows: payload, accountId, personId })
      setResult({ ...res, invalid: invalidCount, payslipExcluded: excludedCount })
      setStep('done')
      await onImported()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setImporting(false)
    }
  }

  const colSelect = (
    value: number,
    onChange: (v: number) => void,
    allowNone: boolean
  ): React.JSX.Element => (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {allowNone && <option value={-1}>— none —</option>}
      {!allowNone && value === -1 && <option value={-1}>choose…</option>}
      {headers.map((h, i) => (
        <option key={i} value={i}>
          {h}
        </option>
      ))}
    </select>
  )

  return (
    <Modal title={`Import transactions${fileName ? ` — ${fileName}` : ''}`} onClose={onClose} wide>
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Pick a CSV export or a PDF statement from your bank. You&apos;ll review everything in
            the next step — nothing is imported until you confirm.
          </p>
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-14 text-slate-500 transition hover:border-indigo-400 hover:text-indigo-500 dark:border-slate-600"
            onClick={() => !readingPdf && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f && !readingPdf) onFile(f)
            }}
          >
            <span className="text-3xl">📄</span>
            <span className="text-sm font-medium">
              {readingPdf ? 'Reading statement…' : 'Click to choose a file, or drop it here'}
            </span>
            <span className="text-xs">CSV or PDF bank statement</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,.pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
            }}
          />
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-5">
          {statement && (
            <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              {statement.periodStart && statement.periodEnd
                ? `Statement period ${formatDateDisplay(statement.periodStart)} – ${formatDateDisplay(statement.periodEnd)} · `
                : ''}
              {statement.transactions.length} transaction
              {statement.transactions.length === 1 ? '' : 's'} found in the PDF
            </div>
          )}
          {statement && statement.warnings.length > 0 && (
            <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              <p className="font-medium">
                Some parts of the statement could not be read — check these against the PDF:
              </p>
              <ul className="list-inside list-disc">
                {statement.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <label className="label">Date column</label>
              {colSelect(dateCol, setDateCol, false)}
            </div>
            <div>
              <label className="label">Amount column</label>
              {colSelect(amountCol, setAmountCol, false)}
            </div>
            <div>
              <label className="label">Description column</label>
              {colSelect(descCol, setDescCol, true)}
            </div>
            <div>
              <label className="label">Category column</label>
              {colSelect(categoryCol, setCategoryCol, true)}
            </div>
            <div>
              <label className="label">Date format</label>
              <select
                className="input"
                value={dateConvention}
                onChange={(e) => setDateConvention(e.target.value as DateConvention)}
              >
                <option value="auto">Auto-detect</option>
                <option value="mdy">MM/DD/YYYY</option>
                <option value="dmy">DD/MM/YYYY</option>
              </select>
            </div>
            <div>
              <label className="label">Person</label>
              <select
                className="input"
                value={personId}
                onChange={(e) => setPersonId(Number(e.target.value))}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Account</label>
              <select
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(Number(e.target.value))}
              >
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col justify-end gap-1.5 pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={flipSigns}
                  onChange={(e) => setFlipSigns(e.target.checked)}
                />
                Flip signs
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hasHeader}
                  onChange={(e) => {
                    setHasHeader(e.target.checked)
                    if (rawData.current.length > 0) applyRows(rawData.current, e.target.checked)
                  }}
                />
                First row is a header
              </label>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Expenses should end up <span className="font-medium text-red-500">negative</span> and
            income <span className="font-medium text-emerald-600">positive</span> — use “Flip signs”
            if your bank exports the opposite convention. Duplicate rows already in dollar (same
            date, amount, description) are skipped automatically.
          </p>

          {/* preview */}
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                <tr className="text-left text-slate-400">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {parsed.slice(0, 12).map((p, i) => {
                  const bad = p.date == null || p.amountCents == null
                  const matched = !bad && payslipMatches[i] != null
                  return (
                    <tr
                      key={i}
                      className={
                        bad
                          ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
                          : matched && isExcluded(i)
                            ? 'bg-amber-50/60 text-slate-400 dark:bg-amber-950/20 dark:text-slate-500'
                            : ''
                      }
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                        {p.date ?? `⚠ ${p.raw[dateCol] ?? ''}`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                        {p.amountCents != null ? fmt(p.amountCents) : `⚠ ${p.raw[amountCol] ?? ''}`}
                      </td>
                      <td className="max-w-64 truncate px-3 py-1.5">{p.payee}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        {p.categoryId != null
                          ? categories.find((c) => c.id === p.categoryId)?.name
                          : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        {matched && (
                          <span className="inline-flex items-center gap-2">
                            <Badge tone="warn">matches payslip</Badge>
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={includeAnyway.has(i)}
                                onChange={(e) => {
                                  setIncludeAnyway((prev) => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(i)
                                    else next.delete(i)
                                    return next
                                  })
                                }}
                              />
                              import anyway
                            </label>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {importCount} of {parsed.length} rows ready
              {excludedCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' '}
                  · {excludedCount} matched payslip{excludedCount > 1 ? 's' : ''} excluded
                </span>
              )}
              {invalidCount > 0 && (
                <span className="text-red-500">
                  {' '}
                  · {invalidCount} unparseable (will be skipped)
                </span>
              )}
            </span>
            <div className="flex gap-2">
              <Button onClick={() => setStep('upload')}>Back</Button>
              <Button
                variant="primary"
                onClick={runImport}
                disabled={importing || importCount === 0 || dateCol < 0 || amountCol < 0}
              >
                {importing ? 'Importing…' : `Import ${importCount} rows`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-5 text-center">
          <div className="text-4xl">{result.imported > 0 ? '✅' : 'ℹ️'}</div>
          <div>
            <p className="text-lg font-semibold">
              {result.imported} imported · {result.skipped} skipped as duplicates
            </p>
            {result.payslipExcluded > 0 && (
              <p className="mt-1 text-sm text-slate-500">
                {result.payslipExcluded} deposit{result.payslipExcluded > 1 ? 's were' : ' was'}{' '}
                skipped as payslip income already in the ledger.
              </p>
            )}
            {result.invalid > 0 && (
              <p className="mt-1 text-sm text-slate-500">
                {result.invalid} rows could not be parsed and were left out.
              </p>
            )}
          </div>
          <div className="flex justify-center">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
