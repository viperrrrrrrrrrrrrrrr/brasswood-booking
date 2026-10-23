import type { DateStr } from './types'
import { shopNow } from './shopTime'

// Calendar dates are plain "YYYY-MM-DD" strings in the SHOP's timezone. Date arithmetic below uses UTC math so it
// gives the same answer in every browser timezone (no DST surprises); "today"/"now" come from the shop clock.

export const pad = (n: number) => String(n).padStart(2, '0')

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDate(s: DateStr): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function utcDate(s: DateStr): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const utcDateStr = (d: Date): DateStr => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

/** Today's date in the shop timezone (not the browser's). */
export function todayStr(): DateStr {
  return shopNow().date
}

export function addDays(s: DateStr, n: number): DateStr {
  const d = utcDate(s)
  d.setUTCDate(d.getUTCDate() + n)
  return utcDateStr(d)
}

export function dayOfWeek(s: DateStr): number {
  return utcDate(s).getUTCDay()
}

/** Monday-based start of week */
export function startOfWeek(s: DateStr): DateStr {
  const dow = dayOfWeek(s)
  return addDays(s, dow === 0 ? -6 : 1 - dow)
}

/** Current minute-of-day in the shop timezone (not the browser's). */
export function nowMinutes(): number {
  return shopNow().minutes
}

export function fmtTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(m)} ${ampm}`
}

export function fmtTime24(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
}

export function parseTime24(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function fmtDate(s: DateStr, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return utcDate(s).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}

export function fmtDateLong(s: DateStr): string {
  return fmtDate(s, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

export const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
