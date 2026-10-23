import type { DataSource } from './repository'
import { LocalStorageDataSource } from './localStorageDataSource'

/**
 * Swap this line for e.g. `new HttpDataSource(import.meta.env.VITE_API_URL)`
 * to move from the static demo to a real backend.
 */
export const api: DataSource = new LocalStorageDataSource()

export * from './repository'
