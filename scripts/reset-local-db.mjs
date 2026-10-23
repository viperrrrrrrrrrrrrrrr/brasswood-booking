// Deletes ONLY the local D1 database used by `wrangler pages dev` (.wrangler/state/v3/d1). Cross-platform (no rm -rf).
import { rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.wrangler', 'state', 'v3', 'd1')
rmSync(dir, { recursive: true, force: true })
console.log('Local D1 removed:', dir)
