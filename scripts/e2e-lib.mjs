// Shared helpers so the UI suites run against both builds:
//   local (static demo, `npm run build:demo && npm run preview:demo`, default BASE_URL http://localhost:4173)
//   api   (`npm run dev:api`, Pages Functions + local D1, default BASE_URL http://localhost:8788)
// Select with `--mode=api` (or E2E_MODE=api). Works the same in PowerShell and bash.
import { readFileSync } from 'node:fs'

const arg = process.argv.find((a) => a.startsWith('--mode='))
export const MODE = (arg ? arg.split('=')[1] : process.env.E2E_MODE) === 'api' ? 'api' : 'local'
export const BASE = process.env.BASE_URL ?? (MODE === 'api' ? 'http://localhost:8788' : 'http://localhost:4173')
export const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'

/** Reads ADMIN_USERNAME / ADMIN_PASSWORD from .dev.vars (or E2E_ADMIN_PASSWORD) — only the test runner sees it. */
export function adminCreds() {
  const vars = {}
  try {
    for (const line of readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
      if (m) vars[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    }
  } catch { /* no .dev.vars */ }
  return { username: process.env.E2E_ADMIN_USERNAME ?? vars.ADMIN_USERNAME ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? vars.ADMIN_PASSWORD ?? '' }
}

/** Fill the login form the way a person would (demo: "Fill in" button; api: real password). */
export async function uiLogin(page) {
  if (MODE === 'local') {
    await page.click('text=Fill in')
  } else {
    const c = adminCreds()
    await page.fill('input[name="username"]', c.username)
    await page.fill('input[name="password"]', c.password)
  }
  await page.click('button[type="submit"]')
}

let cookie = null
/** Admin session for the test runner itself (Node fetch), used to inspect server state in api mode. */
export async function adminFetch(path, init = {}) {
  if (!cookie) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(adminCreds()) })
    if (!r.ok) throw new Error(`admin login for test runner failed: ${r.status} ${await r.text()}`)
    cookie = r.headers.get('set-cookie').split(';')[0]
  }
  return fetch(BASE + path, { ...init, headers: { ...(init.headers ?? {}), cookie } })
}

/** All bookings (both modes). */
export async function allBookings(page) {
  if (MODE === 'local') return page.evaluate(() => JSON.parse(localStorage.getItem('brasswood-booking-demo') ?? '{"bookings":[]}').bookings)
  const r = await adminFetch('/api/admin/bookings')
  return r.json()
}

/** Console noise that is expected in api mode: Chrome logs every 4xx fetch (e.g. the deliberate 409 conflict). */
export const isExpectedConsoleError = (text) => MODE === 'api' && /Failed to load resource: the server responded with a status of 409/.test(text)

/** Screenshot file prefix so api-mode runs never overwrite the demo screenshots. */
export const SHOT_PREFIX = MODE === 'api' ? 'api-' : ''
