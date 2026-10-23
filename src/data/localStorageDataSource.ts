import type { Booking, Client, ClientSummary, ClientSummaryPage, ClientSummaryQuery, ID, NewBookingInput, RescheduleInput, BookingStatus } from '../lib/types'
import { canCancelOnline, setShopTimeZone, shopNow } from '../lib/shopTime'
import { getSlots, isStaffFree, nextAvailable, openDates, pickStaff, type AvailabilityContext } from '../lib/availability'
import { BookingConflictError, NotFoundError, type BookingFilter, type ClientFilter, type CrudRepository, type DataSource } from './repository'
import { createSeed, DB_VERSION, makeCode, makeId, type DbState } from './seed'

type CollectionKey = 'services' | 'staff' | 'timeOff'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const clone = <T,>(v: T): T => structuredClone(v)

/**
 * Browser-only persistence. Mimics an API: async calls, server-side validation,
 * conflict detection, and change notifications (also across tabs via the storage event).
 */
export class LocalStorageDataSource implements DataSource {
  private state: DbState
  private listeners = new Set<() => void>()
  private readonly key: string
  private readonly latencyMs: number

  constructor(key = 'brasswood-booking-demo', latencyMs = 120) {
    this.key = key
    this.latencyMs = latencyMs
    this.state = this.load()
    setShopTimeZone(this.state.settings.timezone)
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === this.key) {
          this.state = this.load()
          this.emit()
        }
      })
    }
  }

  private load(): DbState {
    try {
      const raw = localStorage.getItem(this.key)
      if (raw) {
        const parsed = JSON.parse(raw) as DbState
        if (parsed.version === DB_VERSION) return parsed
      }
    } catch {
      /* corrupted storage -> reseed */
    }
    const seed = createSeed()
    localStorage.setItem(this.key, JSON.stringify(seed))
    return seed
  }

  private commit() {
    localStorage.setItem(this.key, JSON.stringify(this.state))
    this.emit()
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }

  private ctx(): AvailabilityContext {
    const { services, staff, bookings, timeOff, settings } = this.state
    // "now" in the shop timezone — same rule as the server, whatever the browser's timezone is
    return { services, staff, bookings, timeOff, settings, now: shopNow(settings.timezone) }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly canResetDemoData = true

  async resetDemoData() {
    await sleep(this.latencyMs)
    this.state = createSeed()
    this.commit()
  }

  private crud<K extends CollectionKey>(key: K, prefix: string): CrudRepository<DbState[K][number]> {
    type T = DbState[K][number]
    const coll = () => this.state[key] as T[]
    const setColl = (next: T[]) => {
      ;(this.state as unknown as Record<CollectionKey, T[]>)[key] = next
    }
    return {
      list: async () => clone(coll()),
      get: async (id) => clone(coll().find((x) => x.id === id)),
      create: async (data) => {
        const item = { ...(data as object), id: makeId(prefix) } as T
        setColl([...coll(), item])
        this.commit()
        return clone(item)
      },
      update: async (id, patch) => {
        const idx = coll().findIndex((x) => x.id === id)
        if (idx < 0) throw new NotFoundError()
        const updated = { ...coll()[idx], ...patch } as T
        const next = [...coll()]
        next[idx] = updated
        setColl(next)
        this.commit()
        return clone(updated)
      },
      remove: async (id) => {
        setColl(coll().filter((x) => x.id !== id))
        this.commit()
      },
    }
  }

  services = this.crud('services', 'svc')
  staff = this.crud('staff', 'stf')
  timeOff = this.crud('timeOff', 'off')

  clients = {
    list: async (f: ClientFilter = {}) => {
      const list = [...this.state.clients].filter((c) => matchesClient(c, f.q)).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
      return clone(f.limit ? list.slice(0, f.limit) : list)
    },
    summary: async (q: ClientSummaryQuery = {}): Promise<ClientSummaryPage> => {
      const today = shopNow(this.state.settings.timezone).date
      const by = new Map<string, Booking[]>()
      for (const b of this.state.bookings) by.set(b.clientId, [...(by.get(b.clientId) ?? []), b])
      const rows: ClientSummary[] = this.state.clients.filter((c) => matchesClient(c, q.q)).map((c) => {
        const list = by.get(c.id) ?? []
        const done = list.filter((b) => b.status === 'completed')
        const next = list.filter((b) => b.status === 'confirmed' && b.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)[0]
        const last = done.map((b) => b.date).sort().at(-1)
        return {
          client: clone(c), visits: done.length, spent: done.reduce((s, b) => s + b.priceUsd, 0), noShows: list.filter((b) => b.status === 'no-show').length,
          ...(last ? { last } : {}), ...(next ? { next: { date: next.date, start: next.start } } : {}), total: list.length,
        }
      })
      const byName = (a: ClientSummary, b: ClientSummary) => a.client.name.localeCompare(b.client.name, 'en', { sensitivity: 'base' })
      const sort = q.sort ?? 'last'
      rows.sort((a, b) => sort === 'name' ? byName(a, b) : sort === 'spent' ? b.spent - a.spent || byName(a, b) : (b.next?.date ?? b.last ?? '').localeCompare(a.next?.date ?? a.last ?? '') || byName(a, b))
      const offset = q.offset ?? 0
      return { total: rows.length, rows: rows.slice(offset, offset + (q.limit ?? 50)) }
    },
    get: async (id: ID) => clone(this.state.clients.find((c) => c.id === id)),
    update: async (id: ID, patch: Partial<Omit<Client, 'id'>>) => {
      const c = this.state.clients.find((x) => x.id === id)
      if (!c) throw new NotFoundError()
      Object.assign(c, patch)
      this.commit()
      return clone(c)
    },
  }

  settings = {
    get: async () => (setShopTimeZone(this.state.settings.timezone), clone(this.state.settings)),
    update: async (patch: Partial<DbState['settings']>) => {
      this.state.settings = { ...this.state.settings, ...patch }
      setShopTimeZone(this.state.settings.timezone)
      this.commit()
      return clone(this.state.settings)
    },
  }

  availability = {
    getSlots: async (q: Parameters<typeof getSlots>[1]) => getSlots(this.ctx(), q),
    getOpenDates: async (serviceId: ID, staffId: ID | 'any', from: string, to: string) => openDates(this.ctx(), serviceId, staffId, from, to),
    getNextAvailable: async (serviceId: ID, staffIds: (ID | 'any')[]) => nextAvailable(this.ctx(), serviceId, staffIds),
  }

  private findBooking(id: ID): Booking {
    const b = this.state.bookings.find((x) => x.id === id)
    if (!b) throw new NotFoundError('Booking not found')
    return b
  }

  private upsertClient(input: NewBookingInput['client']): Client {
    const email = input.email.trim().toLowerCase()
    const phoneDigits = input.phone.replace(/\D/g, '')
    let client = this.state.clients.find(
      (c) => (email && c.email.toLowerCase() === email) || (phoneDigits && c.phone.replace(/\D/g, '') === phoneDigits),
    )
    if (client) {
      client.name = input.name.trim() || client.name
      if (email) client.email = email
      if (input.phone.trim()) client.phone = input.phone.trim()
    } else {
      client = { id: makeId('cli'), name: input.name.trim(), phone: input.phone.trim(), email, createdAt: new Date().toISOString(), notes: '' }
      this.state.clients.push(client)
    }
    return client
  }

  bookings = {
    list: async (f: BookingFilter = {}) => {
      const out = clone(
        this.state.bookings
          .filter(
            (b) =>
              (!f.from || b.date >= f.from) &&
              (!f.to || b.date <= f.to) &&
              (!f.staffId || b.staffId === f.staffId) &&
              (!f.clientId || b.clientId === f.clientId) &&
              (!f.status || f.status.includes(b.status)),
          )
          .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1)),
      ).slice(0, f.limit || undefined)
      if (!f.withClient) return out
      const byId = new Map(this.state.clients.map((c) => [c.id, c]))
      return out.map((b) => ({ ...b, clientName: byId.get(b.clientId)?.name ?? '', clientPhone: byId.get(b.clientId)?.phone ?? '' }))
    },
    get: async (id: ID) => clone(this.state.bookings.find((b) => b.id === id)),
    findByCode: async (code: string) => {
      await sleep(this.latencyMs)
      const norm = code.trim().toUpperCase().replace(/^BW-?/, '')
      const b = this.state.bookings.find((x) => x.code.replace(/^BW-/, '') === norm)
      return b ? { ...clone(b), canCancel: canCancelOnline(b, shopNow(this.state.settings.timezone)) } : undefined
    },
    create: async (input: NewBookingInput) => {
      await sleep(this.latencyMs * 3)
      const service = this.state.services.find((s) => s.id === input.serviceId)
      if (!service) throw new NotFoundError('Service not found')
      if (!input.client.name.trim()) throw new Error('Name is required')
      const isAdmin = input.source === 'admin'
      const slots = getSlots(this.ctx(), { serviceId: input.serviceId, staffId: input.staffId, date: input.date, ignoreRules: isAdmin })
      const slot = slots.find((s) => s.start === input.start)
      if (!slot) throw new BookingConflictError()
      const staffId = input.staffId === 'any' ? pickStaff(this.ctx(), slot.staffIds, input.date) : input.staffId
      const client = this.upsertClient(input.client)
      let code = makeCode()
      while (this.state.bookings.some((b) => b.code === code)) code = makeCode()
      const booking: Booking = {
        id: makeId('bk'),
        code,
        serviceId: service.id,
        staffId,
        clientId: client.id,
        date: input.date,
        start: input.start,
        end: input.start + service.durationMin,
        status: 'confirmed',
        priceUsd: service.priceUsd,
        notes: input.notes?.trim() ?? '',
        source: input.source ?? 'online',
        createdAt: new Date().toISOString(),
      }
      this.state.bookings.push(booking)
      this.commit()
      return { ...clone(booking), canCancel: canCancelOnline(booking, shopNow(this.state.settings.timezone)) }
    },
    setStatus: async (id: ID, status: BookingStatus) => {
      const b = this.findBooking(id)
      if (b.status === 'cancelled' && status !== 'cancelled' && !isStaffFree(this.ctx(), b.staffId, b.date, b.start, b.end, b.id)) {
        throw new BookingConflictError('This slot has been re-booked since the cancellation, so it cannot be restored. Reschedule instead.')
      }
      b.status = status
      this.commit()
      return clone(b)
    },
    reschedule: async (id: ID, input: RescheduleInput) => {
      const b = this.findBooking(id)
      const duration = b.end - b.start
      if (!isStaffFree(this.ctx(), input.staffId, input.date, input.start, input.start + duration, b.id)) {
        throw new BookingConflictError('The specialist is not available at that time.')
      }
      Object.assign(b, { date: input.date, start: input.start, end: input.start + duration, staffId: input.staffId })
      if (b.status === 'cancelled' || b.status === 'no-show') b.status = 'confirmed'
      this.commit()
      return clone(b)
    },
    cancelByCode: async (code: string) => {
      await sleep(this.latencyMs)
      const found = await this.bookings.findByCode(code)
      if (!found) throw new NotFoundError('No booking with that code')
      const b = this.findBooking(found.id)
      if (b.status !== 'confirmed') throw new Error(`This booking is already ${b.status}.`)
      if (!canCancelOnline(b, shopNow(this.state.settings.timezone))) throw new BookingConflictError('Past appointments can’t be cancelled online.')
      b.status = 'cancelled'
      this.commit()
      return clone(b)
    },
    remove: async (id: ID) => {
      this.state.bookings = this.state.bookings.filter((b) => b.id !== id)
      this.commit()
    },
  }
}

function matchesClient(c: Client, q?: string) {
  const s = (q ?? '').trim().toLowerCase()
  if (!s) return true
  const digits = s.replace(/\D/g, '')
  return c.name.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))
}
