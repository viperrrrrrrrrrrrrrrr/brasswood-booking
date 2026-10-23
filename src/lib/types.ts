export type ID = string

/** Calendar date in the SHOP's timezone (settings.timezone), formatted YYYY-MM-DD. */
export type DateStr = string

export interface Service {
  id: ID
  name: string
  description: string
  category: string
  durationMin: number
  priceUsd: number
  active: boolean
}

export interface DayHours {
  /** minutes from midnight */
  start: number
  end: number
  breakStart?: number | null
  breakEnd?: number | null
}

/** index 0 = Sunday … 6 = Saturday; null = day off */
export type WeeklyHours = (DayHours | null)[]

export interface StaffMember {
  id: ID
  name: string
  role: string
  bio: string
  color: string
  serviceIds: ID[]
  hours: WeeklyHours
  active: boolean
}

export interface TimeOff {
  id: ID
  /** null = whole business closed */
  staffId: ID | null
  date: DateStr
  note: string
}

export interface Client {
  id: ID
  name: string
  phone: string
  email: string
  createdAt: string
  notes: string
}

export type BookingStatus = 'confirmed' | 'completed' | 'no-show' | 'cancelled'

export interface Booking {
  id: ID
  code: string
  serviceId: ID
  staffId: ID
  clientId: ID
  date: DateStr
  /** minutes from midnight */
  start: number
  end: number
  status: BookingStatus
  priceUsd: number
  notes: string
  source: 'online' | 'admin'
  createdAt: string
  /** Admin lists with `withClient`: the client's name/phone joined in (saves loading every client). */
  clientName?: string
  clientPhone?: string
  /** Public lookups: may the client still cancel online? Computed in the SHOP timezone by the data source. */
  canCancel?: boolean
}

/** One row of the admin Clients table — aggregates are computed by the data source (SQL in API mode). */
export interface ClientSummary {
  client: Client
  visits: number
  spent: number
  noShows: number
  last?: DateStr
  next?: { date: DateStr; start: number }
  total: number
}
export type ClientSort = 'name' | 'spent' | 'last'
export interface ClientSummaryQuery { q?: string; sort?: ClientSort; limit?: number; offset?: number }
export interface ClientSummaryPage { total: number; rows: ClientSummary[] }

export interface BusinessSettings {
  name: string
  tagline: string
  address: string
  phone: string
  email: string
  slotStepMin: number
  minNoticeMin: number
  horizonDays: number
  /** IANA timezone of the shop (server mode). Slots are computed in this zone. */
  timezone?: string
}

export interface Slot {
  start: number
  end: number
  staffIds: ID[]
}

export interface NewBookingInput {
  serviceId: ID
  /** 'any' lets the system pick the least busy available specialist */
  staffId: ID | 'any'
  date: DateStr
  start: number
  client: { name: string; phone: string; email: string }
  notes?: string
  source?: 'online' | 'admin'
}

export interface RescheduleInput {
  date: DateStr
  start: number
  staffId: ID
}
