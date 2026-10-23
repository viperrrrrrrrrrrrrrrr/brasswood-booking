/**
 * "Now" in the shop's timezone — shared by the browser (all pages, demo mode) and the server (Pages Functions).
 * All booking dates/minutes are shop-local wall-clock values, so "today", "past", slot cut-offs and cancel
 * eligibility must never use the browser's (or the Worker's UTC) local time.
 */
import type { DateStr } from './types'

export const DEFAULT_SHOP_TZ = 'America/New_York'

export interface ShopNow { date: DateStr; minutes: number }

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    formatters.set(timeZone, f)
  }
  return f
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try { formatter(tz); return true } catch { return false }
}

let current = DEFAULT_SHOP_TZ
/** Called whenever settings are loaded (both data sources). Invalid / empty values keep the previous zone. */
export function setShopTimeZone(tz?: string | null) {
  if (isValidTimeZone(tz)) current = tz
}
export const getShopTimeZone = () => current

/** Current date and minute-of-day in the shop's timezone. */
export function shopNow(timeZone: string | null | undefined = current, at: Date = new Date()): ShopNow {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_SHOP_TZ
  const parts = formatter(tz).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) }
}

/** True when the appointment start (shop-local date + minute) is at or before "now" in the shop. */
export function isPastStart(b: { date: DateStr; start: number }, now: ShopNow): boolean {
  return b.date < now.date || (b.date === now.date && b.start <= now.minutes)
}

/** Online self-service cancellation: only confirmed bookings whose start is still in the future (shop time). */
export function canCancelOnline(b: { status: string; date: DateStr; start: number }, now: ShopNow): boolean {
  return b.status === 'confirmed' && !isPastStart(b, now)
}

/**
 * Shop-local wall-clock time -> UTC instant (used for .ics export). Ambiguous times (DST fall-back) resolve to the
 * first occurrence; non-existent times (spring-forward gap) are shifted forward by the gap, like most calendars do.
 */
export function shopTimeToUtc(date: DateStr, minutes: number, timeZone: string = current): Date {
  const [y, m, d] = date.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d, 0, minutes)
  const offsetAt = (t: number) => {
    const n = shopNow(timeZone, new Date(t))
    const [yy, mm, dd] = n.date.split('-').map(Number)
    return Date.UTC(yy, mm - 1, dd, 0, n.minutes) - t // local - utc, in ms (minute precision)
  }
  // Try the offsets in effect a day before/after (covers both sides of a transition), keep the earliest exact match.
  const candidates = [offsetAt(wall - 86_400_000), offsetAt(wall), offsetAt(wall + 86_400_000)]
  const exact = candidates.map((o) => wall - o).filter((t) => offsetAt(t) === wall - t).sort((a, b) => a - b)
  if (exact.length) return new Date(exact[0])
  return new Date(wall - Math.min(...candidates)) // gap: use the pre-transition (larger negative) offset → shifted forward
}

/** "New York" for America/New_York — used in the "times are shop time" hint. */
export function shopTimeZoneCity(tz: string = current): string {
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ')
}

/** True when the visitor's device is in a different zone than the shop (show the "shop time" hint). */
export function browserDiffersFromShop(tz: string = current): boolean {
  try {
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone
    const at = new Date()
    return mine !== tz && shopNow(mine, at).minutes !== shopNow(tz, at).minutes
  } catch {
    return false
  }
}
