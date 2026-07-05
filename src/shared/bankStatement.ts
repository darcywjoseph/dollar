// Parser for text extracted from CommBank PDFs, in either of two layouts:
//
// Mailed statements list transactions as "DD Mon <description…>" with the
// amount and running balance on the row's last line. Rows carry no year — it
// is inferred from the statement period in the header. The balance column is
// signed ("CR"/"DR"), so the sign of each amount comes from the balance delta
// rather than from guessing which visual column the amount sat in.
//
// NetBank "Transaction Summary" letters instead put the full date, the
// explicitly signed dollar amount and the balance on one line, with extra
// description lines following the row rather than preceding the amount.

import { compareISO, isValidISO, toISO } from './dates'
import type { StatementParseResult, StatementTransaction } from './types'

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

/** "1,234.56" -> 123456. Statement amounts are always unsigned. */
function moneyToCents(s: string): number {
  return Math.round(Number(s.replace(/,/g, '')) * 100)
}

/** Balance with CR/DR suffix -> signed cents. "Nil" -> 0. */
function balanceToCents(amount: string, suffix: string): number {
  const cents = moneyToCents(amount)
  return suffix.toUpperCase() === 'DR' ? -cents : cents
}

function monthFromName(name: string): number | null {
  return MONTHS[name.slice(0, 3).toLowerCase()] ?? null
}

/** "2 Dec 2025" -> ISO date. */
function parseFullDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/)
  if (!m) return null
  const month = monthFromName(m[2])
  if (!month) return null
  const iso = toISO(Number(m[3]), month, Number(m[1]))
  return isValidISO(iso) ? iso : null
}

/** "01/05/26" or "01/05/2026" (DD/MM/YY[YY]) -> ISO date. */
function parseSlashDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])
  const iso = toISO(year, Number(m[2]), Number(m[1]))
  return isValidISO(iso) ? iso : null
}

// Print-margin artifacts that the text extraction can merge into real lines:
// "=a", "5Ï1)", bare asterisks.
const JUNK_TOKEN = /(?:^|\s)(?:=[a-z]|\d+Ï\d+\)|\*)(?=\s|$)/g

function cleanLine(raw: string): string {
  return raw.replace(JUNK_TOKEN, ' ').replace(/\s+/g, ' ').trim()
}

/** Non-transaction furniture: page headers, column headers, print codes. */
function isNoiseLine(line: string): boolean {
  return (
    /^Statement \d+\b/.test(line) ||
    /^Page \d+ of \d+\)?$/.test(line) ||
    /^Account Number\b/.test(line) ||
    /^[\d ]{7,}$/.test(line) || // account number / mail barcode digits
    /^Date Transaction Debit Credit Balance$/i.test(line) ||
    /^\d{3}\.\d{3,4}\.\d+\.\d+ ZZ/.test(line) || // printer control codes
    // Transaction Summary furniture. These also mark the end of the table, so
    // the parser stops attaching description lines when it sees one.
    /^Date Transaction details Amount Balance$/i.test(line) ||
    /^Created \d{1,2}\/\d{1,2}\/\d{2}/.test(line) ||
    /^Any pending transactions\b/i.test(line) ||
    /^Transaction Summary v/.test(line)
  )
}

// A transaction's final line: optional description text, then the unsigned
// amount, then the signed running balance.
const ROW_END = /^(.*?)\s*(\d[\d,]*\.\d{2}) (\d[\d,]*\.\d{2}) (CR|DR)$/
// A new row begins with a day + month name (year only on opening/closing rows).
const ROW_START = /^(\d{1,2}) ([A-Za-z]{3})\b\s*(.*)$/
// A complete Transaction Summary row: full date, details, signed dollar
// amount, dollar balance. Backtracking makes the last two $ tokens win even
// when the details text itself contains a dollar amount.
const SUMMARY_ROW =
  /^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})\s+(.*?)\s*(-?)\$([\d,]+\.\d{2})\s+(-?)\$([\d,]+\.\d{2})$/

/** Metadata lines that would clutter the payee ("Card xx6122", "Value Date …"). */
function isCardMetadata(part: string): boolean {
  return /^Card (?:xx|\*+|\d)/i.test(part) || /^Value Date:? \d{2}\/\d{2}\/\d{4}$/.test(part)
}

interface PendingRow {
  day: number
  month: number
  parts: string[]
}

export function parseBankStatement(rawLines: string[]): StatementParseResult {
  // Noise lines are kept here and skipped inside the loop: seeing one tells
  // the summary-format logic that the transaction table has been interrupted.
  const lines = rawLines.map(cleanLine).filter((l) => l !== '')

  // Statement period, e.g. "Period 2 Dec 2025 - 3 Jun 2026" or (Transaction
  // Summary) "… transactions from 01/05/26-04/07/26". The two years anchor
  // the day-month-only transaction dates of the statement format.
  let periodStart: string | null = null
  let periodEnd: string | null = null
  for (const line of lines) {
    const m = line.match(/(\d{1,2} [A-Za-z]{3,9} \d{4})\s*[-–]\s*(\d{1,2} [A-Za-z]{3,9} \d{4})/)
    if (m) {
      periodStart = parseFullDate(m[1])
      periodEnd = parseFullDate(m[2])
      if (periodStart && periodEnd) break
    }
    const s = line.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/)
    if (s) {
      periodStart = parseSlashDate(s[1])
      periodEnd = parseSlashDate(s[2])
      if (periodStart && periodEnd) break
    }
  }
  // Fallback: the opening/closing balance rows carry full dates too.
  if (!periodStart || !periodEnd) {
    for (const line of lines) {
      const m = line.match(/^(\d{1,2} [A-Za-z]{3,9} \d{4}) (?:OPENING|CLOSING) BALANCE\b/i)
      if (!m) continue
      const iso = parseFullDate(m[1])
      if (!iso) continue
      if (!periodStart || compareISO(iso, periodStart) < 0) periodStart = iso
      if (!periodEnd || compareISO(iso, periodEnd) > 0) periodEnd = iso
    }
  }

  const transactions: StatementTransaction[] = []
  const warnings: string[] = []
  const warn = (msg: string): void => {
    if (warnings.length < 20) warnings.push(msg)
  }

  const resolveDate = (day: number, month: number): string | null => {
    if (!periodStart || !periodEnd) return null
    const years = new Set([Number(periodStart.slice(0, 4)), Number(periodEnd.slice(0, 4))])
    for (const y of years) {
      const iso = toISO(y, month, day)
      if (isValidISO(iso) && compareISO(iso, periodStart) >= 0 && compareISO(iso, periodEnd) <= 0)
        return iso
    }
    return null
  }

  // Signed running balance; null until an OPENING BALANCE row (or first
  // completed row) anchors it.
  let balance: number | null = null
  // Account balance before the first transaction / after the last one, when
  // the statement lets us establish them (first wins / last wins).
  let openingBalance: number | null = null
  let closingBalance: number | null = null
  let pending: PendingRow | null = null
  // Last Transaction Summary row, still accepting follow-on description lines.
  let openSummary: StatementTransaction | null = null

  const flushPendingAsLost = (): void => {
    if (pending) {
      warn(`Row "${pending.day}/${pending.month} ${pending.parts[0] ?? ''}" had no amount; skipped`)
      pending = null
    }
  }

  for (const line of lines) {
    if (isNoiseLine(line)) {
      openSummary = null
      continue
    }

    // Transaction Summary row: everything is on one line, sign included.
    const sm = line.match(SUMMARY_ROW)
    const smMonth = sm ? monthFromName(sm[2]) : null
    if (sm && smMonth) {
      flushPendingAsLost()
      openSummary = null
      const date = toISO(Number(sm[3]), smMonth, Number(sm[1]))
      const description = sm[4].trim() || 'Transaction'
      if (!isValidISO(date)) {
        warn(`"${description}": invalid date "${sm[1]} ${sm[2]} ${sm[3]}"; skipped`)
        continue
      }
      const signed = (sm[5] === '-' ? -1 : 1) * moneyToCents(sm[6])
      const newBalance = (sm[7] === '-' ? -1 : 1) * moneyToCents(sm[8])
      if (balance != null && newBalance - balance !== signed) {
        warn(`"${description}" (${date}): amount does not match the balance movement`)
      }
      // The first row implies what the account held before the period.
      if (openingBalance == null && balance == null) openingBalance = newBalance - signed
      openSummary = { date, amountCents: signed, description }
      transactions.push(openSummary)
      balance = newBalance
      closingBalance = newBalance
      continue
    }

    // Opening balance anchors the running balance; closing balance ends a
    // statement section (multi-statement PDFs restart with a new opening).
    const m = line.match(/^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4}) OPENING BALANCE\b\s*(.*)$/i)
    if (m) {
      flushPendingAsLost()
      const rest = m[4].trim()
      const bal = rest.match(/^(\d[\d,]*\.\d{2}) (CR|DR)$/)
      balance = /^nil$/i.test(rest) ? 0 : bal ? balanceToCents(bal[1], bal[2]) : null
      if (balance == null) warn(`Could not read opening balance ("${rest}")`)
      if (openingBalance == null) openingBalance = balance
      continue
    }
    if (/\bCLOSING BALANCE\b/i.test(line)) {
      flushPendingAsLost()
      const bal = line.match(/(\d[\d,]*\.\d{2}) (CR|DR)$/)
      if (bal && balance != null && balanceToCents(bal[1], bal[2]) !== balance) {
        warn('Closing balance does not match the running balance; some rows may be wrong')
      }
      if (bal) closingBalance = balanceToCents(bal[1], bal[2])
      balance = null
      continue
    }

    const start = line.match(ROW_START)
    const startMonth = start ? monthFromName(start[2]) : null
    if (start && startMonth) {
      flushPendingAsLost()
      openSummary = null
      pending = { day: Number(start[1]), month: startMonth, parts: [] }
      if (start[3]) pending.parts.push(start[3])
      // fall through: a single-line row also ends on this line
    } else if (pending) {
      pending.parts.push(line)
    } else if (openSummary) {
      // Summary format: extra description lines follow the completed row.
      if (!isCardMetadata(line)) openSummary.description += ` ${line}`
      continue
    } else {
      continue // preamble/footer text between rows
    }

    const last = pending.parts.length - 1
    const end = pending.parts[last]?.match(ROW_END)
    if (!end) continue

    const amountCents = moneyToCents(end[2])
    const newBalance = balanceToCents(end[3], end[4])
    pending.parts[last] = end[1]

    const date = resolveDate(pending.day, pending.month)
    const description =
      pending.parts
        .map((p) => p.trim())
        .filter((p) => p !== '' && !isCardMetadata(p))
        .join(' ') || 'Transaction'

    if (date == null) {
      warn(`"${description}": date ${pending.day}/${pending.month} is outside the statement period`)
      pending = null
      balance = newBalance
      closingBalance = newBalance
      continue
    }

    // Sign from the balance movement. When the delta disagrees with the stated
    // amount the line was likely mangled in extraction — keep the delta's sign
    // but flag it.
    let signed: number
    if (balance != null) {
      const delta = newBalance - balance
      if (Math.abs(Math.abs(delta) - amountCents) > 1) {
        warn(`"${description}" (${date}): amount does not match the balance movement`)
      }
      signed = delta < 0 ? -amountCents : amountCents
    } else {
      warn(`"${description}" (${date}): no running balance to infer sign; assumed a debit`)
      signed = -amountCents
    }

    transactions.push({ date, amountCents: signed, description })
    balance = newBalance
    closingBalance = newBalance
    pending = null
  }
  flushPendingAsLost()

  // Summary rows carry full dates, so they can stand in for a missing period.
  if (!periodStart || !periodEnd) {
    for (const t of transactions) {
      if (!periodStart || compareISO(t.date, periodStart) < 0) periodStart = t.date
      if (!periodEnd || compareISO(t.date, periodEnd) > 0) periodEnd = t.date
    }
  }

  return {
    periodStart,
    periodEnd,
    openingBalanceCents: openingBalance,
    closingBalanceCents: closingBalance,
    transactions,
    warnings
  }
}
