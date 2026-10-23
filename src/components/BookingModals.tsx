import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Trash2, Mail, Phone, Scissors, User, CalendarDays, StickyNote } from 'lucide-react'
import { api } from '../data'
import { useDebounced, useQuery } from '../data/hooks'
import type { BookingStatus, ID, Service, StaffMember } from '../lib/types'
import { fmtDateLong, fmtDuration, fmtTime, todayStr, usd } from '../lib/date'
import { Avatar, Button, Field, Input, Modal, Select, STATUS_STYLE, Spinner, Textarea, cn, useToast } from './ui'

const STATUSES: BookingStatus[] = ['confirmed', 'completed', 'no-show', 'cancelled']

export function BookingDetailsModal({ bookingId, onClose, services, staff }: { bookingId: ID | null; onClose: () => void; services: Service[]; staff: StaffMember[] }) {
  const toast = useToast()
  const [rescheduling, setRescheduling] = useState(false)
  const booking = useQuery(() => (bookingId ? api.bookings.get(bookingId) : Promise.resolve(undefined)), [bookingId], ['bookings'])
  const b = booking.data
  const client = useQuery(() => (b ? api.clients.get(b.clientId) : Promise.resolve(undefined)), [b?.clientId], ['clients'])
  useEffect(() => setRescheduling(false), [bookingId])
  if (!bookingId) return null
  const service = services.find((s) => s.id === b?.serviceId)
  const member = staff.find((s) => s.id === b?.staffId)

  const setStatus = async (status: BookingStatus) => {
    try {
      await api.bookings.setStatus(bookingId, status)
      toast(`Marked as ${STATUS_STYLE[status].label.toLowerCase()}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const remove = async () => {
    if (!window.confirm('Delete this booking permanently? This cannot be undone.')) return
    await api.bookings.remove(bookingId)
    toast('Booking deleted')
    onClose()
  }

  if (rescheduling && b) {
    return <BookingFormModal open mode="reschedule" bookingId={b.id} initial={{ serviceId: b.serviceId, staffId: b.staffId, date: b.date, start: b.start }} services={services} staff={staff} onClose={() => setRescheduling(false)} />
  }

  return (
    <Modal open onClose={onClose} title={b ? `Booking ${b.code}` : 'Booking'}
      footer={b && (
        <>
          <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700" onClick={remove}><Trash2 className="size-4" />Delete</Button>
          <Button variant="secondary" onClick={() => setRescheduling(true)}><CalendarClock className="size-4" />Reschedule</Button>
          <Button onClick={onClose}>Done</Button>
        </>
      )}>
      {!b || !service || !member ? <Spinner /> : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={client.data?.name ?? '?'} size={44} color="#44403c" />
            <div className="min-w-0">
              <p className="font-semibold">{client.data?.name}</p>
              <p className="flex flex-wrap gap-x-3 text-sm text-stone-500">
                <a href={`tel:${client.data?.phone}`} className="flex items-center gap-1 hover:text-stone-800"><Phone className="size-3.5" />{client.data?.phone}</a>
                <a href={`mailto:${client.data?.email}`} className="flex items-center gap-1 hover:text-stone-800"><Mail className="size-3.5" />{client.data?.email}</a>
              </p>
            </div>
          </div>
          <div className="grid gap-3 rounded-xl bg-stone-50 p-4 text-sm sm:grid-cols-2">
            <p className="flex items-center gap-2"><Scissors className="size-4 text-stone-400" />{service.name} · {usd(b.priceUsd)}</p>
            <p className="flex items-center gap-2"><User className="size-4 text-stone-400" /><span className="size-2 rounded-full" style={{ background: member.color }} />{member.name}</p>
            <p className="flex items-center gap-2"><CalendarDays className="size-4 text-stone-400" />{fmtDateLong(b.date)}</p>
            <p className="flex items-center gap-2"><CalendarClock className="size-4 text-stone-400" />{fmtTime(b.start)} – {fmtTime(b.end)}</p>
            {b.notes && <p className="flex items-start gap-2 sm:col-span-2"><StickyNote className="mt-0.5 size-4 text-stone-400" />{b.notes}</p>}
            <p className="text-xs text-stone-400 sm:col-span-2">Booked {b.source === 'online' ? 'online' : 'by staff'} · {new Date(b.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-stone-700">Status</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
              {STATUSES.map((s) => (
                <button key={s} role="radio" aria-checked={b.status === s} data-testid={`status-${s}`} onClick={() => setStatus(s)}
                  className={cn('flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium ring-1 transition', b.status === s ? STATUS_STYLE[s].cls + ' ring-2' : 'ring-stone-200 text-stone-600 hover:bg-stone-50')}>
                  <span className={cn('size-2 rounded-full', STATUS_STYLE[s].dot)} />{STATUS_STYLE[s].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

interface FormInitial { serviceId?: ID; staffId?: ID; date?: string; start?: number }

export function BookingFormModal({ open, mode, bookingId, initial, services, staff, onClose }: {
  open: boolean; mode: 'create' | 'reschedule'; bookingId?: ID; initial?: FormInitial; services: Service[]; staff: StaffMember[]; onClose: () => void
}) {
  const toast = useToast()
  const [serviceId, setServiceId] = useState<ID>(initial?.serviceId ?? services.find((s) => s.active)?.id ?? '')
  const [staffId, setStaffId] = useState<ID>(initial?.staffId ?? '')
  const [date, setDate] = useState(initial?.date ?? todayStr())
  const [start, setStart] = useState<number | ''>(initial?.start ?? '')
  const [client, setClient] = useState({ name: '', phone: '', email: '' })
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  // Server-side search (limit 5) instead of loading every client for the autocomplete.
  const term = useDebounced(query.trim(), 250)
  const clients = useQuery(() => (term.length >= 2 ? api.clients.list({ q: term, limit: 5 }) : Promise.resolve([])), [term], ['clients'])
  const eligible = staff.filter((s) => s.active && s.serviceIds.includes(serviceId))

  useEffect(() => {
    if (!eligible.some((s) => s.id === staffId) && eligible[0]) setStaffId(eligible[0].id)
  }, [serviceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const slots = useQuery(
    () => (serviceId && staffId && date ? api.availability.getSlots({ serviceId, staffId, date, excludeBookingId: bookingId, ignoreRules: true }) : Promise.resolve([])),
    [serviceId, staffId, date, bookingId],
    ['catalog', 'bookings'],
  )
  const slotOptions = slots.data ?? []
  const startValid = start !== '' && slotOptions.some((s) => s.start === start)

  const matches = useMemo(() => (query.trim().length < 2 ? [] : clients.data ?? []), [query, clients.data])

  const save = async () => {
    if (start === '' || !startValid) return toast('Pick an available time', 'error')
    setSaving(true)
    try {
      if (mode === 'reschedule' && bookingId) {
        await api.bookings.reschedule(bookingId, { date, start, staffId })
        toast('Booking rescheduled')
      } else {
        if (!client.name.trim()) { setSaving(false); return toast('Client name is required', 'error') }
        await api.bookings.create({ serviceId, staffId, date, start, client, notes, source: 'admin' })
        toast('Booking created')
      }
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const service = services.find((s) => s.id === serviceId)
  return (
    <Modal open={open} onClose={onClose} title={mode === 'create' ? 'New booking' : 'Reschedule booking'} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save} disabled={!startValid} data-testid="save-booking">{mode === 'create' ? 'Create booking' : 'Save new time'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Service" className="sm:col-span-2">
          <Select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setStart('') }} disabled={mode === 'reschedule'}>
            {services.filter((s) => s.active || s.id === serviceId).map((s) => <option key={s.id} value={s.id}>{s.name} — {fmtDuration(s.durationMin)} · {usd(s.priceUsd)}</option>)}
          </Select>
        </Field>
        <Field label="Specialist">
          <Select value={staffId} onChange={(e) => { setStaffId(e.target.value); setStart('') }}>
            {eligible.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setStart('') }} />
        </Field>
        <Field label="Available start times" className="sm:col-span-2" hint={service ? `${fmtDuration(service.durationMin)} · respects working hours, breaks, days off and existing bookings` : undefined}>
          {slots.loading && !slots.data ? <Spinner /> : slotOptions.length === 0 ? (
            <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-500">No free time for this specialist on this date.</p>
          ) : (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto scrollbar-thin">
              {slotOptions.map((s) => (
                <button type="button" key={s.start} onClick={() => setStart(s.start)}
                  className={cn('rounded-lg px-2.5 py-1.5 text-sm ring-1', start === s.start ? 'bg-ink text-white ring-ink' : 'ring-stone-200 hover:bg-stone-50')}>
                  {fmtTime(s.start)}
                </button>
              ))}
            </div>
          )}
        </Field>
        {mode === 'create' && (
          <>
            <div className="relative sm:col-span-2">
              <Field label="Find existing client" hint="Or fill in the details below for a new client">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, phone or email" />
              </Field>
              {matches.length > 0 && (
                <div className="absolute inset-x-0 top-[70px] z-10 rounded-xl bg-white p-1 shadow-lg ring-1 ring-stone-200">
                  {matches.map((c) => (
                    <button type="button" key={c.id} onClick={() => { setClient({ name: c.name, phone: c.phone, email: c.email }); setQuery('') }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50">
                      <span className="font-medium">{c.name}</span><span className="text-stone-400">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Field label="Client name"><Input value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} /></Field>
            <Field label="Phone"><Input type="tel" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} /></Field>
            <Field label="Email" className="sm:col-span-2"><Input type="email" value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Modal>
  )
}
