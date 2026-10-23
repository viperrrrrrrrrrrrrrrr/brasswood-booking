import { useMemo, useState } from 'react'
import { Search, Mail, Phone, Users } from 'lucide-react'
import { api } from '../../data'
import { useCatalog, useQuery } from '../../data/hooks'
import type { Booking, Client } from '../../lib/types'
import { fmtDate, fmtTime, todayStr, usd } from '../../lib/date'
import { Avatar, Button, Card, EmptyState, Field, Input, Modal, Spinner, StatusBadge, Textarea, useToast } from '../../components/ui'
import { PageHeader } from './AdminLayout'

interface Row { client: Client; visits: number; spent: number; last?: string; next?: Booking; total: number }

export default function ClientsPage() {
  const clients = useQuery(() => api.clients.list(), [])
  const bookings = useQuery(() => api.bookings.list(), [])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'name' | 'spent' | 'last'>('last')
  const [openId, setOpenId] = useState<string | null>(null)
  const today = todayStr()

  const rows: Row[] = useMemo(() => {
    const by = new Map<string, Booking[]>()
    for (const b of bookings.data ?? []) by.set(b.clientId, [...(by.get(b.clientId) ?? []), b])
    return (clients.data ?? []).map((c) => {
      const list = by.get(c.id) ?? []
      const done = list.filter((b) => b.status === 'completed')
      return {
        client: c,
        visits: done.length,
        spent: done.reduce((s, b) => s + b.priceUsd, 0),
        last: done.map((b) => b.date).sort().at(-1),
        next: list.filter((b) => b.status === 'confirmed' && b.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0],
        total: list.length,
      }
    })
  }, [clients.data, bookings.data, today])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const digits = s.replace(/\D/g, '')
    const list = rows.filter(({ client: c }) => !s || c.name.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)))
    return list.sort((a, b) => sort === 'name' ? a.client.name.localeCompare(b.client.name) : sort === 'spent' ? b.spent - a.spent : (b.next?.date ?? b.last ?? '').localeCompare(a.next?.date ?? a.last ?? ''))
  }, [rows, q, sort])

  if (!clients.data || !bookings.data) return <Spinner />
  return (
    <div>
      <PageHeader title="Clients" sub={`${clients.data.length} clients · created automatically from bookings`} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 p-3 sm:p-4">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or phone" className="pl-9" data-testid="client-search" />
          </div>
          <div className="flex rounded-xl bg-stone-100 p-0.5 text-xs font-medium">
            {([['last', 'Recent'], ['spent', 'Top spend'], ['name', 'A–Z']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)} className={`rounded-[10px] px-3 py-1.5 ${sort === k ? 'bg-white shadow-sm' : 'text-stone-500'}`}>{l}</button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? <EmptyState icon={<Users className="size-8" />} title="No clients found" text="Try a different name, email or phone number." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-medium text-stone-400">
                <tr><th className="px-5 py-2.5">Client</th><th className="hidden px-3 md:table-cell">Contact</th><th className="px-3 text-right">Visits</th><th className="hidden px-3 text-right sm:table-cell">Spent</th><th className="hidden px-3 lg:table-cell">Last visit</th><th className="hidden px-5 lg:table-cell">Next booking</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100" data-testid="client-rows">
                {filtered.map((r) => (
                  <tr key={r.client.id} onClick={() => setOpenId(r.client.id)} className="cursor-pointer hover:bg-stone-50">
                    <td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={r.client.name} size={32} color="#57534e" /><div className="min-w-0"><p className="font-medium">{r.client.name}</p><p className="truncate text-xs text-stone-400 md:hidden">{r.client.phone}</p></div></div></td>
                    <td className="hidden px-3 md:table-cell"><p>{r.client.email}</p><p className="text-xs text-stone-400">{r.client.phone}</p></td>
                    <td className="px-3 text-right tabular-nums">{r.visits}</td>
                    <td className="hidden px-3 text-right font-medium tabular-nums sm:table-cell">{usd(r.spent)}</td>
                    <td className="hidden px-3 text-stone-500 lg:table-cell">{r.last ? fmtDate(r.last) : '—'}</td>
                    <td className="hidden px-5 lg:table-cell">{r.next ? <span className="text-emerald-700">{fmtDate(r.next.date)}, {fmtTime(r.next.start)}</span> : <span className="text-stone-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {openId && <ClientModal row={rows.find((r) => r.client.id === openId)!} bookings={(bookings.data ?? []).filter((b) => b.clientId === openId)} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function ClientModal({ row, bookings, onClose }: { row: Row; bookings: Booking[]; onClose: () => void }) {
  const { services, staff } = useCatalog()
  const [notes, setNotes] = useState(row.client.notes)
  const toast = useToast()
  const c = row.client
  const sorted = [...bookings].sort((a, b) => (b.date + String(b.start).padStart(4, '0')).localeCompare(a.date + String(a.start).padStart(4, '0')))
  const noShows = bookings.filter((b) => b.status === 'no-show').length
  return (
    <Modal open onClose={onClose} title="Client" wide>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={c.name} size={52} color="#57534e" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{c.name}</p>
          <p className="flex flex-wrap gap-x-4 text-sm text-stone-500">
            <a href={`tel:${c.phone}`} className="flex items-center gap-1"><Phone className="size-3.5" />{c.phone}</a>
            <a href={`mailto:${c.email}`} className="flex items-center gap-1"><Mail className="size-3.5" />{c.email}</a>
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-stone-50 p-3"><p className="text-lg font-semibold">{row.visits}</p><p className="text-xs text-stone-500">Visits</p></div>
        <div className="rounded-xl bg-stone-50 p-3"><p className="text-lg font-semibold">{usd(row.spent)}</p><p className="text-xs text-stone-500">Lifetime spend</p></div>
        <div className="rounded-xl bg-stone-50 p-3"><p className="text-lg font-semibold">{noShows}</p><p className="text-xs text-stone-500">No-shows</p></div>
      </div>
      <Field label="Private notes" className="mt-4">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Preferences, allergies…" />
      </Field>
      {notes !== c.notes && <Button size="sm" className="mt-2" onClick={async () => { await api.clients.update(c.id, { notes }); toast('Notes saved') }}>Save notes</Button>}
      <h3 className="mt-6 mb-2 text-sm font-semibold">Booking history</h3>
      {sorted.length === 0 ? <p className="text-sm text-stone-500">No bookings yet.</p> : (
        <ul className="divide-y divide-stone-100 rounded-xl ring-1 ring-stone-200">
          {sorted.map((b) => {
            const m = staff.find((s) => s.id === b.staffId)
            return (
              <li key={b.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="w-28 shrink-0 tabular-nums text-stone-600">{fmtDate(b.date)}<br /><span className="text-xs text-stone-400">{fmtTime(b.start)}</span></span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{services.find((s) => s.id === b.serviceId)?.name}</span><span className="block truncate text-xs text-stone-400">{m?.name} · {b.code}</span></span>
                <span className="hidden tabular-nums sm:inline">{usd(b.priceUsd)}</span>
                <StatusBadge status={b.status} />
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
