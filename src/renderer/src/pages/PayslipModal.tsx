import React, { useMemo, useState } from 'react'
import type { Payslip, PayslipInput, Transaction } from '@shared/types'
import { formatDateDisplay, todayISO } from '@shared/dates'
import { parseAmountToCents } from '@shared/money'
import { api } from '../api'
import { useApp } from '../appContext'
import { Button, Modal, Money } from '../components/ui'

/** Parse an amount field; empty counts as zero. */
function cents(value: string): number | null {
  if (value.trim() === '') return 0
  return parseAmountToCents(value)
}

function toField(c: number): string {
  return c === 0 ? '' : (c / 100).toFixed(2)
}

export default function PayslipModal({
  payslip,
  onClose,
  onSaved
}: {
  payslip: Payslip | null
  onClose: () => void
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const { people, accounts, categories, settings, toast, viewMode, fmt } = useApp()
  const activeAccounts = accounts.filter((a) => !a.archived)
  const salaryCategory = categories.find((c) => c.type === 'income' && c.name === 'Salary')

  const [personId, setPersonId] = useState<number>(
    payslip?.personId ?? (viewMode === 'combined' ? (people[0]?.id ?? 1) : viewMode)
  )
  const [employer, setEmployer] = useState(payslip?.employer ?? '')
  const [payDate, setPayDate] = useState(payslip?.payDate ?? todayISO())
  const [periodStart, setPeriodStart] = useState(payslip?.periodStart ?? '')
  const [periodEnd, setPeriodEnd] = useState(payslip?.periodEnd ?? '')
  const [gross, setGross] = useState(payslip ? toField(payslip.grossCents) : '')
  const [tax, setTax] = useState(payslip ? toField(payslip.taxCents) : '')
  const [superSg, setSuperSg] = useState(payslip ? toField(payslip.superCents) : '')
  const [superExtra, setSuperExtra] = useState(payslip ? toField(payslip.superExtraCents) : '')
  const [hecs, setHecs] = useState(payslip ? toField(payslip.hecsCents) : '')
  const [other, setOther] = useState(payslip ? toField(payslip.otherDeductionsCents) : '')
  const [net, setNet] = useState(payslip ? toField(payslip.netCents) : '')
  const [notes, setNotes] = useState(payslip?.notes ?? '')
  const [accountId, setAccountId] = useState<number | ''>(() => {
    const own = activeAccounts.find((a) => a.personId === personId)
    return own?.id ?? activeAccounts[0]?.id ?? ''
  })
  const [saving, setSaving] = useState(false)
  const [bankMatches, setBankMatches] = useState<Transaction[] | null>(null)

  // Soft check only — payslips are messy (allowances, rounding, extra lines).
  const mismatchCents = useMemo(() => {
    const g = cents(gross)
    const t = cents(tax)
    const se = cents(superExtra)
    const h = cents(hecs)
    const o = cents(other)
    const n = cents(net)
    if (g == null || t == null || se == null || h == null || o == null || n == null) return null
    if (g === 0 && n === 0) return null
    return n - (g - t - h - se - o)
  }, [gross, tax, superExtra, hecs, other, net])

  const buildInput = (): PayslipInput | null => {
    const g = cents(gross)
    const t = cents(tax)
    const sg = cents(superSg)
    const se = cents(superExtra)
    const h = cents(hecs)
    const o = cents(other)
    const n = cents(net)
    if (g == null || g <= 0) {
      toast('Enter a valid gross amount', 'error')
      return null
    }
    if (n == null || n <= 0) {
      toast('Enter a valid net pay amount', 'error')
      return null
    }
    if (t == null || sg == null || se == null || h == null || o == null) {
      toast('One of the amounts is not a valid number', 'error')
      return null
    }
    return {
      personId,
      payDate,
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      employer: employer.trim(),
      grossCents: g,
      taxCents: t,
      superCents: sg,
      superExtraCents: se,
      hecsCents: h,
      otherDeductionsCents: o,
      netCents: n,
      notes: notes.trim() || null
    }
  }

  const save = async (linkTransactionId?: number | null): Promise<void> => {
    const input = buildInput()
    if (!input) return
    if (accountId === '') {
      toast('Choose an account', 'error')
      return
    }
    setSaving(true)
    try {
      if (payslip) {
        await api.updatePayslip(payslip.id, input)
        toast('Payslip updated', 'success')
      } else {
        await api.createPayslip(input, {
          accountId,
          categoryId: salaryCategory?.id ?? null,
          linkTransactionId: linkTransactionId ?? null
        })
        toast(
          linkTransactionId != null
            ? 'Payslip saved and linked to the existing deposit'
            : 'Payslip saved',
          'success'
        )
      }
      await onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
      setSaving(false)
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    // New payslips first look for an already-imported bank deposit to adopt,
    // so the income isn't counted twice.
    if (!payslip && bankMatches === null) {
      const input = buildInput()
      if (!input) return
      try {
        const matches = await api.findBankMatchesForPayslip(
          input.personId,
          input.netCents,
          input.payDate
        )
        if (matches.length > 0) {
          setBankMatches(matches)
          return
        }
      } catch {
        // matching is best-effort; fall through to a normal save
      }
    }
    await save(null)
  }

  return (
    <Modal title={payslip ? 'Edit payslip' : 'Add payslip'} onClose={onClose} wide>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-3 gap-3">
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
            <label className="label">Employer</label>
            <input
              className="input"
              value={employer}
              onChange={(e) => setEmployer(e.target.value)}
              placeholder="e.g. NSW Police"
            />
          </div>
          <div>
            <label className="label">Pay date</label>
            <input
              type="date"
              className="input"
              required
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Period start (optional)</label>
            <input
              type="date"
              className="input"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Period end (optional)</label>
            <input
              type="date"
              className="input"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
          {!payslip && (
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
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Gross (pre-tax) ({settings.currencySymbol})</label>
            <input
              className="input text-right"
              required
              inputMode="decimal"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Tax withheld</label>
            <input
              className="input text-right"
              inputMode="decimal"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </div>
          <div>
            <label className="label">HECS</label>
            <input
              className="input text-right"
              inputMode="decimal"
              value={hecs}
              onChange={(e) => setHecs(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Super (employer SG)</label>
            <input
              className="input text-right"
              inputMode="decimal"
              value={superSg}
              onChange={(e) => setSuperSg(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Extra super (salary sacrifice)</label>
            <input
              className="input text-right"
              inputMode="decimal"
              value={superExtra}
              onChange={(e) => setSuperExtra(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Other deductions</label>
            <input
              className="input text-right"
              inputMode="decimal"
              value={other}
              onChange={(e) => setOther(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Net pay ({settings.currencySymbol})</label>
            <input
              className="input text-right font-semibold"
              required
              inputMode="decimal"
              value={net}
              onChange={(e) => setNet(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className="label">Notes (optional)</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {mismatchCents != null && mismatchCents !== 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Net pay doesn&rsquo;t equal gross − tax − HECS − extra super − other deductions (off by{' '}
            {(Math.abs(mismatchCents) / 100).toFixed(2)}). That can be fine — allowances and
            employer SG don&rsquo;t reduce net — but double-check the figures.
          </p>
        )}

        {bankMatches && bankMatches.length > 0 && (
          <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-950">
            <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
              A matching bank deposit already exists
            </p>
            <p className="text-xs text-indigo-800 dark:text-indigo-200">
              Linking uses the existing transaction as this payslip&rsquo;s net pay, so the income
              isn&rsquo;t counted twice.
            </p>
            {bankMatches.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm dark:bg-slate-800"
              >
                <span>
                  {formatDateDisplay(m.date)} · {m.payee || 'No description'}
                </span>
                <span className="flex items-center gap-3">
                  <Money cents={m.amountCents} fmt={fmt} />
                  <Button
                    type="button"
                    variant="primary"
                    disabled={saving}
                    onClick={() => save(m.id)}
                  >
                    Link it
                  </Button>
                </span>
              </div>
            ))}
            <div className="flex justify-end">
              <Button type="button" variant="ghost" disabled={saving} onClick={() => save(null)}>
                Create a separate entry instead
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          {!(bankMatches && bankMatches.length > 0) && (
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : payslip ? 'Save changes' : 'Add payslip'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
