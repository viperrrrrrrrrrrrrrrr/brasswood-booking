import type { Env } from './env'

/**
 * Server clock. In production this is always the real time. For local e2e only, `wrangler pages dev
 * --binding TEST_CLOCK=1` lets a request pin "now" with an `x-test-now: <ISO instant>` header so the browser
 * (Playwright fake clock) and the server agree on a fixed instant. TEST_CLOCK is never set in wrangler.toml,
 * so deployed environments ignore the header (verify:remote checks /api/health.testClock is not true).
 */
let override: number | null = null

export function applyTestClock(env: Env, req: Request) {
  override = null
  if (env.TEST_CLOCK !== '1') return
  const h = req.headers.get('x-test-now')
  const t = h ? Date.parse(h) : NaN
  if (!Number.isNaN(t)) override = t
}

export const testClockEnabled = (env: Env) => env.TEST_CLOCK === '1'

export function serverNow(): Date {
  return override === null ? new Date() : new Date(override)
}
