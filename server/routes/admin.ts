/** Admin API under /api/admin/* — the admin middleware guarantees a valid session before these run. */
import type { BookingStatus, DayHours, WeeklyHours } from '../../src/lib/types'
import { Router, noContent, type RouteCtx } from '../router'
import { badRequest, conflict, json, notFound, readJson } from '../http'
import {
  BOOKING_COLS, fromCents, getBookingRow, loadCatalog, makeId, mapBooking, mapClient, mapTimeOff, nowIso, shopNow, toCents,
  type BookingRow, type ClientRow, type TimeOffRow,
} from '../repo'
import { createBooking, rescheduleBooking, setBookingStatus } from '../bookings'
import { serverNow } from '../clock'
import { batchVersioned, readVersions, runVersioned } from '../versions'
import { EMAIL_RE, bool, date, id as vId, idList, int, isDate, normEmail, num, obj, phoneDigits, str } from '../validate'

type Obj = Record<string, unknown>
const STATUSES: BookingStatus[] = ['confirmed', 'completed', 'no-show', 'cancelled']
const HEX = /^#[0-9a-fA-F]{6}$/

async function shopToday(db: D1Database) {
  const s = await db.prepare('SELECT timezone FROM settings WHERE id = 1').first<{ timezone: string }>()
  return shopNow(s?.timezone, serverNow()).date
}

// ---------- services ----------
function serviceFields(b: Obj, partial: boolean) {
  const f = {
    name: str(b, 'name', { required: !partial, max: 120 }),
    description: str(b, 'description', { max: 2000 }),
    category: str(b, 'category', { max: 60 }),
    durationMin: int(b, 'durationMin', { required: !partial, min: 5, max: 720 }),
    priceUsd: num(b, 'priceUsd', { required: !partial, min: 0, max: 100000 }),
    active: bool(b, 'active'),
  }
  if (f.name !== undefined && !f.name) throw badRequest('name is required')
  return f
}

async function getService(db: D1Database, id: string) {
  const s = (await loadCatalog(db)).services.find((x) => x.id === id)
  if (!s) throw notFound('Service not found')
  return s
}

// ---------- staff ----------
function parseHours(v: unknown): WeeklyHours {
  if (!Array.isArray(v) || v.length !== 7) throw badRequest('hours must be a list of 7 days (Sunday first)')
  return v.map((d, i): DayHours | null => {
    if (d === null) return null
    const o = obj(d, `hours[${i}]`)
    const start = int(o, 'start', { required: true, min: 0, max: 1440 })!
    const end = int(o, 'end', { required: true, min: 0, max: 1440 })!
    const breakStart = int(o, 'breakStart', { min: 0, max: 1440 }) ?? null
    const breakEnd = int(o, 'breakEnd', { min: 0, max: 1440 }) ?? null
    if (end <= start) throw badRequest(`hours[${i}]: closing time must be after opening time`)
    if ((breakStart === null) !== (breakEnd === null)) throw badRequest(`hours[${i}]: break needs both start and end`)
    if (breakStart !== null && breakEnd !== null && (breakEnd <= breakStart || breakStart < start || breakEnd > end)) throw badRequest(`hours[${i}]: break must be inside working hours`)
    return { start, end, breakStart, breakEnd }
  })
}

function staffFields(b: Obj, partial: boolean) {
  const color = str(b, 'color', { max: 7 })
  if (color !== undefined && !HEX.test(color)) throw badRequest('color must be like #aabbcc')
  const f = {
    name: str(b, 'name', { required: !partial, max: 120 }),
    role: str(b, 'role', { max: 120 }),
    bio: str(b, 'bio', { max: 2000 }),
    color,
    active: bool(b, 'active'),
    serviceIds: idList(b, 'serviceIds'),
    hours: b.hours === undefined ? undefined : parseHours(b.hours),
  }
  if (f.name !== undefined && !f.name) throw badRequest('name is required')
  return f
}

function staffChildStatements(db: D1Database, staffId: string, f: ReturnType<typeof staffFields>, validServiceIds: Set<string>): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = []
  if (f.serviceIds) {
    const bad = f.serviceIds.find((s) => !validServiceIds.has(s))
    if (bad) throw badRequest(`Unknown service ${bad}`)
    out.push(db.prepare('DELETE FROM staff_services WHERE staff_id = ?').bind(staffId))
    for (const s of f.serviceIds) out.push(db.prepare('INSERT INTO staff_services (staff_id, service_id) VALUES (?, ?)').bind(staffId, s))
  }
  if (f.hours) {
    out.push(db.prepare('DELETE FROM staff_hours WHERE staff_id = ?').bind(staffId))
    f.hours.forEach((h, wd) => {
      if (h) out.push(db.prepare('INSERT INTO staff_hours (staff_id, weekday, start_min, end_min, break_start_min, break_end_min) VALUES (?, ?, ?, ?, ?, ?)').bind(staffId, wd, h.start, h.end, h.breakStart ?? null, h.breakEnd ?? null))
    })
  }
  return out
}

async function getStaff(db: D1Database, id: string) {
  const s = (await loadCatalog(db)).staff.find((x) => x.id === id)
  if (!s) throw notFound('Specialist not found')
  return s
}

/** Shared delete policy: refuse with upcoming bookings, soft-delete with history, hard-delete otherwise. */
async function removeWithHistory(db: D1Database, table: 'services' | 'staff', column: 'service_id' | 'staff_id', id: string) {
  const exists = await db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND deleted_at IS NULL`).bind(id).first()
  if (!exists) throw notFound()
  const today = await shopToday(db)
  const counts = await db
    .prepare(`SELECT SUM(CASE WHEN status = 'confirmed' AND date >= ? THEN 1 ELSE 0 END) AS upcoming, COUNT(*) AS total FROM bookings WHERE ${column} = ?`)
    .bind(today, id)
    .first<{ upcoming: number | null; total: number }>()
  if ((counts?.upcoming ?? 0) > 0) throw conflict(`There are ${counts!.upcoming} upcoming booking(s). Deactivate instead, or reschedule/cancel them first.`)
  if ((counts?.total ?? 0) > 0) {
    await batchVersioned(db, [
      db.prepare(`UPDATE ${table} SET deleted_at = ?, active = 0 WHERE id = ?`).bind(nowIso(), id),
      db.prepare(`DELETE FROM staff_services WHERE ${column} = ?`).bind(id),
      ...(table === 'staff' ? [db.prepare('DELETE FROM time_off WHERE staff_id = ?').bind(id)] : []),
    ], 'catalog')
  } else {
    await runVersioned(db, db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id), 'catalog')
  }
}

// ---------- bookings ----------
async function listBookings(c: RouteCtx) {
  const p = c.url.searchParams
  const where: string[] = []
  const args: unknown[] = []
  const from = p.get('from'), to = p.get('to'), staffId = p.get('staffId'), clientId = p.get('clientId'), status = p.get('status')
  if (from) { if (!isDate(from)) throw badRequest('from must be a date'); where.push('date >= ?'); args.push(from) }
  if (to) { if (!isDate(to)) throw badRequest('to must be a date'); where.push('date <= ?'); args.push(to) }
  if (staffId) { where.push('staff_id = ?'); args.push(vId(staffId, 'staffId')) }
  if (clientId) { where.push('client_id = ?'); args.push(vId(clientId, 'clientId')) }
  if (status) {
    const list = status.split(',').filter(Boolean)
    if (!list.every((s) => STATUSES.includes(s as BookingStatus))) throw badRequest('Unknown status')
    where.push(`status IN (${list.map(() => '?').join(',')})`)
    args.push(...list)
  }
  const withClient = p.get('withClient') === '1'
  const limit = p.get('limit') ? Math.min(Math.max(Number(p.get('limit')) || 0, 1), 5000) : 0
  const cols = withClient ? `${BOOKING_COLS.split(', ').map((col) => 'b.' + col).join(', ')}, c.name AS client_name, c.phone AS client_phone` : BOOKING_COLS
  const sql = `SELECT ${cols} FROM bookings ${withClient ? 'b LEFT JOIN clients c ON c.id = b.client_id' : ''}
    ${where.length ? 'WHERE ' + where.map((w) => (withClient ? 'b.' + w : w)).join(' AND ') : ''} ORDER BY ${withClient ? 'b.date, b.start_min' : 'date, start_min'}${limit ? ' LIMIT ' + limit : ''}`
  const { results } = await c.env.DB.prepare(sql).bind(...args).all<BookingRow & { client_name?: string | null; client_phone?: string | null }>()
  return results.map((r) => (withClient ? { ...mapBooking(r), clientName: r.client_name ?? '', clientPhone: r.client_phone ?? '' } : mapBooking(r)))
}

// ---------- clients (search + paginated summary) ----------
const CLIENT_COLS = 'id, name, phone, email, notes, created_at'
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (ch) => '\\' + ch)

/** WHERE fragment for the client search box: name/email contains, or phone digits contain (3+ digits). */
function clientFilter(qRaw: string | null, alias = '') {
  const qs = (qRaw ?? '').trim().toLowerCase().slice(0, 100)
  if (!qs) return { sql: '', args: [] as unknown[] }
  const digits = qs.replace(/\D/g, '')
  const like = `%${likeEscape(qs)}%`
  const a = alias ? alias + '.' : ''
  return {
    sql: `(${a}name LIKE ? ESCAPE '\\' OR ${a}email LIKE ? ESCAPE '\\'${digits.length >= 3 ? ` OR ${a}phone_digits LIKE ?` : ''})`,
    args: [like, like, ...(digits.length >= 3 ? [`%${digits}%`] : [])],
  }
}

interface AggRow { client_id: string; visits: number; spent_cents: number; no_shows: number; last_date: string | null; next_key: string | null; total: number }
const AGG_COLS = `client_id,
  SUM(status = 'completed') AS visits,
  SUM(CASE WHEN status = 'completed' THEN price_cents ELSE 0 END) AS spent_cents,
  SUM(status = 'no-show') AS no_shows,
  MAX(CASE WHEN status = 'completed' THEN date END) AS last_date,
  MIN(CASE WHEN status = 'confirmed' AND date >= ? THEN date || printf('%05d', start_min) END) AS next_key,
  COUNT(*) AS total`

function summaryRow(c: ClientRow, a?: Partial<AggRow> | null) {
  return {
    client: mapClient(c),
    visits: a?.visits ?? 0,
    spent: fromCents(a?.spent_cents ?? 0),
    noShows: a?.no_shows ?? 0,
    ...(a?.last_date ? { last: a.last_date } : {}),
    ...(a?.next_key ? { next: { date: a.next_key.slice(0, 10), start: Number(a.next_key.slice(10)) } } : {}),
    total: a?.total ?? 0,
  }
}

/**
 * GET /clients/summary?q=&sort=name|spent|last&limit=50&offset=0 → { total, rows }.
 * A–Z walks the clients_name index and aggregates only the page's clients (bookings_client_date index);
 * spend/recent need the aggregate over all bookings once per refresh (only refetched when data changed).
 */
async function clientSummary(c: RouteCtx) {
  const p = c.url.searchParams
  const db = c.env.DB
  const sort = (['name', 'spent', 'last'] as const).find((s) => s === p.get('sort')) ?? 'last'
  const limit = Math.min(Math.max(Number(p.get('limit') ?? 50) || 50, 1), 200)
  const offset = Math.max(Number(p.get('offset') ?? 0) || 0, 0)
  const today = await shopToday(db)
  const f = clientFilter(p.get('q'))
  const where = f.sql ? `WHERE ${f.sql}` : ''
  const countStmt = db.prepare(`SELECT count(*) AS n FROM clients ${where}`).bind(...f.args)
  if (sort === 'name') {
    const [count, page] = await db.batch<{ n: number } | ClientRow>([
      countStmt,
      db.prepare(`SELECT ${CLIENT_COLS} FROM clients ${where} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`).bind(...f.args, limit, offset),
    ])
    const rows = page.results as ClientRow[]
    const aggs = rows.length
      ? (await db.prepare(`SELECT ${AGG_COLS} FROM bookings WHERE client_id IN (${rows.map(() => '?').join(',')}) GROUP BY client_id`).bind(today, ...rows.map((r) => r.id)).all<AggRow>()).results
      : []
    const byId = new Map(aggs.map((a) => [a.client_id, a]))
    return { total: (count.results[0] as { n: number }).n, rows: rows.map((r) => summaryRow(r, byId.get(r.id))) }
  }
  const order = sort === 'spent' ? 'COALESCE(a.spent_cents, 0) DESC, c.name COLLATE NOCASE' : "COALESCE(substr(a.next_key, 1, 10), a.last_date, '') DESC, c.name COLLATE NOCASE"
  const fa = clientFilter(p.get('q'), 'c')
  const [count, page] = await db.batch<{ n: number } | (ClientRow & AggRow)>([
    countStmt,
    db.prepare(`WITH a AS (SELECT ${AGG_COLS} FROM bookings GROUP BY client_id)
      SELECT c.id, c.name, c.phone, c.email, c.notes, c.created_at, a.visits, a.spent_cents, a.no_shows, a.last_date, a.next_key, a.total
      FROM clients c LEFT JOIN a ON a.client_id = c.id ${fa.sql ? 'WHERE ' + fa.sql : ''} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(today, ...fa.args, limit, offset),
  ])
  return { total: (count.results[0] as { n: number }).n, rows: (page.results as (ClientRow & AggRow)[]).map((r) => summaryRow(r, r)) }
}

export const adminRouter = new Router()
  /** Cheap change check for polling: one primary-key row read. The UI refetches only the scopes that moved. */
  .get('/changes', async ({ env }) => json(await readVersions(env.DB)))

  // services
  .get('/services', async ({ env }) => json((await loadCatalog(env.DB)).services))
  .post('/services', async ({ env, req }) => {
    const f = serviceFields(await readJson(req), false)
    const id = makeId('svc')
    await runVersioned(env.DB, env.DB.prepare(
      `INSERT INTO services (id, name, description, category, duration_min, price_cents, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM services))`,
    ).bind(id, f.name, f.description ?? '', f.category ?? '', f.durationMin, toCents(f.priceUsd!), f.active === false ? 0 : 1), 'catalog')
    return json(await getService(env.DB, id), 201)
  })
  .put('/services/:id', async ({ env, req, params }) => {
    await getService(env.DB, params.id)
    const f = serviceFields(await readJson(req), true)
    const sets: string[] = [], args: unknown[] = []
    const set = (col: string, v: unknown) => { if (v !== undefined) { sets.push(`${col} = ?`); args.push(v) } }
    set('name', f.name); set('description', f.description); set('category', f.category); set('duration_min', f.durationMin)
    set('price_cents', f.priceUsd === undefined ? undefined : toCents(f.priceUsd)); set('active', f.active === undefined ? undefined : f.active ? 1 : 0)
    if (sets.length) await runVersioned(env.DB, env.DB.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`).bind(...args, params.id), 'catalog')
    return json(await getService(env.DB, params.id))
  })
  .delete('/services/:id', async ({ env, params }) => { await removeWithHistory(env.DB, 'services', 'service_id', params.id); return noContent() })

  // staff
  .get('/staff', async ({ env }) => json((await loadCatalog(env.DB)).staff))
  .post('/staff', async ({ env, req }) => {
    const f = staffFields(await readJson(req), false)
    const id = makeId('stf')
    const cat = await loadCatalog(env.DB)
    await batchVersioned(env.DB, [
      env.DB.prepare(
        `INSERT INTO staff (id, name, role, bio, color, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM staff))`,
      ).bind(id, f.name, f.role ?? '', f.bio ?? '', f.color ?? '#b7791f', f.active === false ? 0 : 1),
      ...staffChildStatements(env.DB, id, f, new Set(cat.services.map((s) => s.id))),
    ], 'catalog')
    return json(await getStaff(env.DB, id), 201)
  })
  .put('/staff/:id', async ({ env, req, params }) => {
    await getStaff(env.DB, params.id)
    const f = staffFields(await readJson(req), true)
    const cat = await loadCatalog(env.DB)
    const sets: string[] = [], args: unknown[] = []
    const set = (col: string, v: unknown) => { if (v !== undefined) { sets.push(`${col} = ?`); args.push(v) } }
    set('name', f.name); set('role', f.role); set('bio', f.bio); set('color', f.color); set('active', f.active === undefined ? undefined : f.active ? 1 : 0)
    const stmts = [
      ...(sets.length ? [env.DB.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).bind(...args, params.id)] : []),
      ...staffChildStatements(env.DB, params.id, f, new Set(cat.services.map((s) => s.id))),
    ]
    if (stmts.length) await batchVersioned(env.DB, stmts, 'catalog') // atomic: hours/services are replaced all-or-nothing
    return json(await getStaff(env.DB, params.id))
  })
  .delete('/staff/:id', async ({ env, params }) => { await removeWithHistory(env.DB, 'staff', 'staff_id', params.id); return noContent() })

  // time off
  .get('/time-off', async ({ env }) => json(((await env.DB.prepare('SELECT * FROM time_off ORDER BY date').all<TimeOffRow>()).results).map(mapTimeOff)))
  .get('/time-off/:id', async ({ env, params }) => {
    const r = await env.DB.prepare('SELECT * FROM time_off WHERE id = ?').bind(params.id).first<TimeOffRow>()
    if (!r) throw notFound('Day off not found')
    return json(mapTimeOff(r))
  })
  .post('/time-off', async ({ env, req }) => {
    const b = await readJson(req)
    const staffId = b.staffId === null || b.staffId === undefined || b.staffId === '' ? null : vId(b.staffId, 'staffId')
    if (staffId && !(await env.DB.prepare('SELECT 1 FROM staff WHERE id = ? AND deleted_at IS NULL').bind(staffId).first())) throw notFound('Specialist not found')
    const id = makeId('off')
    await runVersioned(env.DB, env.DB.prepare('INSERT INTO time_off (id, staff_id, date, note) VALUES (?, ?, ?, ?)').bind(id, staffId, date(b, 'date'), str(b, 'note', { max: 200 }) ?? ''), 'catalog')
    return json(mapTimeOff((await env.DB.prepare('SELECT * FROM time_off WHERE id = ?').bind(id).first<TimeOffRow>())!), 201)
  })
  .put('/time-off/:id', async ({ env, req, params }) => {
    const b = await readJson(req)
    const cur = await env.DB.prepare('SELECT * FROM time_off WHERE id = ?').bind(params.id).first<TimeOffRow>()
    if (!cur) throw notFound('Day off not found')
    const staffId = b.staffId === undefined ? cur.staff_id : b.staffId === null || b.staffId === '' ? null : vId(b.staffId, 'staffId')
    await runVersioned(env.DB, env.DB.prepare('UPDATE time_off SET staff_id = ?, date = ?, note = ? WHERE id = ?')
      .bind(staffId, date(b, 'date', false) ?? cur.date, str(b, 'note', { max: 200 }) ?? cur.note, params.id), 'catalog')
    return json(mapTimeOff((await env.DB.prepare('SELECT * FROM time_off WHERE id = ?').bind(params.id).first<TimeOffRow>())!))
  })
  .delete('/time-off/:id', async ({ env, params }) => {
    const r = await runVersioned(env.DB, env.DB.prepare('DELETE FROM time_off WHERE id = ?').bind(params.id), 'catalog')
    if (!r.meta.changes) throw notFound('Day off not found')
    return noContent()
  })

  // clients
  /** ?q= searches name/email/phone, ?limit= caps the result (autocomplete). No params = everyone (A–Z). */
  .get('/clients', async ({ env, url }) => {
    const f = clientFilter(url.searchParams.get('q'))
    const limit = url.searchParams.get('limit') ? Math.min(Math.max(Number(url.searchParams.get('limit')) || 0, 1), 500) : 0
    const sql = `SELECT ${CLIENT_COLS} FROM clients ${f.sql ? 'WHERE ' + f.sql : ''} ORDER BY name COLLATE NOCASE${limit ? ' LIMIT ' + limit : ''}`
    return json((await env.DB.prepare(sql).bind(...f.args).all<ClientRow>()).results.map(mapClient))
  })
  .get('/clients/summary', async (c) => json(await clientSummary(c)))
  .get('/clients/:id', async ({ env, params }) => {
    const r = await env.DB.prepare('SELECT id, name, phone, email, notes, created_at FROM clients WHERE id = ?').bind(params.id).first<ClientRow>()
    if (!r) throw notFound('Client not found')
    return json(mapClient(r))
  })
  /** Hard-deletes a client that has no bookings (any status) — 409 otherwise. Used for test clean-up / GDPR erasure. */
  .delete('/clients/:id', async ({ env, params }) => {
    const n = await env.DB.prepare('SELECT count(*) AS n FROM bookings WHERE client_id = ?').bind(params.id).first<{ n: number }>()
    if ((n?.n ?? 0) > 0) throw conflict('Client still has bookings — delete those first.')
    const r = await runVersioned(env.DB, env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(params.id), 'clients')
    if (!r.meta.changes) throw notFound('Client not found')
    return noContent()
  })
  .put('/clients/:id', async ({ env, req, params }) => {
    const b = await readJson(req)
    const cur = await env.DB.prepare('SELECT id, name, phone, email, notes, created_at FROM clients WHERE id = ?').bind(params.id).first<ClientRow>()
    if (!cur) throw notFound('Client not found')
    const name = str(b, 'name', { max: 120 }) ?? cur.name
    const phone = str(b, 'phone', { max: 40 }) ?? cur.phone
    const email = b.email === undefined ? cur.email : normEmail(str(b, 'email', { max: 200 }) ?? '')
    if (!name) throw badRequest('name is required')
    if (email && !EMAIL_RE.test(email)) throw badRequest('Please enter a valid email')
    try {
      await runVersioned(env.DB, env.DB.prepare('UPDATE clients SET name = ?, phone = ?, phone_digits = ?, email = ?, notes = ?, updated_at = ? WHERE id = ?')
        .bind(name, phone, phoneDigits(phone), email, str(b, 'notes', { max: 5000 }) ?? cur.notes, nowIso(), params.id), 'clients')
    } catch (e) {
      if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) throw conflict('Another client already uses this email.')
      throw e
    }
    const r = await env.DB.prepare('SELECT id, name, phone, email, notes, created_at FROM clients WHERE id = ?').bind(params.id).first<ClientRow>()
    return json(mapClient(r!))
  })

  // bookings
  .get('/bookings', async (c) => json(await listBookings(c)))
  .get('/bookings/:id', async ({ env, params }) => json(mapBooking(await getBookingRow(env.DB, params.id))))
  .post('/bookings', async ({ env, req }) => {
    const b = await readJson(req)
    const client = obj(b.client, 'client')
    const booking = await createBooking(env.DB, {
      serviceId: vId(b.serviceId, 'serviceId'),
      staffId: b.staffId === 'any' ? 'any' : vId(b.staffId, 'staffId'),
      date: date(b, 'date')!,
      start: int(b, 'start', { required: true, min: 0, max: 1439 })!,
      client: { name: str(client, 'name', { required: true, max: 120 })!, phone: str(client, 'phone', { max: 40 }) ?? '', email: str(client, 'email', { max: 200 }) ?? '' },
      notes: str(b, 'notes', { max: 1000 }) ?? '',
    }, 'admin')
    return json(booking, 201)
  })
  .patch('/bookings/:id/status', async ({ env, req, params }) => {
    const b = await readJson(req)
    const status = b.status as BookingStatus
    if (!STATUSES.includes(status)) throw badRequest('status must be one of ' + STATUSES.join(', '))
    return json(await setBookingStatus(env.DB, params.id, status))
  })
  .post('/bookings/:id/reschedule', async ({ env, req, params }) => {
    const b = await readJson(req)
    return json(await rescheduleBooking(env.DB, params.id, {
      date: date(b, 'date')!, start: int(b, 'start', { required: true, min: 0, max: 1439 })!, staffId: vId(b.staffId, 'staffId'),
    }))
  })
  .delete('/bookings/:id', async ({ env, params }) => {
    const r = await runVersioned(env.DB, env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(params.id), 'bookings')
    if (!r.meta.changes) throw notFound('Booking not found')
    return noContent()
  })

  // settings
  .put('/settings', async ({ env, req }) => {
    const b = await readJson(req)
    const tz = str(b, 'timezone', { max: 64 })
    if (tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }) } catch { throw badRequest('Unknown timezone') } }
    const map: [string, unknown][] = [
      ['name', str(b, 'name', { max: 120 })], ['tagline', str(b, 'tagline', { max: 300 })], ['address', str(b, 'address', { max: 300 })],
      ['phone', str(b, 'phone', { max: 40 })], ['email', str(b, 'email', { max: 200 })],
      ['slot_step_min', int(b, 'slotStepMin', { min: 5, max: 240 })], ['min_notice_min', int(b, 'minNoticeMin', { min: 0, max: 10080 })],
      ['horizon_days', int(b, 'horizonDays', { min: 1, max: 365 })], ['timezone', tz || undefined],
    ]
    const sets = map.filter(([, v]) => v !== undefined)
    if (sets.length) {
      await runVersioned(env.DB, env.DB.prepare(`UPDATE settings SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = 1`).bind(...sets.map(([, v]) => v), nowIso()), 'catalog')
    }
    return json((await loadCatalog(env.DB)).settings)
  })
