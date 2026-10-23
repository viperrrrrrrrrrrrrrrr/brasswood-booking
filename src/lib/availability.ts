import type { Booking, BusinessSettings, DateStr, ID, Service, Slot, StaffMember, TimeOff } from './types'
import { dayOfWeek, nowMinutes, todayStr, addDays } from './date'

export interface AvailabilityContext {
  services: Service[]
  staff: StaffMember[]
  bookings: Booking[]
  timeOff: TimeOff[]
  settings: BusinessSettings
  /**
   * "Now" in the shop's timezone (shopNow(settings.timezone)). Both the server and the demo data source pass it;
   * the fallback (todayStr/nowMinutes) is also shop time, never the device's local time.
   */
  now?: { date: DateStr; minutes: number }
}

export interface AvailabilityQuery {
  serviceId: ID
  staffId: ID | 'any'
  date: DateStr
  /** ignore this booking when checking conflicts (used for rescheduling) */
  excludeBookingId?: ID
  /** admins may book outside notice / horizon rules and in the past */
  ignoreRules?: boolean
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

export function blockingBookings(bookings: Booking[], staffId: ID, date: DateStr, excludeId?: ID) {
  return bookings.filter(
    (b) => b.staffId === staffId && b.date === date && b.status !== 'cancelled' && b.id !== excludeId,
  )
}

/** Is a given staff member free for [start,end) on date? Checks hours, breaks, time off and bookings. */
export function isStaffFree(ctx: AvailabilityContext, staffId: ID, date: DateStr, start: number, end: number, excludeBookingId?: ID): boolean {
  const member = ctx.staff.find((s) => s.id === staffId)
  if (!member || !member.active) return false
  if (ctx.timeOff.some((t) => t.date === date && (t.staffId === null || t.staffId === staffId))) return false
  const hours = member.hours[dayOfWeek(date)]
  if (!hours) return false
  if (start < hours.start || end > hours.end) return false
  if (hours.breakStart != null && hours.breakEnd != null && overlaps(start, end, hours.breakStart, hours.breakEnd)) return false
  return !blockingBookings(ctx.bookings, staffId, date, excludeBookingId).some((b) => overlaps(start, end, b.start, b.end))
}

export function eligibleStaff(ctx: AvailabilityContext, serviceId: ID): StaffMember[] {
  return ctx.staff.filter((s) => s.active && s.serviceIds.includes(serviceId))
}

export function getSlots(ctx: AvailabilityContext, q: AvailabilityQuery): Slot[] {
  const service = ctx.services.find((s) => s.id === q.serviceId)
  if (!service) return []
  const today = ctx.now?.date ?? todayStr()
  if (!q.ignoreRules) {
    if (q.date < today) return []
    if (q.date > addDays(today, ctx.settings.horizonDays)) return []
  }
  const candidates = q.staffId === 'any' ? eligibleStaff(ctx, q.serviceId) : eligibleStaff(ctx, q.serviceId).filter((s) => s.id === q.staffId)
  const step = ctx.settings.slotStepMin
  const earliest = !q.ignoreRules && q.date === today ? (ctx.now?.minutes ?? nowMinutes()) + ctx.settings.minNoticeMin : -1
  const map = new Map<number, ID[]>()
  for (const member of candidates) {
    const hours = member.hours[dayOfWeek(q.date)]
    if (!hours) continue
    for (let t = hours.start; t + service.durationMin <= hours.end; t += step) {
      if (t < earliest) continue
      if (isStaffFree(ctx, member.id, q.date, t, t + service.durationMin, q.excludeBookingId)) {
        const arr = map.get(t) ?? []
        arr.push(member.id)
        map.set(t, arr)
      }
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, staffIds]) => ({ start, end: start + service.durationMin, staffIds }))
}

/** When the client chooses "any specialist", pick the one with the lightest load that day. */
export function pickStaff(ctx: AvailabilityContext, staffIds: ID[], date: DateStr): ID {
  const load = (id: ID) =>
    ctx.bookings.filter((b) => b.staffId === id && b.date === date && b.status !== 'cancelled').reduce((sum, b) => sum + (b.end - b.start), 0)
  return [...staffIds].sort((a, b) => load(a) - load(b))[0]
}

export type NextAvailable = Record<string, { date: DateStr; start: number } | null>

/** First free slot per specialist id (or 'any') within the booking horizon. Returns no personal data. */
export function nextAvailable(ctx: AvailabilityContext, serviceId: ID, staffIds: (ID | 'any')[]): NextAvailable {
  const today = ctx.now?.date ?? todayStr()
  const out: NextAvailable = {}
  for (const id of staffIds) {
    out[id] = null
    for (let i = 0; i <= ctx.settings.horizonDays; i++) {
      const d = addDays(today, i)
      const slots = getSlots(ctx, { serviceId, staffId: id, date: d })
      if (slots.length) { out[id] = { date: d, start: slots[0].start }; break }
    }
  }
  return out
}

/** Dates in [from,to] that have at least one free slot. */
export function openDates(ctx: AvailabilityContext, serviceId: ID, staffId: ID | 'any', from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (getSlots(ctx, { serviceId, staffId, date: d }).length) out.push(d)
  }
  return out
}
