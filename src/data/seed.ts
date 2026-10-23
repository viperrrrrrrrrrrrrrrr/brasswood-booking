import type { Booking, BookingStatus, BusinessSettings, Client, Service, StaffMember, TimeOff, WeeklyHours } from '../lib/types'
import { addDays, dayOfWeek, todayStr, nowMinutes } from '../lib/date'
import { isStaffFree, type AvailabilityContext } from '../lib/availability'

export interface DbState {
  version: number
  services: Service[]
  staff: StaffMember[]
  timeOff: TimeOff[]
  clients: Client[]
  bookings: Booking[]
  settings: BusinessSettings
}

export const DB_VERSION = 1

/** Small deterministic PRNG so the demo looks the same on every reset (for a given day). */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function makeCode(rand: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]
  return `BW-${s}`
}

export function makeId(prefix: string, rand: () => number = Math.random): string {
  return `${prefix}_${Math.floor(rand() * 36 ** 8).toString(36).padStart(8, '0')}`
}

const h = (hh: number, mm = 0) => hh * 60 + mm

function week(def: { days: number[]; start: number; end: number; breakStart?: number; breakEnd?: number }, overrides: Record<number, WeeklyHours[number]> = {}): WeeklyHours {
  return Array.from({ length: 7 }, (_, d) => {
    if (d in overrides) return overrides[d]
    return def.days.includes(d) ? { start: def.start, end: def.end, breakStart: def.breakStart ?? null, breakEnd: def.breakEnd ?? null } : null
  })
}

export function createSeed(): DbState {
  const today = todayStr()
  const rand = mulberry32(20261023)

  const settings: BusinessSettings = {
    name: 'Brasswood Barber Co.',
    tagline: 'Classic cuts, sharp fades and hot-towel shaves.',
    address: '418 Alder Street, Riverton (fictional)',
    phone: '(555) 555-0142',
    email: 'hello@brasswood.example',
    slotStepMin: 15,
    minNoticeMin: 60,
    horizonDays: 30,
  }

  const services: Service[] = [
    { id: 'svc_cut', name: 'Signature Haircut', category: 'Hair', durationMin: 45, priceUsd: 45, active: true, description: 'Consultation, precision cut, wash and style.' },
    { id: 'svc_fade', name: 'Skin Fade', category: 'Hair', durationMin: 45, priceUsd: 50, active: true, description: 'Zero-to-blend fade finished with a straight-razor line-up.' },
    { id: 'svc_buzz', name: 'Buzz Cut', category: 'Hair', durationMin: 20, priceUsd: 25, active: true, description: 'One length all over, neat edges.' },
    { id: 'svc_beard', name: 'Beard Trim & Shape', category: 'Beard', durationMin: 30, priceUsd: 30, active: true, description: 'Shape, trim and line-up with beard oil finish.' },
    { id: 'svc_shave', name: 'Hot Towel Shave', category: 'Beard', durationMin: 45, priceUsd: 48, active: true, description: 'Traditional straight-razor shave with hot towels.' },
    { id: 'svc_combo', name: 'Haircut + Beard', category: 'Combos', durationMin: 75, priceUsd: 70, active: true, description: 'Our signature cut paired with a full beard service.' },
    { id: 'svc_kids', name: 'Kids Cut (under 12)', category: 'Hair', durationMin: 30, priceUsd: 28, active: true, description: 'Patient, friendly cut for younger clients.' },
    { id: 'svc_color', name: 'Grey Blending', category: 'Color', durationMin: 60, priceUsd: 65, active: true, description: 'Subtle colour to soften grey while keeping it natural.' },
  ]

  const staff: StaffMember[] = [
    {
      id: 'stf_marco', name: 'Marco Reyes', role: 'Master Barber', color: '#b7791f',
      bio: 'Fades, tapers and classic scissor work. 12 years behind the chair.',
      serviceIds: ['svc_cut', 'svc_fade', 'svc_buzz', 'svc_beard', 'svc_shave', 'svc_combo'],
      hours: week({ days: [2, 3, 4, 5, 6], start: h(9), end: h(18), breakStart: h(13), breakEnd: h(13, 45) }),
      active: true,
    },
    {
      id: 'stf_dana', name: 'Dana Whitfield', role: 'Senior Stylist', color: '#2f6f6a',
      bio: 'Scissor cuts, grey blending and longer styles.',
      serviceIds: ['svc_cut', 'svc_buzz', 'svc_kids', 'svc_color', 'svc_beard'],
      hours: week({ days: [1, 2, 3, 4, 5], start: h(10), end: h(19), breakStart: h(14), breakEnd: h(14, 30) }),
      active: true,
    },
    {
      id: 'stf_theo', name: 'Theo Lindqvist', role: 'Barber', color: '#6b4fa3',
      bio: 'Beard specialist with a soft spot for hot-towel shaves.',
      serviceIds: ['svc_cut', 'svc_fade', 'svc_buzz', 'svc_beard', 'svc_shave', 'svc_combo', 'svc_kids'],
      hours: week({ days: [0, 3, 4, 5, 6], start: h(9), end: h(17), breakStart: h(12, 30), breakEnd: h(13) }, { 0: { start: h(10), end: h(15) } }),
      active: true,
    },
  ]

  const timeOff: TimeOff[] = [
    { id: 'off_1', staffId: 'stf_dana', date: addDays(today, 9), note: 'Training course' },
    { id: 'off_2', staffId: null, date: addDays(today, 20), note: 'Shop closed — team day' },
  ]

  const firstNames = ['James', 'Olivia', 'Liam', 'Noah', 'Emma', 'Lucas', 'Mia', 'Ethan', 'Ava', 'Mason', 'Sofia', 'Logan', 'Daniel', 'Grace', 'Henry', 'Chloe', 'Owen', 'Leo', 'Isaac', 'Nora', 'Caleb', 'Ruby', 'Adrian', 'Felix', 'Hannah', 'Samuel', 'Aaron', 'Elena']
  const lastNames = ['Carter', 'Nguyen', 'Patel', 'Hughes', 'Okafor', 'Bennett', 'Kowalski', 'Moreau', 'Silva', 'Fischer', 'Hart', 'Ramirez', 'Brooks', 'Larsen', 'Duarte', 'Sato', 'Mendes', 'Walsh', 'Ibrahim', 'Novak', 'Price', 'Ellison', 'Quinn', 'Romero', 'Blake', 'Haddad', 'Foster', 'Varga']
  const clients: Client[] = firstNames.map((fn, i) => {
    const ln = lastNames[i]
    return {
      id: `cli_${i + 1}`,
      name: `${fn} ${ln}`,
      phone: `(555) 01${String(10 + i).padStart(2, '0')}-${String(1000 + Math.floor(rand() * 8999)).slice(0, 4)}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`,
      createdAt: addDays(today, -120 + i * 3) + 'T10:00:00',
      notes: i % 7 === 0 ? 'Prefers scissors over clippers on top.' : '',
    }
  })

  const bookings: Booking[] = []
  const ctx: AvailabilityContext = { services, staff, bookings, timeOff, settings }
  const now = nowMinutes()

  for (let offset = -14; offset <= 7; offset++) {
    const date = addDays(today, offset)
    const dow = dayOfWeek(date)
    for (const member of staff) {
      const hours = member.hours[dow]
      if (!hours) continue
      // busier in the past/today, lighter further out (as real books fill up)
      const fill = offset <= 0 ? 0.72 : offset <= 3 ? 0.45 : 0.25
      let t = hours.start
      while (t < hours.end) {
        const svc = services.filter((s) => member.serviceIds.includes(s.id))[Math.floor(rand() * member.serviceIds.length)]
        if (!svc) break
        const end = t + svc.durationMin
        if (end > hours.end) break
        if (rand() < fill && isStaffFree(ctx, member.id, date, t, end)) {
          const isPast = offset < 0 || (offset === 0 && end <= now)
          let status: BookingStatus = 'confirmed'
          if (isPast) {
            const r = rand()
            status = r < 0.86 ? 'completed' : r < 0.93 ? 'no-show' : 'cancelled'
          } else if (rand() < 0.05) status = 'cancelled'
          const client = clients[Math.floor(rand() * clients.length)]
          bookings.push({
            id: makeId('bk', rand),
            code: makeCode(rand),
            serviceId: svc.id,
            staffId: member.id,
            clientId: client.id,
            date,
            start: t,
            end,
            status,
            priceUsd: svc.priceUsd,
            notes: '',
            source: rand() < 0.7 ? 'online' : 'admin',
            createdAt: addDays(date, -Math.ceil(rand() * 6)) + 'T12:00:00',
          })
          t = end
        } else {
          // future days keep realistic open gaps; past days are packed tighter
          t += offset > 0 ? 45 : 15
        }
      }
    }
  }

  return { version: DB_VERSION, services, staff, timeOff, clients, bookings, settings }
}
