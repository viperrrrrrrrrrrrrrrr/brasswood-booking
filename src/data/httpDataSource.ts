import type { Booking, BookingStatus, BusinessSettings, Client, ID, NewBookingInput, RescheduleInput, Service, Slot, StaffMember, TimeOff } from '../lib/types'
import type { AvailabilityQuery, NextAvailable } from '../lib/availability'
import { BookingConflictError, NotFoundError, UnauthorizedError, type BookingFilter, type CrudRepository, type DataSource } from './repository'

const POLL_MS = 20_000

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
 * Change notifications: emitted after our own mutations, broadcast to other tabs, and a light
 * poll (every 20 s while the tab is visible) picks up changes made from other devices.
 */
export class HttpDataSource implements DataSource {
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | undefined
  private channel: BroadcastChannel | undefined
  private readonly base: string

  constructor(base = '/api') {
    this.base = base.replace(/\/$/, '')
    if (typeof window !== 'undefined') {
      if ('BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('brasswood-api')
        this.channel.onmessage = () => this.notify()
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.listeners.size) this.notify()
        this.syncPolling()
      })
    }
  }

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
  private get = <T,>(path: string) => this.req<T>('GET', path)
  private async getOrUndefined<T>(path: string): Promise<T | undefined> {
    try {
      return await this.get<T>(path)
    } catch (e) {
      if (e instanceof NotFoundError) return undefined
      throw e
    }
  }
  /** Mutations notify this tab and others. */
  private async mutate<T>(method: string, path: string, body?: unknown): Promise<T> {
    const out = await this.req<T>(method, path, body ?? (method === 'DELETE' ? undefined : {}))
    this.notify()
    this.channel?.postMessage('changed')
    return out
  }

  // ---------- change notifications ----------
  private notify() {
    this.listeners.forEach((l) => l())
  }
  private syncPolling() {
    const want = this.listeners.size > 0 && (typeof document === 'undefined' || document.visibilityState === 'visible')
    if (want && !this.timer) this.timer = setInterval(() => this.notify(), POLL_MS)
    if (!want && this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    this.syncPolling()
    return () => {
      this.listeners.delete(listener)
      this.syncPolling()
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
    list: () => this.get<Client[]>('/admin/clients'),
    get: (id: ID) => this.getOrUndefined<Client>(`/admin/clients/${encodeURIComponent(id)}`),
    update: (id: ID, patch: Partial<Omit<Client, 'id'>>) => this.mutate<Client>('PUT', `/admin/clients/${encodeURIComponent(id)}`, patch),
  }

  settings = {
    get: () => this.get<BusinessSettings>('/settings'),
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
