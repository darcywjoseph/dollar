import React, { useCallback, useEffect, useState } from 'react'
import type {
  BalanceAdjustmentInput,
  FYIncomeReport,
  IncomeSummary,
  PayFrequency,
  PaySchedule,
  Payslip,
  TrackedBalanceKind,
  TrackedBalancePanel
} from '@shared/types'
import { currentMonthKey, formatDateDisplay, todayISO } from '@shared/dates'
import { parseAmountToCents } from '@shared/money'
import { api } from '../api'
import { nativeApi } from '../nativeApi'
import { useApp } from '../appContext'
import { Badge, Button, Card, EmptyState, Modal, Money, MonthNav, Spinner } from '../components/ui'
import PayslipModal from './PayslipModal'

type Tab = 'payslips' | 'expected' | 'super'

const PAY_FREQUENCIES: { value: PayFrequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' }
]

function fyStartYearOf(iso: string): number {
  const [y, m] = iso.split('-').map(Number)
  return m >= 7 ? y : y - 1
}

export default function Income(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('payslips')
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {(
          [
            ['payslips', 'Payslips'],
            ['expected', 'Expected pay'],
            ['super', 'Super & HECS']
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'payslips' && <PayslipsTab />}
      {tab === 'expected' && <ExpectedTab />}
      {tab === 'super' && <SuperHecsTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Payslips tab
// ---------------------------------------------------------------------------

function PayslipsTab(): React.JSX.Element {
  const { personFilter, personById, fmt, toast, confirm, refresh } = useApp()
  const [slips, setSlips] = useState<Payslip[] | null>(null)
  const [fyYear, setFyYear] = useState(() => fyStartYearOf(todayISO()))
  const [fyReport, setFyReport] = useState<FYIncomeReport | null>(null)
  const [editing, setEditing] = useState<Payslip | 'new' | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, fy] = await Promise.all([
        api.listPayslips(personFilter != null ? { personId: personFilter } : {}),
        api.getFinancialYearIncome(fyYear, personFilter)
      ])
      setSlips(list)
      setFyReport(fy)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }, [personFilter, fyYear, toast])

  useEffect(() => {
    load()
  }, [load])

  const openPdf = async (slip: Payslip): Promise<void> => {
    try {
      const pdf = await api.getPayslipPdf(slip.id)
      if (!pdf) {
        toast('No PDF attached to this payslip', 'error')
        return
      }
      const res = await nativeApi.openPdf(pdf.filename, pdf.dataBase64)
      if (!res.opened) toast(res.error ?? 'Could not open the PDF', 'error')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const remove = async (slip: Payslip): Promise<void> => {
    const ok = await confirm({
      title: 'Delete this payslip?',
      message:
        slip.transactionSource === 'created'
          ? 'Its net-pay transaction is deleted from the ledger too.'
          : 'The linked bank transaction stays in the ledger; only the payslip details are removed.',
      confirmLabel: 'Delete payslip',
      danger: true
    })
    if (!ok) return
    try {
      await api.deletePayslip(slip.id)
      await load()
      refresh().catch(() => undefined)
      toast('Payslip deleted', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  if (!slips) return <Spinner />

  return (
    <div className="space-y-4">
      <Card
        title={`Financial year ${fyYear}–${String(fyYear + 1).slice(2)}`}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              onClick={() => setFyYear((y) => y - 1)}
              aria-label="Previous FY"
            >
              ‹
            </Button>
            <Button variant="ghost" onClick={() => setFyYear((y) => y + 1)} aria-label="Next FY">
              ›
            </Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              Add payslip
            </Button>
          </div>
        }
      >
        {fyReport && fyReport.perPerson.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2 text-right">Payslips</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Tax</th>
                  <th className="px-3 py-2 text-right">HECS</th>
                  <th className="px-3 py-2 text-right">Super (SG)</th>
                  <th className="px-3 py-2 text-right">Extra super</th>
                  <th className="px-3 py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {fyReport.perPerson.map((r) => {
                  const p = personById(r.personId)
                  return (
                    <tr key={r.personId}>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: p?.color }}
                          />
                          {p?.name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.payslipCount}</td>
                      <td className="px-3 py-2 text-right">
                        <Money cents={r.grossCents} fmt={fmt} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money cents={r.taxCents} fmt={fmt} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money cents={r.hecsCents} fmt={fmt} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money cents={r.superCents} fmt={fmt} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money cents={r.superExtraCents} fmt={fmt} />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        <Money cents={r.netCents} fmt={fmt} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No payslips recorded in this financial year yet.
          </p>
        )}
      </Card>

      <div className="card overflow-hidden">
        {slips.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No payslips yet"
            message="Record each payslip's gross pay, tax, super and HECS. Net pay is added to the ledger, and matching bank deposits are skipped on CSV import so income is never counted twice."
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                Add your first payslip
              </Button>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                <th className="px-4 py-2.5">Pay date</th>
                <th className="px-4 py-2.5">Person</th>
                <th className="px-4 py-2.5">Employer</th>
                <th className="px-4 py-2.5 text-right">Gross</th>
                <th className="px-4 py-2.5 text-right">Tax</th>
                <th className="px-4 py-2.5 text-right">HECS</th>
                <th className="px-4 py-2.5 text-right">Super</th>
                <th className="px-4 py-2.5 text-right">Net</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {slips.map((s) => {
                const p = personById(s.personId)
                return (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {formatDateDisplay(s.payDate)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: p?.color }}
                        />
                        {p?.name}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                      {s.employer || '—'}{' '}
                      {s.transactionSource === 'linked' && <Badge>linked to bank</Badge>}
                      {s.transactionSource === 'none' && <Badge tone="warn">no ledger row</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money cents={s.grossCents} fmt={fmt} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">
                      <Money cents={s.taxCents} fmt={fmt} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">
                      <Money cents={s.hecsCents} fmt={fmt} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400">
                      <Money cents={s.superCents + s.superExtraCents} fmt={fmt} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      <Money cents={s.netCents} fmt={fmt} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {s.pdfFilename && (
                        <Button
                          variant="ghost"
                          aria-label="Open attached PDF"
                          title="Open attached PDF"
                          onClick={() => openPdf(s)}
                        >
                          📎
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button variant="ghost" className="text-red-500" onClick={() => remove(s)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <PayslipModal
          payslip={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
            refresh().catch(() => undefined)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expected pay tab
// ---------------------------------------------------------------------------

function ExpectedTab(): React.JSX.Element {
  const { people, personFilter, personById, settings, fmt, toast, confirm } = useApp()
  const [schedules, setSchedules] = useState<PaySchedule[] | null>(null)
  const [month, setMonth] = useState(() => currentMonthKey(settings.firstDayOfMonth))
  const [summary, setSummary] = useState<IncomeSummary | null>(null)
  const [editing, setEditing] = useState<PaySchedule | 'new' | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [sch, sum] = await Promise.all([api.listPaySchedules(), api.getIncomeSummary(month)])
      setSchedules(sch)
      setSummary(sum)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }, [month, toast])

  useEffect(() => {
    load()
  }, [load])

  const remove = async (s: PaySchedule): Promise<void> => {
    const ok = await confirm({
      title: `Delete “${s.name}”?`,
      message: 'Payslips stay; they just stop being compared against this schedule.',
      confirmLabel: 'Delete schedule',
      danger: true
    })
    if (!ok) return
    try {
      setSchedules(await api.deletePaySchedule(s.id))
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  if (!schedules || !summary) return <Spinner />

  const events = summary.events.filter((e) => personFilter == null || e.personId === personFilter)
  const totals = summary.totals.filter((t) => personFilter == null || t.personId === personFilter)
  const combined = totals.reduce(
    (acc, t) => {
      acc.expectedCents += t.expectedCents
      acc.actualCents += t.actualCents
      acc.varianceCents += t.varianceCents
      return acc
    },
    { expectedCents: 0, actualCents: 0, varianceCents: 0 }
  )

  return (
    <div className="space-y-4">
      <Card
        title="Pay schedules"
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            New schedule
          </Button>
        }
      >
        {schedules.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Set an expected pay per cycle (e.g. fortnightly) per person. The forecast uses it for
            pays you haven&rsquo;t received yet, and each expected pay is replaced by the actual
            payslip as it&rsquo;s entered. If you modelled salary as a recurring rule, deactivate
            that rule to avoid double counting.
          </p>
        ) : (
          <div className="space-y-2">
            {schedules.map((s) => {
              const p = personById(s.personId)
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p?.color }} />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {PAY_FREQUENCIES.find((f) => f.value === s.frequency)?.label} ·{' '}
                      <Money cents={s.expectedNetCents} fmt={fmt} /> expected
                    </span>
                    {!s.active && <Badge>paused</Badge>}
                  </span>
                  <span>
                    <Button variant="ghost" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button variant="ghost" className="text-red-500" onClick={() => remove(s)}>
                      Delete
                    </Button>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card title="Expected vs actual" actions={<MonthNav month={month} onChange={setMonth} />}>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No expected pay events this month
            {schedules.length === 0 ? ' — create a schedule first' : ''}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-700">
                  <th className="px-3 py-2">Expected</th>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2 text-right">Expected pay</th>
                  <th className="px-3 py-2">Actual</th>
                  <th className="px-3 py-2 text-right">Actual pay</th>
                  <th className="px-3 py-2 text-right">Variance</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {events.map((e, i) => {
                  const p = personById(e.personId)
                  return (
                    <tr key={`${e.scheduleId}-${e.expectedDate}-${i}`}>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {formatDateDisplay(e.expectedDate)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: p?.color }}
                          />
                          {p?.name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money cents={e.expectedNetCents} fmt={fmt} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">
                        {e.actualDate ? formatDateDisplay(e.actualDate) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {e.actualNetCents != null ? (
                          <Money cents={e.actualNetCents} fmt={fmt} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {e.varianceCents != null ? (
                          <Money cents={e.varianceCents} fmt={fmt} colored sign />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {e.status === 'received' && <Badge tone="good">received</Badge>}
                        {e.status === 'upcoming' && <Badge>upcoming</Badge>}
                        {e.status === 'missed' && <Badge tone="warn">missed</Badge>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                {totals.map((t) => {
                  const p = personById(t.personId)
                  return (
                    <tr
                      key={t.personId}
                      className="border-t border-slate-200 text-sm dark:border-slate-700"
                    >
                      <td className="px-3 py-2 font-medium" colSpan={2}>
                        {p?.name} total
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money cents={t.expectedCents} fmt={fmt} />
                      </td>
                      <td />
                      <td className="px-3 py-2 text-right">
                        <Money cents={t.actualCents} fmt={fmt} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        <Money cents={t.varianceCents} fmt={fmt} colored sign />
                      </td>
                      <td />
                    </tr>
                  )
                })}
                {personFilter == null && totals.length > 1 && (
                  <tr className="border-t border-slate-300 font-semibold dark:border-slate-600">
                    <td className="px-3 py-2" colSpan={2}>
                      Joint total
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Money cents={combined.expectedCents} fmt={fmt} />
                    </td>
                    <td />
                    <td className="px-3 py-2 text-right">
                      <Money cents={combined.actualCents} fmt={fmt} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Money cents={combined.varianceCents} fmt={fmt} colored sign />
                    </td>
                    <td />
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
        {summary.unscheduledPayslips.length > 0 && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {summary.unscheduledPayslips.length} payslip
            {summary.unscheduledPayslips.length > 1 ? 's' : ''} this month didn&rsquo;t match any
            schedule (extra shifts or one-off pay) — still counted as income, just not compared
            against an expected pay.
          </p>
        )}
      </Card>

      {editing && (
        <ScheduleModal
          schedule={editing === 'new' ? null : editing}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={async (updated) => {
            setSchedules(updated)
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function ScheduleModal({
  schedule,
  people,
  onClose,
  onSaved
}: {
  schedule: PaySchedule | null
  people: { id: number; name: string }[]
  onClose: () => void
  onSaved: (updated: PaySchedule[]) => Promise<void>
}): React.JSX.Element {
  const { accounts, settings, toast } = useApp()
  const activeAccounts = accounts.filter((a) => !a.archived)

  const [name, setName] = useState(schedule?.name ?? '')
  const [personId, setPersonId] = useState<number>(schedule?.personId ?? people[0]?.id ?? 1)
  const [frequency, setFrequency] = useState<PayFrequency>(schedule?.frequency ?? 'biweekly')
  const [anchorDate, setAnchorDate] = useState(schedule?.anchorDate ?? todayISO())
  const [expectedNet, setExpectedNet] = useState(
    schedule ? (schedule.expectedNetCents / 100).toFixed(2) : ''
  )
  const [expectedGross, setExpectedGross] = useState(
    schedule && schedule.expectedGrossCents > 0
      ? (schedule.expectedGrossCents / 100).toFixed(2)
      : ''
  )
  const [accountId, setAccountId] = useState<number | ''>(
    schedule?.accountId ?? activeAccounts[0]?.id ?? ''
  )
  const [active, setActive] = useState(schedule?.active ?? true)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const net = parseAmountToCents(expectedNet)
    if (net == null || net <= 0) {
      toast('Enter a valid expected net amount', 'error')
      return
    }
    const gross = expectedGross.trim() === '' ? 0 : parseAmountToCents(expectedGross)
    if (gross == null) {
      toast('Enter a valid expected gross amount', 'error')
      return
    }
    if (accountId === '') {
      toast('Choose an account', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        personId,
        name: name.trim(),
        frequency,
        anchorDate,
        expectedNetCents: net,
        expectedGrossCents: gross,
        accountId,
        active
      }
      const updated = schedule
        ? await api.updatePaySchedule(schedule.id, payload)
        : await api.createPaySchedule(payload)
      toast(schedule ? 'Schedule updated' : 'Schedule created', 'success')
      await onSaved(updated)
    } catch (err) {
      toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  return (
    <Modal title={schedule ? 'Edit pay schedule' : 'New pay schedule'} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="label">Name / employer</label>
          <input
            className="input"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. NSW Police fortnightly pay"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
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
            <label className="label">Frequency</label>
            <select
              className="input"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as PayFrequency)}
            >
              {PAY_FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">A known pay date</label>
            <input
              type="date"
              className="input"
              required
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Paid into account</label>
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
          <div>
            <label className="label">Expected net per pay ({settings.currencySymbol})</label>
            <input
              className="input text-right"
              required
              inputMode="decimal"
              value={expectedNet}
              onChange={(e) => setExpectedNet(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Expected gross (optional)</label>
            <input
              className="input text-right"
              inputMode="decimal"
              value={expectedGross}
              onChange={(e) => setExpectedGross(e.target.value)}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : schedule ? 'Save changes' : 'Create schedule'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Super & HECS tab
// ---------------------------------------------------------------------------

function SuperHecsTab(): React.JSX.Element {
  const { personFilter, personById, fmt, toast, confirm } = useApp()
  const [panels, setPanels] = useState<TrackedBalancePanel[] | null>(null)
  const [configuring, setConfiguring] = useState<TrackedBalancePanel | null>(null)
  const [adjusting, setAdjusting] = useState<TrackedBalancePanel | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setPanels(await api.getTrackedBalances())
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  if (!panels) return <Spinner />

  const visible = panels.filter((p) => personFilter == null || p.personId === personFilter)

  const removeAdjustment = async (id: number): Promise<void> => {
    const ok = await confirm({
      title: 'Delete this adjustment?',
      message: 'The balance is recalculated without it.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      setPanels(await api.deleteBalanceAdjustment(id))
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {visible.map((panel) => {
        const p = personById(panel.personId)
        const isSuper = panel.kind === 'super'
        return (
          <Card
            key={`${panel.personId}-${panel.kind}`}
            title={`${p?.name} — ${isSuper ? 'Super' : 'HECS debt'}`}
            actions={
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => setConfiguring(panel)}>
                  {panel.config ? 'Edit starting balance' : 'Set up'}
                </Button>
                {panel.config && (
                  <Button variant="ghost" onClick={() => setAdjusting(panel)}>
                    {isSuper ? 'Add adjustment' : 'Add indexation'}
                  </Button>
                )}
              </div>
            }
          >
            {!panel.config ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isSuper
                  ? 'Track a running super balance: starting balance plus payslip contributions, with manual adjustments for market movement.'
                  : 'Track your remaining HECS debt: starting debt minus payslip deductions, with manual entries for annual indexation.'}
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-2xl font-semibold tabular-nums">
                    <Money cents={panel.currentCents ?? 0} fmt={fmt} />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {fmt(panel.config.startingCents)} on{' '}
                    {formatDateDisplay(panel.config.startingDate)}
                    {isSuper ? ' + ' : ' − '}
                    {fmt(panel.contributionsCents)} from payslips
                    {panel.adjustmentsCents !== 0 &&
                      ` ${panel.adjustmentsCents > 0 ? '+' : '−'} ${fmt(Math.abs(panel.adjustmentsCents))} adjustments`}
                  </p>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {isSuper ? 'Contributions' : 'Deductions'} this FY:{' '}
                  <Money cents={panel.fyContributionsCents} fmt={fmt} className="font-medium" />
                </p>
                {panel.adjustments.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Adjustments
                    </p>
                    {panel.adjustments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-xs dark:bg-slate-700/40"
                      >
                        <span className="tabular-nums">
                          {formatDateDisplay(a.date)}
                          {a.note ? ` · ${a.note}` : ''}
                        </span>
                        <span className="flex items-center gap-2">
                          <Money cents={a.amountCents} fmt={fmt} colored sign />
                          <button
                            className="text-slate-400 hover:text-red-500"
                            aria-label="Delete adjustment"
                            onClick={() => removeAdjustment(a.id)}
                          >
                            ×
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        )
      })}

      {configuring && (
        <BalanceConfigModal
          panel={configuring}
          onClose={() => setConfiguring(null)}
          onSaved={async (updated) => {
            setPanels(updated)
            setConfiguring(null)
          }}
        />
      )}
      {adjusting && (
        <AdjustmentModal
          panel={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={async (updated) => {
            setPanels(updated)
            setAdjusting(null)
          }}
        />
      )}
    </div>
  )
}

function BalanceConfigModal({
  panel,
  onClose,
  onSaved
}: {
  panel: TrackedBalancePanel
  onClose: () => void
  onSaved: (updated: TrackedBalancePanel[]) => Promise<void>
}): React.JSX.Element {
  const { personById, settings, toast } = useApp()
  const [starting, setStarting] = useState(
    panel.config ? (panel.config.startingCents / 100).toFixed(2) : ''
  )
  const [startingDate, setStartingDate] = useState(panel.config?.startingDate ?? todayISO())
  const [saving, setSaving] = useState(false)
  const isSuper = panel.kind === 'super'

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const c = parseAmountToCents(starting)
    if (c == null || c < 0) {
      toast('Enter a valid balance', 'error')
      return
    }
    setSaving(true)
    try {
      const updated = await api.setTrackedBalance(panel.personId, panel.kind, c, startingDate)
      toast('Saved', 'success')
      await onSaved(updated)
    } catch (err) {
      toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`${personById(panel.personId)?.name} — ${isSuper ? 'super balance' : 'HECS debt'}`}
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">
              {isSuper ? 'Balance' : 'Debt'} ({settings.currencySymbol})
            </label>
            <input
              className="input text-right"
              required
              inputMode="decimal"
              autoFocus
              value={starting}
              onChange={(e) => setStarting(e.target.value)}
            />
          </div>
          <div>
            <label className="label">As at</label>
            <input
              type="date"
              className="input"
              required
              value={startingDate}
              onChange={(e) => setStartingDate(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Payslips dated on or after this date {isSuper ? 'add to' : 'reduce'} the balance
          automatically.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function AdjustmentModal({
  panel,
  onClose,
  onSaved
}: {
  panel: TrackedBalancePanel
  onClose: () => void
  onSaved: (updated: TrackedBalancePanel[]) => Promise<void>
}): React.JSX.Element {
  const { personById, settings, toast } = useApp()
  const isSuper = panel.kind === 'super'
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'up' | 'down'>('up')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState(isSuper ? '' : 'Indexation')
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const c = parseAmountToCents(amount)
    if (c == null || c <= 0) {
      toast('Enter a valid amount', 'error')
      return
    }
    setSaving(true)
    try {
      const input: BalanceAdjustmentInput = {
        personId: panel.personId,
        kind: panel.kind as TrackedBalanceKind,
        date,
        amountCents: direction === 'up' ? c : -c,
        note: note.trim() || null
      }
      const updated = await api.createBalanceAdjustment(input)
      toast('Adjustment added', 'success')
      await onSaved(updated)
    } catch (err) {
      toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`${personById(panel.personId)?.name} — ${isSuper ? 'super adjustment' : 'HECS indexation'}`}
      onClose={onClose}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Direction</label>
            <select
              className="input"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'up' | 'down')}
            >
              <option value="up">{isSuper ? 'Balance up (gains)' : 'Debt up (indexation)'}</option>
              <option value="down">{isSuper ? 'Balance down (losses)' : 'Debt down'}</option>
            </select>
          </div>
          <div>
            <label className="label">Amount ({settings.currencySymbol})</label>
            <input
              className="input text-right"
              required
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="col-span-3">
            <label className="label">Note (optional)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Add adjustment'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
