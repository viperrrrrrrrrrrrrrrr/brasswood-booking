import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Clock, MapPin, Phone, Scissors, Users, CalendarDays, CalendarPlus, Sparkles, ChevronRight, Sun, Sunset, Moon, Copy } from 'lucide-react'
import { api, BookingConflictError, IS_DEMO } from '../../data'
import { useCatalog, useQuery } from '../../data/hooks'
import type { DataScope } from '../../data/repository'
import { browserDiffersFromShop, shopTimeZoneCity } from '../../lib/shopTime'
import type { Booking, DateStr, ID, Service, Slot, StaffMember } from '../../lib/types'
import { addDays, dayOfWeek, fmtDate, fmtDateLong, fmtDuration, fmtTime, todayStr, usd, WEEKDAYS_SHORT } from '../../lib/date'
import { Avatar, cn, useToast } from '../../components/ui'
import { Eyebrow, LuxButton, LuxCard, LuxField, LuxInput, LuxSpinner, LuxTextarea } from '../../components/lux'
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

  const scrollToBooking = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    topRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }
  const hours = useMemo(() => shopHours(staff), [staff])

  return (
    <PublicLayout stickyBar={ready && !confirmedCode} settings={settings}>
      {/* Hero — outside <main>; the CTA only scrolls (no navigation, no hash). */}
      <section className="relative isolate overflow-hidden bg-walnut bg-[radial-gradient(120%_90%_at_85%_10%,#4a3722_0%,#2a2019_45%,#0f0d0b_100%)]">
        <img
          src="/hero-1600.webp"
          srcSet="/hero-800.webp 800w, /hero-1600.webp 1600w"
          sizes="100vw"
          width={1600}
          height={900}
          alt=""
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 -z-10 size-full object-cover object-[70%_50%] opacity-70"
        />
        <div className="absolute inset-0 -z-10 bg-linear-to-r from-ink via-ink/85 to-ink/25 max-md:via-ink/75" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-linear-to-t from-ink to-transparent" aria-hidden />
        <div className={cn('mx-auto max-w-6xl px-4 sm:px-6', confirmedCode ? 'pt-12 pb-24 sm:pt-16 sm:pb-28' : 'pt-14 pb-28 sm:pt-24 sm:pb-36')}>
          <Eyebrow>Barbershop · Online booking</Eyebrow>
          <h1 className="mt-4 max-w-3xl font-display text-[2.6rem] leading-[1.05] font-semibold tracking-tight text-cream sm:text-6xl lg:text-7xl">
            {confirmedCode ? 'See you soon.' : settings?.name ?? 'Brasswood Barber Co.'}
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-stone-300 sm:text-lg">{settings?.tagline}</p>
          {!confirmedCode && (
            <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1">
              <LuxButton size="lg" onClick={scrollToBooking} className="uppercase tracking-[.16em] text-[13px] max-sm:w-full sm:px-8">
                Book an appointment <ArrowRight className="size-4" />
              </LuxButton>
              <Link to="/manage" className="inline-flex h-12 items-center rounded-md px-4 text-sm font-medium text-stone-300 underline-offset-4 hover:text-cream hover:underline">Find my booking</Link>
            </div>
          )}
          <dl className="mt-9 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-6 text-sm sm:mt-10 sm:grid-cols-[auto_auto_1fr] sm:gap-x-10">
            <div>
              <dt className="eyebrow mb-1.5 flex items-center gap-1.5 text-faint"><MapPin className="size-3.5 text-brand-400" />Address</dt>
              <dd className="text-stone-200">{settings?.address ?? '—'}</dd>
            </div>
            <div>
              <dt className="eyebrow mb-1.5 flex items-center gap-1.5 text-faint"><Phone className="size-3.5 text-brand-400" />Phone</dt>
              <dd>{settings ? <a href={`tel:${settings.phone.replace(/[^\d+]/g, '')}`} className="text-stone-200 hover:text-cream">{settings.phone}</a> : '—'}</dd>
            </div>
            {hours.length > 0 && (
              <div className="col-span-2 sm:col-span-1">
                <dt className="eyebrow mb-1.5 flex items-center gap-1.5 text-faint"><Clock className="size-3.5 text-brand-400" />Hours</dt>
                <dd className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-stone-200">
                  {hours.map((h) => (
                    <span key={h.days} className="contents"><span className="text-muted">{h.days}</span><span className="tabular-nums">{h.time}</span></span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <main ref={topRef} className="relative mx-auto -mt-14 max-w-6xl scroll-mt-4 px-3 pb-32 sm:-mt-16 sm:px-6 lg:pb-20">
        {!ready || (confirmedCode && !shown) ? (
          <LuxCard className="flex h-64 items-center justify-center"><LuxSpinner label="Loading…" /></LuxCard>
        ) : shown ? (
          <Confirmation booking={shown} services={services} staff={staff} address={settings?.address ?? ''} onAgain={reset} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <LuxCard className="overflow-hidden">
              <Stepper step={step} onStep={(s) => s < step && back(s)} />
              <div className="p-4 sm:p-7" key={step}>
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
                <div className="hidden border-t border-line/70 px-7 py-3.5 lg:block">
                  <button onClick={() => back((step - 1) as Step)} className="flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-cream"><ArrowLeft className="size-4" /> Back</button>
                </div>
              )}
            </LuxCard>

            {/* Desktop summary */}
            <aside className="hidden lg:block">
              <LuxCard className="sticky top-4 p-6">
                <p className="eyebrow text-brand-300">Your appointment</p>
                <Summary service={service} staffId={staffId} member={member} date={date} slot={slot} />
                <div className="mt-5 border-t border-line/70 pt-5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted">Total</span>
                    <span className="font-display text-2xl font-semibold text-cream">{service ? usd(service.priceUsd) : '—'}</span>
                  </div>
                  <p className="mt-1 text-xs text-faint">Paid at the shop.</p>
                  {step === 3 ? (
                    <LuxButton size="lg" className="mt-5 w-full" loading={submitting} onClick={submit} data-testid="confirm-desktop">Confirm booking</LuxButton>
                  ) : (
                    <LuxButton size="lg" variant={canContinue ? 'gold' : 'outline'} className="mt-5 w-full" disabled={!canContinue} onClick={() => go((step + 1) as Step)}>Continue <ChevronRight className="size-4" /></LuxButton>
                  )}
                </div>
              </LuxCard>
            </aside>
          </div>
        )}
      </main>

      {/* Mobile sticky action bar */}
      {ready && !confirmedCode && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-coal/95 px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <div className="flex items-center gap-3">
            {step > 0 && (
              <button onClick={() => back((step - 1) as Step)} aria-label="Back" className="flex size-12 shrink-0 items-center justify-center rounded-md text-cream ring-1 ring-line transition-colors hover:ring-brand-500"><ArrowLeft className="size-5" /></button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-cream">{service ? service.name : 'Choose a service'}</p>
              <p className="truncate text-xs text-muted">
                {service ? `${usd(service.priceUsd)} · ${fmtDuration(service.durationMin)}` : `Step 1 of 4`}
                {date && slot ? ` · ${fmtDate(date)} ${fmtTime(slot.start)}` : ''}
              </p>
            </div>
            {step === 3 ? (
              <LuxButton size="lg" loading={submitting} onClick={submit} data-testid="confirm-mobile">Confirm</LuxButton>
            ) : (
              <LuxButton size="lg" variant={canContinue ? 'gold' : 'outline'} disabled={!canContinue} onClick={() => go((step + 1) as Step)}>Next</LuxButton>
            )}
          </div>
        </div>
      )}
    </PublicLayout>
  )
}

/** Opening hours for display only: union of the active specialists' weekly hours, Mon → Sun, equal days grouped. */
function shopHours(staff: StaffMember[]): { days: string; time: string }[] {
  const order = [1, 2, 3, 4, 5, 6, 0]
  const short = (m: number) => fmtTime(m).replace(':00', '')
  const active = staff.filter((m) => m.active && Array.isArray(m.hours))
  if (!active.length) return []
  const perDay = order.map((d) => {
    const hs = active.map((m) => m.hours[d]).filter((h): h is NonNullable<typeof h> => !!h)
    return { d, time: hs.length ? `${short(Math.min(...hs.map((h) => h.start)))} – ${short(Math.max(...hs.map((h) => h.end)))}` : 'Closed' }
  })
  const out: { days: string; time: string }[] = []
  for (let i = 0; i < perDay.length; ) {
    let j = i
    while (j + 1 < perDay.length && perDay[j + 1].time === perDay[i].time) j++
    const a = WEEKDAYS_SHORT[perDay[i].d]
    const b = WEEKDAYS_SHORT[perDay[j].d]
    out.push({ days: i === j ? a : `${a}–${b}`, time: perDay[i].time })
    i = j + 1
  }
  return out
}

function Stepper({ step, onStep }: { step: Step; onStep: (s: Step) => void }) {
  return (
    <div className="border-b border-line/70 px-4 pt-4 pb-3.5 sm:px-7 sm:pt-5 sm:pb-4">
      <p className="mb-3 text-xs font-medium text-muted sm:hidden">Step {step + 1} of {STEPS.length} · <span className="text-cream">{STEPS[step]}</span></p>
      <ol className="grid grid-cols-4 gap-1.5 sm:gap-3">
        {STEPS.map((label, i) => {
          const done = i < step
          const active = i === step
          return (
            <li key={label}>
              <button
                onClick={() => onStep(i as Step)}
                disabled={!done}
                aria-current={active ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${label}`}
                className={cn('group block w-full text-left', done && 'cursor-pointer')}
              >
                <span className={cn('block h-[3px] rounded-full transition-colors', active ? 'bg-brand-400' : done ? 'bg-brand-600 group-hover:bg-brand-400' : 'bg-line')} />
                <span className="mt-2.5 hidden items-center gap-2 text-sm sm:flex">
                  <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums', active ? 'bg-brand-400 text-ink' : done ? 'bg-brand-400/15 text-brand-300' : 'text-faint ring-1 ring-line')}>
                    {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={cn('truncate font-medium', active ? 'text-cream' : done ? 'text-muted group-hover:text-cream' : 'text-faint')}>{label}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StepTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5 sm:mb-6">
      <h2 className="font-display text-2xl font-semibold text-cream sm:text-[1.75rem]">{title}</h2>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  )
}

function SelectedMark() {
  return <span className="flex size-5 items-center justify-center rounded-full bg-brand-400 text-ink"><Check className="size-3" strokeWidth={3} /></span>
}

function ServiceStep({ services, value, onPick }: { services: Service[]; value: ID | null; onPick: (id: ID) => void }) {
  const cats = [...new Set(services.map((s) => s.category))]
  return (
    <div>
      <StepTitle title="Choose a service" sub="Prices in USD, paid at the shop. Durations are approximate." />
      <div className="space-y-7">
        {cats.map((cat) => (
          <div key={cat}>
            <p className="eyebrow mb-3 text-faint">{cat}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {services.filter((s) => s.category === cat).map((s) => {
                const sel = value === s.id
                return (
                  <button
                    key={s.id}
                    data-testid={`service-${s.id}`}
                    onClick={() => onPick(s.id)}
                    aria-pressed={sel}
                    className={cn(
                      'group relative flex h-full flex-col rounded-lg p-4 text-left transition-colors',
                      sel ? 'bg-walnut ring-2 ring-brand-400' : 'bg-coal ring-1 ring-line hover:bg-walnut/50 hover:ring-brand-600',
                    )}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="flex items-center gap-2.5">
                        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', sel ? 'bg-brand-400/20 text-brand-200' : 'bg-white/[.04] text-brand-400')}>
                          {cat === 'Combos' ? <Sparkles className="size-4" /> : <Scissors className="size-4" />}
                        </span>
                        <span className="font-display text-[17px] font-semibold leading-tight text-cream">{s.name}</span>
                      </span>
                      <span className="shrink-0 font-display text-lg font-semibold text-brand-300">{usd(s.priceUsd)}</span>
                    </span>
                    <span className="mt-2.5 block flex-1 text-sm leading-relaxed text-muted">{s.description}</span>
                    <span className="mt-3 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-stone-300"><Clock className="size-3.5 text-brand-400" />{fmtDuration(s.durationMin)}</span>
                      {sel ? <SelectedMark /> : <ChevronRight className="size-4 text-faint transition-colors group-hover:text-brand-300" />}
                    </span>
                  </button>
                )
              })}
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
  const option = (id: ID | 'any', content: ReactNode, nextText: string) => {
    const sel = value === id
    return (
      <button
        key={id}
        data-testid={`staff-${id}`}
        onClick={() => onPick(id)}
        aria-pressed={sel}
        className={cn('group flex w-full items-center gap-4 rounded-lg p-4 text-left transition-colors', sel ? 'bg-walnut ring-2 ring-brand-400' : 'bg-coal ring-1 ring-line hover:bg-walnut/50 hover:ring-brand-600')}
      >
        {content}
        <span className="flex shrink-0 flex-col items-end gap-2">
          {sel ? <SelectedMark /> : <ChevronRight className="size-4 text-faint transition-colors group-hover:text-brand-300" />}
          <span className={cn('hidden text-xs font-medium sm:block', nextText.startsWith('Next') ? 'text-emerald-300/90' : 'text-faint')}>{nextText}</span>
        </span>
      </button>
    )
  }
  const nextMobile = (t: string) => <span className={cn('mt-1.5 block text-xs font-medium sm:hidden', t.startsWith('Next') ? 'text-emerald-300/90' : 'text-faint')}>{t}</span>
  const anyNext = nextLabel(next.data?.any)
  return (
    <div>
      <StepTitle title="Choose your barber" sub={`${eligible.length} specialists offer ${service.name}.`} />
      <div className="grid gap-3">
        {option('any', (
          <>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ink text-brand-300 ring-1 ring-brand-400/40"><Users className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-cream">Any available specialist</span>
              <span className="mt-0.5 block text-sm text-muted">Most availability — matched with whoever is free.</span>
              {nextMobile(anyNext)}
            </span>
          </>
        ), anyNext)}
        {eligible.map((m) => {
          const t = nextLabel(next.data?.[m.id])
          return option(m.id, (
            <>
              <span className="rounded-full ring-2 ring-white/10"><Avatar name={m.name} color={m.color} size={48} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2.5"><span className="font-medium text-cream">{m.name}</span><span className="eyebrow text-[10px] text-brand-300">{m.role}</span></span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">{m.bio}</span>
                {nextMobile(t)}
              </span>
            </>
          ), t)
        })}
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
      { label: 'Morning', icon: <Sun className="size-3.5" />, items: [] },
      { label: 'Afternoon', icon: <Sunset className="size-3.5" />, items: [] },
      { label: 'Evening', icon: <Moon className="size-3.5" />, items: [] },
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
      <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar md:hidden">
        {strip.map((d) => {
          const enabled = stripSet.has(d)
          const sel = d === date
          return (
            <button key={d} disabled={!enabled} onClick={() => { onDate(d); setMonth(monthKey(d)) }}
              className={cn('flex w-14 shrink-0 flex-col items-center rounded-md py-2 transition-colors', sel ? 'bg-brand-400 text-ink' : enabled ? 'bg-coal text-cream ring-1 ring-line' : 'text-faint/60 ring-1 ring-line/40')}>
              <span className={cn('text-[10px] font-semibold tracking-wider uppercase', sel ? 'text-ink/70' : 'text-muted')}>{WEEKDAYS_SHORT[dayOfWeek(d)]}</span>
              <span className="text-lg font-semibold leading-tight tabular-nums">{Number(d.slice(8))}</span>
            </button>
          )
        })}
      </div>
      <div className="grid gap-7 md:grid-cols-[minmax(0,300px)_1fr]">
        <div className="hidden md:block">
          <div className="rounded-lg bg-coal p-4 ring-1 ring-line">
            <MonthCalendar month={month} onMonthChange={setMonth} value={date} onChange={onDate} isEnabled={(d) => openSet.has(d)} minMonth={monthKey(today)} maxMonth={monthKey(maxDate)} loading={open.loading} />
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-faint"><span className="size-3 rounded-sm bg-graphite-2 ring-1 ring-brand-600" /> Days with free slots</p>
        </div>
        <div>
          {date ? (
            <>
              <p className="mb-4 flex flex-wrap items-center gap-2 font-medium text-cream"><CalendarDays className="size-4 text-brand-400" />{fmtDateLong(date)}{browserDiffersFromShop() && <span className="text-xs font-normal text-faint" data-testid="shop-time-hint">Times shown in shop time ({shopTimeZoneCity()})</span>}</p>
              {slots.loading && !slots.data ? (
                <LuxSpinner label="Checking free times…" />
              ) : groups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No free times on this day. Try another date{staffId !== 'any' ? ' or choose “Any available specialist”' : ''}.</p>
              ) : (
                <div className="space-y-5" data-testid="slots">
                  {groups.map((g) => (
                    <div key={g.label}>
                      <p className="eyebrow mb-2.5 flex items-center gap-1.5 text-faint">{g.icon}{g.label}</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))]">
                        {g.items.map((s) => (
                          <button key={s.start} data-testid="slot" onClick={() => onSlot(s)} aria-pressed={slot?.start === s.start}
                            className={cn('h-11 rounded-md text-sm font-medium whitespace-nowrap tabular-nums transition-colors', slot?.start === s.start ? 'bg-ink bg-linear-to-b from-brand-300 to-brand-400 font-semibold text-ink' : 'bg-coal text-cream ring-1 ring-line hover:text-brand-200 hover:ring-brand-500')}>
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
            <LuxSpinner label="Checking availability…" />
          ) : (
            <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No availability this month — try the next one.</p>
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
      <StepTitle title="Your details" sub="So the shop knows who is coming and can reach you about this appointment." />
      <form className="grid gap-5 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} noValidate>
        <LuxField label="Full name" error={errors.name} className="sm:col-span-2">
          <LuxInput name="name" autoComplete="name" value={details.name} onChange={set('name')} placeholder="Alex Morgan" aria-invalid={!!errors.name} />
        </LuxField>
        <LuxField label="Phone" error={errors.phone}>
          <LuxInput name="phone" type="tel" inputMode="tel" autoComplete="tel" value={details.phone} onChange={set('phone')} placeholder="(555) 010-1234" aria-invalid={!!errors.phone} />
        </LuxField>
        <LuxField label="Email" error={errors.email}>
          <LuxInput name="email" type="email" inputMode="email" autoComplete="email" value={details.email} onChange={set('email')} placeholder="alex@example.com" aria-invalid={!!errors.email} />
        </LuxField>
        <LuxField label="Notes for your barber (optional)" className="sm:col-span-2">
          <LuxTextarea name="notes" value={details.notes} onChange={set('notes')} placeholder="e.g. keep length on top, sensitive skin…" />
        </LuxField>
      </form>
      {IS_DEMO && <p className="mt-5 text-xs text-faint">Demo only: details are stored in this browser’s local storage and never sent anywhere.</p>}
    </div>
  )
}

function Summary({ service, staffId, member, date, slot }: { service?: Service; staffId: ID | 'any' | null; member?: StaffMember; date: DateStr | null; slot: Slot | null }) {
  const row = (icon: ReactNode, label: string, value?: ReactNode) => (
    <div className="flex items-start gap-3 py-3">
      <span className={cn('mt-0.5', value ? 'text-brand-400' : 'text-faint')}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-faint">{label}</p>
        <p className={cn('mt-0.5 text-sm font-medium', value ? 'text-cream' : 'text-faint')}>{value ?? 'Not selected'}</p>
      </div>
    </div>
  )
  return (
    <div className="mt-3 divide-y divide-line/60">
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
  const row = (label: string, value: ReactNode, strong?: boolean) => (
    <div className="flex justify-between gap-4 py-3.5"><span className="text-muted">{label}</span><span className={cn('text-right text-cream', strong ? 'font-display text-lg font-semibold' : 'font-medium')}>{value}</span></div>
  )
  return (
    <LuxCard className="mx-auto max-w-xl overflow-hidden">
      <div className="flex flex-col items-center px-6 pt-10 pb-7 text-center" data-testid="confirmation">
        <span className="flex size-14 items-center justify-center rounded-full bg-brand-400/15 text-brand-300 ring-1 ring-brand-400/50 animate-pop"><Check className="size-7" strokeWidth={2.5} /></span>
        <h2 className="mt-5 font-display text-3xl font-semibold text-cream">You’re booked!</h2>
        <p className="mt-2 max-w-sm text-sm text-muted">Save your booking code — you’ll need it to manage or cancel online.</p>
        <button
          onClick={() => { navigator.clipboard?.writeText(booking.code); setCopied(true) }}
          className="mt-6 rounded-lg border border-dashed border-brand-400/60 bg-coal px-7 py-3.5 transition-colors hover:border-brand-300"
          title="Copy code"
        >
          <span className="eyebrow block text-[10px] text-brand-300">Booking code</span>
          <span className="mt-1 block font-mono text-2xl font-bold tracking-[.2em] text-cream" data-testid="booking-code">{booking.code}</span>
          <span className="mt-1 flex items-center justify-center gap-1 text-[11px] text-faint">{copied ? <><Check className="size-3" /> Copied</> : <><Copy className="size-3" /> Tap to copy</>}</span>
        </button>
      </div>
      <div className="mx-5 divide-y divide-line/60 rounded-lg bg-coal px-4 text-sm ring-1 ring-line sm:mx-7">
        {row('Service', service.name)}
        {row('Specialist', member.name)}
        {row('When', <>{fmtDateLong(booking.date)}<br />{fmtTime(booking.start)} – {fmtTime(booking.end)}</>)}
        {row('Where', address)}
        {row('Total (pay at shop)', usd(booking.priceUsd), true)}
      </div>
      <div className="grid gap-2.5 p-5 sm:grid-cols-2 sm:p-7">
        <LuxButton variant="outline" onClick={() => downloadIcs({ uid: booking.code, title: `${service.name} at Brasswood Barber Co.`, description: `With ${member.name}. Booking code ${booking.code}`, location: address, date: booking.date, start: booking.start, end: booking.end })}>
          <CalendarPlus className="size-4" /> Add to calendar
        </LuxButton>
        <Link to={`/manage?code=${booking.code}`} className="inline-flex h-11 items-center justify-center rounded-md text-sm font-semibold tracking-wide text-cream ring-1 ring-inset ring-line transition-colors hover:ring-brand-400/70">Manage or cancel</Link>
        <LuxButton className="sm:col-span-2" onClick={onAgain}>Book another appointment</LuxButton>
      </div>
    </LuxCard>
  )
}
