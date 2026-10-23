// Bundled by scripts/unit-shop-time.mjs and run once per process timezone (TZ=...). Pure logic, no DOM.
import { canCancelOnline, isPastStart, shopNow, shopTimeToUtc, setShopTimeZone, getShopTimeZone } from '../../src/lib/shopTime'
import { addDays, dayOfWeek, todayStr, nowMinutes, fmtDate } from '../../src/lib/date'
import { getSlots, type AvailabilityContext } from '../../src/lib/availability'
import { icsStamp } from '../../src/lib/ics'
import type { StaffMember } from '../../src/lib/types'

let failed = 0, passed = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) passed++; else { failed++; console.log(`FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}
const NY = 'America/New_York'
const at = (iso: string) => new Date(iso)

// --- shopNow around the DST end (Sun Nov 1 2026, 02:00 EDT -> 01:00 EST) ---
eq('Oct 31 23:59 EDT', shopNow(NY, at('2026-11-01T03:59:00Z')), { date: '2026-10-31', minutes: 23 * 60 + 59 })
eq('Nov 1 00:00 EDT', shopNow(NY, at('2026-11-01T04:00:00Z')), { date: '2026-11-01', minutes: 0 })
eq('Nov 1 01:30 EDT (first)', shopNow(NY, at('2026-11-01T05:30:00Z')), { date: '2026-11-01', minutes: 90 })
eq('Nov 1 01:30 EST (second)', shopNow(NY, at('2026-11-01T06:30:00Z')), { date: '2026-11-01', minutes: 90 })
eq('Nov 1 02:00 EST', shopNow(NY, at('2026-11-01T07:00:00Z')), { date: '2026-11-01', minutes: 120 })
eq('Nov 1 23:59 EST', shopNow(NY, at('2026-11-02T04:59:00Z')), { date: '2026-11-01', minutes: 23 * 60 + 59 })
eq('Nov 2 00:00 EST', shopNow(NY, at('2026-11-02T05:00:00Z')), { date: '2026-11-02', minutes: 0 })
// --- DST start (Sun Mar 8 2026, 02:00 EST -> 03:00 EDT) ---
eq('Mar 8 01:59 EST', shopNow(NY, at('2026-03-08T06:59:00Z')), { date: '2026-03-08', minutes: 119 })
eq('Mar 8 03:00 EDT', shopNow(NY, at('2026-03-08T07:00:00Z')), { date: '2026-03-08', minutes: 180 })
// --- far zones on the same instant ---
eq('Tokyo is already tomorrow', shopNow('Asia/Tokyo', at('2026-11-03T20:00:00Z')), { date: '2026-11-04', minutes: 5 * 60 })
eq('NY same instant', shopNow(NY, at('2026-11-03T20:00:00Z')), { date: '2026-11-03', minutes: 15 * 60 })
eq('invalid tz falls back to NY', shopNow('Not/AZone', at('2026-11-03T20:00:00Z')), { date: '2026-11-03', minutes: 15 * 60 })

// --- shopTimeToUtc ---
eq('Nov 3 15:00 NY -> 20:00Z', shopTimeToUtc('2026-11-03', 900, NY).toISOString(), '2026-11-03T20:00:00.000Z')
eq('Jul 1 09:00 NY -> 13:00Z', shopTimeToUtc('2026-07-01', 540, NY).toISOString(), '2026-07-01T13:00:00.000Z')
eq('ambiguous 01:30 -> first (EDT)', shopTimeToUtc('2026-11-01', 90, NY).toISOString(), '2026-11-01T05:30:00.000Z')
eq('Nov 1 03:00 -> EST', shopTimeToUtc('2026-11-01', 180, NY).toISOString(), '2026-11-01T08:00:00.000Z')
eq('gap 02:30 Mar 8 -> 03:30 EDT', shopTimeToUtc('2026-03-08', 150, NY).toISOString(), '2026-03-08T07:30:00.000Z')
eq('Prague 10:00 winter', shopTimeToUtc('2026-11-03', 600, 'Europe/Prague').toISOString(), '2026-11-03T09:00:00.000Z')
eq('ics stamp is UTC', icsStamp('2026-11-03', 915, NY), '20261103T201500Z')

// --- date helpers are browser-TZ independent (pure calendar math) ---
eq('addDays across DST end', addDays('2026-10-31', 1), '2026-11-01')
eq('addDays across DST end x2', addDays('2026-10-31', 2), '2026-11-02')
eq('addDays across spring', addDays('2026-03-07', 2), '2026-03-09')
eq('addDays month end', addDays('2026-12-31', 1), '2027-01-01')
eq('addDays negative', addDays('2026-03-01', -1), '2026-02-28')
eq('dayOfWeek Nov 1 2026 = Sun', dayOfWeek('2026-11-01'), 0)
eq('dayOfWeek Nov 3 2026 = Tue', dayOfWeek('2026-11-03'), 2)
eq('dayOfWeek Mar 8 2026 = Sun', dayOfWeek('2026-03-08'), 0)
eq('fmtDate is the calendar date', fmtDate('2026-11-01', { weekday: 'short', month: 'short', day: 'numeric' }), 'Sun, Nov 1')

// --- todayStr / nowMinutes follow the shop zone, not the process TZ ---
setShopTimeZone(NY)
eq('module zone NY', getShopTimeZone(), NY)
const n = shopNow(NY)
eq('todayStr = shop date', todayStr(), n.date)
eq('nowMinutes = shop minutes', Math.abs(nowMinutes() - n.minutes) <= 1, true)
setShopTimeZone('bogus')
eq('invalid zone is ignored', getShopTimeZone(), NY)

// --- past / cancel rules ---
const now = { date: '2026-11-03', minutes: 900 }
eq('later today is not past', isPastStart({ date: '2026-11-03', start: 960 }, now), false)
eq('exactly now is past', isPastStart({ date: '2026-11-03', start: 900 }, now), true)
eq('earlier today is past', isPastStart({ date: '2026-11-03', start: 600 }, now), true)
eq('yesterday is past', isPastStart({ date: '2026-11-02', start: 1200 }, now), true)
eq('tomorrow is not past', isPastStart({ date: '2026-11-04', start: 0 }, now), false)
eq('cancel later today', canCancelOnline({ status: 'confirmed', date: '2026-11-03', start: 960 }, now), true)
eq('no cancel past', canCancelOnline({ status: 'confirmed', date: '2026-11-03', start: 600 }, now), false)
eq('no cancel completed', canCancelOnline({ status: 'completed', date: '2026-11-04', start: 600 }, now), false)

// --- slots use ctx.now (shop time) ---
const hours = Array.from({ length: 7 }, () => ({ start: 540, end: 1080 }))
const staff: StaffMember[] = [{ id: 's1', name: 'A', role: '', bio: '', color: '#000', active: true, serviceIds: ['svc'], hours } as unknown as StaffMember]
const ctx = (now: { date: string; minutes: number }): AvailabilityContext => ({
  services: [{ id: 'svc', name: 'Cut', description: '', category: '', durationMin: 60, priceUsd: 40, active: true } as never],
  staff, bookings: [], timeOff: [],
  settings: { slotStepMin: 15, minNoticeMin: 60, horizonDays: 30, timezone: NY } as never,
  now,
})
const s = getSlots(ctx({ date: '2026-11-03', minutes: 900 }), { serviceId: 'svc', staffId: 'any', date: '2026-11-03' })
eq('today slots start at now+notice (16:00)', s[0]?.start, 960)
eq('today last slot 17:00', s.at(-1)?.start, 1020)
eq('yesterday (shop) has no slots', getSlots(ctx({ date: '2026-11-03', minutes: 900 }), { serviceId: 'svc', staffId: 'any', date: '2026-11-02' }).length, 0)
eq('late evening Oct 31 NY: Oct 31 still bookable date but no slots', getSlots(ctx({ date: '2026-10-31', minutes: 23 * 60 + 30 }), { serviceId: 'svc', staffId: 'any', date: '2026-10-31' }).length, 0)
eq('late evening Oct 31 NY: Nov 1 full day', getSlots(ctx({ date: '2026-10-31', minutes: 23 * 60 + 30 }), { serviceId: 'svc', staffId: 'any', date: '2026-11-01' }).length, 33)

console.log(`TZ=${process.env.TZ ?? '(unset)'}: ${passed}/${passed + failed} passed`)
if (failed) process.exit(1)
