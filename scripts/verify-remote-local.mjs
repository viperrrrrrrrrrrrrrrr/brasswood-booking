// Proves scripts/verify-remote.mjs end-to-end against a LOCAL `wrangler pages dev` + isolated local D1
// (.wrangler/verify-state — never the dev DB, never remote) and checks that it leaves the DB exactly as it found it.
// Usage: npm run build && npm run verify:remote:local     (password from .dev.vars)
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminCreds } from './e2e-lib.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.VERIFY_PORT ?? 8797)
const BASE = `http://localhost:${PORT}`
const PERSIST = join(ROOT, '.wrangler', 'verify-state')
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const CREDS = adminCreds()
const ENV = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }
const TABLES = ['settings', 'services', 'staff', 'staff_services', 'staff_hours', 'time_off', 'clients', 'bookings', 'admin_sessions', 'login_attempts']

if (!CREDS.password) { console.error('No ADMIN_PASSWORD in .dev.vars'); process.exit(2) }
if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist/ missing — run `npm run build` first.'); process.exit(2) }

const wr = (args) => {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, encoding: 'utf8', env: ENV })
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}
const counts = () => {
  const sql = 'SELECT ' + TABLES.map((t) => `(SELECT count(*) FROM ${t}) AS ${t}`).join(', ')
  const out = wr(['d1', 'execute', 'brasswood', '--local', '--persist-to', PERSIST, '--json', '--command', sql])
  return JSON.parse(out.slice(out.indexOf('[')))[0].results[0]
}
let server = null
async function start() {
  server = spawn(process.execPath, [WRANGLER, 'pages', 'dev', '--port', String(PORT), '--inspector-port', String(PORT + 1000), '--persist-to', PERSIST], { cwd: ROOT, env: ENV, detached: process.platform !== 'win32', stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try { if ((await fetch(BASE + '/api/health')).ok) return } catch { /* starting */ }
  }
  throw new Error('wrangler pages dev did not start')
}
async function stop() {
  if (!server) return
  const done = new Promise((r) => server.once('exit', r))
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'])
  else { try { process.kill(-server.pid, 'SIGTERM') } catch { server.kill('SIGTERM') } }
  await Promise.race([done, new Promise((r) => setTimeout(r, 8000))])
  server = null
  await new Promise((r) => setTimeout(r, 800))
}
const verify = (...flags) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-remote.mjs'), ...flags], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, BASE_URL: BASE, ADMIN_USERNAME: CREDS.username, ADMIN_PASSWORD: CREDS.password },
}).status
const show = (label, c) => console.log(`${label}: ${TABLES.map((t) => `${t}=${c[t]}`).join(' ')}`)
const same = (a, b) => TABLES.every((t) => a[t] === b[t])

const checks = []
const ok = (n, c, x = '') => { checks.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`) }
try {
  rmSync(PERSIST, { recursive: true, force: true })
  wr(['d1', 'migrations', 'apply', 'brasswood', '--local', '--persist-to', PERSIST])
  wr(['d1', 'execute', 'brasswood', '--local', '--persist-to', PERSIST, '--file', join(ROOT, 'seed', 'seed.sql')])
  const before = counts(); show('\nDB before', before)
  ok('Fresh seed has no clients and no bookings', before.clients === 0 && before.bookings === 0)

  console.log('\n######## run 1: npm run verify:remote (local pages dev) ########')
  await start(); const s1 = verify(); await stop()
  const after1 = counts(); show('DB after run 1', after1)
  ok('verify-remote run 1 exit code 0', s1 === 0)
  ok('Row counts identical before/after run 1 (nothing left behind)', same(before, after1))

  console.log('\n######## run 2: --keep, then server restart, then --cleanup-only ########')
  await start(); const s2 = verify('--keep'); await stop()
  const kept = counts(); show('DB after --keep', kept)
  ok('--keep leaves exactly 1 booking + 1 client', s2 === 0 && kept.bookings === 1 && kept.clients === 1)
  await start() // fresh process = data must come from persisted D1
  const s3 = verify('--cleanup-only'); await stop()
  const after2 = counts(); show('DB after --cleanup-only', after2)
  ok('--cleanup-only removed the kept booking after a server restart', s3 === 0 && same(before, after2))
} catch (e) {
  ok(`harness error: ${e.message}`, false)
} finally {
  await stop()
  if (!process.env.KEEP_VERIFY_DB) rmSync(PERSIST, { recursive: true, force: true })
}
console.log(`\nverify-remote local proof: ${checks.filter(Boolean).length}/${checks.length} passed`)
process.exit(checks.every(Boolean) ? 0 : 1)
