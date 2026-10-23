/**
 * Change counters for cheap polling (migration 0002_data_versions.sql). Every mutation bumps the counter of the
 * data it touched IN THE SAME db.batch() (one implicit transaction), so a reader can never see new data with an old
 * version. No SQL triggers on purpose: D1's remote statement splitter has known bugs with CREATE TRIGGER bodies.
 *   catalog  = services, staff, staff_services, staff_hours, time_off, settings
 *   bookings = bookings
 *   clients  = clients
 * Reading the versions is a single-row primary-key lookup (1 row read).
 */
import { nowIso } from './repo'

export type Scope = 'catalog' | 'bookings' | 'clients'
export interface Versions { catalog: number; bookings: number; clients: number }

function bumpSql(scopes: Scope[], onlyIfChanged: boolean) {
  const cols = [...new Set(scopes)].map((s) => `${s} = ${s} + 1`).join(', ')
  return `UPDATE data_versions SET ${cols}, updated_at = ? WHERE id = 1${onlyIfChanged ? ' AND changes() > 0' : ''}`
}

/** Unconditional bump statement (append to a batch whose effect is certain). */
export const bump = (db: D1Database, ...scopes: Scope[]) => db.prepare(bumpSql(scopes, false)).bind(nowIso())
/** Bump only if the statement right before it in the batch changed at least one row. */
export const bumpIfChanged = (db: D1Database, ...scopes: Scope[]) => db.prepare(bumpSql(scopes, true)).bind(nowIso())

/** Runs one write + its conditional version bump atomically; returns the write's result. */
export async function runVersioned<T = unknown>(db: D1Database, stmt: D1PreparedStatement, ...scopes: Scope[]): Promise<D1Result<T>> {
  const [res] = await db.batch<T>([stmt, bumpIfChanged(db, ...scopes)])
  return res
}

/** Runs several writes + one version bump atomically. */
export async function batchVersioned(db: D1Database, stmts: D1PreparedStatement[], ...scopes: Scope[]): Promise<D1Result[]> {
  const res = await db.batch([...stmts, bump(db, ...scopes)])
  return res.slice(0, -1)
}

export async function readVersions(db: D1Database): Promise<Versions> {
  const r = await db.prepare('SELECT catalog, bookings, clients FROM data_versions WHERE id = 1').first<Versions>()
  return r ?? { catalog: 0, bookings: 0, clients: 0 }
}
