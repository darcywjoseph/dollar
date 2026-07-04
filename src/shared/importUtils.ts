import { isValidISO, toISO } from './dates'

export type DateConvention = 'auto' | 'mdy' | 'dmy'

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

/**
 * Parse a date string from a CSV into ISO YYYY-MM-DD.
 */
export function parseDateFlexible(raw: string, convention: DateConvention = 'auto'): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null

  // ISO-like
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})([T ].*)?$/)
  if (m) {
    const iso = toISO(Number(m[1]), Number(m[2]), Number(m[3]))
    return isValidISO(iso) ? iso : null
  }

  // Textual month
  m = s.match(/^([A-Za-z]{3,9})[ .\-/]+(\d{1,2})(?:st|nd|rd|th)?[,]?[ .\-/]+(\d{2,4})$/)
  if (m) {
    const mon =
      MONTH_NAMES[m[1].slice(0, 4).toLowerCase()] ?? MONTH_NAMES[m[1].slice(0, 3).toLowerCase()]
    if (mon) {
      const iso = toISO(expandYear(Number(m[3])), mon, Number(m[2]))
      return isValidISO(iso) ? iso : null
    }
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ .\-/]+([A-Za-z]{3,9})[,]?[ .\-/]+(\d{2,4})$/)
  if (m) {
    const mon =
      MONTH_NAMES[m[2].slice(0, 4).toLowerCase()] ?? MONTH_NAMES[m[2].slice(0, 3).toLowerCase()]
    if (mon) {
      const iso = toISO(expandYear(Number(m[3])), mon, Number(m[1]))
      return isValidISO(iso) ? iso : null
    }
  }

  // Numeric with slashes/dashes/dots
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const y = expandYear(Number(m[3]))
    let month: number, day: number
    if (convention === 'dmy') {
      day = a
      month = b
    } else if (convention === 'mdy') {
      month = a
      day = b
    } else {
      // auto: prefer MDY, but if the first component can't be a month, flip
      if (a > 12 && b <= 12) {
        day = a
        month = b
      } else {
        month = a
        day = b
      }
    }
    const iso = toISO(y, month, day)
    return isValidISO(iso) ? iso : null
  }

  return null
}

function expandYear(y: number): number {
  if (y >= 100) return y
  return y >= 70 ? 1900 + y : 2000 + y
}

/** Guess which mapped column index matches a purpose from CSV header names. */
export function guessColumn(
  headers: string[],
  purpose: 'date' | 'amount' | 'description' | 'category' | 'account'
): number {
  const patterns: Record<string, RegExp[]> = {
    date: [/^date$/i, /date/i, /posted/i, /^when$/i],
    amount: [/^amount$/i, /amount/i, /^value$/i, /debit/i, /total/i, /^sum$/i],
    description: [
      /^description$/i,
      /desc/i,
      /payee/i,
      /merchant/i,
      /memo/i,
      /narrative/i,
      /details/i,
      /^name$/i
    ],
    category: [/^category$/i, /categor/i],
    account: [/^account$/i, /account/i]
  }
  for (const re of patterns[purpose]) {
    const idx = headers.findIndex((h) => re.test(h.trim()))
    if (idx !== -1) return idx
  }
  return -1
}
