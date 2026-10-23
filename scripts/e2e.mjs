// End-to-end smoke test + screenshots against a running build.
// Static demo: npm run build:demo && npm run preview:demo   then  npm run e2e
// API + D1:    npm run dev:api                              then  npm run e2e -- --mode=api
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BASE, CHROME, MODE, SHOT_PREFIX, allBookings, isExpectedConsoleError, uiLogin } from './e2e-lib.mjs'

console.log(`mode=${MODE} base=${BASE}`)
const OUT = fileURLToPath(new URL('../shots/', import.meta.url))
mkdirSync(OUT, { recursive: true })
const results = []
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const errors = []

async function bookFlow(page, { serviceId, staffId }) {
  await page.click(`[data-testid="service-${serviceId}"]`)
  await page.click(`[data-testid="staff-${staffId}"]`)
  await page.waitForSelector('[data-testid="slot"]')
}

// ---------------- Desktop booking ----------------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !isExpectedConsoleError(m.text()) && errors.push(m.text()))
await page.goto(BASE + '/')
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForSelector('[data-testid="service-svc_fade"]')
await page.waitForTimeout(800) // fonts
await bookFlow(page, { serviceId: 'svc_fade', staffId: 'stf_marco' })
const date = await page.$eval('[data-date][aria-pressed="true"]', (el) => el.getAttribute('data-date'))
const slotTexts = await page.$$eval('[data-testid="slot"]', (els) => els.map((e) => e.textContent))
ok('Slots computed for Skin Fade with Marco', slotTexts.length > 0, `${date}: ${slotTexts.length} slots, first ${slotTexts[0]}`)
await page.waitForTimeout(300)
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(300)
await page.screenshot({ path: OUT + SHOT_PREFIX + 'booking.png', fullPage: true })
const chosen = slotTexts[1] ?? slotTexts[0]
await page.locator('[data-testid="slot"]', { hasText: chosen }).first().click()
await page.fill('input[name="name"]', 'Jordan Ellis')
await page.fill('input[name="phone"]', '(555) 019-4471')
await page.fill('input[name="email"]', 'jordan.ellis@example.com')
await page.fill('textarea[name="notes"]', 'Low skin fade, keep length on top.')
await page.click('[data-testid="confirm-desktop"]')
await page.waitForSelector('[data-testid="booking-code"]')
const code = (await page.textContent('[data-testid="booking-code"]')).trim()
ok('Booking confirmed with code', /^BW-[A-Z0-9]{6}$/.test(code), code)
await page.waitForTimeout(500)
await page.screenshot({ path: OUT + SHOT_PREFIX + 'booking-confirmation.png', fullPage: true })

// no double booking: same service/staff/date must not offer the booked time anymore
await page.click('text=Book another appointment')
await bookFlow(page, { serviceId: 'svc_fade', staffId: 'stf_marco' })
// If the run happens late in the shop day, the booked slot may have been the last bookable one today,
// in which case the date button becomes disabled — that also means the time is no longer offered.
const dateOpen = await page.$eval(`[data-date="${date}"]`, (el) => !el.disabled).catch(() => false)
if (dateOpen) await page.click(`[data-date="${date}"]`)
await page.waitForTimeout(300)
const after = dateOpen ? await page.$$eval('[data-testid="slot"]', (els) => els.map((e) => e.textContent)) : []
ok('Booked time no longer offered (no double booking)', !after.includes(chosen), dateOpen ? `${chosen} removed; ${after.length} slots left` : `${date} is no longer bookable at all`)

// ---------------- Admin ----------------
await page.goto(BASE + '/admin')
await page.waitForURL('**/admin/login')
ok('Admin requires login', page.url().endsWith('/admin/login'))
await uiLogin(page)
await page.waitForSelector('text=Revenue · last 7 days')
await page.waitForTimeout(500)
await page.screenshot({ path: OUT + SHOT_PREFIX + 'admin-dashboard.png' })
ok('Dashboard renders KPIs', await page.isVisible('text=Today’s bookings'))

// Schedule: find the new booking
await page.click('nav >> text=Schedule')
await page.click('[data-testid="view-week"]')
let found = false
for (let i = 0; i < 6 && !found; i++) {
  await page.waitForTimeout(250)
  found = (await page.$(`[data-testid="booking-block"][data-code="${code}"]`)) !== null
  if (!found) await page.click('button[aria-label="Next"]')
}
ok('New booking appears in admin schedule (week view)', found)
await page.screenshot({ path: OUT + SHOT_PREFIX + 'admin-calendar.png' })
await page.click(`[data-testid="booking-block"][data-code="${code}"]`)
await page.waitForSelector('text=Jordan Ellis')
ok('Booking details show client', await page.isVisible('text=jordan.ellis@example.com'))
await page.click('[data-testid="status-completed"]')
await page.waitForSelector('[data-testid="status-completed"][aria-checked="true"]')
ok('Status change persisted (completed)', (await allBookings(page)).find((b) => b.code === code)?.status === 'completed')
await page.click('[data-testid="status-confirmed"]')
await page.waitForSelector('[data-testid="status-confirmed"][aria-checked="true"]')
await page.click('text=Done')

// day view screenshot of the booking date
await page.click('[data-testid="view-day"]')
await page.click('button:has-text("Today")')
await page.waitForTimeout(4500) // let toasts fade
await page.screenshot({ path: OUT + SHOT_PREFIX + 'admin-calendar-day.png' })

// Clients: search
await page.click('nav >> text=Clients')
await page.fill('[data-testid="client-search"]', 'jordan')
await page.waitForTimeout(200)
const rows = await page.$$eval('[data-testid="client-rows"] tr', (els) => els.map((e) => e.textContent))
ok('Client created & searchable', rows.length === 1 && rows[0].includes('Jordan Ellis'))
await page.click('[data-testid="client-rows"] tr')
ok('Client history contains booking', await page.isVisible(`text=${code}`))

// ---------------- Cancel by code ----------------
await page.goto(`${BASE}/manage?code=${code}`)
await page.waitForSelector('text=Cancel booking')
await page.click('text=Cancel booking')
await page.click('[data-testid="confirm-cancel"]')
await page.waitForSelector('text=This booking is cancelled')
ok('Client can cancel by code', true)
const freed = (await allBookings(page)).find((b) => b.code === code)?.status
ok('Cancelled status stored', freed === 'cancelled')
await page.goto(BASE + '/')
await bookFlow(page, { serviceId: 'svc_fade', staffId: 'stf_marco' })
await page.click(`[data-date="${date}"]`)
await page.waitForTimeout(300)
const again = await page.$$eval('[data-testid="slot"]', (els) => els.map((e) => e.textContent))
ok('Cancelled slot released back to availability', again.includes(chosen))
await ctx.close()

// ---------------- Mobile ----------------
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' })
const m = await mctx.newPage()
m.on('pageerror', (e) => errors.push('mobile: ' + e.message))
await m.goto(BASE + '/')
await m.waitForSelector('[data-testid="service-svc_cut"]')
await m.waitForTimeout(800)
await m.screenshot({ path: OUT + SHOT_PREFIX + 'booking-mobile-services.png' })
await m.click('[data-testid="service-svc_cut"]')
await m.click('[data-testid="staff-any"]')
await m.waitForSelector('[data-testid="slot"]')
await m.waitForTimeout(700)
await m.screenshot({ path: OUT + SHOT_PREFIX + 'booking-mobile.png' })
await m.locator('[data-testid="slot"]').first().click()
await m.fill('input[name="name"]', 'Sam Okoye')
await m.fill('input[name="phone"]', '(555) 017-2210')
await m.fill('input[name="email"]', 'sam.okoye@example.com')
await m.click('[data-testid="confirm-mobile"]')
await m.waitForSelector('[data-testid="booking-code"]')
ok('Mobile booking completes ("any specialist")', true, (await m.textContent('[data-testid="booking-code"]')).trim())
await m.waitForTimeout(600)
await m.screenshot({ path: OUT + SHOT_PREFIX + 'booking-mobile-confirmation.png' })
await m.goto(BASE + '/admin/login')
await uiLogin(m)
await m.waitForSelector('text=Revenue · last 7 days')
await m.waitForTimeout(400)
await m.screenshot({ path: OUT + SHOT_PREFIX + 'admin-dashboard-mobile.png' })
await mctx.close()

ok('No uncaught page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
