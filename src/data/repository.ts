import type {
  Booking, BookingStatus, BusinessSettings, Client, DateStr, ID, NewBookingInput, RescheduleInput,
  Service, Slot, StaffMember, TimeOff,
} from '../lib/types'
import type { AvailabilityQuery } from '../lib/availability'

/**
 * The single seam between UI and persistence.
 * Every method is async so the localStorage implementation can be swapped for an
 * HTTP client (REST/tRPC/Supabase…) without touching components.
 */
export interface CrudRepository<T extends { id: ID }> {
  list(): Promise<T[]>
  get(id: ID): Promise<T | undefined>
  create(data: Omit<T, 'id'>): Promise<T>
  update(id: ID, patch: Partial<Omit<T, 'id'>>): Promise<T>
  remove(id: ID): Promise<void>
}

export interface BookingFilter {
  from?: DateStr
  to?: DateStr
  staffId?: ID
  clientId?: ID
  status?: BookingStatus[]
}

export interface BookingRepository {
  list(filter?: BookingFilter): Promise<Booking[]>
  get(id: ID): Promise<Booking | undefined>
  findByCode(code: string): Promise<Booking | undefined>
  /** Validates availability server-side style; throws BookingConflictError on double booking. */
  create(input: NewBookingInput): Promise<Booking>
  setStatus(id: ID, status: BookingStatus): Promise<Booking>
  reschedule(id: ID, input: RescheduleInput): Promise<Booking>
  cancelByCode(code: string): Promise<Booking>
  remove(id: ID): Promise<void>
}

export interface ClientRepository {
  list(): Promise<Client[]>
  get(id: ID): Promise<Client | undefined>
  update(id: ID, patch: Partial<Omit<Client, 'id'>>): Promise<Client>
}

export interface AvailabilityService {
  getSlots(q: AvailabilityQuery): Promise<Slot[]>
  /** Dates in [from,to] that have at least one free slot. */
  getOpenDates(serviceId: ID, staffId: ID | 'any', from: DateStr, to: DateStr): Promise<DateStr[]>
}

export interface DataSource {
  services: CrudRepository<Service>
  staff: CrudRepository<StaffMember>
  timeOff: CrudRepository<TimeOff>
  clients: ClientRepository
  bookings: BookingRepository
  availability: AvailabilityService
  settings: { get(): Promise<BusinessSettings>; update(patch: Partial<BusinessSettings>): Promise<BusinessSettings> }
  /** Notifies on any data change (including from other tabs). Returns unsubscribe. */
  subscribe(listener: () => void): () => void
  resetDemoData(): Promise<void>
}

export class BookingConflictError extends Error {
  constructor(message = 'That time was just taken. Please pick another slot.') {
    super(message)
    this.name = 'BookingConflictError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}
