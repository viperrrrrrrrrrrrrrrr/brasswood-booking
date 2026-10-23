// Smoke/acceptance test for a DEPLOYED (or local) Brasswood site. Plain HTTP, no browser, no Cloudflare API.
// Creates only clearly fake data ('Test Verify', test+<ts>…@example.com, 555-01xx phone) and removes ALL of it.
//
//   PowerShell:  $env:BASE_URL="https://brasswood-test.pages.dev"; $env:ADMIN_USERNAME="admin"; $env:ADMIN_PASSWORD="…"; npm run verify:remote
//   bash:        BASE_URL=… ADMIN_USERNAME=… ADMIN_PASSWORD=… npm run verify:remote
//
// Flags:
//   --keep          leave ONE booking (context A's) in place for the manual persistence check; prints its code
//   --cleanup-only  only delete leftovers of earlier runs (clients named 'Test Verify' with test+…@example.com)
// Login lockout: exactly ONE wrong password is sent per run (the server locks an IP after 5 failures in 15 min,
// and a successful login resets the counter), so re-running is safe.
const BASE = (process.env.BASE_URL ?? '').replace(/\/+$/, '')
const USER = process.env.ADMIN_USERNAME ?? 'admin'
const PASS = process.env.ADMIN_PASSWORD ?? ''
const KEEP = process.argv.includes('--keep')
const CLEANUP_ONLY = process.argv.includes('--cleanup-only')
if (!/^https?:\/\//.test(BASE) || !PASS) {
  console.error('Set BASE_URL (e.g. https://brasswood-test.pages.dev), ADMIN_USERNAME and ADMIN_PASSWORD in the environment.')
  process.exit(2)
}

const TS = Date.now()
const NAME = 'Test Verify'
const email = (tag = '') => `test+${TS}${tag ? '-' + tag : ''}@example.com`
const PHONE = `(555) 555-01${String(TS % 100).padStart(2, '0')}` // 555-0100…0199 is reserved for fiction
const MARKER = /^test\+\d+(-[a-z0-9]+)?@example\.com$/
const results = []
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  return !!cond
}
const section = (t) => console.log(`\n== ${t} ==`)
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** One "browser context" = its own cookie jar. */
function context(label) {
  let cookie = null
  return {
    label,
    get cookie() { return cookie },
    async call(path, { method = 'GET', body } = {}) {
      const headers = { accept: 'application/json', 'user-agent': 'brasswood-verify-remote', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { origin: BASE } : {}), ...(cookie ? { cookie } : {}) }
      const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' })
      const sc = res.headers.get('set-cookie')
      if (sc && sc.startsWith('bw_admin_session=')) cookie = /bw_admin_session=;|Max-Age=0/i.test(sc) ? null : sc.split(';')[0]
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: res.status, data, text, setCookie: sc }
    },
    login(password = PASS) { return this.call('/api/auth/login', { method: 'POST', body: { username: USER, password } }) },
  }
}

const created = { bookings: new Map(), clients: new Set() } // id -> label
let admin = null
let B = null // 'fresh browser' admin context

async function cleanupAll(ctx, { onlyMarked }) {
  let nb = 0, nc = 0
  const clients = (await ctx.call('/api/admin/clients')).data ?? []
  const mine = clients.filter((c) => c.name === NAME && MARKER.test(c.email) && (onlyMarked || created.clients.has(c.id)))
  for (const c of mine) created.clients.add(c.id)
  for (const cid of created.clients) {
    const bs = (await ctx.call(`/api/admin/bookings?clientId=${encodeURIComponent(cid)}`)).data ?? []
    for (const b of bs) created.bookings.set(b.id, created.bookings.get(b.id) ?? 'leftover')
  }
  for (const id of created.bookings.keys()) {
    const b = await ctx.call(`/api/admin/bookings/${id}`)
    if (b.status === 404) { created.bookings.delete(id); continue }
    if (b.data?.status !== 'cancelled') await ctx.call(`/api/admin/bookings/${id}/status`, { method: 'PATCH', body: { status: 'cancelled' } })
    const d = await ctx.call(`/api/admin/bookings/${id}`, { method: 'DELETE' })
    if (d.status === 204) { nb++; created.bookings.delete(id) } else console.log(`WARN  could not delete booking ${id}: ${d.status}`)
  }
  for (const id of [...created.clients]) {
    const d = await ctx.call(`/api/admin/clients/${id}`, { method: 'DELETE' })
    if (d.status === 204 || d.status === 404) { nc += d.status === 204 ? 1 : 0; created.clients.delete(id) } else console.log(`WARN  could not delete client ${id}: ${d.status} ${d.text}`)
  }
  return { nb, nc }
}

let exitCode = 1
try {
  console.log(`Target: ${BASE}  (user "${USER}")${KEEP ? '  [--keep]' : ''}${CLEANUP_ONLY ? '  [--cleanup-only]' : ''}`)

  if (CLEANUP_ONLY) {
    admin = context('admin')
    const l = await admin.login()
    if (!ok('Admin login', l.status === 200 && admin.cookie, String(l.status))) throw new Error('login failed')
    const r = await cleanupAll(admin, { onlyMarked: true })
    ok(`Removed leftovers: ${r.nb} booking(s), ${r.nc} client(s)`, created.bookings.size === 0 && created.clients.size === 0)
    exitCode = results.every((r) => r.pass) ? 0 : 1
  } else {
    section('Health & D1 binding')
    const anon = context('anon')
    const h = await anon.call('/api/health')
    if (!ok('/api/health → ok, D1 bound, schema + seed present', h.status === 200 && h.data?.ok === true && h.data?.db === 'ok' && h.data?.seeded === true, `${h.status} ${h.text.slice(0, 160)}`)) throw new Error('health failed — stop (binding/migrations/seed?)')
    ok('Schema 2 (migration 0002_data_versions applied)', h.data?.schema === 2, `schema=${h.data?.schema}`)
    ok('TEST_CLOCK is NOT enabled (x-test-now headers are ignored)', h.data?.testClock !== true)

    section('Admin authentication')
    for (const p of ['/api/admin/bookings', '/api/admin/clients']) {
      const r = await anon.call(p)
      ok(`GET ${p} without cookie → 401`, r.status === 401, String(r.status))
    }
    const me = await anon.call('/api/auth/me')
    ok('/api/auth/me without cookie → not authenticated', me.data?.authenticated === false)
    const wrong = await context('wrong').login(PASS + '-wrong')
    if (wrong.status === 429) { ok('Login is currently LOCKED for this IP (5 failures / 15 min) — wait and re-run', false, wrong.text); throw new Error('locked out') }
    ok('Exactly ONE wrong-password attempt → 401, no session cookie', wrong.status === 401 && !wrong.setCookie, String(wrong.status))
    admin = context('admin')
    const good = await admin.login()
    ok('Correct password → 200 + session cookie', good.status === 200 && !!admin.cookie, String(good.status))
    if (!admin.cookie) throw new Error('login failed — check ADMIN_USERNAME / ADMIN_PASSWORD secrets')
    const sc = good.setCookie ?? ''
    ok('Session cookie is HttpOnly + SameSite=Strict' + (BASE.startsWith('https') ? ' + Secure' : ''), /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc) && (!BASE.startsWith('https') || /Secure/i.test(sc)), sc.replace(/=[^;]+/, '=…'))
    ok('Admin API works with the cookie', (await admin.call('/api/admin/clients')).status === 200)

    section('Pick a service, specialist and free slots')
    const services = (await anon.call('/api/services')).data.filter((s) => s.active)
    const staff = (await anon.call('/api/staff')).data.filter((s) => s.active)
    let svc, stf, date, slots = []
    outer: for (const s of services) {
      for (const p of staff.filter((x) => x.serviceIds.includes(s.id))) {
        const next = (await anon.call(`/api/availability/next?serviceId=${s.id}&staffIds=${p.id}`)).data?.[p.id]
        if (!next) continue
        // prefer a date with ≥2 non-overlapping free slots
        for (let i = 0; i < 14; i++) {
          const d = new Date(next.date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i)
          const ds = d.toISOString().slice(0, 10)
          const sl = (await anon.call(`/api/availability/slots?serviceId=${s.id}&staffId=${p.id}&date=${ds}`)).data ?? []
          if (sl.length >= 2 && sl.some((x) => x.start >= sl[0].end)) { svc = s; stf = p; date = ds; slots = sl; break outer }
        }
      }
    }
    if (!ok('Found a date with two free slots', !!svc, svc ? `${svc.name} / ${stf.name} / ${date}` : 'no availability in the horizon')) throw new Error('no slots')
    const s1 = slots[0]
    const s2 = slots.find((x) => x.start >= s1.end)

    section('Context A (public visitor) books → context B (fresh admin session) sees it')
    const A = context('A')
    const vBefore = (await admin.call('/api/admin/changes')).data
    const bookA = await A.call('/api/bookings', { method: 'POST', body: { serviceId: svc.id, staffId: stf.id, date, start: s1.start, client: { name: NAME, phone: PHONE, email: email('a') }, notes: 'automated verify-remote test' } })
    if (bookA.status === 201) created.bookings.set(bookA.data.id, 'A')
    ok('Public POST /api/bookings (context A, no cookie) → 201', bookA.status === 201, `${bookA.status} ${bookA.data?.code ?? bookA.text.slice(0, 120)} ${date} ${fmt(s1.start)}`)
    if (bookA.status !== 201) throw new Error('booking failed')
    B = context('B')
    ok('Context B: fresh admin login', (await B.login()).status === 200 && !!B.cookie)
    const list = (await B.call(`/api/admin/bookings?from=${date}&to=${date}&staffId=${stf.id}`)).data ?? []
    const seen = list.find((b) => b.id === bookA.data.id)
    ok('Context B sees A\'s booking in the admin list', !!seen && seen.start === s1.start && seen.status === 'confirmed')
    if (seen) {
      created.clients.add(seen.clientId)
      const cl = (await B.call(`/api/admin/clients/${seen.clientId}`)).data
      ok('…with the client details (admin only)', cl?.name === NAME && cl?.email === email('a'))
    }
    const after = (await anon.call(`/api/availability/slots?serviceId=${svc.id}&staffId=${stf.id}&date=${date}`)).data ?? []
    ok(`Slot ${fmt(s1.start)} is now shown as taken (gone from public slots)`, !after.some((x) => x.start < s1.end && x.end > s1.start))
    const byCode = await A.call(`/api/bookings/by-code/${bookA.data.code}`)
    ok('Context A finds the booking by its code', byCode.status === 200 && byCode.data?.id === bookA.data.id)
    const vAfter = (await B.call('/api/admin/changes')).data
    ok('Change counter (GET /api/admin/changes) bumped by the booking', typeof vBefore?.bookings === 'number' && vAfter?.bookings > vBefore.bookings, `bookings ${vBefore?.bookings} → ${vAfter?.bookings}`)
    ok('Public by-code returns canCancel (shop timezone)', typeof byCode.data?.canCancel === 'boolean')

    section('10 parallel creates on one slot')
    const race = await Promise.all(Array.from({ length: 10 }, (_, i) => context('race' + i).call('/api/bookings', {
      method: 'POST', body: { serviceId: svc.id, staffId: stf.id, date, start: s2.start, client: { name: NAME, phone: PHONE, email: email('r' + i) }, notes: '' },
    })))
    const st = race.map((r) => r.status)
    const winners = race.filter((r) => r.status === 201)
    for (const w of winners) created.bookings.set(w.data.id, 'race')
    ok('Exactly 1×201 and 9×409', winners.length === 1 && st.filter((s) => s === 409).length === 9, st.join(','))
    const runClients = ((await B.call('/api/admin/clients')).data ?? []).filter((c) => c.email.startsWith(`test+${TS}`))
    for (const c of runClients) created.clients.add(c.id)
    // the server may match an existing client by phone/email, so count orphans (clients with no booking), not clients
    let orphans = 0
    for (const c of runClients) if (!((await B.call(`/api/admin/bookings?clientId=${encodeURIComponent(c.id)}`)).data ?? []).length) orphans++
    ok('Losing requests left no orphan client records', orphans === 0 && runClients.length <= 1 + winners.length, `${runClients.length} client(s) for this run, ${orphans} without bookings`)

    section('Reschedule into a taken slot')
    const R = winners[0]?.data
    if (R) {
      const re = await B.call(`/api/admin/bookings/${R.id}/reschedule`, { method: 'POST', body: { date, start: s1.start, staffId: stf.id } })
      ok(`Reschedule ${fmt(s2.start)} → ${fmt(s1.start)} (taken by A) → 409`, re.status === 409, `${re.status} ${re.data?.error?.message ?? ''}`)
      const r2 = (await B.call(`/api/admin/bookings/${R.id}`)).data
      ok('Failed reschedule left the booking unchanged', r2?.start === s2.start && r2?.date === date)
    } else ok('Reschedule check skipped (no race winner)', false)

    section('Public endpoints leak no personal data')
    const pii = [NAME, `test+${TS}`, PHONE, PHONE.replace(/\D/g, '')]
    const publicGets = [
      '/api/services', '/api/staff', '/api/settings',
      `/api/availability/slots?serviceId=${svc.id}&staffId=${stf.id}&date=${date}`,
      `/api/availability/slots?serviceId=${svc.id}&staffId=any&date=${date}`,
      `/api/availability/open-dates?serviceId=${svc.id}&staffId=any&from=${date}&to=${date}`,
      `/api/availability/next?serviceId=${svc.id}&staffIds=${stf.id},any`,
      `/api/bookings/by-code/${bookA.data.code}`, ...(R ? [`/api/bookings/by-code/${R.code}`] : []),
    ]
    const leaky = []
    for (const p of publicGets) {
      const r = await anon.call(p)
      const t = r.text.toLowerCase()
      if (pii.some((x) => t.includes(x.toLowerCase())) || /"clientId"\s*:\s*"[^"]+"/.test(r.text)) leaky.push(p)
    }
    ok(`${publicGets.length} public GETs contain no name/email/phone/clientId`, leaky.length === 0, leaky.join(', '))
    ok('Public POST response itself has no PII / clientId', !pii.some((x) => bookA.text.includes(x)) && bookA.data.clientId === '')
    for (const p of ['/api/clients', '/api/bookings']) {
      const r = await anon.call(p)
      ok(`GET ${p} (no cookie) exposes nothing`, [401, 404, 405].includes(r.status) && !pii.some((x) => r.text.includes(x)), String(r.status))
    }

    exitCode = 0
  }
} catch (e) {
  console.log(`\nSTOPPED: ${e.message}`)
} finally {
  if (!CLEANUP_ONLY && admin?.cookie) {
    section('Clean-up')
    let kept = null
    if (KEEP) {
      kept = [...created.bookings].find(([, l]) => l === 'A')?.[0]
      if (kept) {
        created.bookings.delete(kept)
        const b = (await admin.call(`/api/admin/bookings/${kept}`)).data
        created.clients.delete(b.clientId)
        console.log(`KEPT  booking ${b.code} on ${b.date} ${fmt(b.start)} (client "${NAME}") for the manual persistence check.`)
        console.log('      Remove it afterwards with:  npm run verify:remote -- --cleanup-only')
      }
    }
    const r = await cleanupAll(admin, { onlyMarked: false })
    const left = ((await admin.call('/api/admin/clients')).data ?? []).filter((c) => c.email.startsWith(`test+${TS}`) && (!kept || c.email !== email('a')))
    ok(`Deleted ${r.nb} booking(s) and ${r.nc} client(s) created by this run`, created.bookings.size === 0 && created.clients.size === 0 && left.length === 0, left.length ? `${left.length} left` : '')
  }
  // log out every session we opened, so no admin_sessions rows are left behind
  for (const c of [admin, B]) if (c?.cookie) await c.call('/api/auth/logout', { method: 'POST' }).catch(() => {})
  const failed = results.filter((r) => !r.pass)
  console.log(`\n== Summary ==\n${results.length - failed.length}/${results.length} checks passed against ${BASE}`)
  for (const f of failed) console.log(`  FAILED: ${f.name}`)
  process.exitCode = failed.length || exitCode ? 1 : 0
}
