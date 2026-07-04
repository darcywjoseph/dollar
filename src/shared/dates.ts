// Date helper function..
// All dates are ISO strings (YYYY-MM-DD); month keys are YYYY-MM.

export function todayISO(): string {
  const d = new Date()
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

export function toISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

export function isValidISO(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const { y, m, d } = parseISO(iso)
  if (m < 1 || m > 12 || d < 1) return false
  return d <= daysInMonth(y, m)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

export function addDaysISO(iso: string, days: number): string {
  const { y, m, d } = parseISO(iso)
  const dt = new Date(y, m - 1, d + days)
  return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

/** Add months, clamping the day to the target month's length (Jan 31 + 1mo = Feb 28). */
export function addMonthsISO(iso: string, months: number): string {
  const { y, m, d } = parseISO(iso)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Advance a recurring rule's due date one period. */
export function advanceDate(
  iso: string,
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly'
): string {
  switch (frequency) {
    case 'weekly':
      return addDaysISO(iso, 7)
    case 'biweekly':
      return addDaysISO(iso, 14)
    case 'monthly':
      return addMonthsISO(iso, 1)
    case 'yearly':
      return addMonthsISO(iso, 12)
  }
}

// Budget months. A "month" (period key YYYY-MM) runs from
// YYYY-MM-<firstDay> inclusive to the same day of the next month exclusive.
// With firstDay = 1 this is the plain calendar month.

/** The month key a given date belongs to. */
export function monthKeyOf(iso: string, firstDay: number): string {
  const shifted = addDaysISO(iso, -(firstDay - 1))
  return shifted.slice(0, 7)
}

/** Inclusive start and exclusive end dates of a month period. */
export function monthRange(monthKey: string, firstDay: number): { start: string; end: string } {
  const start = addDaysISO(`${monthKey}-01`, firstDay - 1)
  const end = addDaysISO(`${addMonthKey(monthKey, 1)}-01`, firstDay - 1)
  return { start, end }
}

export function addMonthKey(monthKey: string, months: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`
}

export function currentMonthKey(firstDay: number): string {
  return monthKeyOf(todayISO(), firstDay)
}

/** List of month keys, e.g. lastNMonthKeys('2026-07', 3) = ['2026-04','2026-05','2026-06'] (excludes given month). */
export function lastNMonthKeys(monthKey: string, n: number): string[] {
  const out: string[] = []
  for (let i = n; i >= 1; i--) out.push(addMonthKey(monthKey, -i))
  return out
}

export function monthKeysOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

export function formatMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[m - 1]} ${y}`
}

export function formatDateDisplay(iso: string): string {
  if (!isValidISO(iso)) return iso
  const { y, m, d } = parseISO(iso)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[m - 1]} ${d}, ${y}`
}
