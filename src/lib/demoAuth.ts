import type { AuthClient } from './authTypes'

/**
 * Static demo only (VITE_DATA_SOURCE=local, `npm run build:demo`): a fake login kept in sessionStorage.
 * This module is dropped from the default (api) bundle — see src/lib/auth.ts.
 */
const KEY = 'brasswood-admin-session'
const DEMO_CREDENTIALS = { username: 'admin', password: 'demo' }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const demoAuth: AuthClient = {
  demoCredentials: DEMO_CREDENTIALS,
  known: () => true,
  isLoggedIn: () => sessionStorage.getItem(KEY) === '1',
  check: async () => sessionStorage.getItem(KEY) === '1',
  async login(username, password) {
    const ok = username.trim().toLowerCase() === DEMO_CREDENTIALS.username && password === DEMO_CREDENTIALS.password
    if (!ok) return 'Invalid username or password'
    sessionStorage.setItem(KEY, '1')
    emit()
    return null
  },
  async logout() {
    sessionStorage.removeItem(KEY)
    emit()
  },
  onChange(l) {
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
}
