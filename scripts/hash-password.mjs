// Prints a value for ADMIN_PASSWORD_HASH:  npm run hash-password -- "my long password"
import { pbkdf2Sync, randomBytes } from 'node:crypto'
const pw = process.argv[2]
if (!pw || pw.length < 10) {
  console.error('Usage: npm run hash-password -- "<password, at least 10 characters>"')
  process.exit(1)
}
const iterations = 100000 // Cloudflare Workers support at most 100k PBKDF2 iterations
const salt = randomBytes(16)
const hash = pbkdf2Sync(pw, salt, iterations, 32, 'sha256')
console.log(`pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`)
