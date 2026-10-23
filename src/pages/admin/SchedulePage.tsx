import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { api } from '../../data'
import { useCatalog, useQuery } from '../../data/hooks'
import type { Booking, Client, DateStr, Service, StaffMember, TimeOff } from '../../lib/types'
import { addDays, dayOfWeek, fmtDate, fmtTime, nowMinutes, parseDate, startOfWeek, todayStr, WEEKDAYS_SHORT } from '../../lib/date'
import { Avatar, Button, Card, STATUS_STYLE, Spinner, cn } from '../../components/ui'
import { BookingDetailsModal, BookingFormModal } from '../../components/BookingModals'
import { PageHeader } from './AdminLayout'

const PX_PER_MIN = 1.35
type View = 'day' | 'week'

export default function SchedulePage() {
  const { services, staff, ready } = useCatalog()
  const [view, setView] = useState<View>(() => (window.innerWidth < 768 ? 'day' : 'week'))
  const [date, setDate] = useState<DateStr>(todayStr())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [create, setCreate] = useState<{ staffId?: string; date: string; start?: number } | null>(null)
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60_000); return () => clearInterval(t) }, [])

  const from = view === 'day' ? date : startOfWeek(date)
  const to = view === 'day' ? date : addDays(from, 6)
  const bookings = useQuery(() => api.bookings.list({ from, to }), [from, to])
  const clients = useQuery(() => api.clients.list(), [])
  const timeOff = useQuery(() => api.timeOff.list(), [])
  const clientMap = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c])), [clients.data])
  const visibleStaff = staff.filter((s) => s.active && !hidden.has(s.id))

  const days = view === 'day' ? [date] : Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const { dayStart, dayEnd } = useMemo(() => {
    let s = 9 * 60, e = 19 * 60
    for (const m of staff) for (const d of days) { const h = m.hours[dayOfWeek(d)]; if (h) { s = Math.min(s, h.start); e = Math.max(e, h.end) } }
    return { dayStart: Math.floor(s / 60) * 60, dayEnd: Math.ceil(e / 60) * 60 }
  }, [staff, days.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  const label = view === 'day'
    ? parseDate(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : `${fmtDate(from, { month: 'short', day: 'numeric' })} – ${fmtDate(to, { month: 'short', day: 'numeric', year: 'numeric' })}`

  const shift = (dir: number) => setDate(addDays(date, dir * (view === 'day' ? 1 : 7)))
  const toggleStaff = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n })

  if (!ready) return <Spinner />
  const list = (bookings.data ?? []).filter((b) => !hidden.has(b.staffId))
  const counts = { total: list.filter((b) => b.status !== 'cancelled').length }

  return (
    <div>
      <PageHeader title="Schedule" sub={`${counts.total} active bookings in view`} actions={<Button onClick={() => setCreate({ date })}><Plus className="size-4" />New booking</Button>} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 p-3 sm:p-4">
          <div className="flex rounded-xl bg-stone-100 p-0.5 text-sm font-medium">
            {(['day', 'week'] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)} data-testid={`view-${v}`} className={cn('rounded-[10px] px-3 py-1.5 capitalize transition', view === v ? 'bg-white shadow-sm' : 'text-stone-500')}>{v}</button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => shift(-1)} className="rounded-lg p-1.5 hover:bg-stone-100" aria-label="Previous"><ChevronLeft className="size-5" /></button>
            <Button size="sm" variant="secondary" onClick={() => setDate(todayStr())}>Today</Button>
            <button onClick={() => shift(1)} className="rounded-lg p-1.5 hover:bg-stone-100" aria-label="Next"><ChevronRight className="size-5" /></button>
          </div>
          <p className="font-semibold">{label}</p>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {staff.filter((s) => s.active).map((m) => (
              <button key={m.id} onClick={() => toggleStaff(m.id)}
                className={cn('flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs font-medium ring-1 transition', hidden.has(m.id) ? 'text-stone-400 ring-stone-200' : 'bg-white ring-stone-300')}>
                <span className="size-5 rounded-full" style={{ background: hidden.has(m.id) ? '#d6d3d1' : m.color }} />{m.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin" data-testid="schedule-grid">
          <Grid
            view={view} days={days} staff={visibleStaff} bookings={list} services={services} clientMap={clientMap} timeOff={timeOff.data ?? []}
            dayStart={dayStart} dayEnd={dayEnd}
            onOpen={setOpenId}
            onEmpty={(d, staffId, start) => setCreate({ date: d, staffId, start })}
            onDayClick={(d) => { setDate(d); setView('day') }}
          />
        </div>
        <div className="flex flex-wrap gap-4 border-t border-stone-100 px-4 py-3 text-xs text-stone-500">
          {Object.entries(STATUS_STYLE).map(([k, s]) => <span key={k} className="flex items-center gap-1.5"><span className={cn('size-2 rounded-full', s.dot)} />{s.label}</span>)}
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-[repeating-linear-gradient(135deg,#f5f5f4_0_4px,#e7e5e4_4px_6px)]" />Closed / break</span>
          <span className="ml-auto hidden sm:inline">Click an empty slot to add a booking</span>
        </div>
      </Card>
      <BookingDetailsModal bookingId={openId} onClose={() => setOpenId(null)} services={services} staff={staff} />
      {create && (
        <BookingFormModal open mode="create" services={services} staff={staff} onClose={() => setCreate(null)}
          initial={{ date: create.date, staffId: create.staffId, start: create.start, serviceId: create.staffId ? staff.find((s) => s.id === create.staffId)?.serviceIds[0] : undefined }} />
      )}
    </div>
  )
}

interface GridProps {
  view: View; days: DateStr[]; staff: StaffMember[]; bookings: Booking[]; services: Service[]; clientMap: Map<string, Client>; timeOff: TimeOff[]
  dayStart: number; dayEnd: number
  onOpen: (id: string) => void; onEmpty: (date: DateStr, staffId: string, start: number) => void; onDayClick: (d: DateStr) => void
}

function Grid({ view, days, staff, bookings, services, clientMap, timeOff, dayStart, dayEnd, onOpen, onEmpty, onDayClick }: GridProps) {
  const height = (dayEnd - dayStart) * PX_PER_MIN
  const hours = Array.from({ length: (dayEnd - dayStart) / 60 + 1 }, (_, i) => dayStart + i * 60)
  const today = todayStr()
  const now = nowMinutes()
  // columns: day view => one per staff; week view => one per day with staff lanes
  const columns = view === 'day'
    ? staff.map((m) => ({ key: m.id, date: days[0], lanes: [m] }))
    : days.map((d) => ({ key: d, date: d, lanes: staff }))
  const minCol = view === 'day' ? 200 : 120

  return (
    <div style={{ minWidth: 56 + columns.length * minCol }}>
      {/* header */}
      <div className="sticky top-0 z-10 flex border-b border-stone-200 bg-white">
        <div className="w-14 shrink-0" />
        {columns.map((c) => (
          <div key={c.key} className="flex-1 border-l border-stone-100 px-2 py-2.5" style={{ minWidth: minCol }}>
            {view === 'day' ? (
              <div className="flex items-center gap-2">
                <Avatar name={c.lanes[0].name} color={c.lanes[0].color} size={28} />
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{c.lanes[0].name}</p><p className="truncate text-xs text-stone-400">{c.lanes[0].role}</p></div>
              </div>
            ) : (
              <button onClick={() => onDayClick(c.date)} className="flex w-full flex-col items-center rounded-lg py-0.5 hover:bg-stone-50">
                <span className="text-xs font-medium uppercase text-stone-400">{WEEKDAYS_SHORT[dayOfWeek(c.date)]}</span>
                <span className={cn('mt-0.5 flex size-8 items-center justify-center rounded-full text-base font-semibold', c.date === today && 'bg-ink text-white')}>{Number(c.date.slice(8))}</span>
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="relative flex">
        <div className="relative w-14 shrink-0" style={{ height }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-stone-400 tabular-nums" style={{ top: (h - dayStart) * PX_PER_MIN }}>
              {h === dayStart ? '' : fmtTime(h).replace(':00', '')}
            </span>
          ))}
        </div>
        {columns.map((c) => (
          <div key={c.key} className="relative flex flex-1 border-l border-stone-100" style={{ minWidth: minCol, height }}>
            {hours.slice(1, -1).map((h) => <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-stone-100" style={{ top: (h - dayStart) * PX_PER_MIN }} />)}
            {c.lanes.map((m) => (
              <Lane key={m.id} member={m} date={c.date} bookings={bookings.filter((b) => b.date === c.date && b.staffId === m.id)} services={services} clientMap={clientMap}
                off={timeOff.find((t) => t.date === c.date && (t.staffId === null || t.staffId === m.id))} dayStart={dayStart} dayEnd={dayEnd} compact={view === 'week'}
                onOpen={onOpen} onEmpty={onEmpty} />
            ))}
            {c.date === today && now > dayStart && now < dayEnd && (
              <div className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-red-500" style={{ top: (now - dayStart) * PX_PER_MIN }}>
                <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-red-500" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const hatch = 'bg-[repeating-linear-gradient(135deg,#fafaf9_0_6px,#f0efed_6px_8px)]'

function Lane({ member, date, bookings, services, clientMap, off, dayStart, dayEnd, compact, onOpen, onEmpty }: {
  member: StaffMember; date: DateStr; bookings: Booking[]; services: Service[]; clientMap: Map<string, Client>; off?: TimeOff
  dayStart: number; dayEnd: number; compact: boolean; onOpen: (id: string) => void; onEmpty: (d: DateStr, staffId: string, start: number) => void
}) {
  const h = member.hours[dayOfWeek(date)]
  const y = (m: number) => (m - dayStart) * PX_PER_MIN
  const blocks: { from: number; to: number; label?: string }[] = []
  if (!h || off) blocks.push({ from: dayStart, to: dayEnd, label: off ? off.note || 'Day off' : 'Not working' })
  else {
    if (h.start > dayStart) blocks.push({ from: dayStart, to: h.start })
    if (h.end < dayEnd) blocks.push({ from: h.end, to: dayEnd })
    if (h.breakStart != null && h.breakEnd != null) blocks.push({ from: h.breakStart, to: h.breakEnd, label: compact ? undefined : 'Break' })
  }
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const min = dayStart + Math.floor((e.clientY - rect.top) / PX_PER_MIN / 15) * 15
    onEmpty(date, member.id, min)
  }
  return (
    <div className={cn('relative flex-1', compact && 'border-l border-stone-50 first:border-l-0')} onClick={click}>
      {blocks.map((b, i) => (
        <div key={i} className={cn('pointer-events-none absolute inset-x-0 flex items-start justify-center', hatch)} style={{ top: y(b.from), height: y(b.to) - y(b.from) }}>
          {b.label && !compact && <span className="mt-2 rounded bg-white/80 px-1.5 text-[11px] text-stone-400">{b.label}</span>}
        </div>
      ))}
      {bookings.map((b) => {
        const svc = services.find((s) => s.id === b.serviceId)
        const client = clientMap.get(b.clientId)
        const hgt = (b.end - b.start) * PX_PER_MIN
        const cancelled = b.status === 'cancelled'
        return (
          <button
            key={b.id}
            data-testid="booking-block"
            data-code={b.code}
            onClick={() => onOpen(b.id)}
            title={`${fmtTime(b.start)} ${client?.name ?? ''} — ${svc?.name ?? ''} (${STATUS_STYLE[b.status].label})`}
            className={cn(
              'absolute inset-x-0.5 overflow-hidden rounded-md text-left text-[11px] leading-tight shadow-sm ring-1 transition hover:z-10 hover:shadow-md',
              compact ? 'px-1 py-0.5' : 'px-2 py-1',
              cancelled ? 'bg-white text-stone-400 line-through ring-stone-200 opacity-70' : 'text-stone-800 ring-black/5',
              b.status === 'no-show' && 'ring-2 ring-amber-400',
            )}
            style={{ top: y(b.start) + 1, height: hgt - 2, background: cancelled ? undefined : b.status === 'completed' ? `color-mix(in srgb, ${member.color} 12%, white)` : `color-mix(in srgb, ${member.color} 22%, white)`, borderLeft: `3px solid ${member.color}` }}
          >
            {compact ? (
              <span className="block truncate font-semibold">{client?.name.split(' ')[0]}</span>
            ) : (
              <>
                <span className="flex items-center justify-between gap-1">
                  <span className="truncate font-semibold">{client?.name}</span>
                  <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_STYLE[b.status].dot)} />
                </span>
                {hgt > 30 && <span className="block truncate text-stone-600">{fmtTime(b.start)} · {svc?.name}</span>}
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
