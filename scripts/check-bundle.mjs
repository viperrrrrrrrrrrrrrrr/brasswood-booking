// `npm run check:bundle` — builds the production (API) site and its Pages Functions bundle LOCALLY,
// then fails if the admin password or any demo-login leftovers are inside what would be uploaded.
// No network, no Cloudflare account. Password source: ADMIN_PASSWORD env var, else .dev.vars.
// Usage: npm run check:bundle            (also: SKIP_BUILD=1 to scan an existing dist/)
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminCreds } from './e2e-lib.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FN_OUT = join(ROOT, '.wrangler', 'check-bundle')
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } })
  if (r.status !== 0) { console.error(`FAILED: ${cmd} ${args.join(' ')}`); process.exit(1) }
}

if (!process.env.SKIP_BUILD) run('npm', ['run', 'build'])
if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist/ missing'); process.exit(1) }

// Bundle functions/ exactly like `pages deploy` would (local esbuild only).
rmSync(FN_OUT, { recursive: true, force: true })
run(process.execPath, [WRANGLER, 'pages', 'functions', 'build', '--outdir', FN_OUT, '--build-output-directory', 'dist'])

const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)])) : [])
const files = [...walk(join(ROOT, 'dist')), ...walk(FN_OUT)]
const password = process.env.ADMIN_PASSWORD || adminCreds().password
const needles = [
  ...(password ? [{ name: 'ADMIN_PASSWORD value from .dev.vars/env', test: (t) => t.includes(password) }] : []),
  { name: 'example password from .dev.vars.example', test: (t) => t.includes('change-me-to-a-long-password') },
  { name: 'DEMO_CREDENTIALS', test: (t) => t.includes('DEMO_CREDENTIALS') },
  { name: "'admin/demo'", test: (t) => t.includes('admin/demo') },
  { name: 'demo login object {username:"admin",password:"demo"}', test: (t) => /username\s*:\s*["']admin["']\s*,\s*password\s*:\s*["']demo["']/.test(t) },
  { name: '"Demo credentials" hint', test: (t) => /Demo credentials/i.test(t) },
  { name: 'ADMIN_PASSWORD= assignment (a .dev.vars copy)', test: (t) => /ADMIN_PASSWORD\s*=\s*\S/.test(t) },
]
let bad = 0
for (const n of needles) {
  const hits = files.filter((f) => n.test(readFileSync(f, 'latin1')))
  console.log(`${hits.length ? 'FAIL' : 'PASS'}  ${n.name}${hits.length ? '  — in ' + hits.map((h) => h.slice(ROOT.length)).join(', ') : ''}`)
  bad += hits.length ? 1 : 0
}
const devVars = files.filter((f) => /(^|[\\/])\.dev\.vars/.test(f) || /[\\/]\.env/.test(f))
console.log(`${devVars.length ? 'FAIL' : 'PASS'}  no .dev.vars / .env files in the upload`)
bad += devVars.length ? 1 : 0
if (!password) console.log('WARN  no ADMIN_PASSWORD found (.dev.vars / env) — password check skipped')
console.log(`\nScanned ${files.length} files (dist/ + functions bundle in .wrangler/check-bundle). ${bad ? 'FAILED' : 'OK'}`)
process.exit(bad ? 1 : 0)
