import type { AuthClient } from './authTypes'

/**
 * Real admin auth against Pages Functions. The session lives in an HttpOnly cookie set by the server,
 * so this module never sees a token or a password beyond the login form submit.
 */
type State = 'unknown' | 'in' | 'out'
let state: State = 'unknown'
let pending: Promise<boolean> | null = null
const listeners = new Set<() => void>()
const set = (next: State) => {
  if (next === state) return
  state = next
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  // Any admin API call that returns 401 (expired session) flips us to signed-out.
  window.addEventListener('brasswood:unauthorized', () => set('out'))
}

async function call(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const serverAuth: AuthClient = {
  known: () => state !== 'unknown',
  isLoggedIn: () => state === 'in',
  check() {
    pending ??= call('/api/auth/me')
      .then(async (r) => {
        const ok = r.ok && ((await r.json()) as { authenticated?: boolean }).authenticated === true
        set(ok ? 'in' : 'out')
        return ok
      })
      .catch(() => {
        // Network error: keep a known state if we had one, otherwise treat as signed out.
        if (state === 'unknown') set('out')
        return state === 'in'
      })
      .finally(() => { pending = null })
    return pending
  },
  async login(username, password) {
    try {
      const r = await call('/api/auth/login', { username, password })
      if (r.ok) {
        set('in')
        return null
      }
      const data = (await r.json().catch(() => null)) as { error?: { message?: string } } | null
      return data?.error?.message ?? 'Sign in failed. Please try again.'
    } catch {
      return 'Cannot reach the server. Check your connection and try again.'
    }
  },
  async logout() {
    try {
      await call('/api/auth/logout', {})
    } finally {
      set('out')
    }
  },
  onChange(l) {
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
}
