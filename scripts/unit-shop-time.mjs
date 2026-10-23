// Unit tests for the shop-timezone helpers (src/lib/shopTime.ts, date.ts, availability.ts, ics.ts).
// Bundles scripts/unit/shop-time.test.ts with esbuild and runs it under several PROCESS timezones — results must
// be identical because nothing may depend on the machine/browser zone. Usage: npm run test:unit
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'node_modules', '.cache', 'unit', 'shop-time.test.mjs')
mkdirSync(join(OUT, '..'), { recursive: true })
await build({ entryPoints: [join(ROOT, 'scripts/unit/shop-time.test.ts')], bundle: true, platform: 'node', format: 'esm', outfile: OUT, logLevel: 'warning' })

const zones = ['UTC', 'Europe/Prague', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Pacific/Kiritimati']
let bad = 0
for (const tz of zones) {
  const r = spawnSync(process.execPath, [OUT], { env: { ...process.env, TZ: tz }, encoding: 'utf8' })
  process.stdout.write(r.stdout + r.stderr)
  if (r.status !== 0) bad++
}
console.log(bad ? `\n${bad}/${zones.length} timezone runs FAILED` : `\nAll ${zones.length} timezone runs passed`)
process.exit(bad ? 1 : 0)
