import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, XCircle, CalendarDays, Clock, User } from 'lucide-react'
import { api } from '../../data'
import { useCatalog } from '../../data/hooks'
import type { Booking } from '../../lib/types'
import { fmtDateLong, fmtTime, usd } from '../../lib/date'
import { browserDiffersFromShop, canCancelOnline, shopNow, shopTimeZoneCity } from '../../lib/shopTime'
import { Button, Card, Field, Input, StatusBadge, useToast } from '../../components/ui'
import { PublicLayout } from '../../components/PublicLayout'

export default function ManagePage() {
  const [params, setParams] = useSearchParams()
  const [code, setCode] = useState(params.get('code') ?? '')
  const [booking, setBooking] = useState<Booking | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const { services, staff } = useCatalog()
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
    <PublicLayout>
      <section className="bg-ink pb-24 text-white">
        <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12">
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">Manage your booking</h1>
          <p className="mt-2 text-stone-300">Enter the code from your confirmation to view or cancel your appointment.</p>
        </div>
      </section>
      <main className="mx-auto -mt-16 max-w-xl px-3 pb-16 sm:px-6">
        <Card className="p-5 sm:p-6">
          <form onSubmit={(e) => { e.preventDefault(); lookup() }} className="flex items-end gap-2">
            <Field label="Booking code" className="flex-1">
              <Input name="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BW-XXXXXX" className="font-mono uppercase tracking-wider" autoCapitalize="characters" />
            </Field>
            <Button type="submit" loading={loading} className="h-[42px]"><Search className="size-4" />Find</Button>
          </form>
          {notFound && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">We couldn’t find a booking with that code. Check for typos and try again.</p>}
        </Card>

        {booking && service && member && (
          <Card className="mt-4 p-5 animate-fade-up sm:p-6" >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm text-stone-400">{booking.code}</p>
                <h2 className="text-lg font-semibold">{service.name}</h2>
              </div>
              <StatusBadge status={booking.status} />
            </div>
            <div className="mt-4 space-y-2.5 text-sm">
              <p className="flex items-center gap-2"><CalendarDays className="size-4 text-stone-400" />{fmtDateLong(booking.date)}</p>
              <p className="flex items-center gap-2"><Clock className="size-4 text-stone-400" />{fmtTime(booking.start)} – {fmtTime(booking.end)}{browserDiffersFromShop() && <span className="text-xs text-stone-400" data-testid="shop-time-hint">({shopTimeZoneCity()} time)</span>}</p>
              <p className="flex items-center gap-2"><User className="size-4 text-stone-400" />with {member.name}</p>
              <p className="pt-1 font-semibold">{usd(booking.priceUsd)} <span className="font-normal text-stone-400">· pay at the shop</span></p>
            </div>
            {booking.status === 'confirmed' && !canCancel && (
              <p className="mt-5 border-t border-stone-100 pt-4 text-sm text-stone-500" data-testid="cancel-unavailable">This appointment has already started, so it can’t be cancelled online. Please call the shop.</p>
            )}
            {booking.status === 'confirmed' && canCancel && (
              <div className="mt-5 border-t border-stone-100 pt-4">
                {confirming ? (
                  <div className="rounded-xl bg-red-50 p-4">
                    <p className="text-sm font-medium text-red-800">Cancel this appointment? The time slot will be released to other clients.</p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="danger" loading={cancelling} onClick={cancel} data-testid="confirm-cancel">Yes, cancel it</Button>
                      <Button variant="secondary" onClick={() => setConfirming(false)}>Keep it</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="secondary" className="w-full text-red-600" onClick={() => setConfirming(true)} data-testid="cancel-booking"><XCircle className="size-4" />Cancel booking</Button>
                )}
              </div>
            )}
            {booking.status === 'cancelled' && (
              <p className="mt-5 text-sm text-stone-500">This booking is cancelled. <Link to="/" className="font-medium text-brand-700 underline">Book a new time →</Link></p>
            )}
          </Card>
        )}
      </main>
    </PublicLayout>
  )
}
