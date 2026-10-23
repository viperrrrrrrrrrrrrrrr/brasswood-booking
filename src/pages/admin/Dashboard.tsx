import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CalendarClock, DollarSign, UserX, ArrowUpRight, ArrowDownRight, Check, Plus } from 'lucide-react'
import { api } from '../../data'
import { useCatalog, useQuery } from '../../data/hooks'
import type { Booking, Client, StaffMember } from '../../lib/types'
import { addDays, dayOfWeek, fmtDate, fmtDateLong, fmtTime, nowMinutes, todayStr, usd } from '../../lib/date'
import { Avatar, Button, Card, EmptyState, Spinner, StatusBadge, cn, useToast } from '../../components/ui'
import { BookingDetailsModal, BookingFormModal } from '../../components/BookingModals'
import { PageHeader } from './AdminLayout'

export default function Dashboard() {
  const today = todayStr()
  const { services, staff, ready } = useCatalog()
  const toast = useToast()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const bookings = useQuery(() => api.bookings.list({ from: addDays(today, -27), to: addDays(today, 13) }), [today])
  const clients = useQuery(() => api.clients.list(), [])
  const clientMap = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c])), [clients.data])

  const stats = useMemo(() => {
    const all = bookings.data ?? []
    const inRange = (from: string, to: string) => all.filter((b) => b.date >= from && b.date <= to)
    const todays = all.filter((b) => b.date === today && b.status !== 'cancelled')
    const upcoming = all.filter((b) => b.status === 'confirmed' && (b.date > today || (b.date === today && b.start > nowMinutes())) && b.date <= addDays(today, 7))
    const rev = (list: Booking[]) => list.filter((b) => b.status === 'completed').reduce((s, b) => s + b.priceUsd, 0)
    const last7 = rev(inRange(addDays(today, -6), today))
    const prev7 = rev(inRange(addDays(today, -13), addDays(today, -7)))
    const past14 = inRange(addDays(today, -13), today).filter((b) => b.status === 'completed' || b.status === 'no-show')
    const noShow = past14.length ? past14.filter((b) => b.status === 'no-show').length / past14.length : 0
    const chart = Array.from({ length: 21 }, (_, i) => {
      const d = addDays(today, i - 13)
      const day = all.filter((b) => b.date === d)
      const future = d > today
      const value = future ? day.filter((b) => b.status === 'confirmed').reduce((s, b) => s + b.priceUsd, 0) : rev(day) + (d === today ? day.filter((b) => b.status === 'confirmed').reduce((s, b) => s + b.priceUsd, 0) : 0)
      return { date: d, value, future }
    })
    const counts = new Map<string, number>()
    inRange(addDays(today, -27), today).filter((b) => b.status === 'completed').forEach((b) => counts.set(b.serviceId, (counts.get(b.serviceId) ?? 0) + 1))
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    return { todays, upcoming, last7, prev7, noShow, chart, top, todayRevenue: todays.filter((b) => b.status !== 'no-show').reduce((s, b) => s + b.priceUsd, 0) }
  }, [bookings.data, today])

  if (!ready || !bookings.data) return <div className="flex h-64 items-center justify-center"><Spinner /></div>
  const change = stats.prev7 ? (stats.last7 - stats.prev7) / stats.prev7 : 0
  const svcName = (id: string) => services.find((s) => s.id === id)?.name ?? '—'

  return (
    <div>
      <PageHeader title="Dashboard" sub={fmtDateLong(today)} actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" />New booking</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Kpi icon={<CalendarCheck />} label="Today’s bookings" value={String(stats.todays.length)} foot={`${usd(stats.todayRevenue)} expected`} />
        <Kpi icon={<CalendarClock />} label="Upcoming · 7 days" value={String(stats.upcoming.length)} foot="confirmed appointments" />
        <Kpi icon={<DollarSign />} label="Revenue · last 7 days" value={usd(stats.last7)}
          foot={<span className={cn('inline-flex items-center gap-0.5 font-medium', change >= 0 ? 'text-emerald-600' : 'text-red-600')}>{change >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.abs(change * 100).toFixed(0)}% vs prior week</span>} />
        <Kpi icon={<UserX />} label="No-show rate · 14 days" value={`${(stats.noShow * 100).toFixed(1)}%`} foot="of finished appointments" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-semibold">Revenue</h2>
              <p className="text-sm text-stone-500">Completed (last 14 days) and booked (next 7 days)</p>
            </div>
            <div className="flex gap-4 text-xs text-stone-500">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brand-500" />Earned</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brand-200" />Booked</span>
            </div>
          </div>
          <RevenueChart data={stats.chart} />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Staff load this week</h2>
          <p className="text-sm text-stone-500">Booked time vs. working hours</p>
          <StaffLoad staff={staff} bookings={bookings.data} />
          <h2 className="mt-6 font-semibold">Top services · 4 weeks</h2>
          <ul className="mt-3 space-y-2">
            {stats.top.map(([id, n]) => (
              <li key={id} className="flex items-center justify-between text-sm"><span>{svcName(id)}</span><span className="tabular-nums text-stone-500">{n}</span></li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <h2 className="font-semibold">Today’s schedule</h2>
          <Link to="/admin/schedule" className="text-sm font-medium text-brand-700 hover:underline">Open calendar →</Link>
        </div>
        {stats.todays.length === 0 ? <EmptyState title="No bookings today" text="Enjoy the quiet — or add a walk-in." /> : (
          <ul className="divide-y divide-stone-100" data-testid="today-list">
            {stats.todays.map((b) => {
              const m = staff.find((s) => s.id === b.staffId)
              const c = clientMap.get(b.clientId) as Client | undefined
              return (
                <li key={b.id} className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-stone-50" onClick={() => setOpenId(b.id)}>
                  <span className="w-20 shrink-0 text-sm font-semibold tabular-nums">{fmtTime(b.start)}</span>
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: m?.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c?.name}</p>
                    <p className="truncate text-xs text-stone-500">{svcName(b.serviceId)} · {m?.name}</p>
                  </div>
                  <span className="hidden sm:inline"><StatusBadge status={b.status} /></span>
                  {b.status === 'confirmed' && (
                    <Button size="sm" variant="secondary" onClick={async (e) => { e.stopPropagation(); await api.bookings.setStatus(b.id, 'completed'); toast('Marked as completed') }} title="Mark completed">
                      <Check className="size-4" /><span className="hidden sm:inline">Done</span>
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <BookingDetailsModal bookingId={openId} onClose={() => setOpenId(null)} services={services} staff={staff} />
      {creating && <BookingFormModal open mode="create" services={services} staff={staff} onClose={() => setCreating(false)} />}
    </div>
  )
}

function Kpi({ icon, label, value, foot }: { icon: ReactNode; label: string; value: string; foot: ReactNode }) {
  return (
    <Card className="p-4 lg:p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-stone-500 sm:text-sm">{label}</p>
        <span className="hidden rounded-lg bg-brand-50 p-1.5 text-brand-600 sm:block [&>svg]:size-4">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums lg:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-stone-500">{foot}</p>
    </Card>
  )
}

function RevenueChart({ data }: { data: { date: string; value: number; future: boolean }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(100, ...data.map((d) => d.value))
  const nice = Math.ceil(max / 100) * 100
  const today = todayStr()
  return (
    <div className="mt-5">
      <div className="relative flex h-52 items-end gap-1 sm:gap-1.5">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-stone-100" style={{ bottom: `${f * 100}%` }}>
            <span className="absolute -top-2 right-0 bg-white pl-1 text-[10px] text-stone-300">{usd(nice * f)}</span>
          </div>
        ))}
        {data.map((d, i) => (
          <div key={d.date} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i && (
              <div className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs text-white shadow">
                {fmtDate(d.date)} · {usd(d.value)}
              </div>
            )}
            <div
              className={cn('w-full rounded-t-md transition-all', d.future ? 'bg-brand-200' : 'bg-brand-500', hover === i && 'opacity-80', d.date === today && 'ring-2 ring-ink ring-offset-1')}
              style={{ height: `${Math.max(2, (d.value / nice) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1 sm:gap-1.5">
        {data.map((d) => (
          <span key={d.date} className={cn('flex-1 text-center text-[10px] text-stone-400', d.date === today && 'font-semibold text-ink')}>
            {d.date === today ? 'Today' : dayOfWeek(d.date) === 1 ? fmtDate(d.date, { month: 'short', day: 'numeric' }) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function StaffLoad({ staff, bookings }: { staff: StaffMember[]; bookings: Booking[] }) {
  const today = todayStr()
  const monday = addDays(today, -((dayOfWeek(today) + 6) % 7))
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  return (
    <ul className="mt-4 space-y-3.5">
      {staff.filter((s) => s.active).map((m) => {
        const avail = days.reduce((sum, d) => {
          const h = m.hours[dayOfWeek(d)]
          if (!h) return sum
          return sum + (h.end - h.start) - (h.breakStart != null && h.breakEnd != null ? h.breakEnd - h.breakStart : 0)
        }, 0)
        const booked = bookings.filter((b) => b.staffId === m.id && days.includes(b.date) && b.status !== 'cancelled').reduce((s, b) => s + b.end - b.start, 0)
        const pct = avail ? Math.min(1, booked / avail) : 0
        return (
          <li key={m.id} className="flex items-center gap-3">
            <Avatar name={m.name} color={m.color} size={32} />
            <div className="flex-1">
              <div className="flex justify-between text-sm"><span className="font-medium">{m.name}</span><span className="tabular-nums text-stone-500">{Math.round(pct * 100)}%</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-stone-100"><div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: m.color }} /></div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
