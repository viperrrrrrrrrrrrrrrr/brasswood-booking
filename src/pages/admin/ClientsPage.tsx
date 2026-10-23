import { useState } from 'react'
import { Search, Mail, Phone, Users } from 'lucide-react'
import { api } from '../../data'
import { useCatalog, useDebounced, useQuery } from '../../data/hooks'
import type { ClientSort, ClientSummary, ClientSummaryPage } from '../../lib/types'
import { fmtDate, fmtTime, usd } from '../../lib/date'
import { Avatar, Button, Card, EmptyState, Field, Input, Modal, Spinner, StatusBadge, Textarea, useToast } from '../../components/ui'
import { PageHeader } from './AdminLayout'

const PAGE = 50
const MAX_PER_REQUEST = 200

/** Loads the first `count` rows of the server-side summary (search / sort / aggregates run in the database). */
async function loadRows(q: string, sort: ClientSort, count: number): Promise<ClientSummaryPage> {
  const parts: Promise<ClientSummaryPage>[] = []
  for (let offset = 0; offset < count; offset += MAX_PER_REQUEST) parts.push(api.clients.summary({ q, sort, offset, limit: Math.min(MAX_PER_REQUEST, count - offset) }))
  const pages = await Promise.all(parts)
  return { total: pages[0]?.total ?? 0, rows: pages.flatMap((p) => p.rows) }
}

function quickMatch(c: { name: string; email: string; phone: string }, term: string): boolean {
  const t = term.toLowerCase()
  const digits = term.replace(/\D/g, '')
  return c.name.toLowerCase().includes(t) || c.email.toLowerCase().includes(t) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))
}

export default function ClientsPage() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<ClientSort>('last')
  const [count, setCount] = useState(PAGE)
  const [openId, setOpenId] = useState<string | null>(null)
  const term = useDebounced(q.trim(), 250)
  // Visit counts/spend depend on bookings too, so refetch when either scope changes.
  // (useQuery keeps the previous rows while a new search/sort/page loads.)
  const page = useQuery(() => loadRows(term, sort, count), [term, sort, count], ['clients', 'bookings'])
  const shown = page.data

  if (!shown) return <Spinner />
  // Instant feedback while the debounced server search is in flight: narrow the loaded rows locally.
  const typed = q.trim()
  const rows = typed && typed !== term ? shown.rows.filter((r) => quickMatch(r.client, typed)) : shown.rows
  const open = rows.find((r) => r.client.id === openId)
  return (
    <div>
      <PageHeader title="Clients" sub={term ? `${shown.total} matching “${term}”` : `${shown.total} clients · created automatically from bookings`} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 p-3 sm:p-4">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setCount(PAGE) }} placeholder="Search name, email or phone" className="pl-9" data-testid="client-search" />
          </div>
          <div className="flex rounded-xl bg-stone-100 p-0.5 text-xs font-medium">
            {([['last', 'Recent'], ['spent', 'Top spend'], ['name', 'A–Z']] as const).map(([k, l]) => (
              <button key={k} onClick={() => { setSort(k); setCount(PAGE) }} className={`rounded-[10px] px-3 py-1.5 ${sort === k ? 'bg-white shadow-sm' : 'text-stone-500'}`}>{l}</button>
            ))}
          </div>
          {page.loading && <Spinner />}
        </div>
        {rows.length === 0 ? <EmptyState icon={<Users className="size-8" />} title="No clients found" text="Try a different name, email or phone number." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-medium text-stone-400">
                <tr><th className="px-5 py-2.5">Client</th><th className="hidden px-3 md:table-cell">Contact</th><th className="px-3 text-right">Visits</th><th className="hidden px-3 text-right sm:table-cell">Spent</th><th className="hidden px-3 lg:table-cell">Last visit</th><th className="hidden px-5 lg:table-cell">Next booking</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100" data-testid="client-rows">
                {rows.map((r) => (
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
        {rows.length < shown.total && (
          <div className="flex items-center justify-center gap-3 border-t border-stone-100 p-3 text-sm text-stone-500">
            <span>Showing {rows.length} of {shown.total}</span>
            <Button size="sm" variant="secondary" loading={page.loading} onClick={() => setCount((c) => c + PAGE)} data-testid="clients-more">Show more</Button>
          </div>
        )}
      </Card>
      {open && <ClientModal row={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function ClientModal({ row, onClose }: { row: ClientSummary; onClose: () => void }) {
  const { services, staff } = useCatalog()
  const [notes, setNotes] = useState(row.client.notes)
  const toast = useToast()
  const c = row.client
  // Only this client's bookings (indexed by client_id, date) — not the whole bookings table.
  const history = useQuery(() => api.bookings.list({ clientId: c.id }), [c.id], ['bookings'])
  const sorted = [...(history.data ?? [])].sort((a, b) => (b.date + String(b.start).padStart(4, '0')).localeCompare(a.date + String(a.start).padStart(4, '0')))
  const noShows = row.noShows
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
      {!history.data ? <Spinner /> : sorted.length === 0 ? <p className="text-sm text-stone-500">No bookings yet.</p> : (
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
