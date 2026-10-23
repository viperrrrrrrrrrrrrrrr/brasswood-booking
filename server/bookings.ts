/**
 * Booking writes. Every write that occupies time is validated with the shared availability engine
 * (src/lib/availability.ts: hours, breaks, days off, min notice, horizon) AND made atomic in SQL:
 * the INSERT/UPDATE only happens if no overlapping non-cancelled booking exists for that specialist
 * on that date (single statement => D1 executes it serially, so two concurrent requests cannot both win).
 * A partial UNIQUE index on (staff_id, date, start_min) is the last line of defence.
 */
import type { Booking, BookingStatus, ID } from '../src/lib/types'
import { getSlots, isStaffFree } from '../src/lib/availability'
import { conflict, notFound, badRequest } from './http'
import {
  BOOKING_COLS, availabilityCtx, getBookingRow, isUniqueViolation, loadCatalog, makeCode, makeId, mapBooking, normalizeCode, nowIso, shopNow, toCents,
  type BookingRow,
} from './repo'
import { EMAIL_RE, normEmail, phoneDigits } from './validate'

export interface CreateBookingInput {
  serviceId: ID
  staffId: ID | 'any'
  date: string
  start: number
  client: { name: string; phone: string; email: string }
  notes: string
}

const OVERLAP_GUARD = `NOT EXISTS (
  SELECT 1 FROM bookings o
  WHERE o.staff_id = ?1 AND o.date = ?2 AND o.status <> 'cancelled' AND o.start_min < ?4 AND o.end_min > ?3 AND o.id <> ?5
)`

/** Find-or-create the client. Public bookings never overwrite an existing client's name/phone (no email verification). */
async function upsertClient(db: D1Database, input: CreateBookingInput['client'], isAdmin: boolean): Promise<{ id: string; created: boolean }> {
  const email = normEmail(input.email)
  const digits = phoneDigits(input.phone)
  const name = input.name.trim()
  const phone = input.phone.trim()
  let existing: { id: string; name: string; phone: string; email: string } | null = null
  if (email) existing = await db.prepare('SELECT id, name, phone, email FROM clients WHERE email = ?').bind(email).first()
  if (!existing && digits) existing = await db.prepare('SELECT id, name, phone, email FROM clients WHERE phone_digits = ? ORDER BY created_at LIMIT 1').bind(digits).first()
  const now = nowIso()
  if (existing) {
    const next = isAdmin
      ? { name: name || existing.name, phone: phone || existing.phone, email: existing.email || email }
      : { name: existing.name || name, phone: existing.phone || phone, email: existing.email || email }
    if (next.name !== existing.name || next.phone !== existing.phone || next.email !== existing.email) {
      try {
        await db.prepare('UPDATE clients SET name = ?, phone = ?, phone_digits = ?, email = ?, updated_at = ? WHERE id = ?')
          .bind(next.name, next.phone, phoneDigits(next.phone), next.email, now, existing.id).run()
      } catch (e) {
        if (!isUniqueViolation(e, 'clients.email')) throw e // email already used by another client: keep the record as is
      }
    }
    return { id: existing.id, created: false }
  }
  const id = makeId('cli')
  // ON CONFLICT handles two first-time bookings with the same email racing each other.
  const row = await db
    .prepare(`INSERT INTO clients (id, name, phone, phone_digits, email, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)
              ON CONFLICT(email) WHERE email <> '' DO UPDATE SET updated_at = excluded.updated_at RETURNING id`)
    .bind(id, name, phone, digits, email, now, now)
    .first<{ id: string }>()
  return { id: row!.id, created: row!.id === id }
}

export function validateClient(c: CreateBookingInput['client'], isAdmin: boolean) {
  if (c.name.trim().length < 2) throw badRequest('Please enter the full name')
  if (c.email && !EMAIL_RE.test(c.email.trim())) throw badRequest('Please enter a valid email')
  if (!isAdmin) {
    if (phoneDigits(c.phone).length < 7) throw badRequest('Please enter a valid phone number')
    if (!EMAIL_RE.test(c.email.trim())) throw badRequest('Please enter a valid email')
  }
}

export async function createBooking(db: D1Database, input: CreateBookingInput, source: 'online' | 'admin'): Promise<Booking> {
  const isAdmin = source === 'admin'
  validateClient(input.client, isAdmin)
  const catalog = await loadCatalog(db)
  const service = catalog.services.find((s) => s.id === input.serviceId)
  if (!service || (!isAdmin && !service.active)) throw notFound('Service not found')
  if (input.staffId !== 'any' && !catalog.staff.some((s) => s.id === input.staffId)) throw notFound('Specialist not found')
  const ctx = await availabilityCtx(db, input.date, input.date, catalog)
  const slot = getSlots(ctx, { serviceId: service.id, staffId: input.staffId, date: input.date, ignoreRules: isAdmin }).find((s) => s.start === input.start)
  if (!slot) throw conflict()

  // "Any available": least-loaded specialist first, falling back to the others if someone grabs the slot meanwhile.
  const load = (sid: ID) => ctx.bookings.filter((b) => b.staffId === sid).reduce((sum, b) => sum + (b.end - b.start), 0)
  const candidates = input.staffId === 'any' ? [...slot.staffIds].sort((a, b) => load(a) - load(b)) : [input.staffId]

  const client = await upsertClient(db, input.client, isAdmin)
  const end = input.start + service.durationMin
  const now = nowIso()
  for (const staffId of candidates) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = makeId('bk')
      const code = makeCode()
      try {
        const res = await db
          .prepare(
            `INSERT INTO bookings (id, code, service_id, staff_id, client_id, date, start_min, end_min, status, price_cents, notes, source, created_at, updated_at)
             SELECT ?5, ?6, ?7, ?1, ?8, ?2, ?3, ?4, 'confirmed', ?9, ?10, ?11, ?12, ?12
             WHERE ${OVERLAP_GUARD}`,
          )
          .bind(staffId, input.date, input.start, end, id, code, service.id, client.id, toCents(service.priceUsd), input.notes, source, now)
          .run()
        if (res.meta.changes === 1) return mapBooking(await getBookingRow(db, id))
        break // overlap: try the next candidate
      } catch (e) {
        if (isUniqueViolation(e, 'bookings.code')) continue // astronomically rare: new code
        if (isUniqueViolation(e, 'bookings.staff_id')) break // backstop index fired
        throw e
      }
    }
  }
  if (client.created) {
    await db.prepare('DELETE FROM clients WHERE id = ? AND NOT EXISTS (SELECT 1 FROM bookings WHERE client_id = ?)').bind(client.id, client.id).run()
  }
  throw conflict()
}

export async function rescheduleBooking(db: D1Database, id: ID, input: { date: string; start: number; staffId: ID }): Promise<Booking> {
  const row = await getBookingRow(db, id)
  const duration = row.end_min - row.start_min
  const end = input.start + duration
  if (end > 1440) throw badRequest('Booking would end after midnight')
  const ctx = await availabilityCtx(db, input.date, input.date)
  if (!isStaffFree(ctx, input.staffId, input.date, input.start, end, id)) throw conflict('The specialist is not available at that time.')
  try {
    const res = await db
      .prepare(
        `UPDATE bookings SET date = ?2, start_min = ?3, end_min = ?4, staff_id = ?1,
           status = CASE WHEN status IN ('cancelled','no-show') THEN 'confirmed' ELSE status END, updated_at = ?6
         WHERE id = ?5 AND ${OVERLAP_GUARD}`,
      )
      .bind(input.staffId, input.date, input.start, end, id, nowIso())
      .run()
    if (res.meta.changes !== 1) throw conflict('The specialist is not available at that time.')
  } catch (e) {
    if (isUniqueViolation(e, 'bookings.staff_id')) throw conflict('The specialist is not available at that time.')
    throw e
  }
  return mapBooking(await getBookingRow(db, id))
}

export async function setBookingStatus(db: D1Database, id: ID, status: BookingStatus): Promise<Booking> {
  const row = await getBookingRow(db, id)
  const restoring = row.status === 'cancelled' && status !== 'cancelled'
  const msg = 'This slot has been re-booked since the cancellation, so it cannot be restored. Reschedule instead.'
  if (restoring) {
    const ctx = await availabilityCtx(db, row.date, row.date)
    if (!isStaffFree(ctx, row.staff_id, row.date, row.start_min, row.end_min, id)) throw conflict(msg)
  }
  try {
    const res = await db
      .prepare(`UPDATE bookings SET status = ?6, updated_at = ?7 WHERE id = ?5 AND (?8 = 0 OR ${OVERLAP_GUARD})`)
      .bind(row.staff_id, row.date, row.start_min, row.end_min, id, status, nowIso(), restoring ? 1 : 0)
      .run()
    if (res.meta.changes !== 1) throw conflict(msg)
  } catch (e) {
    if (isUniqueViolation(e, 'bookings.staff_id')) throw conflict(msg)
    throw e
  }
  return mapBooking(await getBookingRow(db, id))
}

/** What a client holding the code may see: their own booking, without internal ids of other records. */
export const publicBooking = (b: Booking): Booking => ({ ...b, clientId: '' })

export async function findByCode(db: D1Database, code: string): Promise<Booking | null> {
  const norm = normalizeCode(code)
  if (!norm) return null
  const row = await db.prepare(`SELECT ${BOOKING_COLS} FROM bookings WHERE code = ?`).bind(norm).first<BookingRow>()
  return row ? mapBooking(row) : null
}

export async function cancelByCode(db: D1Database, code: string): Promise<Booking> {
  const b = await findByCode(db, code)
  if (!b) throw notFound('No booking with that code')
  if (b.status !== 'confirmed') throw conflict(`This booking is already ${b.status}.`)
  const settings = await db.prepare('SELECT timezone FROM settings WHERE id = 1').first<{ timezone: string }>()
  const now = shopNow(settings?.timezone)
  if (b.date < now.date || (b.date === now.date && b.start <= now.minutes)) throw conflict('Past appointments can’t be cancelled online.')
  const res = await db.prepare("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'confirmed'").bind(nowIso(), b.id).run()
  if (res.meta.changes !== 1) throw conflict('This booking was changed meanwhile. Please reload.')
  return mapBooking(await getBookingRow(db, b.id))
}
