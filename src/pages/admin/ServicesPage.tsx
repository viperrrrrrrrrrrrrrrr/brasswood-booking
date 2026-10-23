import { useState } from 'react'
import { Plus, Pencil, Trash2, Clock } from 'lucide-react'
import { api } from '../../data'
import { useQuery } from '../../data/hooks'
import type { Service } from '../../lib/types'
import { fmtDuration, todayStr, usd } from '../../lib/date'
import { Badge, Button, Card, Field, Input, Modal, Select, Spinner, Textarea, cn, useToast } from '../../components/ui'
import { PageHeader } from './AdminLayout'

type Draft = Omit<Service, 'id'> & { id?: string }
const EMPTY: Draft = { name: '', description: '', category: 'Hair', durationMin: 30, priceUsd: 30, active: true }

export default function ServicesPage() {
  const services = useQuery(() => api.services.list(), [])
  const bookings = useQuery(() => api.bookings.list({ from: todayStr(), status: ['confirmed'] }), [])
  const [draft, setDraft] = useState<Draft | null>(null)
  const toast = useToast()

  const remove = async (s: Service) => {
    const upcoming = (bookings.data ?? []).filter((b) => b.serviceId === s.id).length
    if (upcoming) {
      if (window.confirm(`${s.name} has ${upcoming} upcoming booking(s). Hide it from online booking instead? Existing bookings are kept.`)) {
        await api.services.update(s.id, { active: false })
        toast(`${s.name} hidden from booking page`)
      }
      return
    }
    if (!window.confirm(`Delete “${s.name}”?`)) return
    await api.services.remove(s.id)
    toast('Service deleted')
  }

  if (!services.data) return <Spinner />
  const cats = [...new Set(services.data.map((s) => s.category))]

  return (
    <div>
      <PageHeader title="Services" sub="What clients can book online, with duration and price." actions={<Button onClick={() => setDraft({ ...EMPTY })}><Plus className="size-4" />Add service</Button>} />
      <div className="space-y-6">
        {cats.map((cat) => (
          <div key={cat}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">{cat}</p>
            <Card className="divide-y divide-stone-100">
              {services.data!.filter((s) => s.category === cat).map((s) => (
                <div key={s.id} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className={cn('font-medium', !s.active && 'text-stone-400')}>{s.name} {!s.active && <Badge className="ml-1 bg-stone-100 text-stone-500">Hidden</Badge>}</p>
                    <p className="truncate text-sm text-stone-500">{s.description}</p>
                  </div>
                  <span className="hidden items-center gap-1 text-sm text-stone-500 sm:flex"><Clock className="size-3.5" />{fmtDuration(s.durationMin)}</span>
                  <span className="w-16 text-right font-semibold tabular-nums">{usd(s.priceUsd)}</span>
                  <div className="flex gap-1">
                    <button onClick={() => setDraft({ ...s })} className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label={`Edit ${s.name}`}><Pencil className="size-4" /></button>
                    <button onClick={() => remove(s)} className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${s.name}`}><Trash2 className="size-4" /></button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>
      {draft && <ServiceModal draft={draft} categories={cats} onClose={() => setDraft(null)} />}
    </div>
  )
}

function ServiceModal({ draft: initial, categories, onClose }: { draft: Draft; categories: string[]; onClose: () => void }) {
  const [d, setD] = useState<Draft>(initial)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const save = async () => {
    if (!d.name.trim()) return toast('Name is required', 'error')
    if (d.durationMin < 5 || d.priceUsd < 0) return toast('Check duration and price', 'error')
    setSaving(true)
    const { id, ...data } = d
    if (id) await api.services.update(id, data)
    else await api.services.create(data)
    toast(id ? 'Service updated' : 'Service added')
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit service' : 'New service'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
        <Field label="Category">
          <Input list="cats" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Duration">
          <Select value={d.durationMin} onChange={(e) => setD({ ...d, durationMin: Number(e.target.value) })}>
            {[15, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180].map((m) => <option key={m} value={m}>{fmtDuration(m)}</option>)}
          </Select>
        </Field>
        <Field label="Price (USD)"><Input type="number" min={0} step={1} value={d.priceUsd} onChange={(e) => setD({ ...d, priceUsd: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="size-4 accent-ink" />
          Bookable online
        </label>
      </div>
    </Modal>
  )
}
