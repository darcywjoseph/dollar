// Money helpers functions. Note all amounts are stored as integer cents.

/** Format cents as a currency string, e.g. 123456 -> "$1,234.56", -500 -> "-$5.00". */
export function formatCents(cents: number, symbol = '$', opts?: { sign?: boolean }): string {
  const neg = cents < 0
  const abs = Math.abs(Math.round(cents))
  const dollars = Math.floor(abs / 100)
  const rem = String(abs % 100).padStart(2, '0')
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = neg ? '-' : opts?.sign ? '+' : ''
  return `${sign}${symbol}${withCommas}.${rem}`
}

/** Format cents without decimals when whole dollars, used for compact chart labels. */
export function formatCentsCompact(cents: number, symbol = '$'): string {
  const abs = Math.abs(cents)
  if (abs >= 100000000) return `${cents < 0 ? '-' : ''}${symbol}${(abs / 100000000).toFixed(1)}M`
  if (abs >= 100000) return `${cents < 0 ? '-' : ''}${symbol}${Math.round(abs / 10000) / 10}k`
  return formatCents(cents, symbol)
}

/**
 * Parse a human-entered amount into cents. Returns null when unparseable.
 * Handles: "$1,234.56", "(12.34)" (negative), "-5", "1.234,56" (decimal comma),
 * leading/trailing junk like currency codes.
 */
export function parseAmountToCents(input: string): number | null {
  if (input == null) return null
  let s = String(input).trim()
  if (s === '') return null

  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/^-/.test(s)) {
    negative = true
    s = s.slice(1)
  }
  if (/-$/.test(s)) {
    negative = true
    s = s.slice(0, -1)
  }
  // strip currency symbols, letters, spaces
  s = s.replace(/[^0-9.,]/g, '')
  if (s === '') return null

  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')

  if (lastComma > lastDot) {
    // decimal comma convention: "1.234,56"
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    // decimal dot convention: "1,234.56"
    s = s.replace(/,/g, '')
  }

  const value = Number(s)
  if (!isFinite(value)) return null
  const cents = Math.round(value * 100)
  return negative ? -cents : cents
}
