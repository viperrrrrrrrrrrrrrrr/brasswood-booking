import type { AuthClient } from './authTypes'
import { demoAuth } from './demoAuth'
import { serverAuth } from './serverAuth'

/**
 * `import.meta.env.VITE_DATA_SOURCE` is replaced at build time, so the unused implementation
 * (and, in the default api build, the demo credentials) is removed from the bundle entirely.
 */
export const auth: AuthClient = import.meta.env.VITE_DATA_SOURCE === 'local' ? demoAuth : serverAuth
export type { AuthClient }
