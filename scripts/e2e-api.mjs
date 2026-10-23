// API + local D1 integration test. Starts its own `wrangler pages dev` on an isolated local D1
// (.wrangler/e2e-state, never the dev DB, never remote), restarts it once to prove persistence.
// Usage:  npm run build  (once)  then  npm run e2e:api
// Env: E2E_PORT (default 8799), CHROME_PATH, KEEP_E2E_DB=1 to keep the test DB afterwards.
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminCreds, CHROME } from './e2e-lib.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.E2E_PORT ?? 8799)
const BASE = `http://localhost:${PORT}`
const PERSIST = join(ROOT, '.wrangler', 'e2e-state')
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const SHOTS = join(ROOT, 'shots')
const CREDS = adminCreds()
const results = []
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}
const section = (t) => console.log(`\n== ${t} ==`)
const rnd = () => Math.random().toString(36).slice(2, 8)

if (!CREDS.password) { console.error('No ADMIN_PASSWORD: copy .dev.vars.example to .dev.vars and set one.'); process.exit(2) }
if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist/ missing — run `npm run build` first.'); process.exit(2) }

// ---------- local wrangler helpers (local only: --local / --persist-to, no account access) ----------
const wr = (args) => {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } })
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`)
}
let server = null
let serverLog = ''
async function startServer() {
  serverLog = ''
  server = spawn(process.execPath, [WRANGLER, 'pages', 'dev', '--port', String(PORT), '--inspector-port', String(PORT + 1000), '--persist-to', PERSIST], {
    cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (d) => (serverLog += d))
  server.stderr.on('data', (d) => (serverLog += d))
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try { if ((await fetch(BASE + '/api/health')).ok) return } catch { /* not up yet */ }
    if (server.exitCode !== null) break
  }
  throw new Error('wrangler pages dev did not start:\n' + serverLog.slice(-3000))
}
async function stopServer() {
  if (!server || server.exitCode !== null) return
  const done = new Promise((r) => server.once('exit', r))
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'])
  else { try { process.kill(-server.pid, 'SIGTERM') } catch { server.kill('SIGTERM') } }
  await Promise.race([done, new Promise((r) => setTimeout(r, 8000))])
  if (server.exitCode === null && process.platform !== 'win32') { try { process.kill(-server.pid, 'SIGKILL') } catch { /* gone */ } }
  server = null
  for (let i = 0; i < 20; i++) { try { await fetch(BASE + '/api/health'); await new Promise((r) => setTimeout(r, 300)) } catch { return } }
}

// ---------- HTTP helpers ----------
async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data, text, headers: res.headers }
}
async function login(username = CREDS.username, password = CREDS.password, headers = {}) {
  const r = await call('/api/auth/login', { method: 'POST', body: { username, password }, headers })
  const sc = r.headers.get('set-cookie')
  return { ...r, setCookie: sc, cookie: sc ? sc.split(';')[0] : null }
}
const ymd = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d) }
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
let exitCode = 1
try {
  section('Fresh isolated local D1')
  rmSync(PERSIST, { recursive: true, force: true })
  wr(['d1', 'migrations', 'apply', 'brasswood', '--local', '--persist-to', PERSIST])
  wr(['d1', 'execute', 'brasswood', '--local', '--persist-to', PERSIST, '--file', join(ROOT, 'seed', 'seed.sql')])
  ok('Migrations + base seed applied to .wrangler/e2e-state (local only)', true)
  await startServer()
  ok('wrangler pages dev is up', (await call('/api/health')).data?.ok === true, BASE)

  // ---------- secrets / bundle ----------
  section('No secrets in the shipped bundle')
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
  const distFiles = walk(join(ROOT, 'dist'))
  const distText = distFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
  ok('Admin password from .dev.vars not in dist/', !distText.includes(CREDS.password), `${distFiles.length} files scanned`)
  ok('No demo credentials / demo auth in api bundle', !/Demo credentials|DEMO_CREDENTIALS|brasswood-admin-session|brasswood-booking-demo/.test(distText))
  const html = await (await fetch(BASE + '/')).text()
  const served = [...html.matchAll(/\/assets\/[^"']+\.js/g)].map((m) => m[0])
  const servedText = (await Promise.all(served.map(async (p) => (await fetch(BASE + p)).text()))).join('\n')
  ok('Served JS (as fetched over HTTP) has no admin password', served.length > 0 && !servedText.includes(CREDS.password), served.join(', '))
  ok('.dev.vars is not served', !(await (await fetch(BASE + '/.dev.vars')).text()).includes(CREDS.password))

  // ---------- auth ----------
  section('Admin authentication')
  for (const [m, p] of [['GET', '/api/admin/bookings'], ['GET', '/api/admin/clients'], ['POST', '/api/admin/services'], ['PUT', '/api/admin/settings'], ['DELETE', '/api/admin/bookings/x']]) {
    const r = await call(p, { method: m, body: m === 'GET' || m === 'DELETE' ? undefined : {} })
    ok(`${m} ${p} without cookie → 401`, r.status === 401, String(r.status))
  }
  ok('Bogus session cookie → 401', (await call('/api/admin/bookings', { cookie: 'bw_admin_session=' + 'a'.repeat(64) })).status === 401)
  const wrong = await login(CREDS.username, CREDS.password + 'x')
  ok('Wrong password → 401, no cookie set', wrong.status === 401 && !wrong.setCookie, String(wrong.status))
  const wrongUser = await login('root', CREDS.password)
  ok('Wrong username → 401', wrongUser.status === 401 && !wrongUser.setCookie)
  ok('Empty body login → 4xx', (await call('/api/auth/login', { method: 'POST', body: {} })).status >= 400)
  const good = await login()
  const ADMIN = good.cookie
  ok('Correct password → 200 + session cookie', good.status === 200 && !!ADMIN)
  ok('Cookie is HttpOnly; SameSite=Strict; Path=/api', /HttpOnly/i.test(good.setCookie) && /SameSite=Strict/i.test(good.setCookie) && /Path=\/api/i.test(good.setCookie), good.setCookie.replace(/=[0-9a-f]{20,}/, '=…'))
  ok('Session works for admin API', (await call('/api/admin/bookings', { cookie: ADMIN })).status === 200)
  ok('/api/auth/me reflects session', (await call('/api/auth/me', { cookie: ADMIN })).data?.authenticated === true && (await call('/api/auth/me')).data?.authenticated === false)
  ok('Cross-origin admin write with valid cookie → 403', (await call('/api/admin/settings', { method: 'PUT', body: {}, cookie: ADMIN, headers: { origin: 'https://evil.example' } })).status === 403)
  ok('Cross-origin public booking POST → 403', (await call('/api/bookings', { method: 'POST', body: {}, headers: { origin: 'https://evil.example' } })).status === 403)

  // pick dates/slots
  const today = ymd(new Date())
  const open = (await call(`/api/availability/open-dates?serviceId=svc_fade&staffId=stf_marco&from=${addDays(today, 1)}&to=${addDays(today, 30)}`)).data
  ok('Open dates available for tests', Array.isArray(open) && open.length >= 4, (open ?? []).slice(0, 4).join(', '))
  const [dUi, dRace, dResched, dAny] = open
  const slotsFor = async (d, staff = 'stf_marco', svc = 'svc_fade') => (await call(`/api/availability/slots?serviceId=${svc}&staffId=${staff}&date=${d}`)).data
  ok('ignoreRules on public slots without session → 403', (await call(`/api/availability/slots?serviceId=svc_fade&staffId=stf_marco&date=${dUi}&ignoreRules=1`)).status === 403)

  // ---------- two independent browsers ----------
  section('Booking in browser A is visible in a separate fresh browser B')
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const A = await ctxA.newPage()
  const errsA = []
  A.on('pageerror', (e) => errsA.push(e.message))
  A.on('console', (m) => m.type() === 'error' && errsA.push(m.text()))
  await A.goto(BASE + '/')
  await A.click('[data-testid="service-svc_fade"]')
  await A.click('[data-testid="staff-stf_marco"]')
  await A.waitForSelector('[data-testid="slot"]')
  // a future date (not today), so the check does not depend on the time of day the test runs
  await A.click(`[data-date="${dUi}"]`)
  await A.waitForTimeout(400)
  const uiDate = await A.$eval('[data-date][aria-pressed="true"]', (el) => el.getAttribute('data-date'))
  const uiSlots = await A.$$eval('[data-testid="slot"]', (els) => els.map((e) => e.textContent))
  const uiTime = uiSlots[1] ?? uiSlots[0]
  await A.locator('[data-testid="slot"]', { hasText: uiTime }).first().click()
  const uiName = `Cross Context ${rnd()}`
  const uiEmail = `cross.${rnd()}@example.com`
  await A.fill('input[name="name"]', uiName)
  await A.fill('input[name="phone"]', '(555) 321-7788')
  await A.fill('input[name="email"]', uiEmail)
  await A.click('[data-testid="confirm-desktop"]')
  await A.waitForSelector('[data-testid="booking-code"]')
  const uiCode = (await A.textContent('[data-testid="booking-code"]')).trim()
  ok('Browser A: booking confirmed through the UI', /^BW-[A-Z0-9]{6}$/.test(uiCode), `${uiCode} ${uiDate} ${uiTime}`)
  ok('Browser A: localStorage holds no booking data', (await A.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('brasswood-booking-demo')).length)) === 0)

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 } }) // fresh cookies + storage
  const B = await ctxB.newPage()
  const errsB = []
  B.on('pageerror', (e) => errsB.push(e.message))
  B.on('console', (m) => m.type() === 'error' && errsB.push(m.text()))
  await B.goto(BASE + '/')
  await B.click('[data-testid="service-svc_fade"]')
  await B.click('[data-testid="staff-stf_marco"]')
  await B.waitForSelector('[data-testid="slot"]')
  await B.click(`[data-date="${uiDate}"]`).catch(() => {})
  await B.waitForTimeout(400)
  const bSlots = await B.$$eval('[data-testid="slot"]', (els) => els.map((e) => e.textContent))
  ok('Browser B: the slot booked in A is not offered', !bSlots.includes(uiTime), `${uiTime} absent; ${bSlots.length} slots shown`)
  ok('Browser B (no cookie): admin API → 401 from the page', (await B.evaluate(async () => (await fetch('/api/admin/bookings')).status)) === 401)

  await B.goto(BASE + '/admin')
  await B.waitForURL('**/admin/login')
  await B.waitForSelector('input[name="password"]')
  await B.waitForTimeout(400)
  const loginState = await B.evaluate(() => ({
    user: document.querySelector('input[name="username"]').value, pass: document.querySelector('input[name="password"]').value, text: document.body.innerText,
  }))
  await B.screenshot({ path: join(SHOTS, 'api-admin-login.png') })
  ok('Admin login page: empty password, no demo credentials, no "Fill in"', loginState.pass === '' && !/Demo credentials|Fill in|demo/i.test(loginState.text), `username field="${loginState.user}"`)
  await B.fill('input[name="username"]', CREDS.username)
  await B.fill('input[name="password"]', 'definitely-wrong')
  await B.click('button[type="submit"]')
  await B.waitForTimeout(900)
  ok('Admin UI: wrong password stays on login with an error', new URL(B.url()).pathname === '/admin/login' && !(await B.$('text=Revenue · last 7 days')))
  await B.screenshot({ path: join(SHOTS, 'api-admin-login-error.png') })
  await B.fill('input[name="password"]', CREDS.password)
  await B.click('button[type="submit"]')
  await B.waitForSelector('text=Revenue · last 7 days')
  ok('Admin UI: correct password → dashboard', new URL(B.url()).pathname === '/admin')
  await B.click('nav >> text=Clients')
  await B.fill('[data-testid="client-search"]', uiName)
  await B.waitForTimeout(400)
  const bRows = await B.$$eval('[data-testid="client-rows"] tr', (els) => els.map((e) => e.textContent))
  ok('Browser B admin: client from browser A is listed', bRows.length === 1 && bRows[0].includes(uiName))
  const bBook = await B.evaluate(async (c) => (await (await fetch('/api/admin/bookings')).json()).find((b) => b.code === c), uiCode)
  ok('Browser B admin: booking from A is in the admin API', bBook?.status === 'confirmed' && bBook.date === uiDate)
  ok('No console/page errors in A and B (except the deliberate wrong-password 401)', [...errsA, ...errsB.filter((e) => !/status of 401/.test(e))].length === 0, [...errsA, ...errsB].slice(0, 3).join(' | '))
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const M = await ctxM.newPage()
  await M.goto(BASE + '/admin/login'); await M.waitForSelector('input[name="password"]'); await M.waitForTimeout(400)
  await M.screenshot({ path: join(SHOTS, 'api-admin-login-mobile.png') })
  ok('Mobile admin login (fresh context) has no credentials shown', !/Demo credentials|Fill in/i.test(await M.innerText('body')))
  await ctxM.close()

  // ---------- privacy of public endpoints ----------
  section('Public endpoints do not leak personal data')
  const pName = `Leak Probe ${rnd()}`, pEmail = `leak.${rnd()}@example.com`, pPhone = `(555) 0${Math.floor(Math.random() * 90 + 10)}-${Math.floor(Math.random() * 9000 + 1000)}`
  const leakSlot = (await slotsFor(dAny))[0]
  const created = await call('/api/bookings', { method: 'POST', body: { serviceId: 'svc_fade', staffId: 'stf_marco', date: dAny, start: leakSlot.start, client: { name: pName, phone: pPhone, email: pEmail }, notes: '' } })
  ok('Public POST /api/bookings → 201', created.status === 201, created.data?.code)
  const pii = [pName, pEmail, pPhone, pPhone.replace(/\D/g, ''), uiName, uiEmail, '3217788']
  const leaks = (t) => pii.filter((x) => t.toLowerCase().includes(x.toLowerCase()))
  ok('POST response has no client name/email/phone/clientId', leaks(created.text).length === 0 && created.data?.clientId === '')
  const publicGets = [
    '/api/services', '/api/services/svc_fade', '/api/staff', '/api/staff/stf_marco', '/api/settings',
    `/api/availability/slots?serviceId=svc_fade&staffId=stf_marco&date=${dAny}`, `/api/availability/slots?serviceId=svc_fade&staffId=any&date=${uiDate}`,
    `/api/availability/open-dates?serviceId=svc_fade&staffId=any&from=${today}&to=${addDays(today, 60)}`,
    '/api/availability/next?serviceId=svc_fade&staffIds=stf_marco,any', `/api/bookings/by-code/${created.data.code}`, `/api/bookings/by-code/${uiCode}`,
  ]
  const found = []
  for (const p of publicGets) { const r = await call(p); if (leaks(r.text).length || (p !== '/api/settings' && /"(email|phone|clientName)"\s*:/.test(r.text))) found.push(p) } // /api/settings legitimately has the shop's own contact email/phone
  ok(`${publicGets.length} public GET endpoints contain no names/emails/phones`, found.length === 0, found.join(', '))
  const byCode = await call(`/api/bookings/by-code/${uiCode}`)
  ok('by-code returns the booking but blanks clientId', byCode.status === 200 && byCode.data.clientId === '')
  for (const p of ['/api/clients', '/api/bookings', '/api/time-off', '/api/admin']) {
    const r = await call(p)
    ok(`GET ${p} (no cookie) exposes nothing`, r.status === 401 || r.status === 404 || r.status === 405, String(r.status))
  }
  const adminSide = await call('/api/admin/clients', { cookie: ADMIN })
  ok('…while the admin API does have that client (data is really there)', adminSide.data.some((c) => c.email === pEmail))

  // ---------- concurrency ----------
  section('Concurrent booking of the same slot')
  const raceSlots = await slotsFor(dRace)
  const s0 = raceSlots[0]
  const race = await Promise.all(Array.from({ length: 10 }, (_, i) => call('/api/bookings', {
    method: 'POST', body: { serviceId: 'svc_fade', staffId: 'stf_marco', date: dRace, start: s0.start, client: { name: `Racer ${i}`, phone: `(555) 100-00${String(i).padStart(2, '0')}`, email: `racer${i}.${rnd()}@example.com` }, notes: '' },
  })))
  const st = race.map((r) => r.status)
  ok('10 parallel public creates, same slot → exactly 1×201 and 9×409', st.filter((s) => s === 201).length === 1 && st.filter((s) => s === 409).length === 9, st.join(','))
  const dayList = (await call(`/api/admin/bookings?from=${dRace}&to=${dRace}&staffId=stf_marco`, { cookie: ADMIN })).data.filter((b) => b.status !== 'cancelled')
  ok('DB holds exactly one booking at that time', dayList.filter((b) => b.start < s0.end && b.end > s0.start).length === 1)
  const losers = (await call('/api/admin/clients', { cookie: ADMIN })).data.filter((c) => /^Racer /.test(c.name))
  ok('Losing requests leave no orphan client records', losers.length === 1, `${losers.length} Racer clients`)
  // overlapping, different start times (guard is an interval check, not just the unique start index)
  const overl = raceSlots.filter((s) => s.start > s0.end).slice(0, 3)
  const ovRes = await Promise.all(Array.from({ length: 9 }, (_, i) => call('/api/bookings', {
    method: 'POST', body: { serviceId: 'svc_fade', staffId: 'stf_marco', date: dRace, start: overl[i % overl.length].start, client: { name: `Overlap ${i}`, phone: '(555) 200-0000', email: `ov${i}.${rnd()}@example.com` }, notes: '' },
  })))
  const ovSt = ovRes.map((r) => r.status)
  const ovWin = ovRes.filter((r) => r.status === 201).map((r) => r.data)
  const ovClash = ovWin.some((a, i) => ovWin.some((b, j) => i !== j && a.start < b.end && a.end > b.start))
  ok('9 parallel creates on 3 overlapping start times → no overlapping winners', !ovClash && ovWin.length >= 1 && ovSt.every((s) => s === 201 || s === 409), `${overl.map((s) => fmt(s.start)).join('/')} → ${ovSt.join(',')}`)
  const adminRace = (await slotsFor(dRace)).find((s) => s.start > s0.end + 120)
  const ar = await Promise.all(Array.from({ length: 10 }, (_, i) => call('/api/admin/bookings', {
    method: 'POST', cookie: ADMIN, body: { serviceId: 'svc_fade', staffId: 'stf_marco', date: dRace, start: adminRace.start, client: { name: `Walk In ${i}`, phone: '', email: '' }, notes: '' },
  })))
  const arSt = ar.map((r) => r.status)
  ok('10 parallel ADMIN creates, same slot → exactly 1×201 and 9×409', arSt.filter((s) => s === 201).length === 1 && arSt.filter((s) => s === 409).length === 9, arSt.join(','))
  const anySlot = (await call(`/api/availability/slots?serviceId=svc_cut&staffId=any&date=${dRace}`)).data.find((s) => s.staffIds.length >= 2)
  if (anySlot) {
    const anyRes = await Promise.all(Array.from({ length: 10 }, (_, i) => call('/api/bookings', {
      method: 'POST', body: { serviceId: 'svc_cut', staffId: 'any', date: dRace, start: anySlot.start, client: { name: `Any ${i}`, phone: '(555) 300-0000', email: `any${i}.${rnd()}@example.com` }, notes: '' },
    })))
    const wins = anyRes.filter((r) => r.status === 201).map((r) => r.data.staffId)
    ok(`10 parallel "any specialist" creates → one per free specialist (${anySlot.staffIds.length}), each specialist once`, wins.length === anySlot.staffIds.length && new Set(wins).size === wins.length && anyRes.every((r) => r.status === 201 || r.status === 409), `${wins.length}×201: ${wins.join(',')}`)
  } else ok('"any specialist" race skipped (no slot with ≥2 free specialists)', true)

  // ---------- reschedule ----------
  section('Reschedule conflicts')
  const rs = await slotsFor(dResched)
  const pick = (after) => rs.find((s) => s.start >= after)
  const sa = rs[0], sb = pick(sa.end + 60), sc = pick(sb.end + 60), sd = pick(sc.end + 60)
  const mk = async (s, n) => (await call('/api/admin/bookings', { method: 'POST', cookie: ADMIN, body: { serviceId: 'svc_fade', staffId: 'stf_marco', date: dResched, start: s.start, client: { name: n, phone: '', email: '' }, notes: '' } })).data
  const X = await mk(sa, 'Resched X'), Y = await mk(sb, 'Resched Y')
  const re = (id, start, staffId = 'stf_marco', d = dResched) => call(`/api/admin/bookings/${id}/reschedule`, { method: 'POST', cookie: ADMIN, body: { date: d, start, staffId } })
  const r1 = await re(Y.id, X.start)
  ok('Reschedule into an occupied slot (same start) → 409', r1.status === 409, `${r1.status} ${JSON.stringify(r1.data)}`)
  const r2 = await re(Y.id, X.start + 15)
  ok('Reschedule into an overlapping time → 409', r2.status === 409, String(r2.status))
  const yAfter = (await call(`/api/admin/bookings/${Y.id}`, { cookie: ADMIN })).data
  ok('Failed reschedule leaves the booking unchanged', yAfter.start === Y.start && yAfter.date === Y.date)
  const r3 = await re(Y.id, sc.start)
  ok('Reschedule into a free slot → 200', r3.status === 200 && r3.data.start === sc.start)
  const both = await Promise.all([re(X.id, sd.start), re(Y.id, sd.start)])
  ok('Two parallel reschedules into the same free slot → exactly one wins', both.map((r) => r.status).sort().join(',') === '200,409', both.map((r) => r.status).join(','))
  const Z = await mk(pick(sd.end + 30) ?? rs[rs.length - 1], 'Resched Z')
  await call(`/api/admin/bookings/${Z.id}/status`, { method: 'PATCH', cookie: ADMIN, body: { status: 'cancelled' } })
  const W = await mk({ start: Z.start }, 'Resched W')
  const restore = await call(`/api/admin/bookings/${Z.id}/status`, { method: 'PATCH', cookie: ADMIN, body: { status: 'confirmed' } })
  ok('Restoring a cancelled booking whose slot was re-booked → 409', W?.id && restore.status === 409, String(restore.status))

  // ---------- persistence across restart ----------
  section('Persistence across a server restart')
  const before = (await call('/api/admin/bookings', { cookie: ADMIN })).data
  await ctxA.close(); await ctxB.close()
  await stopServer()
  let down = false
  try { await fetch(BASE + '/api/health') } catch { down = true }
  ok('Server stopped', down)
  await startServer()
  ok('Server restarted on the same local D1', (await call('/api/health')).data?.ok === true)
  const sameSession = await call('/api/admin/bookings', { cookie: ADMIN })
  ok('Existing admin session still valid after restart (sessions live in D1)', sameSession.status === 200)
  const after = sameSession.data ?? []
  ok('All bookings survived the restart', after.length === before.length && before.every((b) => after.some((a) => a.id === b.id && a.status === b.status && a.start === b.start)), `${before.length} → ${after.length}`)
  ok('UI booking from browser A still found by code', (await call(`/api/bookings/by-code/${uiCode}`)).data?.code === uiCode)
  const ctxC = await browser.newContext()
  const C = await ctxC.newPage()
  await C.goto(BASE + '/'); await C.click('[data-testid="service-svc_fade"]'); await C.click('[data-testid="staff-stf_marco"]')
  await C.waitForSelector('[data-testid="slot"]'); await C.click(`[data-date="${uiDate}"]`).catch(() => {}); await C.waitForTimeout(400)
  ok('Fresh browser after restart: booked slot still taken', !(await C.$$eval('[data-testid="slot"]', (els) => els.map((e) => e.textContent))).includes(uiTime))
  await ctxC.close()

  // ---------- logout + rate limit ----------
  section('Logout and brute-force limit')
  await call('/api/auth/logout', { method: 'POST', cookie: ADMIN })
  ok('After logout the old cookie → 401', (await call('/api/admin/bookings', { cookie: ADMIN })).status === 401)
  const ipHdr = { 'CF-Connecting-IP': `203.0.113.${Math.floor(Math.random() * 200) + 20}` } // set by Cloudflare in production; simulated here
  const tries = []
  for (let i = 0; i < 5; i++) tries.push((await login(CREDS.username, 'nope-' + i, ipHdr)).status)
  const blocked = await login(CREDS.username, CREDS.password, ipHdr)
  ok('5 wrong passwords from one IP → 6th attempt (even correct) → 429', tries.every((s) => s === 401) && blocked.status === 429 && !blocked.setCookie, `${tries.join(',')} → ${blocked.status}, retry-after=${blocked.headers.get('retry-after')}`)
  ok('Other IPs are not affected', (await login()).status === 200)

  exitCode = results.every((r) => r.pass) ? 0 : 1
} catch (e) {
  console.error('\nFATAL:', e)
  console.error(serverLog.slice(-2000))
} finally {
  await browser.close().catch(() => {})
  await stopServer()
  if (!process.env.KEEP_E2E_DB) rmSync(PERSIST, { recursive: true, force: true })
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed${exitCode && !failed.length ? ' (aborted)' : ''}`)
process.exit(exitCode)
