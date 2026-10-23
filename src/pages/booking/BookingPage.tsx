import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Clock, MapPin, Phone, Scissors, Users, CalendarDays, CalendarPlus, Sparkles, ChevronRight, Sun, Sunset, Moon } from 'lucide-react'
import { api, BookingConflictError, IS_DEMO } from '../../data'
import { useCatalog, useQuery } from '../../data/hooks'
import type { DataScope } from '../../data/repository'
import { browserDiffersFromShop, shopTimeZoneCity } from '../../lib/shopTime'
import type { Booking, DateStr, ID, Service, Slot, StaffMember } from '../../lib/types'
import { addDays, dayOfWeek, fmtDate, fmtDateLong, fmtDuration, fmtTime, todayStr, usd, WEEKDAYS_SHORT } from '../../lib/date'
import { Avatar, Button, Card, Field, Input, Spinner, Textarea, cn, useToast } from '../../components/ui'
import { MonthCalendar, monthKey, monthRange } from '../../components/MonthCalendar'
import { PublicLayout } from '../../components/PublicLayout'
import { downloadIcs } from '../../lib/ics'

type Step = 0 | 1 | 2 | 3
const STEPS = ['Service', 'Specialist', 'Date & time', 'Your details']
/** URL value of each step (`/?step=…`), so every step is its own browser-history entry. */
const STEP_KEYS = ['service', 'specialist', 'datetime', 'details'] as const

interface Details { name: string; phone: string; email: string; notes: string }
const EMPTY_DETAILS: Details = { name: '', phone: '', email: '', notes: '' }

/** In-progress selections survive back/forward, reloads and trips to other pages (per tab). */
const DRAFT_KEY = 'brasswood-booking-draft'
interface Draft { serviceId: ID | null; staffId: ID | 'any' | null; date: DateStr | null; slot: Slot | null; details: Details }
function loadDraft(): Partial<Draft> {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') ?? {} } catch { return {} }
}
/** history.state of a step entry: steps of the entries directly behind it that this flow pushed. */
type FlowState = { bwTrail?: Step[] } | null
const stepSearch = (s: Step) => (s === 0 ? '' : `?step=${STEP_KEYS[s]}`)

export default function BookingPage() {
  const { services, staff, settings, ready } = useCatalog()
  const toast = useToast()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [draft] = useState(loadDraft)
  const [serviceId, setServiceId] = useState<ID | null>(draft.serviceId ?? null)
  const [staffId, setStaffId] = useState<ID | 'any' | null>(draft.staffId ?? null)
  const [date, setDate] = useState<DateStr | null>(draft.date ?? null)
  const [slot, setSlot] = useState<Slot | null>(draft.slot ?? null)
  const [details, setDetails] = useState<Details>({ ...EMPTY_DETAILS, ...draft.details })
  const [errors, setErrors] = useState<Partial<Record<keyof Details, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [confirmed, setConfirmed] = useState<Booking | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const service = services.find((s) => s.id === serviceId)
  const member = staffId && staffId !== 'any' ? staff.find((s) => s.id === staffId) : undefined

  // The step lives in the URL; it can never be ahead of the selections it depends on.
  const confirmedCode = params.get('confirmed')
  const requested = Math.max(0, STEP_KEYS.indexOf(params.get('step') as (typeof STEP_KEYS)[number])) as Step
  const maxStep: Step = !service ? 0 : !staffId ? 1 : !date || !slot ? 2 : 3
  const step = Math.min(requested, maxStep) as Step
  const trail = (location.state as FlowState)?.bwTrail ?? []
  // Set while our own navigation is in flight (router updates land in a transition, after state updates).
  const navPending = useRef(false)
  useEffect(() => { navPending.current = false }, [location.key])

  // Deep link / Forward to a step whose prerequisites are missing → earliest incomplete step.
  useEffect(() => {
    if (ready && !confirmedCode && requested > maxStep && !navPending.current) navigate({ search: stepSearch(maxStep) }, { replace: true, state: location.state })
  }, [ready, confirmedCode, requested, maxStep, navigate, location.state])

  useEffect(() => {
    const empty = !serviceId && !staffId && !date && !slot && !Object.values(details).some(Boolean)
    if (empty) sessionStorage.removeItem(DRAFT_KEY)
    else sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ serviceId, staffId, date, slot, details } satisfies Draft))
  }, [serviceId, staffId, date, slot, details])

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [step])

  /** Next step = new history entry. */
  const go = (s: Step) => navigate({ search: stepSearch(s) }, { state: { bwTrail: [...trail, step] } satisfies FlowState })
  /** Previous step: same as the browser Back button when that entry is ours, otherwise replace. */
  const back = (s: Step) => {
    const i = trail.lastIndexOf(s)
    if (i >= 0) { navPending.current = true; navigate(i - trail.length) }
    else navigate({ search: stepSearch(s) }, { replace: true, state: { bwTrail: trail } satisfies FlowState })
  }

  // Confirmation is addressed by code (`/?confirmed=BW-…`) so a reload keeps it and nothing is resubmitted.
  const lookup = useQuery(() => (confirmedCode && confirmed?.code !== confirmedCode ? api.bookings.findByCode(confirmedCode) : Promise.resolve(undefined)), [confirmedCode, confirmed?.code], ['bookings'])
  const shown = confirmedCode ? (confirmed?.code === confirmedCode ? confirmed : lookup.data ?? null) : null
  useEffect(() => {
    if (confirmedCode && confirmed?.code !== confirmedCode && !lookup.loading && !lookup.data && !navPending.current) navigate('/', { replace: true })
  }, [confirmedCode, confirmed?.code, lookup.loading, lookup.data, navigate])

  const validate = () => {
    const e: typeof errors = {}
    if (details.name.trim().length < 2) e.name = 'Please enter your full name'
    if (details.phone.replace(/\D/g, '').length < 7) e.phone = 'Please enter a valid phone number'
    if (!/^\S+@\S+\.\S+$/.test(details.email.trim())) e.email = 'Please enter a valid email'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async () => {
    if (!service || !staffId || !date || !slot) return
    if (submittingRef.current) return // guard against double click / double tap
    if (!validate()) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const b = await api.bookings.create({ serviceId: service.id, staffId, date, start: slot.start, client: details, notes: details.notes, source: 'online' })
      setConfirmed(b)
      clearSelections()
      navPending.current = true
      // Replace the details entry: Back from the confirmation never returns to a submittable form.
      navigate({ search: `?confirmed=${b.code}` }, { replace: true, state: null })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      if (err instanceof BookingConflictError) {
        toast(err.message, 'error')
        setSlot(null)
        back(2)
      } else toast((err as Error).message, 'error')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const clearSelections = () => {
    setServiceId(null)
    setStaffId(null)
    setDate(null)
    setSlot(null)
    setDetails(EMPTY_DETAILS)
    sessionStorage.removeItem(DRAFT_KEY)
  }

  const reset = () => {
    setConfirmed(null)
    clearSelections()
    navPending.current = true
    navigate('/')
  }

  const canContinue = [!!serviceId, !!staffId, !!slot, true][step]

  return (
    <PublicLayout stickyBar={ready && !confirmedCode}>
      <section className="bg-ink pb-24 text-white sm:pb-28">
        <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-brand-300">Online booking</p>
          <h1 className="mt-2 max-w-2xl font-display text-3xl font-semibold leading-tight sm:text-5xl">
            {confirmedCode ? 'See you soon.' : 'Book your next cut in under a minute.'}
          </h1>
          <p className="mt-3 max-w-xl text-stone-300">{settings?.tagline} Live availability — pick a time that suits you.</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-300">
            <span className="flex items-center gap-1.5"><MapPin className="size-4 text-brand-300" />{settings?.address}</span>
            <span className="flex items-center gap-1.5"><Clock className="size-4 text-brand-300" />Mon–Sat 9 AM – 7 PM · Sun 10 AM – 3 PM</span>
            <span className="flex items-center gap-1.5"><Phone className="size-4 text-brand-300" />{settings?.phone}</span>
          </div>
        </div>
      </section>

      <main ref={topRef} className="mx-auto -mt-16 max-w-6xl scroll-mt-4 px-3 pb-32 sm:-mt-20 sm:px-6 lg:pb-16">
        {!ready || (confirmedCode && !shown) ? (
          <Card className="flex h-64 items-center justify-center"><Spinner /></Card>
        ) : shown ? (
          <Confirmation booking={shown} services={services} staff={staff} address={settings?.address ?? ''} onAgain={reset} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <Card className="overflow-hidden">
              <Stepper step={step} onStep={(s) => s < step && back(s)} />
              <div className="p-4 sm:p-6" key={step}>
                <div className="animate-fade-up">
                  {step === 0 && (
                    <ServiceStep services={services.filter((s) => s.active && staff.some((m) => m.active && m.serviceIds.includes(s.id)))} value={serviceId} onPick={(id) => {
                      setServiceId(id)
                      if (staffId && staffId !== 'any' && !staff.find((m) => m.id === staffId)?.serviceIds.includes(id)) setStaffId(null)
                      setSlot(null)
                      go(1)
                    }} />
                  )}
                  {step === 1 && service && (
                    <StaffStep service={service} staff={staff} value={staffId} onPick={(id) => { setStaffId(id); setSlot(null); go(2) }} />
                  )}
                  {step === 2 && service && staffId && (
                    <TimeStep service={service} staffId={staffId} staff={staff} date={date} onDate={(d) => { setDate(d); setSlot(null) }} slot={slot} onSlot={(s) => { setSlot(s); go(3) }} horizonDays={settings?.horizonDays ?? 30} />
                  )}
                  {step === 3 && (
                    <DetailsStep details={details} errors={errors} onChange={(d) => setDetails(d)} />
                  )}
                </div>
              </div>
              {step > 0 && (
                <div className="hidden border-t border-stone-100 px-6 py-3 lg:block">
                  <button onClick={() => back((step - 1) as Step)} className="flex items-center gap-1 text-sm font-medium text-stone-500 hover:text-stone-900"><ArrowLeft className="size-4" /> Back</button>
                </div>
              )}
            </Card>

            {/* Desktop summary */}
            <aside className="hidden lg:block">
              <Card className="sticky top-4 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-400">Your appointment</h3>
                <Summary service={service} staffId={staffId} member={member} date={date} slot={slot} />
                <div className="mt-5 border-t border-stone-100 pt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-stone-500">Total</span>
                    <span className="text-xl font-semibold">{service ? usd(service.priceUsd) : '—'}</span>
                  </div>
                  <p className="mt-1 text-xs text-stone-400">Pay at the shop. Free cancellation online.</p>
                  {step === 3 ? (
                    <Button variant="brand" size="lg" className="mt-4 w-full" loading={submitting} onClick={submit} data-testid="confirm-desktop">Confirm booking</Button>
                  ) : (
                    <Button size="lg" className="mt-4 w-full" disabled={!canContinue} onClick={() => go((step + 1) as Step)}>Continue <ChevronRight className="size-4" /></Button>
                  )}
                </div>
              </Card>
            </aside>
          </div>
        )}
      </main>

      {/* Mobile sticky action bar */}
      {ready && !confirmedCode && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <div className="flex items-center gap-3">
            {step > 0 && (
              <button onClick={() => back((step - 1) as Step)} aria-label="Back" className="flex size-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-stone-200"><ArrowLeft className="size-5" /></button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{service ? service.name : 'Choose a service'}</p>
              <p className="truncate text-xs text-stone-500">
                {service ? `${usd(service.priceUsd)} · ${fmtDuration(service.durationMin)}` : `Step 1 of 4`}
                {date && slot ? ` · ${fmtDate(date)} ${fmtTime(slot.start)}` : ''}
              </p>
            </div>
            {step === 3 ? (
              <Button variant="brand" size="lg" loading={submitting} onClick={submit} data-testid="confirm-mobile">Confirm</Button>
            ) : (
              <Button size="lg" disabled={!canContinue} onClick={() => go((step + 1) as Step)}>Next</Button>
            )}
          </div>
        </div>
      )}
    </PublicLayout>
  )
}

function Stepper({ step, onStep }: { step: Step; onStep: (s: Step) => void }) {
  return (
    <div className="border-b border-stone-100 px-4 py-3 sm:px-6 sm:py-4">
      <ol className="flex items-center gap-1 sm:gap-2">
        {STEPS.map((label, i) => {
          const done = i < step
          const active = i === step
          return (
            <li key={label} className={cn('flex items-center gap-1 sm:gap-2', active ? 'flex-1 sm:flex-none' : '')}>
              <button
                onClick={() => onStep(i as Step)}
                disabled={!done}
                className={cn('flex items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm transition', done && 'hover:bg-stone-100')}
              >
                <span className={cn('flex size-6 items-center justify-center rounded-full text-xs font-semibold', active ? 'bg-ink text-white' : done ? 'bg-brand-100 text-brand-700' : 'bg-stone-100 text-stone-400')}>
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={cn('font-medium', active ? 'text-stone-900' : 'hidden text-stone-400 sm:inline', done && 'sm:text-stone-600')}>{label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={cn('hidden h-px w-6 bg-stone-200 sm:block')} />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StepTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4 sm:mb-5">
      <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
      {sub && <p className="mt-0.5 text-sm text-stone-500">{sub}</p>}
    </div>
  )
}

function ServiceStep({ services, value, onPick }: { services: Service[]; value: ID | null; onPick: (id: ID) => void }) {
  const cats = [...new Set(services.map((s) => s.category))]
  return (
    <div>
      <StepTitle title="Choose a service" sub="Prices include tax. Duration is approximate." />
      <div className="space-y-6">
        {cats.map((cat) => (
          <div key={cat}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">{cat}</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {services.filter((s) => s.category === cat).map((s) => (
                <button
                  key={s.id}
                  data-testid={`service-${s.id}`}
                  onClick={() => onPick(s.id)}
                  className={cn(
                    'group flex items-start gap-3 rounded-xl p-3.5 text-left ring-1 transition hover:ring-brand-300 hover:bg-brand-50/50',
                    value === s.id ? 'bg-brand-50 ring-2 ring-brand-400' : 'ring-stone-200',
                  )}
                >
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500 group-hover:bg-white">
                    {cat === 'Combos' ? <Sparkles className="size-4.5" /> : <Scissors className="size-4.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-stone-900">{s.name}</span>
                      <span className="shrink-0 font-semibold">{usd(s.priceUsd)}</span>
                    </span>
                    <span className="mt-0.5 block text-sm leading-snug text-stone-500">{s.description}</span>
                    <span className="mt-1.5 flex items-center gap-1 text-xs text-stone-400"><Clock className="size-3.5" />{fmtDuration(s.durationMin)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Availability depends on the catalog (hours, days off, services) and on bookings. */
const AVAIL: readonly DataScope[] = ['catalog', 'bookings']

function useNextAvailable(service: Service, staffIds: (ID | 'any')[]) {
  // Computed by the data source (server-side in API mode) — the public page never loads other clients' bookings.
  return useQuery(() => api.availability.getNextAvailable(service.id, staffIds), [service.id, staffIds.join()], AVAIL)
}

function nextLabel(n?: { date: DateStr; start: number } | null) {
  if (n === undefined) return 'Checking…'
  if (!n) return 'No availability soon'
  const today = todayStr()
  const day = n.date === today ? 'Today' : n.date === addDays(today, 1) ? 'Tomorrow' : fmtDate(n.date)
  return `Next: ${day}, ${fmtTime(n.start)}`
}

function StaffStep({ service, staff, value, onPick }: { service: Service; staff: StaffMember[]; value: ID | 'any' | null; onPick: (id: ID | 'any') => void }) {
  const eligible = staff.filter((s) => s.active && s.serviceIds.includes(service.id))
  const next = useNextAvailable(service, ['any', ...eligible.map((s) => s.id)])
  const option = (id: ID | 'any', content: ReactNode) => (
    <button
      key={id}
      data-testid={`staff-${id}`}
      onClick={() => onPick(id)}
      className={cn('flex w-full items-center gap-3 rounded-xl p-3.5 text-left ring-1 transition hover:bg-brand-50/50 hover:ring-brand-300', value === id ? 'bg-brand-50 ring-2 ring-brand-400' : 'ring-stone-200')}
    >
      {content}
      <ChevronRight className="size-4 shrink-0 text-stone-300" />
    </button>
  )
  return (
    <div>
      <StepTitle title="Choose a specialist" sub={`${eligible.length} specialists offer ${service.name}.`} />
      <div className="grid gap-2.5">
        {option('any', (
          <>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-brand-300"><Users className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Any available specialist</span>
              <span className="block text-sm text-stone-500">Most availability — we’ll match you with whoever is free.</span>
              <span className="mt-1 block text-xs font-medium text-emerald-700">{nextLabel(next.data?.any)}</span>
            </span>
          </>
        ))}
        {eligible.map((m) => option(m.id, (
          <>
            <Avatar name={m.name} color={m.color} size={44} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{m.name}</span><span className="text-xs text-stone-400">{m.role}</span></span>
              <span className="block text-sm text-stone-500">{m.bio}</span>
              <span className="mt-1 block text-xs font-medium text-emerald-700">{nextLabel(next.data?.[m.id])}</span>
            </span>
          </>
        )))}
      </div>
    </div>
  )
}

function TimeStep({ service, staffId, staff, date, onDate, slot, onSlot, horizonDays }: {
  service: Service; staffId: ID | 'any'; staff: StaffMember[]; date: DateStr | null; onDate: (d: DateStr) => void; slot: Slot | null; onSlot: (s: Slot) => void; horizonDays: number
}) {
  const today = todayStr()
  const maxDate = addDays(today, horizonDays)
  const [month, setMonth] = useState(monthKey(date ?? today))
  const { first, last } = monthRange(month)
  const open = useQuery(() => api.availability.getOpenDates(service.id, staffId, first < today ? today : first, last > maxDate ? maxDate : last), [service.id, staffId, month], AVAIL)
  const openSet = useMemo(() => new Set(open.data ?? []), [open.data])

  // auto-select first open date
  useEffect(() => {
    if (!date && open.data?.length) onDate(open.data[0])
  }, [open.data, date, onDate])

  const slots = useQuery(() => (date ? api.availability.getSlots({ serviceId: service.id, staffId, date }) : Promise.resolve([])), [service.id, staffId, date], AVAIL)
  const groups = useMemo(() => {
    const g: { label: string; icon: ReactNode; items: Slot[] }[] = [
      { label: 'Morning', icon: <Sun className="size-4" />, items: [] },
      { label: 'Afternoon', icon: <Sunset className="size-4" />, items: [] },
      { label: 'Evening', icon: <Moon className="size-4" />, items: [] },
    ]
    for (const s of slots.data ?? []) g[s.start < 720 ? 0 : s.start < 1020 ? 1 : 2].items.push(s)
    return g.filter((x) => x.items.length)
  }, [slots.data])

  // quick date strip for mobile
  const strip = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today])
  const stripOpen = useQuery(() => api.availability.getOpenDates(service.id, staffId, strip[0], strip[13]), [service.id, staffId, strip[0]], AVAIL)
  const stripSet = new Set(stripOpen.data ?? [])
  const who = staffId === 'any' ? 'any specialist' : staff.find((s) => s.id === staffId)?.name

  return (
    <div>
      <StepTitle title="Pick a date & time" sub={`${service.name} · ${fmtDuration(service.durationMin)} with ${who}`} />
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar md:hidden">
        {strip.map((d) => {
          const enabled = stripSet.has(d)
          const sel = d === date
          return (
            <button key={d} disabled={!enabled} onClick={() => { onDate(d); setMonth(monthKey(d)) }}
              className={cn('flex w-14 shrink-0 flex-col items-center rounded-xl py-2 ring-1 transition', sel ? 'bg-ink text-white ring-ink' : enabled ? 'bg-white ring-stone-200' : 'bg-stone-50 text-stone-300 ring-stone-100')}>
              <span className="text-[11px] font-medium uppercase">{WEEKDAYS_SHORT[dayOfWeek(d)]}</span>
              <span className="text-lg font-semibold leading-tight">{Number(d.slice(8))}</span>
            </button>
          )
        })}
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,300px)_1fr]">
        <div className="hidden md:block">
          <MonthCalendar month={month} onMonthChange={setMonth} value={date} onChange={onDate} isEnabled={(d) => openSet.has(d)} minMonth={monthKey(today)} maxMonth={monthKey(maxDate)} loading={open.loading} />
          <p className="mt-3 flex items-center gap-2 text-xs text-stone-400"><span className="size-3 rounded bg-brand-50 ring-1 ring-brand-100" /> Days with free slots</p>
        </div>
        <div>
          {date ? (
            <>
              <p className="mb-3 flex flex-wrap items-center gap-2 font-medium"><CalendarDays className="size-4 text-stone-400" />{fmtDateLong(date)}{browserDiffersFromShop() && <span className="text-xs font-normal text-stone-400" data-testid="shop-time-hint">Times shown in shop time ({shopTimeZoneCity()})</span>}</p>
              {slots.loading && !slots.data ? (
                <Spinner />
              ) : groups.length === 0 ? (
                <p className="rounded-xl bg-stone-50 p-4 text-sm text-stone-500">No free times on this day. Try another date{staffId !== 'any' ? ' or choose “Any available specialist”' : ''}.</p>
              ) : (
                <div className="space-y-4" data-testid="slots">
                  {groups.map((g) => (
                    <div key={g.label}>
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">{g.icon}{g.label}</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5">
                        {g.items.map((s) => (
                          <button key={s.start} data-testid="slot" onClick={() => onSlot(s)}
                            className={cn('h-11 rounded-xl text-sm font-medium ring-1 transition', slot?.start === s.start ? 'bg-ink text-white ring-ink' : 'bg-white ring-stone-200 hover:ring-brand-400 hover:bg-brand-50')}>
                            {fmtTime(s.start)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : open.loading ? (
            <Spinner />
          ) : (
            <p className="rounded-xl bg-stone-50 p-4 text-sm text-stone-500">No availability this month — try the next one.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailsStep({ details, errors, onChange }: { details: Details; errors: Partial<Record<keyof Details, string>>; onChange: (d: Details) => void }) {
  const set = (k: keyof Details) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...details, [k]: e.target.value })
  return (
    <div>
      <StepTitle title="Your details" sub="We’ll send your confirmation and a reminder the day before." />
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} noValidate>
        <Field label="Full name" error={errors.name} className="sm:col-span-2">
          <Input name="name" autoComplete="name" value={details.name} onChange={set('name')} placeholder="Alex Morgan" aria-invalid={!!errors.name} />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" value={details.phone} onChange={set('phone')} placeholder="(555) 010-1234" aria-invalid={!!errors.phone} />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input name="email" type="email" inputMode="email" autoComplete="email" value={details.email} onChange={set('email')} placeholder="alex@example.com" aria-invalid={!!errors.email} />
        </Field>
        <Field label="Notes for your specialist (optional)" className="sm:col-span-2">
          <Textarea name="notes" value={details.notes} onChange={set('notes')} placeholder="e.g. keep length on top, sensitive skin…" />
        </Field>
      </form>
      {IS_DEMO && <p className="mt-4 text-xs text-stone-400">Demo only: details are stored in this browser’s local storage and never sent anywhere.</p>}
    </div>
  )
}

function Summary({ service, staffId, member, date, slot }: { service?: Service; staffId: ID | 'any' | null; member?: StaffMember; date: DateStr | null; slot: Slot | null }) {
  const row = (icon: ReactNode, label: string, value?: ReactNode) => (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 text-stone-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-stone-400">{label}</p>
        <p className={cn('text-sm font-medium', !value && 'text-stone-300')}>{value ?? 'Not selected'}</p>
      </div>
    </div>
  )
  return (
    <div className="mt-2 divide-y divide-stone-100">
      {row(<Scissors className="size-4" />, 'Service', service && `${service.name} · ${fmtDuration(service.durationMin)}`)}
      {row(<Users className="size-4" />, 'Specialist', staffId === 'any' ? 'Any available' : member?.name)}
      {row(<CalendarDays className="size-4" />, 'Date & time', date && slot ? `${fmtDate(date)} · ${fmtTime(slot.start)} – ${fmtTime(slot.end)}` : date ? fmtDate(date) : undefined)}
    </div>
  )
}

function Confirmation({ booking, services, staff, address, onAgain }: { booking: Booking; services: Service[]; staff: StaffMember[]; address: string; onAgain: () => void }) {
  const service = services.find((s) => s.id === booking.serviceId)!
  const member = staff.find((s) => s.id === booking.staffId)!
  const [copied, setCopied] = useState(false)
  return (
    <Card className="mx-auto max-w-xl overflow-hidden" >
      <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center" data-testid="confirmation">
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 animate-pop"><Check className="size-7" strokeWidth={3} /></span>
        <h2 className="mt-4 text-2xl font-semibold">You’re booked!</h2>
        <p className="mt-1 text-stone-500">A confirmation would be emailed to you in the live product.</p>
        <button
          onClick={() => { navigator.clipboard?.writeText(booking.code); setCopied(true) }}
          className="mt-5 rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50 px-6 py-3"
          title="Copy code"
        >
          <span className="block text-xs font-medium uppercase tracking-wider text-brand-700">Booking code</span>
          <span className="block font-mono text-2xl font-bold tracking-widest text-ink" data-testid="booking-code">{booking.code}</span>
          <span className="block text-[11px] text-brand-700/70">{copied ? 'Copied!' : 'Tap to copy'}</span>
        </button>
      </div>
      <div className="mx-6 divide-y divide-stone-100 rounded-xl bg-stone-50 px-4 text-sm">
        <div className="flex justify-between py-3"><span className="text-stone-500">Service</span><span className="font-medium">{service.name}</span></div>
        <div className="flex justify-between py-3"><span className="text-stone-500">Specialist</span><span className="font-medium">{member.name}</span></div>
        <div className="flex justify-between py-3"><span className="text-stone-500">When</span><span className="text-right font-medium">{fmtDateLong(booking.date)}<br />{fmtTime(booking.start)} – {fmtTime(booking.end)}</span></div>
        <div className="flex justify-between py-3"><span className="text-stone-500">Where</span><span className="font-medium">{address}</span></div>
        <div className="flex justify-between py-3"><span className="text-stone-500">Total (pay at shop)</span><span className="font-semibold">{usd(booking.priceUsd)}</span></div>
      </div>
      <div className="grid gap-2 p-6 sm:grid-cols-2">
        <Button variant="secondary" onClick={() => downloadIcs({ uid: booking.code, title: `${service.name} at Brasswood Barber Co.`, description: `With ${member.name}. Booking code ${booking.code}`, location: address, date: booking.date, start: booking.start, end: booking.end })}>
          <CalendarPlus className="size-4" /> Add to calendar
        </Button>
        <Link to={`/manage?code=${booking.code}`} className="inline-flex h-10 items-center justify-center rounded-xl text-sm font-medium text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50">Manage or cancel</Link>
        <Button className="sm:col-span-2" onClick={onAgain}>Book another appointment</Button>
      </div>
    </Card>
  )
}
