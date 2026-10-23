// Local helper for the remote TEST environment config in wrangler.toml (no network, no Cloudflare calls).
//   node scripts/remote-config.mjs set-db-id <uuid>   -> writes the id into [env.production] and [env.preview]
//   node scripts/remote-config.mjs check              -> exit 1 while the placeholder is still there
// npm: `npm run remote:set-db-id -- <uuid>`, `npm run remote:check`. See docs/REMOTE_TEST.md.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(new URL('../wrangler.toml', import.meta.url))
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REMOTE = ['[[env.production.d1_databases]]', '[[env.preview.d1_databases]]']
const PROJECT = 'brasswood-test'

/** Splits the TOML into sections keyed by their header line ('' = top level). */
function sections(text) {
  const out = [{ header: '', lines: [] }]
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) out.push({ header: line.trim(), lines: [line] })
    else out[out.length - 1].lines.push(line)
  }
  return out
}
const value = (sec, key) => {
  for (const l of sec.lines) {
    const m = l.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`))
    if (m) return m[1]
  }
  return undefined
}

const [cmd, arg] = process.argv.slice(2)
const text = readFileSync(FILE, 'utf8')
const secs = sections(text)

if (cmd === 'set-db-id') {
  const id = (arg ?? '').trim()
  if (!UUID.test(id) || id === PLACEHOLDER) {
    console.error(`Usage: npm run remote:set-db-id -- <database_id>\n  (the uuid printed by "npx wrangler d1 create ${PROJECT}"; got: "${id}")`)
    process.exit(2)
  }
  let n = 0
  for (const s of secs) {
    if (!REMOTE.includes(s.header)) continue
    s.lines = s.lines.map((l) => (/^\s*database_id\s*=/.test(l) ? (n++, `database_id = "${id}"`) : l))
  }
  if (n !== 2) { console.error(`Expected 2 remote database_id lines in wrangler.toml, found ${n}. Not changed.`); process.exit(1) }
  writeFileSync(FILE, secs.map((s) => s.lines.join('\n')).join('\n'))
  console.log(`OK: wrangler.toml [env.production] and [env.preview] now use D1 ${PROJECT} = ${id}`)
  console.log('Top-level (local dev) block left unchanged.')
} else if (cmd === 'check') {
  const problems = []
  const top = secs.find((s) => s.header === '')
  if (value(top, 'name') !== PROJECT) problems.push(`top-level name must be "${PROJECT}" (is "${value(top, 'name')}")`)
  const ids = new Set()
  for (const h of REMOTE) {
    const s = secs.find((x) => x.header === h)
    if (!s) { problems.push(`missing ${h}`); continue }
    const id = value(s, 'database_id')
    if (value(s, 'database_name') !== PROJECT) problems.push(`${h} database_name must be "${PROJECT}"`)
    if (value(s, 'binding') !== 'DB') problems.push(`${h} binding must be "DB"`)
    if (!id || id === PLACEHOLDER) problems.push(`${h} database_id is still the PLACEHOLDER — run: npm run remote:set-db-id -- <id from "npx wrangler d1 create ${PROJECT}">`)
    else if (!UUID.test(id)) problems.push(`${h} database_id "${id}" is not a uuid`)
    ids.add(id)
  }
  if (ids.size > 1) problems.push('env.production and env.preview point at different database ids')
  if (problems.length) {
    console.error('NOT READY for remote:\n - ' + problems.join('\n - '))
    process.exit(1)
  }
  console.log(`OK: project "${PROJECT}", D1 "${PROJECT}" id ${[...ids][0]} (production + preview)`)
} else {
  console.error('Usage: node scripts/remote-config.mjs set-db-id <uuid> | check')
  process.exit(2)
}
