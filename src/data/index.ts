import type { DataSource } from './repository'
import { LocalStorageDataSource } from './localStorageDataSource'
import { HttpDataSource } from './httpDataSource'

/**
 * Data source chosen at build time by VITE_DATA_SOURCE (see .env / .env.demo):
 *  - 'api'   (default): Cloudflare Pages Functions + D1 — shared, persistent, server-validated.
 *  - 'local' (`npm run build:demo`): the original static demo, data only in this browser.
 * The comparison is constant-folded by Vite, so the unused implementation is not shipped.
 */
export const DATA_SOURCE: 'api' | 'local' = import.meta.env.VITE_DATA_SOURCE === 'local' ? 'local' : 'api'
export const IS_DEMO = import.meta.env.VITE_DATA_SOURCE === 'local'

export const api: DataSource = import.meta.env.VITE_DATA_SOURCE === 'local' ? new LocalStorageDataSource() : new HttpDataSource('/api')

export * from './repository'
