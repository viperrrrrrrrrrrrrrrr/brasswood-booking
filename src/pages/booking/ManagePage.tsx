import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, XCircle, CalendarDays, Clock, User, AlertCircle } from 'lucide-react'
import { api } from '../../data'
import { useCatalog } from '../../data/hooks'
import type { Booking } from '../../lib/types'
import { fmtDateLong, fmtTime, usd } from '../../lib/date'
import { browserDiffersFromShop, canCancelOnline, shopNow, shopTimeZoneCity } from '../../lib/shopTime'
import { STATUS_STYLE, cn, useToast } from '../../components/ui'
import { Eyebrow, LuxButton, LuxCard, LuxField, LuxInput } from '../../components/lux'
import { PublicLayout } from '../../components/PublicLayout'

export default function ManagePage() {
  const [params, setParams] = useSearchParams()
  const [code, setCode] = useState(params.get('code') ?? '')
  const [booking, setBooking] = useState<Booking | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const { services, staff, settings } = useCatalog()
  const toast = useToast()

  const lookup = async (c = code) => {
    if (!c.trim()) return
    setLoading(true)
    setNotFound(false)
    const b = await api.bookings.findByCode(c)
    setBooking(b ?? null)
    setNotFound(!b)
    setLoading(false)
    if (b) setParams({ code: b.code }, { replace: true })
  }

  useEffect(() => {
    if (params.get('code')) lookup(params.get('code')!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancel = async () => {
    if (!booking) return
    setCancelling(true)
    try {
      const b = await api.bookings.cancelByCode(booking.code)
      setBooking(b)
      setConfirming(false)
      toast('Your booking has been cancelled.')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setCancelling(false)
    }
  }

  const service = services.find((s) => s.id === booking?.serviceId)
  const member = staff.find((s) => s.id === booking?.staffId)
  // Decided by the data source in the SHOP timezone (server in API mode); the local fallback also uses shop time.
  const canCancel = !!booking && (booking.canCancel ?? canCancelOnline(booking, shopNow()))

  return (
    <PublicLayout settings={settings}>
      <section className="relative isolate overflow-hidden bg-[radial-gradient(110%_120%_at_90%_0%,#3a2a1b_0%,#1a1511_45%,#0f0d0b_100%)] pb-24">
        <div className="absolute inset-x-0 bottom-0 -z-10 h-24 bg-linear-to-t from-ink to-transparent" aria-hidden />
        <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6 sm:pt-16">
          <Eyebrow>Your appointment</Eyebrow>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-cream sm:text-5xl">Manage your booking</h1>
          <p className="mt-3 max-w-lg text-stone-300">Enter the code from your confirmation to view or cancel your appointment.</p>
        </div>
      </section>
      <main className="relative mx-auto -mt-14 max-w-xl px-3 pb-20 sm:px-6">
        <LuxCard className="p-5 sm:p-7">
          <form onSubmit={(e) => { e.preventDefault(); lookup() }} className="flex items-end gap-2.5">
            <LuxField label="Booking code" className="flex-1">
              <LuxInput name="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BW-XXXXXX" className="font-mono uppercase tracking-[.15em]" autoCapitalize="characters" />
            </LuxField>
            <LuxButton type="submit" loading={loading} className="h-[50px]">{!loading && <Search className="size-4" />}Find</LuxButton>
          </form>
          {notFound && <p className="mt-4 flex items-start gap-2 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />We couldn’t find a booking with that code. Check for typos and try again.</p>}
        </LuxCard>

        {booking && service && member && (
          <LuxCard className="mt-4 p-5 animate-fade-up sm:p-7" >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs tracking-[.15em] text-brand-300">{booking.code}</p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-cream">{service.name}</h2>
              </div>
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', booking.status === 'cancelled' ? 'text-muted ring-line' : 'bg-white/[.04] text-cream ring-line')}>
                <span className={cn('size-1.5 rounded-full', STATUS_STYLE[booking.status].dot)} />{STATUS_STYLE[booking.status].label}
              </span>
            </div>
            <div className="mt-5 space-y-3 text-sm text-stone-200">
              <p className="flex items-center gap-2.5"><CalendarDays className="size-4 text-brand-400" />{fmtDateLong(booking.date)}</p>
              <p className="flex flex-wrap items-center gap-2.5"><Clock className="size-4 text-brand-400" />{fmtTime(booking.start)} – {fmtTime(booking.end)}{browserDiffersFromShop() && <span className="text-xs text-faint" data-testid="shop-time-hint">({shopTimeZoneCity()} time)</span>}</p>
              <p className="flex items-center gap-2.5"><User className="size-4 text-brand-400" />with {member.name}</p>
              <p className="pt-1"><span className="font-display text-lg font-semibold text-cream">{usd(booking.priceUsd)}</span> <span className="text-faint">· pay at the shop</span></p>
            </div>
            {booking.status === 'confirmed' && !canCancel && (
              <p className="mt-6 border-t border-line/70 pt-4 text-sm text-muted" data-testid="cancel-unavailable">This appointment has already started, so it can’t be cancelled online. Please call the shop.</p>
            )}
            {booking.status === 'confirmed' && canCancel && (
              <div className="mt-6 border-t border-line/70 pt-5">
                {confirming ? (
                  <div className="rounded-md border border-red-400/30 bg-red-500/10 p-4">
                    <p className="text-sm font-medium text-red-100">Cancel this appointment? The time slot will be released to other clients.</p>
                    <div className="mt-3.5 flex gap-2">
                      <LuxButton variant="danger" loading={cancelling} onClick={cancel} data-testid="confirm-cancel">Yes, cancel it</LuxButton>
                      <LuxButton variant="outline" onClick={() => setConfirming(false)}>Keep it</LuxButton>
                    </div>
                  </div>
                ) : (
                  <LuxButton variant="outline" className="w-full text-red-300 hover:ring-red-400/60" onClick={() => setConfirming(true)} data-testid="cancel-booking"><XCircle className="size-4" />Cancel booking</LuxButton>
                )}
              </div>
            )}
            {booking.status === 'cancelled' && (
              <p className="mt-6 border-t border-line/70 pt-4 text-sm text-muted">This booking is cancelled. <Link to="/" className="font-medium text-brand-300 underline underline-offset-4">Book a new time →</Link></p>
            )}
          </LuxCard>
        )}
      </main>
    </PublicLayout>
  )
}
