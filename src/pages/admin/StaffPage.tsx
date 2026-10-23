import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../data'
import { useQuery } from '../../data/hooks'
import type { StaffMember } from '../../lib/types'
import { fmtTime, todayStr, WEEKDAYS_SHORT } from '../../lib/date'
import { Avatar, Badge, Button, Card, Field, Input, Modal, Spinner, Textarea, cn, useToast } from '../../components/ui'
import { PageHeader } from './AdminLayout'

const COLORS = ['#b7791f', '#2f6f6a', '#6b4fa3', '#b4483c', '#2e5f9e', '#5f7d2e', '#a3487f', '#44403c']
type Draft = Omit<StaffMember, 'id'> & { id?: string }
const defaultHours = () => Array.from({ length: 7 }, (_, d) => (d === 0 ? null : { start: 540, end: 1080, breakStart: 780, breakEnd: 810 }))

export default function StaffPage() {
  const staff = useQuery(() => api.staff.list(), [], ['catalog'])
  const services = useQuery(() => api.services.list(), [], ['catalog'])
  const bookings = useQuery(() => api.bookings.list({ from: todayStr(), status: ['confirmed'] }), [], ['bookings'])
  const [draft, setDraft] = useState<Draft | null>(null)
  const toast = useToast()

  const remove = async (m: StaffMember) => {
    const upcoming = (bookings.data ?? []).filter((b) => b.staffId === m.id).length
    if (upcoming) {
      if (window.confirm(`${m.name} has ${upcoming} upcoming booking(s). Deactivate instead (hidden from booking, history kept)? Reassign their bookings from the schedule.`)) {
        await api.staff.update(m.id, { active: false })
        toast(`${m.name} deactivated`)
      }
      return
    }
    if (!window.confirm(`Remove ${m.name}?`)) return
    await api.staff.remove(m.id)
    toast('Staff member removed')
  }

  if (!staff.data || !services.data) return <Spinner />
  return (
    <div>
      <PageHeader title="Staff" sub="Who works here and which services they offer." actions={<Button onClick={() => setDraft({ name: '', role: 'Barber', bio: '', color: COLORS[staff.data!.length % COLORS.length], serviceIds: services.data!.map((s) => s.id), hours: defaultHours(), active: true })}><Plus className="size-4" />Add staff</Button>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {staff.data.map((m) => (
          <Card key={m.id} className={cn('flex flex-col p-5', !m.active && 'opacity-60')}>
            <div className="flex items-start gap-3">
              <Avatar name={m.name} color={m.color} size={48} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{m.name} {!m.active && <Badge className="bg-stone-100 text-stone-500">Inactive</Badge>}</p>
                <p className="text-sm text-stone-500">{m.role}</p>
              </div>
              <div className="flex">
                <button onClick={() => setDraft({ ...m })} className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label={`Edit ${m.name}`}><Pencil className="size-4" /></button>
                <button onClick={() => remove(m)} className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${m.name}`}><Trash2 className="size-4" /></button>
              </div>
            </div>
            <p className="mt-3 text-sm text-stone-600">{m.bio}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {services.data!.filter((s) => m.serviceIds.includes(s.id)).map((s) => <Badge key={s.id} className="bg-stone-100 text-stone-600">{s.name}</Badge>)}
            </div>
            <div className="mt-auto pt-4">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const h = m.hours[d]
                  return (
                    <div key={d} className={cn('rounded-lg py-1.5', h ? 'bg-brand-50 text-brand-900' : 'bg-stone-50 text-stone-300')}>
                      <p className="font-semibold">{WEEKDAYS_SHORT[d].slice(0, 2)}</p>
                      <p className="leading-tight">{h ? fmtTime(h.start).replace(':00', '').replace(' ', '') : 'off'}</p>
                      <p className="leading-tight">{h ? fmtTime(h.end).replace(':00', '').replace(' ', '') : ''}</p>
                    </div>
                  )
                })}
              </div>
              <Link to="/admin/hours" className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">Edit hours & days off →</Link>
            </div>
          </Card>
        ))}
      </div>
      {draft && <StaffModal draft={draft} onClose={() => setDraft(null)} services={services.data} />}
    </div>
  )
}

function StaffModal({ draft: initial, services, onClose }: { draft: Draft; services: { id: string; name: string }[]; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial)
  const toast = useToast()
  const save = async () => {
    if (!d.name.trim()) return toast('Name is required', 'error')
    const { id, ...data } = d
    if (id) await api.staff.update(id, data)
    else await api.staff.create(data)
    toast(id ? 'Staff updated' : 'Staff member added')
    onClose()
  }
  const toggle = (sid: string) => setD({ ...d, serviceIds: d.serviceIds.includes(sid) ? d.serviceIds.filter((x) => x !== sid) : [...d.serviceIds, sid] })
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit staff member' : 'New staff member'} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus /></Field>
        <Field label="Role / title"><Input value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })} /></Field>
        <Field label="Short bio (shown to clients)" className="sm:col-span-2"><Textarea value={d.bio} onChange={(e) => setD({ ...d, bio: e.target.value })} /></Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-stone-700">Calendar colour</p>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => <button key={c} type="button" onClick={() => setD({ ...d, color: c })} className={cn('size-8 rounded-full ring-offset-2 transition', d.color === c && 'ring-2 ring-ink')} style={{ background: c }} aria-label={`Colour ${c}`} />)}
          </div>
        </div>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-stone-700">Services offered</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-50">
                <input type="checkbox" className="size-4 accent-ink" checked={d.serviceIds.includes(s.id)} onChange={() => toggle(s.id)} />{s.name}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="size-4 accent-ink" /> Active (bookable online)
        </label>
      </div>
    </Modal>
  )
}
