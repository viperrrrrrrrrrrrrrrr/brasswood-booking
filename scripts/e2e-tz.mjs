// Shop-timezone + admin-polling e2e (API mode, local D1 only — never remote).
// Starts its own `wrangler pages dev` on an isolated local D1 (.wrangler/e2e-tz-state) with the local-only
// TEST_CLOCK=1 binding, so the server's "now" can be pinned per request (x-test-now header) to the same instant as
// the browser's fake clock. Then, for browser timezones UTC / Europe/Prague / Asia/Tokyo / America/Los_Angeles,
// checks slots, the admin "today" list and the /manage cancel button for a booking later today in NEW YORK time.
// Finally checks the change-polling behaviour with a fast interval (localStorage brasswood:pollMs=500).
// Usage: npm run build && npm run e2e:tz     Env: E2E_TZ_PORT (default 8796), CHROME_PATH, KEEP_E2E_DB=1
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminCreds, CHROME } from './e2e-lib.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.E2E_TZ_PORT ?? 8796)
const BASE = `http://localhost:${PORT}`
const PERSIST = join(ROOT, '.wrangler', 'e2e-tz-state')
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const CREDS = adminCreds()
// Tue Nov 3 2026, 20:00 UTC = 15:00 EST in the shop (America/New_York) = 05:00 Wed Nov 4 in Tokyo.
const NOW = '2026-11-03T20:00:00.000Z'
const SHOP_DATE = '2026-11-03'
const ZONES = ['UTC', 'Europe/Prague', 'Asia/Tokyo', 'America/Los_Angeles']
const results = []
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}
const section = (t) => console.log(`\n== ${t} ==`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rnd = () => Math.random().toString(36).slice(2, 7)
const fmt = (m) => { const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }

if (!CREDS.password) { console.error('No ADMIN_PASSWORD in .dev.vars'); process.exit(2) }
if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist/ missing — run `npm run build` first.'); process.exit(2) }

const wr = (args) => {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } })
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`)
}
let server = null, serverLog = ''
async function startServer() {
  server = spawn(process.execPath, [WRANGLER, 'pages', 'dev', '--port', String(PORT), '--inspector-port', String(PORT + 1000), '--persist-to', PERSIST, '--binding', 'TEST_CLOCK=1'], {
    cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (d) => (serverLog += d))
  server.stderr.on('data', (d) => (serverLog += d))
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    try { if ((await fetch(BASE + '/api/health')).ok) return } catch { /* not up yet */ }
    if (server.exitCode !== null) break
  }
  throw new Error('wrangler pages dev did not start:\n' + serverLog.slice(-3000))
}
async function stopServer() {
  if (!server || server.exitCode !== null) return
  const done = new Promise((r) => server.once('exit', r))
  try { process.kill(-server.pid, 'SIGTERM') } catch { server.kill('SIGTERM') }
  await Promise.race([done, sleep(8000)])
  if (server.exitCode === null) { try { process.kill(-server.pid, 'SIGKILL') } catch { /* gone */ } }
}
async function call(path, { method = 'GET', body, cookie, now = NOW } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(now ? { 'x-test-now': now } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data, headers: res.headers }
}

/** Browser context in a given timezone whose clock (and the server's, via x-test-now) is pinned to `now`. */
async function tzContext(browser, timezoneId, now = NOW, { pollMs } = {}) {
  const ctx = await browser.newContext({ timezoneId, viewport: { width: 1280, height: 900 } })
  await ctx.route('**/api/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-test-now': now } }))
  if (pollMs) await ctx.addInitScript((ms) => localStorage.setItem('brasswood:pollMs', String(ms)), pollMs)
  const page = await ctx.newPage()
  await page.clock.setFixedTime(new Date(now))
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page, errors }
}
async function adminLogin(page) {
  await page.goto(BASE + '/admin/login')
  await page.fill('input[name="username"]', CREDS.username)
  await page.fill('input[name="password"]', CREDS.password)
  await page.click('button[type="submit"]')
  await page.waitForSelector('text=Today’s schedule', { timeout: 15000 })
}

let browser
try {
  rmSync(PERSIST, { recursive: true, force: true })
  wr(['d1', 'migrations', 'apply', 'brasswood', '--local', '--persist-to', PERSIST])
  wr(['d1', 'execute', 'brasswood', '--local', '--persist-to', PERSIST, '--file', join(ROOT, 'seed', 'seed.sql')])
  await startServer()
  browser = await chromium.launch({ executablePath: CHROME, headless: true })

  section('Server: test clock + versions')
  const health = await call('/api/health')
  ok('Health: schema 2, test clock enabled ONLY in this local run', health.data?.schema === 2 && health.data?.testClock === true, JSON.stringify(health.data))
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(CREDS) })
  const ADMIN = login.headers.get('set-cookie')?.split(';')[0]
  ok('Admin login (API)', login.ok && ADMIN)
  const v0 = (await call('/api/admin/changes', { cookie: ADMIN })).data
  ok('GET /api/admin/changes returns the 3 counters', ['catalog', 'bookings', 'clients'].every((k) => typeof v0?.[k] === 'number'), JSON.stringify(v0))

  // Fixtures (shop time): one booking LATER today (17:00 NY) and one that already started (10:00 NY).
  const later = await call('/api/bookings', { method: 'POST', body: { serviceId: 'svc_fade', staffId: 'stf_marco', date: SHOP_DATE, start: 17 * 60, client: { name: 'Later Today', phone: '(555) 010-1700', email: `later.${rnd()}@example.com` }, notes: '' } })
  ok('Public booking for 5:00 PM NY today accepted (server uses shop time)', later.status === 201 && later.data?.canCancel === true, `${later.status} ${later.data?.code} canCancel=${later.data?.canCancel}`)
  const past = await call('/api/admin/bookings', { method: 'POST', cookie: ADMIN, body: { serviceId: 'svc_cut', staffId: 'stf_dana', date: SHOP_DATE, start: 11 * 60, client: { name: 'Morning Visit', phone: '', email: '' }, notes: '' } })
  ok('Admin booking for 11:00 AM NY today (already started)', past.status === 201, `${past.status} ${past.data?.code}`)
  const tooSoon = await call('/api/bookings', { method: 'POST', body: { serviceId: 'svc_fade', staffId: 'stf_marco', date: SHOP_DATE, start: 15 * 60 + 15, client: { name: 'Too Soon', phone: '(555) 010-0000', email: `soon.${rnd()}@example.com` }, notes: '' } })
  ok('Public booking inside the 60-min notice (3:15 PM NY) rejected', tooSoon.status === 409 || tooSoon.status === 400, String(tooSoon.status))
  const v1 = (await call('/api/admin/changes', { cookie: ADMIN })).data
  ok('Versions: bookings and clients bumped by the writes, catalog unchanged', v1.bookings >= v0.bookings + 2 && v1.clients >= v0.clients + 2 && v1.catalog === v0.catalog, `${JSON.stringify(v0)} → ${JSON.stringify(v1)}`)
  const v1b = (await call('/api/admin/changes', { cookie: ADMIN })).data
  ok('Failed write (409) did not bump versions', JSON.stringify(v1b) === JSON.stringify(v1))
  const byCodeLater = (await call(`/api/bookings/by-code/${later.data.code}`)).data
  const byCodePast = (await call(`/api/bookings/by-code/${past.data.code}`)).data
  ok('by-code: canCancel true for later today, false for the started one', byCodeLater?.canCancel === true && byCodePast?.canCancel === false)
  const cancelPast = await call(`/api/bookings/by-code/${past.data.code}/cancel`, { method: 'POST', body: {} })
  ok('Online cancel of the started booking → 409', cancelPast.status === 409, String(cancelPast.status))
  const apiSlots = (await call(`/api/availability/slots?serviceId=svc_fade&staffId=stf_marco&date=${SHOP_DATE}`)).data
  ok('API slots today start at 4:00 PM NY (15:00 + 60 min notice)', apiSlots?.[0]?.start === 16 * 60 && !apiSlots.some((s) => s.start === 17 * 60), apiSlots?.map((s) => fmt(s.start)).join(' '))
  const late = (await call(`/api/availability/slots?serviceId=svc_fade&staffId=stf_marco&date=${SHOP_DATE}`, { now: '2026-11-03T21:30:00.000Z' })).data
  ok('Same day at 4:30 PM NY → no slots left today (notice cut-off follows the shop clock)', Array.isArray(late) && late.length === 0, JSON.stringify(late))

  for (const tz of ZONES) {
    section(`Browser timezone ${tz} (shop: America/New_York, now = Tue Nov 3 2026 3:00 PM)`)
    const { ctx, page, errors } = await tzContext(browser, tz)
    const browserLocal = await page.evaluate(() => `${new Date().toString()}`)
    // booking page: slots
    await page.goto(BASE + '/')
    await page.click('[data-testid="service-svc_fade"]')
    await page.click('[data-testid="staff-stf_marco"]')
    await page.waitForSelector('[data-testid="slot"]')
    await sleep(300)
    const selDate = await page.$eval('[data-date][aria-pressed="true"]', (el) => el.getAttribute('data-date')).catch(() => null)
    const uiSlots = await page.$$eval('[data-testid="slot"]', (els) => els.map((e) => e.textContent.trim()))
    ok(`[${tz}] booking page auto-selects shop today (${SHOP_DATE})`, selDate === SHOP_DATE, `selected=${selDate}; browser local: ${browserLocal.slice(0, 33)}`)
    ok(`[${tz}] slots match the server (first 4:00 PM, 5:00 PM taken)`, uiSlots.join() === apiSlots.map((s) => fmt(s.start)).join(), uiSlots.join(' '))
    ok(`[${tz}] "shop time" hint shown`, await page.isVisible('[data-testid="shop-time-hint"]'))
    // /manage
    await page.goto(`${BASE}/manage?code=${later.data.code}`)
    await page.waitForSelector('[data-testid="cancel-booking"], [data-testid="cancel-unavailable"]', { timeout: 10000 }).catch(() => {})
    ok(`[${tz}] /manage: "Cancel booking" shown for 5:00 PM NY today`, await page.isVisible('[data-testid="cancel-booking"]'))
    await page.goto(`${BASE}/manage?code=${past.data.code}`)
    await page.waitForSelector('[data-testid="cancel-booking"], [data-testid="cancel-unavailable"]', { timeout: 10000 }).catch(() => {})
    ok(`[${tz}] /manage: no cancel for the 11:00 AM NY booking`, (await page.isVisible('[data-testid="cancel-unavailable"]')) && !(await page.isVisible('[data-testid="cancel-booking"]')))
    // admin today
    await adminLogin(page)
    const header = await page.textContent('main h1 + p, header p').catch(() => '')
    const hasDate = await page.isVisible('text=Tuesday, November 3, 2026')
    const today = await page.$$eval('[data-testid="today-list"] li', (els) => els.map((e) => e.textContent)).catch(() => [])
    ok(`[${tz}] admin dashboard date = Tuesday, November 3, 2026`, hasDate, header?.slice(0, 60))
    ok(`[${tz}] admin today list has both shop-today bookings`, today.some((t) => t.includes('Later Today')) && today.some((t) => t.includes('Morning Visit')), `${today.length} rows`)
    await page.goto(BASE + '/admin/schedule')
    await page.click('[data-testid="view-day"]')
    await page.waitForSelector('[data-testid="booking-block"]', { timeout: 10000 }).catch(() => {})
    const blocks = await page.$$eval('[data-testid="booking-block"]', (els) => els.map((e) => e.getAttribute('data-code')))
    ok(`[${tz}] schedule (day view) opens on shop today with both bookings`, blocks.includes(later.data.code) && blocks.includes(past.data.code), `${blocks.length} blocks`)
    ok(`[${tz}] no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  section('Shop midnight vs browser midnight')
  {
    // Oct 31 23:30 EDT in the shop = Nov 1 12:30 in Tokyo — "today" must still be Oct 31.
    const at = '2026-11-01T03:30:00.000Z'
    const { ctx, page } = await tzContext(browser, 'Asia/Tokyo', at)
    await adminLogin(page)
    ok('[Asia/Tokyo] at Nov 1 12:30 local, dashboard says Saturday, October 31, 2026', await page.isVisible('text=Saturday, October 31, 2026'))
    await ctx.close()
  }

  section('Cancel later today from a far timezone')
  {
    const { ctx, page } = await tzContext(browser, 'Asia/Tokyo')
    await page.goto(`${BASE}/manage?code=${later.data.code}`)
    await page.click('[data-testid="cancel-booking"]')
    await page.click('[data-testid="confirm-cancel"]')
    await page.waitForSelector('text=This booking is cancelled', { timeout: 10000 }).catch(() => {})
    const st = (await call(`/api/bookings/by-code/${later.data.code}`)).data?.status
    ok('[Asia/Tokyo] cancel works for 5:00 PM NY today', st === 'cancelled', st)
    await ctx.close()
  }

  section('Admin polling (pollMs = 500)')
  {
    const { ctx, page } = await tzContext(browser, 'Europe/Prague', NOW, { pollMs: 500 })
    const reqs = []
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) reqs.push({ t: Date.now(), path: u.pathname + u.search }) })
    await adminLogin(page)
    await sleep(1500)
    let mark = reqs.length
    await sleep(3000)
    const idle = reqs.slice(mark)
    ok('No changes → only version checks (/api/admin/changes)', idle.length >= 3 && idle.every((r) => r.path === '/api/admin/changes'), `${idle.length} requests: ${[...new Set(idle.map((r) => r.path))].join(', ')}`)

    mark = reqs.length
    const name = `Poll Probe ${rnd()}`
    const other = await call('/api/bookings', { method: 'POST', body: { serviceId: 'svc_cut', staffId: 'stf_dana', date: SHOP_DATE, start: 17 * 60 + 30, client: { name, phone: '(555) 010-1730', email: `probe.${rnd()}@example.com` }, notes: '' } })
    const seen = await page.waitForSelector(`[data-testid="today-list"] >> text=${name}`, { timeout: 5000 }).then(() => true, () => false)
    ok('Booking from another context appears on the open dashboard', other.status === 201 && seen)
    await sleep(300)
    const after = reqs.slice(mark).map((r) => r.path.split('?')[0])
    ok('…refetch touched bookings only, not the catalog', after.includes('/api/admin/bookings') && !after.some((p) => /\/api\/(admin\/)?(services|staff|settings|time-off)/.test(p)), [...new Set(after)].join(', '))

    // hidden tab
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await sleep(400)
    mark = reqs.length
    await sleep(3000)
    ok('Hidden tab → no polling', reqs.length - mark === 0, `${reqs.length - mark} requests in 3 s`)
    mark = reqs.length
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await sleep(250)
    ok('Visible again → immediate version check', reqs.slice(mark).some((r) => r.path === '/api/admin/changes'), `${reqs.length - mark} request(s) within 250 ms`)

    // idle backoff: idle threshold = 15 × 500 ms = 7.5 s, then the interval doubles up to 3 × 500 ms
    await sleep(9000)
    mark = reqs.length
    await sleep(4500)
    const ts = reqs.slice(mark).filter((r) => r.path === '/api/admin/changes').map((r) => r.t)
    const gaps = ts.slice(1).map((t, i) => t - ts[i])
    ok('Idle → interval backs off (≈1.5 s instead of 0.5 s)', gaps.length >= 1 && Math.min(...gaps) >= 1200, gaps.join(','))
    mark = reqs.length
    await page.mouse.move(200, 200); await page.mouse.down(); await page.mouse.up()
    await sleep(1600)
    const ts2 = reqs.slice(mark).filter((r) => r.path === '/api/admin/changes').map((r) => r.t)
    ok('Activity → back to the fast interval', ts2.length >= 2, `${ts2.length} checks in 1.6 s`)
    await ctx.close()
  }
} catch (e) {
  ok('Unexpected error', false, e.stack)
} finally {
  await browser?.close()
  await stopServer()
  if (!process.env.KEEP_E2E_DB) rmSync(PERSIST, { recursive: true, force: true })
}
const passed = results.filter((r) => r.pass).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
