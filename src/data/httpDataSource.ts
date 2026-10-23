import type { Booking, BookingStatus, BusinessSettings, Client, ClientSummaryPage, ClientSummaryQuery, ID, NewBookingInput, RescheduleInput, Service, Slot, StaffMember, TimeOff } from '../lib/types'
import type { AvailabilityQuery, NextAvailable } from '../lib/availability'
import { setShopTimeZone } from '../lib/shopTime'
import { BookingConflictError, NotFoundError, UnauthorizedError, ALL_SCOPES, type BookingFilter, type ClientFilter, type CrudRepository, type DataSource, type DataScope } from './repository'

/** Poll timing. `localStorage['brasswood:pollMs']` (>=100) overrides the base interval — used by the e2e polling tests. */
const DEFAULT_POLL_MS = 20_000
type Versions = Partial<Record<DataScope, number>>

/** API error with the server's message (validation, rate limit, …). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Talks to the Cloudflare Pages Functions in /functions (D1 database).
 * Same-origin requests with the HttpOnly admin session cookie; no secrets in the browser.
 *
 * Change detection (cheap on D1): instead of re-reading every list on a timer, the tab polls a single-row version
 * counter (GET /api/admin/changes on admin pages, /api/changes elsewhere — 1 row read) and only re-runs the queries
 * whose scope (catalog / bookings / clients) actually changed.
 *   - every 20 s while the user is active; after 5 min without interaction the interval doubles up to 60 s;
 *   - no polling at all while the tab is hidden; an immediate check when it becomes visible / gets focus;
 *   - our own mutations and other tabs (BroadcastChannel) trigger an immediate check.
 */
export class HttpDataSource implements DataSource {
  private subs = new Set<{ listener: () => void; scopes: Set<DataScope> }>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private channel: BroadcastChannel | undefined
  private readonly base: string
  private readonly baseMs: number
  private readonly maxMs: number
  private readonly idleAfterMs: number
  private intervalMs: number
  private lastActivity = performance.now()
  private lastCheck = 0
  private versions: Versions | undefined
  private checking: Promise<void> | undefined
  private inflight = new Map<string, Promise<unknown>>()

  constructor(base = '/api') {
    this.base = base.replace(/\/$/, '')
    let override = 0
    try { override = Number(globalThis.localStorage?.getItem('brasswood:pollMs')) || 0 } catch { /* storage blocked */ }
    this.baseMs = override >= 100 ? override : DEFAULT_POLL_MS
    this.maxMs = this.baseMs * 3
    this.idleAfterMs = this.baseMs * 15
    this.intervalMs = this.baseMs
    if (typeof window !== 'undefined') {
      if ('BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('brasswood-api')
        this.channel.onmessage = () => void this.check(true)
      }
      document.addEventListener('visibilitychange', () => {
        if (this.visible()) this.onActivity(true)
        else this.schedule()
      })
      window.addEventListener('focus', () => this.onActivity(true))
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, () => this.onActivity(false), { passive: true })
    }
  }

  private visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

  readonly canResetDemoData = false
  async resetDemoData() {
    throw new Error('Resetting data is only available in the static demo.')
  }

  // ---------- transport ----------
  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 204) return undefined as T
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    if (res.ok) return data as T
    const msg = data?.error?.message ?? `Request failed (${res.status})`
    if (res.status === 409) throw new BookingConflictError(msg)
    if (res.status === 404) throw new NotFoundError(msg)
    if (res.status === 401) {
      window.dispatchEvent(new Event('brasswood:unauthorized'))
      throw new UnauthorizedError()
    }
    throw new ApiError(res.status, data?.error?.code ?? 'error', msg)
  }
  /** Identical concurrent GETs (e.g. several components refetching the catalog) share one request. */
  private get<T>(path: string): Promise<T> {
    const hit = this.inflight.get(path)
    if (hit) return hit as Promise<T>
    const p = this.req<T>('GET', path).finally(() => this.inflight.delete(path))
    this.inflight.set(path, p)
    return p
  }
  private async getOrUndefined<T>(path: string): Promise<T | undefined> {
    try {
      return await this.get<T>(path)
    } catch (e) {
      if (e instanceof NotFoundError) return undefined
      throw e
    }
  }
  /** Mutations: immediate version check here (refetches only what moved), and a nudge to other tabs. */
  private async mutate<T>(method: string, path: string, body?: unknown): Promise<T> {
    const out = await this.req<T>(method, path, body ?? (method === 'DELETE' ? undefined : {}))
    this.check(true).catch(() => this.notify(ALL_SCOPES))
    this.channel?.postMessage('changed')
    return out
  }

  // ---------- change detection ----------
  private notify(scopes: readonly DataScope[]) {
    this.subs.forEach((s) => { if (scopes.some((x) => s.scopes.has(x))) s.listener() })
  }

  private async fetchVersions(): Promise<Versions> {
    const path = typeof location !== 'undefined' ? location.pathname : ''
    const admin = path.startsWith('/admin') && !path.startsWith('/admin/login')
    const opts: RequestInit = { credentials: 'same-origin', headers: { accept: 'application/json' }, cache: 'no-store' }
    if (admin) {
      const r = await fetch(`${this.base}/admin/changes`, opts)
      if (r.ok) return r.json()
      if (r.status !== 401) throw new Error(`changes: ${r.status}`)
      // signed out: fall back to the public counters (the page's own queries handle the 401 redirect)
    }
    const r = await fetch(`${this.base}/changes`, opts)
    if (!r.ok) throw new Error(`changes: ${r.status}`)
    return r.json()
  }

  /** One version check (1 D1 row). `force` = run after any in-flight check, so a just-committed write is seen. */
  check(force = false): Promise<void> {
    if (this.checking && !force) return this.checking
    const prev = this.checking ?? Promise.resolve()
    const run = prev.catch(() => {}).then(async () => {
      this.lastCheck = performance.now()
      const next = await this.fetchVersions()
      const changed: DataScope[] = []
      const known = this.versions ?? {}
      const merged: Versions = { ...known }
      for (const k of ALL_SCOPES) {
        const v = next[k]
        if (typeof v !== 'number') continue
        if (known[k] === undefined) merged[k] = v
        else if (v > known[k]!) { merged[k] = v; changed.push(k) }
      }
      this.versions = merged
      if (changed.length) {
        this.intervalMs = this.baseMs
        this.notify(changed)
      }
      return changed.length > 0
    })
    const done = run.then(() => undefined)
    this.checking = done
    const clear = () => { if (this.checking === done) this.checking = undefined }
    done.then(clear, clear)
    return run.then((changed) => {
      if (!changed && performance.now() - this.lastActivity > this.idleAfterMs) this.intervalMs = Math.min(this.intervalMs * 2, this.maxMs)
    })
  }

  private onActivity(checkNow: boolean) {
    this.lastActivity = performance.now()
    const wasBackedOff = this.intervalMs > this.baseMs
    this.intervalMs = this.baseMs
    if (checkNow && this.subs.size && this.visible() && performance.now() - this.lastCheck > 1000) {
      this.check().catch(() => {}).finally(() => this.schedule())
    } else if (wasBackedOff || !this.timer) this.schedule()
  }

  private schedule() {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.subs.size || !this.visible()) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.check().catch(() => {}).finally(() => this.schedule())
    }, this.intervalMs)
  }

  subscribe(listener: () => void, scopes: readonly DataScope[] = ALL_SCOPES) {
    const sub = { listener, scopes: new Set(scopes) }
    const first = this.subs.size === 0
    this.subs.add(sub)
    if (first) {
      // (re)baseline the counters; the subscribing queries fetch fresh data themselves
      this.versions = undefined
      if (this.visible()) this.check().catch(() => {})
      this.schedule()
    }
    return () => {
      this.subs.delete(sub)
      if (!this.subs.size) this.schedule()
    }
  }

  // ---------- repositories ----------
  /** Reads are public (catalog has no personal data); writes go to the admin API. */
  private crud<T extends { id: ID }>(readPath: string | null, adminPath: string): CrudRepository<T> {
    const read = readPath ?? `/admin${adminPath}`
    return {
      list: () => this.get<T[]>(read),
      get: (id) => this.getOrUndefined<T>(`${read}/${encodeURIComponent(id)}`),
      create: (data) => this.mutate<T>('POST', `/admin${adminPath}`, data),
      update: (id, patch) => this.mutate<T>('PUT', `/admin${adminPath}/${encodeURIComponent(id)}`, patch),
      remove: (id) => this.mutate<void>('DELETE', `/admin${adminPath}/${encodeURIComponent(id)}`),
    }
  }

  services = this.crud<Service>('/services', '/services')
  staff = this.crud<StaffMember>('/staff', '/staff')
  timeOff = this.crud<TimeOff>(null, '/time-off')

  clients = {
    list: (f: ClientFilter = {}) => {
      const p = new URLSearchParams()
      if (f.q) p.set('q', f.q)
      if (f.limit) p.set('limit', String(f.limit))
      const qs = p.toString()
      return this.get<Client[]>(`/admin/clients${qs ? `?${qs}` : ''}`)
    },
    summary: (q: ClientSummaryQuery = {}) => {
      const p = new URLSearchParams({ sort: q.sort ?? 'last', limit: String(q.limit ?? 50), offset: String(q.offset ?? 0) })
      if (q.q) p.set('q', q.q)
      return this.get<ClientSummaryPage>(`/admin/clients/summary?${p}`)
    },
    get: (id: ID) => this.getOrUndefined<Client>(`/admin/clients/${encodeURIComponent(id)}`),
    update: (id: ID, patch: Partial<Omit<Client, 'id'>>) => this.mutate<Client>('PUT', `/admin/clients/${encodeURIComponent(id)}`, patch),
  }

  settings = {
    get: () => this.get<BusinessSettings>('/settings').then((st) => (setShopTimeZone(st.timezone), st)),
    update: (patch: Partial<BusinessSettings>) => this.mutate<BusinessSettings>('PUT', '/admin/settings', patch),
  }

  availability = {
    getSlots: (q: AvailabilityQuery) => {
      const p = new URLSearchParams({ serviceId: q.serviceId, staffId: q.staffId, date: q.date })
      if (q.ignoreRules) p.set('ignoreRules', '1')
      if (q.excludeBookingId) p.set('excludeBookingId', q.excludeBookingId)
      return this.get<Slot[]>(`/availability/slots?${p}`)
    },
    getOpenDates: (serviceId: ID, staffId: ID | 'any', from: string, to: string) =>
      this.get<string[]>(`/availability/open-dates?${new URLSearchParams({ serviceId, staffId, from, to })}`),
    getNextAvailable: (serviceId: ID, staffIds: (ID | 'any')[]) =>
      this.get<NextAvailable>(`/availability/next?${new URLSearchParams({ serviceId, staffIds: staffIds.join(',') })}`),
  }

  bookings = {
    list: (f: BookingFilter = {}) => {
      const p = new URLSearchParams()
      if (f.from) p.set('from', f.from)
      if (f.to) p.set('to', f.to)
      if (f.staffId) p.set('staffId', f.staffId)
      if (f.clientId) p.set('clientId', f.clientId)
      if (f.status) p.set('status', f.status.join(','))
      if (f.withClient) p.set('withClient', '1')
      if (f.limit) p.set('limit', String(f.limit))
      const qs = p.toString()
      return this.get<Booking[]>(`/admin/bookings${qs ? `?${qs}` : ''}`)
    },
    get: (id: ID) => this.getOrUndefined<Booking>(`/admin/bookings/${encodeURIComponent(id)}`),
    findByCode: (code: string) => {
      const c = code.trim()
      if (!c) return Promise.resolve(undefined)
      return this.getOrUndefined<Booking>(`/bookings/by-code/${encodeURIComponent(c)}`)
    },
    create: (input: NewBookingInput) =>
      input.source === 'admin'
        ? this.mutate<Booking>('POST', '/admin/bookings', input)
        : this.mutate<Booking>('POST', '/bookings', { ...input, source: undefined }),
    setStatus: (id: ID, status: BookingStatus) => this.mutate<Booking>('PATCH', `/admin/bookings/${encodeURIComponent(id)}/status`, { status }),
    reschedule: (id: ID, input: RescheduleInput) => this.mutate<Booking>('POST', `/admin/bookings/${encodeURIComponent(id)}/reschedule`, input),
    cancelByCode: (code: string) => this.mutate<Booking>('POST', `/bookings/by-code/${encodeURIComponent(code.trim())}/cancel`),
    remove: (id: ID) => this.mutate<void>('DELETE', `/admin/bookings/${encodeURIComponent(id)}`),
  }
}
