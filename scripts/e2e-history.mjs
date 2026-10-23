// Browser history (Back / Forward / reload) checks for the booking flow and admin, desktop + mobile.
// Static demo: npm run build:demo && npm run preview:demo (another shell), then  npm run e2e:history
// API + D1:    npm run dev:api (another shell), then                              npm run e2e:history -- --mode=api
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { BASE, CHROME, MODE, SHOT_PREFIX, allBookings, isExpectedConsoleError, uiLogin } from './e2e-lib.mjs'

console.log(`mode=${MODE} base=${BASE}`)
const results = []
let prefix = ''
const ok = (name, cond, extra = '') => {
  results.push({ name: prefix + name, pass: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${prefix}${name}${extra ? '  — ' + extra : ''}`)
}
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

const VIEWPORTS = [
  { label: 'desktop', opts: { viewport: { width: 1440, height: 900 } } },
  {
    label: 'mobile', mobile: true,
    opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  },
]

for (const vp of VIEWPORTS) {
  prefix = `[${vp.label}] `
  const ctx = await browser.newContext(vp.opts)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !isExpectedConsoleError(m.text()) && errors.push(m.text()))

  const step = () => new URL(page.url()).searchParams.get('step') ?? 'service'
  const waitStep = async (s) => {
    await page.waitForFunction((s) => (new URL(location.href).searchParams.get('step') ?? 'service') === s, s, { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(250)
  }
  const bookingsCount = async () => (await allBookings(page)).length
  const cls = (sel) => page.getAttribute(sel, 'class')
  const summaryText = () => page.locator(vp.mobile ? 'div.fixed.inset-x-0.bottom-0' : 'aside').first().innerText()
  const confirmSel = vp.mobile ? '[data-testid="confirm-mobile"]' : '[data-testid="confirm-desktop"]'
  const inAppBack = () => (vp.mobile ? page.click('button[aria-label="Back"]') : page.click('main button:has-text("Back")'))
  const selectedSlot = () => page.$$eval('[data-testid="slot"]', (els) => els.filter((e) => e.className.includes('bg-ink')).map((e) => e.textContent))

  await page.goto(BASE + '/')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.goto(BASE + '/manage') // a page *before* the booking flow, to prove Back no longer leaves the flow
  await page.click('nav >> text=Book')
  await page.waitForSelector('[data-testid="service-svc_fade"]')

  // ---------- forward through the steps ----------
  await page.click('[data-testid="service-svc_fade"]')
  await waitStep('specialist')
  const staffName = (await page.locator('[data-testid="staff-stf_marco"] .font-medium').first().innerText()).trim()
  await page.click('[data-testid="staff-stf_marco"]')
  await waitStep('datetime')
  await page.waitForSelector('[data-testid="slot"]')
  const date = await page.$eval('[data-date][aria-pressed="true"]', (el) => el.getAttribute('data-date'))
  const slots = await page.$$eval('[data-testid="slot"]', (els) => els.map((e) => e.textContent))
  const time = slots[2] ?? slots[0]
  await page.locator('[data-testid="slot"]', { hasText: time }).first().click()
  await waitStep('details')
  await page.fill('input[name="name"]', 'History Tester')
  await page.fill('input[name="phone"]', '(555) 010-2020')
  await page.fill('input[name="email"]', 'history@example.com')
  ok('Forward clicks push ?step=specialist → datetime → details', step() === 'details', `${date} ${time} with ${staffName}`)

  // ---------- browser Back through every step ----------
  await page.goBack(); await waitStep('datetime')
  await page.waitForSelector('[data-testid="slot"]')
  const dateBack = await page.$eval('[data-date][aria-pressed="true"]', (el) => el.getAttribute('data-date')).catch(() => null)
  const sum1 = await summaryText()
  ok('Back: details → datetime, date & slot still selected', step() === 'datetime' && dateBack === date && (await selectedSlot()).includes(time), `date=${dateBack} slot=${await selectedSlot()}`)
  ok('Back: summary panel intact on datetime', sum1.includes('Skin Fade') && sum1.includes(time) && (vp.mobile || sum1.includes(staffName)))
  await page.goBack(); await waitStep('specialist')
  ok('Back: datetime → specialist, specialist highlighted', step() === 'specialist' && (await cls('[data-testid="staff-stf_marco"]')).includes('ring-brand-400'))
  await page.goBack(); await waitStep('service')
  ok('Back: specialist → service, service highlighted, still on booking page', new URL(page.url()).pathname === '/' && step() === 'service' && (await cls('[data-testid="service-svc_fade"]')).includes('ring-brand-400'))
  const sum2 = await summaryText()
  ok('Summary keeps all selections on service step', sum2.includes('Skin Fade') && sum2.includes(time))

  // ---------- browser Forward ----------
  await page.goForward(); await waitStep('specialist')
  await page.goForward(); await waitStep('datetime')
  await page.goForward(); await waitStep('details')
  ok('Forward ×3 restores specialist → datetime → details with typed details', step() === 'details' && (await page.inputValue('input[name="name"]')) === 'History Tester')

  // ---------- reload mid-flow ----------
  await page.reload(); await page.waitForSelector('input[name="name"]')
  const sum3 = await summaryText()
  ok('Reload on details keeps step, details and summary', step() === 'details' && (await page.inputValue('input[name="email"]')) === 'history@example.com' && sum3.includes('Skin Fade') && sum3.includes(time))
  await page.goBack(); await waitStep('datetime'); await page.waitForSelector('[data-testid="slot"]')
  await page.reload(); await page.waitForSelector('[data-testid="slot"]'); await page.waitForTimeout(300)
  ok('Reload on datetime keeps date + slot highlighted', step() === 'datetime' && (await selectedSlot()).includes(time))

  // ---------- in-app Back button behaves like browser Back ----------
  await page.goForward(); await waitStep('details')
  await inAppBack(); await waitStep('datetime')
  await page.goForward(); await waitStep('details')
  ok('In-app Back = history back (browser Forward returns to details)', step() === 'details')

  // ---------- Forward blocked when prerequisites changed ----------
  await page.goBack(); await waitStep('datetime')
  await page.goBack(); await waitStep('specialist')
  await page.goBack(); await waitStep('service')
  await page.click('[data-testid="service-svc_cut"]') // pick another service → new branch, slot cleared
  await waitStep('specialist')
  await page.goBack(); await waitStep('service')
  await page.goForward(); await waitStep('specialist')
  ok('After changing service, Forward goes to specialist (forward branch replaced)', step() === 'specialist')
  await page.click('[data-testid="staff-stf_marco"]'); await waitStep('datetime')
  await page.goBack(); await waitStep('specialist')
  await page.evaluate(() => { const d = JSON.parse(sessionStorage.getItem('brasswood-booking-draft')); d.slot = null; sessionStorage.setItem('brasswood-booking-draft', JSON.stringify(d)) })
  await page.goto(BASE + '/?step=details') // details without a slot
  await page.waitForTimeout(600)
  ok('Details requested without a time → falls back to datetime', step() === 'datetime' && !(await page.$('input[name="name"]')))

  // ---------- booking → admin → Back ----------
  await page.waitForSelector('[data-testid="slot"]')
  await page.locator('[data-testid="slot"]').first().click(); await waitStep('details')
  await page.goBack(); await waitStep('datetime'); await page.waitForSelector('[data-testid="slot"]')
  const selBefore = await selectedSlot()
  // Footer link must be reachable by a real click (on mobile it used to sit under the sticky action bar).
  const adminLink = page.locator('text=Open the admin panel →')
  await adminLink.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(400)
  const linkHit = await adminLink.evaluate((a) => {
    const r = a.getBoundingClientRect()
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2]]
    return { inView: r.top >= 0 && r.bottom <= innerHeight, uncovered: pts.every(([x, y]) => a.contains(document.elementFromPoint(x, y))) }
  })
  if (vp.mobile) await page.screenshot({ path: fileURLToPath(new URL(`../shots/${SHOT_PREFIX}booking-mobile-footer.png`, import.meta.url)) })
  ok('Footer admin link visible and not covered at page bottom (elementFromPoint)', linkHit.inView && linkHit.uncovered, JSON.stringify(linkHit))
  await adminLink.click({ timeout: 5000 })
  await page.waitForURL('**/admin/login')
  const leaked = new URL(page.url()).search
  await page.goBack(); await waitStep('datetime'); await page.waitForSelector('[data-testid="slot"]'); await page.waitForTimeout(300)
  ok('Booking → admin login → Back returns to booking at the same step', new URL(page.url()).pathname === '/' && step() === 'datetime' && JSON.stringify(await selectedSlot()) === JSON.stringify(selBefore), `${page.url()}, admin url had search "${leaked}"`)
  await page.goForward(); await page.waitForURL('**/admin/login')
  ok('Forward goes back to admin login, no booking params leaked', page.url() === BASE + '/admin/login')
  await page.goBack(); await waitStep('datetime')

  // ---------- deep link without selections (fresh tab) ----------
  const fresh = await ctx.newPage()
  await fresh.goto(BASE + '/?step=details')
  await fresh.waitForSelector('[data-testid="service-svc_fade"]'); await fresh.waitForTimeout(300)
  ok('Deep link ?step=details without selections → service step', !new URL(fresh.url()).searchParams.get('step') && !(await fresh.$('input[name="name"]')))
  await fresh.evaluate(() => sessionStorage.setItem('brasswood-booking-draft', JSON.stringify({ serviceId: 'svc_fade', staffId: null, date: null, slot: null })))
  await fresh.goto(BASE + '/?step=details'); await fresh.waitForSelector('[data-testid="staff-stf_marco"]')
  ok('Deep link ?step=details with only a service → specialist step', new URL(fresh.url()).searchParams.get('step') === 'specialist')
  await fresh.close()

  // ---------- confirm, then Back does not resubmit ----------
  await page.waitForSelector('[data-testid="slot"]')
  await page.locator('[data-testid="slot"]').first().click(); await waitStep('details')
  if (!(await page.inputValue('input[name="name"]'))) await page.fill('input[name="name"]', 'History Tester')
  const before = await bookingsCount()
  await page.click(confirmSel)
  await page.waitForSelector('[data-testid="booking-code"]')
  const code = (await page.textContent('[data-testid="booking-code"]')).trim()
  ok('Booking confirmed, URL is ?confirmed=CODE', new URL(page.url()).searchParams.get('confirmed') === code, code)
  ok('Booking count +1', (await bookingsCount()) === before + 1)
  await page.goBack(); await page.waitForTimeout(800)
  ok('Back from confirmation → fresh booking start (no details form, no confirm button)', !(await page.$('input[name="name"]')) && !(await page.$(confirmSel)) && (await page.$('[data-testid="service-svc_fade"]')) && !(await cls('[data-testid="service-svc_fade"]')).includes('ring-brand-400'), page.url())
  await page.goBack(); await page.waitForTimeout(600)
  ok('Further Back never shows a submittable form', !(await page.$(confirmSel)) || !(await page.$('input[name="name"]')), page.url())
  await page.goForward(); await page.goForward(); await page.waitForTimeout(800)
  ok('Forward again shows the confirmation (read-only), not a new booking', (await page.$('[data-testid="booking-code"]')) !== null && (await bookingsCount()) === before + 1, page.url())
  await page.reload(); await page.waitForSelector('[data-testid="booking-code"]')
  ok('Reload on confirmation shows same booking, count unchanged', (await page.textContent('[data-testid="booking-code"]')).trim() === code && (await bookingsCount()) === before + 1)
  ok('Draft cleared after booking', (await page.evaluate(() => sessionStorage.getItem('brasswood-booking-draft'))) === null)

  // ---------- double click on confirm ----------
  await page.click('text=Book another appointment')
  await page.waitForSelector('[data-testid="service-svc_beard"]')
  await page.click('[data-testid="service-svc_beard"]'); await waitStep('specialist')
  await page.click('[data-testid="staff-any"]'); await waitStep('datetime')
  await page.waitForSelector('[data-testid="slot"]')
  await page.locator('[data-testid="slot"]').last().click(); await waitStep('details')
  await page.fill('input[name="name"]', 'Double Clicker')
  await page.fill('input[name="phone"]', '(555) 010-3030')
  await page.fill('input[name="email"]', 'double@example.com')
  const before2 = await bookingsCount()
  await page.evaluate((sel) => { const b = document.querySelector(sel); b.click(); b.click(); b.click() }, confirmSel) // same-tick triple click
  await page.waitForSelector('[data-testid="booking-code"]'); await page.waitForTimeout(800)
  ok('Rapid repeated clicks on Confirm create exactly one booking', (await bookingsCount()) === before2 + 1, `${before2} → ${await bookingsCount()}`)
  await page.goBack(); await page.waitForTimeout(800)
  ok('Back after double-click booking: still exactly one booking', (await bookingsCount()) === before2 + 1)

  // ---------- slot taken meanwhile (BookingConflictError) ----------
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="service-svc_cut"]')
  await page.click('[data-testid="service-svc_cut"]'); await waitStep('specialist')
  await page.click('[data-testid="staff-stf_marco"]'); await waitStep('datetime')
  await page.waitForSelector('[data-testid="slot"]')
  const cDate = await page.$eval('[data-date][aria-pressed="true"]', (el) => el.getAttribute('data-date'))
  const cTime = await page.locator('[data-testid="slot"]').first().innerText()
  await page.locator('[data-testid="slot"]').first().click(); await waitStep('details')
  await page.fill('input[name="name"]', 'Conflict Tester')
  await page.fill('input[name="phone"]', '(555) 010-4040')
  await page.fill('input[name="email"]', 'conflict@example.com')
  const other = await ctx.newPage() // another tab grabs the same slot first
  await other.goto(BASE + '/'); await other.waitForSelector('[data-testid="service-svc_cut"]')
  await other.click('[data-testid="service-svc_cut"]'); await other.click('[data-testid="staff-stf_marco"]')
  await other.waitForSelector('[data-testid="slot"]')
  await other.click(`[data-date="${cDate}"]`).catch(() => {})
  await other.waitForTimeout(300)
  await other.locator('[data-testid="slot"]', { hasText: cTime }).first().click()
  await other.fill('input[name="name"]', 'Other Tab'); await other.fill('input[name="phone"]', '(555) 010-5050'); await other.fill('input[name="email"]', 'other@example.com')
  await other.click(confirmSel); await other.waitForSelector('[data-testid="booking-code"]')
  await other.close()
  await page.waitForTimeout(500)
  const before3 = await bookingsCount()
  await page.click(confirmSel)
  await page.waitForSelector('text=That time was just taken', { timeout: 5000 }).catch(() => {})
  await waitStep('datetime')
  ok('Slot taken meanwhile → conflict toast, back to date & time, nothing created', step() === 'datetime' && (await page.$('text=That time was just taken')) !== null && (await bookingsCount()) === before3, page.url())
  await page.goForward(); await page.waitForTimeout(600)
  ok('Forward after conflict does not reach a submittable form without a time', step() === 'datetime' && !(await page.$(confirmSel)), page.url())

  // ---------- admin login / logout history ----------
  const draftBeforeAdmin = await page.evaluate(() => sessionStorage.getItem('brasswood-booking-draft'))
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="service-svc_fade"]')
  await page.goto(BASE + '/admin') // → /admin/login (replace)
  await page.waitForURL('**/admin/login')
  await uiLogin(page)
  await page.waitForSelector('text=Revenue · last 7 days')
  ok('Login redirects to /admin', new URL(page.url()).pathname === '/admin')
  await page.goBack(); await page.waitForTimeout(600)
  ok('Back after login does not show the login form', new URL(page.url()).pathname !== '/admin/login' && !(await page.$('text=Staff sign in')), page.url())
  await page.goForward(); await page.waitForSelector('text=Revenue · last 7 days')
  await page.goto(BASE + '/admin/login'); await page.waitForTimeout(600)
  ok('Visiting /admin/login while signed in redirects to admin', new URL(page.url()).pathname === '/admin' && !(await page.$('text=Staff sign in')))
  if (vp.mobile) await page.click('button[aria-label="Open menu"]')
  await page.locator('nav >> text=Schedule').last().click(); await page.waitForURL('**/admin/schedule')
  if (vp.mobile) await page.click('button[aria-label="Open menu"]')
  await page.locator('button:has-text("Sign out")').last().click()
  await page.waitForURL('**/admin/login')
  await page.goBack(); await page.waitForTimeout(600)
  ok('Back after logout does not show admin data', !(await page.$('text=Revenue · last 7 days')) && !(await page.$('[data-testid="view-week"]')) && new URL(page.url()).pathname === '/admin/login', page.url())
  await page.goBack(); await page.waitForTimeout(600)
  ok('Further Back after logout still no admin data', !(await page.$('text=Revenue · last 7 days')) && !(await page.$('[data-testid="view-week"]')), page.url())
  ok('Booking draft untouched by admin login/logout', (await page.evaluate(() => sessionStorage.getItem('brasswood-booking-draft'))) === draftBeforeAdmin)

  ok('No uncaught page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
