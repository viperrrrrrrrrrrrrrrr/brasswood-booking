import { useEffect, useState } from 'react'
import { Plus, Trash2, CalendarOff, AlertTriangle } from 'lucide-react'
import { api } from '../../data'
import { useQuery } from '../../data/hooks'
import type { DayHours, WeeklyHours } from '../../lib/types'
import { addDays, fmtDateLong, fmtTime24, parseTime24, todayStr, WEEKDAYS } from '../../lib/date'
import { Avatar, Button, Card, EmptyState, Field, Input, Select, Spinner, cn, useToast } from '../../components/ui'
import { PageHeader } from './AdminLayout'

export default function HoursPage() {
  const staff = useQuery(() => api.staff.list(), [], ['catalog'])
  const [selected, setSelected] = useState<string | null>(null)
  const member = staff.data?.find((s) => s.id === (selected ?? staff.data?.[0]?.id))

  if (!staff.data) return <Spinner />
  return (
    <div>
      <PageHeader title="Hours & days off" sub="Availability shown to clients is calculated from these hours, breaks, days off and existing bookings." />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card>
          <div className="flex gap-1 overflow-x-auto border-b border-stone-100 p-2 no-scrollbar">
            {staff.data.map((m) => (
              <button key={m.id} onClick={() => setSelected(m.id)} className={cn('flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium', member?.id === m.id ? 'bg-stone-100' : 'text-stone-500 hover:bg-stone-50')}>
                <Avatar name={m.name} color={m.color} size={24} />{m.name}
              </button>
            ))}
          </div>
          {member && <WeekEditor key={member.id} staffId={member.id} hours={member.hours} />}
        </Card>
        <TimeOffCard staff={staff.data} />
      </div>
    </div>
  )
}

function WeekEditor({ staffId, hours: initial }: { staffId: string; hours: WeeklyHours }) {
  const [hours, setHours] = useState<WeeklyHours>(initial)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  useEffect(() => setHours(initial), [initial])
  const dirty = JSON.stringify(hours) !== JSON.stringify(initial)
  const set = (d: number, patch: Partial<DayHours> | null) =>
    setHours(hours.map((h, i) => (i !== d ? h : patch === null ? null : { ...(h ?? { start: 540, end: 1080, breakStart: null, breakEnd: null }), ...patch })))

  const save = async () => {
    for (const h of hours) {
      if (h && h.end <= h.start) return toast('End time must be after start time', 'error')
      if (h && h.breakStart != null && h.breakEnd != null && (h.breakEnd <= h.breakStart || h.breakStart < h.start || h.breakEnd > h.end)) return toast('Breaks must be within working hours', 'error')
    }
    setSaving(true)
    await api.staff.update(staffId, { hours })
    setSaving(false)
    toast('Working hours saved')
  }

  return (
    <div>
      <div className="divide-y divide-stone-100">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const h = hours[d]
          return (
            <div key={d} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
              <label className="flex w-32 items-center gap-2.5 text-sm font-medium">
                <input type="checkbox" className="peer sr-only" checked={!!h} onChange={(e) => set(d, e.target.checked ? {} : null)} />
                <span className="relative h-5 w-9 rounded-full bg-stone-200 transition peer-checked:bg-ink after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4" />
                {WEEKDAYS[d]}
              </label>
              {h ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Input type="time" step={900} className="w-28 py-1.5" value={fmtTime24(h.start)} onChange={(e) => set(d, { start: parseTime24(e.target.value) })} />
                  <span className="text-stone-400">to</span>
                  <Input type="time" step={900} className="w-28 py-1.5" value={fmtTime24(h.end)} onChange={(e) => set(d, { end: parseTime24(e.target.value) })} />
                  {h.breakStart != null ? (
                    <span className="flex items-center gap-2">
                      <span className="text-stone-400">break</span>
                      <Input type="time" step={900} className="w-28 py-1.5" value={fmtTime24(h.breakStart)} onChange={(e) => set(d, { breakStart: parseTime24(e.target.value) })} />
                      <span className="text-stone-400">–</span>
                      <Input type="time" step={900} className="w-28 py-1.5" value={fmtTime24(h.breakEnd ?? h.breakStart + 30)} onChange={(e) => set(d, { breakEnd: parseTime24(e.target.value) })} />
                      <button onClick={() => set(d, { breakStart: null, breakEnd: null })} className="text-stone-400 hover:text-red-600" aria-label="Remove break"><Trash2 className="size-4" /></button>
                    </span>
                  ) : (
                    <button onClick={() => set(d, { breakStart: 780, breakEnd: 810 })} className="text-xs font-medium text-brand-700 hover:underline">+ Add break</button>
                  )}
                </div>
              ) : <span className="text-sm text-stone-400">Day off</span>}
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-stone-100 px-5 py-3">
        {dirty && <span className="mr-auto text-xs text-amber-700">Unsaved changes</span>}
        <Button variant="secondary" disabled={!dirty} onClick={() => setHours(initial)}>Discard</Button>
        <Button disabled={!dirty} loading={saving} onClick={save}>Save hours</Button>
      </div>
    </div>
  )
}

function TimeOffCard({ staff }: { staff: { id: string; name: string; color: string }[] }) {
  const today = todayStr()
  const timeOff = useQuery(() => api.timeOff.list(), [], ['catalog'])
  const [form, setForm] = useState({ date: addDays(today, 1), staffId: '', note: '' })
  const affected = useQuery(() => api.bookings.list({ from: form.date, to: form.date, status: ['confirmed'], staffId: form.staffId || undefined }), [form.date, form.staffId], ['bookings'])
  const toast = useToast()
  const add = async () => {
    if (!form.date) return
    await api.timeOff.create({ date: form.date, staffId: form.staffId || null, note: form.note.trim() || (form.staffId ? 'Day off' : 'Shop closed') })
    toast('Day off added — online booking is blocked for that day')
    setForm({ ...form, note: '' })
  }
  const upcoming = (timeOff.data ?? []).filter((t) => t.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  return (
    <Card className="self-start">
      <div className="border-b border-stone-100 px-5 py-4">
        <h2 className="font-semibold">Days off & closures</h2>
        <p className="text-sm text-stone-500">Holidays, sick days, training, shop closures.</p>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <Field label="Date"><Input type="date" min={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Who">
          <Select value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
            <option value="">Whole shop (closed)</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Note" className="sm:col-span-2"><Input value={form.note} placeholder="e.g. Public holiday" onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        {!!affected.data?.length && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 sm:col-span-2"><AlertTriangle className="size-4 shrink-0" />{affected.data.length} confirmed booking(s) exist on this day. They will stay in the schedule — reschedule or cancel them manually.</p>
        )}
        <Button className="sm:col-span-2" onClick={add}><Plus className="size-4" />Add day off</Button>
      </div>
      <div className="border-t border-stone-100">
        {upcoming.length === 0 ? <EmptyState icon={<CalendarOff className="size-8" />} title="No upcoming days off" /> : (
          <ul className="divide-y divide-stone-100">
            {upcoming.map((t) => {
              const m = staff.find((s) => s.id === t.staffId)
              return (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                  {m ? <Avatar name={m.name} color={m.color} size={30} /> : <span className="flex size-[30px] items-center justify-center rounded-full bg-ink text-brand-300"><CalendarOff className="size-4" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{fmtDateLong(t.date)}</p>
                    <p className="truncate text-xs text-stone-500">{m ? m.name : 'Whole shop'} · {t.note}</p>
                  </div>
                  <button onClick={async () => { await api.timeOff.remove(t.id); toast('Day off removed') }} className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove"><Trash2 className="size-4" /></button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
