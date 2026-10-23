/**
 * Server-side admin auth: password from a Cloudflare secret (ADMIN_PASSWORD or a PBKDF2 ADMIN_PASSWORD_HASH),
 * random session token in an HttpOnly cookie, only its SHA-256 hash stored in D1 (admin_sessions).
 */
import type { Env } from './env'
import { HttpError, forbidden } from './http'

export const SESSION_COOKIE = 'bw_admin_session'
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const MAX_FAILURES = 5
const FAILURE_WINDOW_MS = 15 * 60 * 1000
export const MIN_PASSWORD_LENGTH = 10

const enc = new TextEncoder()
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const b64url = (buf: Uint8Array) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export const sha256 = async (s: string) => crypto.subtle.digest('SHA-256', enc.encode(s))
export const sha256Hex = async (s: string) => hex(await sha256(s))

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

export async function verifyCredentials(env: Env, username: string, password: string): Promise<boolean> {
  const expectedUser = (env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase()
  const userOk = constantTimeEqual(new Uint8Array(await sha256(username.trim().toLowerCase())), new Uint8Array(await sha256(expectedUser)))
  let passOk = false
  if (env.ADMIN_PASSWORD_HASH) {
    const [scheme, iter, salt, hash] = env.ADMIN_PASSWORD_HASH.split('$')
    if (scheme !== 'pbkdf2-sha256' || !iter || !salt || !hash) throw new HttpError(500, 'internal', 'ADMIN_PASSWORD_HASH is malformed')
    // Workers cap PBKDF2 at 100k iterations.
    passOk = constantTimeEqual(await pbkdf2(password, unb64(salt), Math.min(Number(iter), 100_000)), unb64(hash))
  } else if (env.ADMIN_PASSWORD) {
    if (env.ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH) throw new HttpError(500, 'internal', `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`)
    passOk = constantTimeEqual(new Uint8Array(await sha256(password)), new Uint8Array(await sha256(env.ADMIN_PASSWORD)))
  } else {
    throw new HttpError(500, 'internal', 'Admin password is not configured (set ADMIN_PASSWORD in .dev.vars or as a Cloudflare secret)')
  }
  return userOk && passOk
}

export const clientIp = (req: Request) => req.headers.get('CF-Connecting-IP') ?? 'local'

export async function assertNotRateLimited(db: D1Database, ip: string) {
  const since = Date.now() - FAILURE_WINDOW_MS
  const row = await db.prepare('SELECT COUNT(*) AS n, MIN(attempted_at) AS first FROM login_attempts WHERE ip = ? AND attempted_at > ?').bind(ip, since).first<{ n: number; first: number | null }>()
  if (row && row.n >= MAX_FAILURES) {
    const retry = Math.max(1, Math.ceil(((row.first ?? Date.now()) + FAILURE_WINDOW_MS - Date.now()) / 1000))
    throw new HttpError(429, 'rate_limited', `Too many failed sign-in attempts. Try again in ${Math.ceil(retry / 60)} min.`, { 'retry-after': String(retry) })
  }
}

export async function recordFailure(db: D1Database, ip: string) {
  await db.batch([
    db.prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, Date.now()),
    db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(Date.now() - 24 * 60 * 60 * 1000),
  ])
}

export async function createSession(db: D1Database, username: string): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const now = Date.now()
  await db.batch([
    db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now),
    db.prepare('INSERT INTO admin_sessions (token_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(token), username, now, now + SESSION_TTL_MS),
  ])
  return token
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

/** Returns the admin username for a valid, unexpired session cookie; otherwise null. */
export async function getSession(db: D1Database, req: Request): Promise<string | null> {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token || token.length > 100) return null
  const row = await db.prepare('SELECT username FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').bind(await sha256Hex(token), Date.now()).first<{ username: string }>()
  return row?.username ?? null
}

export async function deleteSession(db: D1Database, req: Request) {
  const token = readCookie(req, SESSION_COOKIE)
  if (token) await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
}

const isLocalhost = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

export function sessionCookie(url: URL, token: string | null): string {
  const parts = [`${SESSION_COOKIE}=${token ?? ''}`, 'Path=/api', 'HttpOnly', 'SameSite=Strict', `Max-Age=${token ? SESSION_TTL_MS / 1000 : 0}`]
  if (!isLocalhost(url)) parts.push('Secure') // plain http on localhost would drop a Secure cookie in some browsers
  return parts.join('; ')
}

/** CSRF defence in depth (cookie is already SameSite=Strict): state-changing requests must come from our own origin. */
export function assertSameOrigin(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') return
  const origin = req.headers.get('Origin')
  if (origin && origin !== new URL(req.url).origin) throw forbidden('Cross-origin request rejected')
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
