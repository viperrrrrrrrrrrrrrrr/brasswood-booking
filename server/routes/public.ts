/** Public API (no personal data except a booking returned to the holder of its code). */
import { getSlots, nextAvailable, openDates } from '../../src/lib/availability'
import { addDays } from '../../src/lib/date'
import { Router, type RouteCtx } from '../router'
import { badRequest, json, notFound, forbidden, HttpError, readJson } from '../http'
import { availabilityCtx, loadCatalog, shopNow } from '../repo'
import { cancelByCode, createBooking, findByCode, publicBooking } from '../bookings'
import { assertNotRateLimited, assertSameOrigin, clientIp, createSession, deleteSession, getSession, recordFailure, sessionCookie, sleep, verifyCredentials } from '../auth'
import { id as vId, int, isDate, obj, str } from '../validate'
import { serverNow, testClockEnabled } from '../clock'
import { readVersions } from '../versions'

const q = (c: RouteCtx, k: string) => c.url.searchParams.get(k) ?? ''
const staffParam = (v: string) => (v === 'any' ? 'any' : vId(v, 'staffId'))
const dateParam = (v: string, k: string) => {
  if (!isDate(v)) throw badRequest(`${k} must be a date YYYY-MM-DD`)
  return v
}

export const publicRouter = new Router()
  /** Liveness + D1 binding/schema/seed check (2 tiny reads). Used by docs/REMOTE_TEST.md and scripts/verify-remote.mjs. */
  .get('/health', async ({ env }) => {
    try {
      // data_versions comes from migration 0002 — if it is missing the query fails → 503 "apply migrations".
      const r = await env.DB.prepare('SELECT (SELECT count(*) FROM settings) AS settings, (SELECT count(*) FROM services) AS services, (SELECT count(*) FROM data_versions) AS versions').first<{ settings: number; services: number; versions: number }>()
      return json({ ok: true, db: 'ok', seeded: (r?.settings ?? 0) > 0 && (r?.services ?? 0) > 0, schema: (r?.versions ?? 0) > 0 ? 2 : 1, ...(testClockEnabled(env) ? { testClock: true } : {}) })
    } catch {
      return json({ ok: false, db: 'error', message: 'D1 is bound but the schema is missing — apply migrations' }, 503)
    }
  })

  /** Cheap change check for the public booking page (1 row read). Clients' version is admin-only. */
  .get('/changes', async ({ env }) => {
    const v = await readVersions(env.DB)
    return json({ catalog: v.catalog, bookings: v.bookings }, 200, { 'cache-control': 'no-store' })
  })

  .get('/services', async ({ env }) => json((await loadCatalog(env.DB)).services))
  .get('/services/:id', async ({ env, params }) => {
    const s = (await loadCatalog(env.DB)).services.find((x) => x.id === params.id)
    if (!s) throw notFound('Service not found')
    return json(s)
  })
  .get('/staff', async ({ env }) => json((await loadCatalog(env.DB)).staff))
  .get('/staff/:id', async ({ env, params }) => {
    const s = (await loadCatalog(env.DB)).staff.find((x) => x.id === params.id)
    if (!s) throw notFound('Specialist not found')
    return json(s)
  })
  .get('/settings', async ({ env }) => json((await loadCatalog(env.DB)).settings))

  .get('/availability/slots', async (c) => {
    const serviceId = vId(q(c, 'serviceId'), 'serviceId')
    const staffId = staffParam(q(c, 'staffId'))
    const date = dateParam(q(c, 'date'), 'date')
    const ignoreRules = q(c, 'ignoreRules') === '1'
    const excludeBookingId = q(c, 'excludeBookingId') ? vId(q(c, 'excludeBookingId'), 'excludeBookingId') : undefined
    // Admin-only options (booking outside notice/horizon, rescheduling) need a session.
    if ((ignoreRules || excludeBookingId) && !(await getSession(c.env.DB, c.req))) throw forbidden('Admin session required for these options')
    const ctx = await availabilityCtx(c.env.DB, date, date)
    return json(getSlots(ctx, { serviceId, staffId, date, ignoreRules, excludeBookingId }))
  })
  .get('/availability/open-dates', async (c) => {
    const serviceId = vId(q(c, 'serviceId'), 'serviceId')
    const staffId = staffParam(q(c, 'staffId'))
    const from = dateParam(q(c, 'from'), 'from')
    let to = dateParam(q(c, 'to'), 'to')
    if (to < from) return json([])
    if (to > addDays(from, 62)) to = addDays(from, 62)
    const ctx = await availabilityCtx(c.env.DB, from, to)
    return json(openDates(ctx, serviceId, staffId, from, to))
  })
  .get('/availability/next', async (c) => {
    const serviceId = vId(q(c, 'serviceId'), 'serviceId')
    const staffIds = q(c, 'staffIds').split(',').filter(Boolean).map(staffParam).slice(0, 20)
    const cat = await loadCatalog(c.env.DB)
    const today = shopNow(cat.settings.timezone, serverNow()).date
    const ctx = await availabilityCtx(c.env.DB, today, addDays(today, cat.settings.horizonDays + 1), cat)
    return json(nextAvailable(ctx, serviceId, staffIds))
  })

  .post('/bookings', async (c) => {
    assertSameOrigin(c.req)
    const b = await readJson(c.req)
    const client = obj(b.client, 'client')
    const booking = await createBooking(
      c.env.DB,
      {
        serviceId: vId(b.serviceId, 'serviceId'),
        staffId: b.staffId === 'any' ? 'any' : vId(b.staffId, 'staffId'),
        date: dateParam(String(b.date ?? ''), 'date'),
        start: int(b, 'start', { required: true, min: 0, max: 1439 })!,
        client: { name: str(client, 'name', { required: true, max: 120 })!, phone: str(client, 'phone', { max: 40 }) ?? '', email: str(client, 'email', { max: 200 }) ?? '' },
        notes: str(b, 'notes', { max: 1000 }) ?? '',
      },
      'online', // public endpoint can never create admin bookings or bypass notice/horizon rules
    )
    return json(publicBooking(booking), 201)
  })
  .get('/bookings/by-code/:code', async (c) => {
    const found = await findByCode(c.env.DB, c.params.code)
    if (!found) throw notFound('No booking with that code')
    return json(publicBooking(found.booking, found.timeZone))
  })
  .post('/bookings/by-code/:code/cancel', async (c) => {
    assertSameOrigin(c.req)
    const done = await cancelByCode(c.env.DB, c.params.code)
    return json(publicBooking(done.booking, done.timeZone))
  })

  // ---------- auth ----------
  .get('/auth/me', async (c) => {
    const username = await getSession(c.env.DB, c.req)
    return json({ authenticated: !!username, username })
  })
  .post('/auth/login', async (c) => {
    assertSameOrigin(c.req)
    const ip = clientIp(c.req)
    await assertNotRateLimited(c.env.DB, ip)
    const b = await readJson(c.req)
    const username = typeof b.username === 'string' ? b.username.slice(0, 100) : ''
    const password = typeof b.password === 'string' ? b.password.slice(0, 200) : ''
    if (!(await verifyCredentials(c.env, username, password))) {
      await recordFailure(c.env.DB, ip)
      await sleep(400) // slows down guessing
      throw new HttpError(401, 'unauthorized', 'Invalid username or password')
    }
    await c.env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run()
    const token = await createSession(c.env.DB, username.trim().toLowerCase())
    return json({ authenticated: true, username: username.trim().toLowerCase() }, 200, { 'set-cookie': sessionCookie(c.url, token) })
  })
  .post('/auth/logout', async (c) => {
    assertSameOrigin(c.req)
    await deleteSession(c.env.DB, c.req)
    return json({ authenticated: false }, 200, { 'set-cookie': sessionCookie(c.url, null) })
  })
