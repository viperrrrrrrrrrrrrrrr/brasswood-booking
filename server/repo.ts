/** Row <-> domain mapping and read helpers for D1. */
import type { Booking, BookingStatus, BusinessSettings, Client, DateStr, Service, StaffMember, TimeOff, WeeklyHours } from '../src/lib/types'
import type { AvailabilityContext } from '../src/lib/availability'
import { notFound } from './http'
import { shopNow } from '../src/lib/shopTime'
import { serverNow } from './clock'

export interface ServiceRow { id: string; name: string; description: string; category: string; duration_min: number; price_cents: number; active: number }
export interface StaffRow { id: string; name: string; role: string; bio: string; color: string; active: number }
export interface HoursRow { staff_id: string; weekday: number; start_min: number; end_min: number; break_start_min: number | null; break_end_min: number | null }
export interface TimeOffRow { id: string; staff_id: string | null; date: string; note: string }
export interface ClientRow { id: string; name: string; phone: string; email: string; notes: string; created_at: string }
export interface BookingRow {
  id: string; code: string; service_id: string; staff_id: string; client_id: string; date: string; start_min: number; end_min: number
  status: BookingStatus; price_cents: number; notes: string; source: 'online' | 'admin'; created_at: string
}
export interface SettingsRow {
  name: string; tagline: string; address: string; phone: string; email: string
  slot_step_min: number; min_notice_min: number; horizon_days: number; timezone: string
}

export const toCents = (usd: number) => Math.round(usd * 100)
export const fromCents = (c: number) => c / 100

export const mapService = (r: ServiceRow): Service => ({
  id: r.id, name: r.name, description: r.description, category: r.category, durationMin: r.duration_min, priceUsd: fromCents(r.price_cents), active: !!r.active,
})
export const mapTimeOff = (r: TimeOffRow): TimeOff => ({ id: r.id, staffId: r.staff_id, date: r.date, note: r.note })
export const mapClient = (r: ClientRow): Client => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, notes: r.notes, createdAt: r.created_at })
export const mapBooking = (r: BookingRow): Booking => ({
  id: r.id, code: r.code, serviceId: r.service_id, staffId: r.staff_id, clientId: r.client_id, date: r.date, start: r.start_min, end: r.end_min,
  status: r.status, priceUsd: fromCents(r.price_cents), notes: r.notes, source: r.source, createdAt: r.created_at,
})
export const mapSettings = (r: SettingsRow): BusinessSettings => ({
  name: r.name, tagline: r.tagline, address: r.address, phone: r.phone, email: r.email,
  slotStepMin: r.slot_step_min, minNoticeMin: r.min_notice_min, horizonDays: r.horizon_days, timezone: r.timezone,
})

export function buildStaff(rows: StaffRow[], links: { staff_id: string; service_id: string }[], hours: HoursRow[]): StaffMember[] {
  return rows.map((r) => {
    const week: WeeklyHours = Array.from({ length: 7 }, () => null)
    for (const h of hours) {
      if (h.staff_id === r.id) week[h.weekday] = { start: h.start_min, end: h.end_min, breakStart: h.break_start_min, breakEnd: h.break_end_min }
    }
    return {
      id: r.id, name: r.name, role: r.role, bio: r.bio, color: r.color, active: !!r.active, hours: week,
      serviceIds: links.filter((l) => l.staff_id === r.id).map((l) => l.service_id),
    }
  })
}

export const BOOKING_COLS = 'id, code, service_id, staff_id, client_id, date, start_min, end_min, status, price_cents, notes, source, created_at'

export interface Catalog { services: Service[]; staff: StaffMember[]; timeOff: TimeOff[]; settings: BusinessSettings }

/** Everything except bookings and clients — none of it is personal data. */
export async function loadCatalog(db: D1Database): Promise<Catalog> {
  const [svc, stf, links, hours, off, set] = await db.batch([
    db.prepare('SELECT * FROM services WHERE deleted_at IS NULL ORDER BY sort_order, created_at, id'),
    db.prepare('SELECT * FROM staff WHERE deleted_at IS NULL ORDER BY sort_order, created_at, id'),
    db.prepare('SELECT staff_id, service_id FROM staff_services'),
    db.prepare('SELECT * FROM staff_hours'),
    db.prepare('SELECT * FROM time_off ORDER BY date'),
    db.prepare('SELECT * FROM settings WHERE id = 1'),
  ])
  const settingsRow = (set.results as unknown as SettingsRow[])[0]
  if (!settingsRow) throw new Error('settings row missing — run the seed (npm run db:seed:local)')
  return {
    services: (svc.results as unknown as ServiceRow[]).map(mapService),
    staff: buildStaff(stf.results as unknown as StaffRow[], links.results as unknown as { staff_id: string; service_id: string }[], hours.results as unknown as HoursRow[]),
    timeOff: (off.results as unknown as TimeOffRow[]).map(mapTimeOff),
    settings: mapSettings(settingsRow),
  }
}

/**
 * Non-cancelled bookings in [from,to] reduced to what the availability engine needs.
 * No client ids, names or notes — safe to use on public endpoints.
 */
export async function loadBlocking(db: D1Database, from: DateStr, to: DateStr): Promise<Booking[]> {
  const { results } = await db
    .prepare("SELECT id, staff_id, date, start_min, end_min, status FROM bookings WHERE date BETWEEN ? AND ? AND status <> 'cancelled'")
    .bind(from, to)
    .all<Pick<BookingRow, 'id' | 'staff_id' | 'date' | 'start_min' | 'end_min' | 'status'>>()
  return results.map((r) => ({
    id: r.id, staffId: r.staff_id, date: r.date, start: r.start_min, end: r.end_min, status: r.status,
    code: '', serviceId: '', clientId: '', priceUsd: 0, notes: '', source: 'online', createdAt: '',
  }))
}

export { shopNow } from '../src/lib/shopTime'

export async function availabilityCtx(db: D1Database, from: DateStr, to: DateStr, catalog?: Catalog): Promise<AvailabilityContext> {
  const cat = catalog ?? (await loadCatalog(db))
  return { ...cat, bookings: await loadBlocking(db, from, to), now: shopNow(cat.settings.timezone, serverNow()) }
}

export async function getBookingRow(db: D1Database, id: string): Promise<BookingRow> {
  const row = await db.prepare(`SELECT ${BOOKING_COLS} FROM bookings WHERE id = ?`).bind(id).first<BookingRow>()
  if (!row) throw notFound('Booking not found')
  return row
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomString(len: number, alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  // 256 % 32 === 0 and 256 % 36 is close enough for ids; codes use the 32-char alphabet (no bias).
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}
export const makeCode = () => `BW-${randomString(6, CODE_ALPHABET)}`
export const makeId = (prefix: string) => `${prefix}_${randomString(12, 'abcdefghijklmnopqrstuvwxyz0123456789')}`
export const nowIso = () => new Date().toISOString()

/** 'bw-abc123', 'ABC123', ' BW-ABC123 ' -> 'BW-ABC123' (or null if malformed). */
export function normalizeCode(code: string): string | null {
  const norm = code.trim().toUpperCase().replace(/^BW-?/, '')
  return /^[A-Z0-9]{6}$/.test(norm) ? `BW-${norm}` : null
}

export const isUniqueViolation = (e: unknown, what: string) => e instanceof Error && e.message.includes('UNIQUE constraint failed') && e.message.includes(what)
