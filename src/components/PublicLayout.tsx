import { Link, NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { IS_DEMO } from '../data'
import type { BusinessSettings } from '../lib/types'
import { cn } from './ui'

export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden>
        <rect x="2" y="2" width="60" height="60" rx="12" fill="#0f0d0b" stroke="#b99862" strokeWidth="3" />
        <rect x="9" y="9" width="46" height="46" rx="7" fill="none" stroke="#b99862" strokeOpacity=".35" strokeWidth="1.5" />
        <path d="M24 17h11.5c6 0 9.5 3 9.5 7.6 0 3.3-1.9 5.6-4.9 6.4 3.8.7 6.2 3.4 6.2 7.2 0 5.3-4 8.8-10.6 8.8H24V17Zm6 5v8.4h4.6c3 0 4.6-1.5 4.6-4.2S37.6 22 34.6 22H30Zm0 13.2V42h5.4c3.3 0 5-1.3 5-3.9 0-2.6-1.7-3.9-5-3.9H30Z" fill="#cbb07c" />
      </svg>
      <span className={cn('whitespace-nowrap font-display text-base font-semibold leading-none tracking-tight', !compact && 'sm:text-lg', light ? 'text-cream' : 'text-ink')}>
        Brasswood <span className="text-brand-300">Barber<span className="max-[420px]:hidden"> Co.</span></span>
      </span>
    </span>
  )
}

/** `stickyBar`: page shows the fixed mobile action bar (< lg), so reserve its height below the footer. */
export function PublicLayout({ children, stickyBar, settings }: { children: ReactNode; stickyBar?: boolean; settings?: BusinessSettings }) {
  const link = ({ isActive }: { isActive: boolean }) =>
    cn('whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3', isActive ? 'text-cream' : 'text-muted hover:text-cream')
  return (
    <div className={cn('public-shell min-h-dvh bg-ink text-cream', stickyBar && 'max-lg:pb-[calc(3.75rem+1px+max(.75rem,env(safe-area-inset-bottom)))]')}>
      <header className="relative z-20 border-b border-white/[.06] bg-ink/95">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Home"><Logo light /></Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={link}>Book</NavLink>
            <NavLink to="/manage" className={link}>My booking</NavLink>
            <Link to="/admin" className="ml-1 hidden rounded-md px-3 py-1.5 text-sm font-medium text-brand-300 ring-1 ring-inset ring-brand-400/40 transition-colors hover:bg-brand-400/10 sm:inline-block">Admin demo</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-white/[.06] bg-coal">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-[1fr_auto] sm:items-end sm:px-6">
          <div className="space-y-3">
            <Logo light />
            {settings && (
              <p className="text-muted">
                {settings.address}
                <span className="mx-2 text-line">|</span>
                <a href={`tel:${settings.phone.replace(/[^\d+]/g, '')}`} className="hover:text-cream">{settings.phone}</a>
              </p>
            )}
            <p className="max-w-xl text-xs leading-relaxed text-faint">
              Brasswood Barber Co. is a fictional business — this site is a product demo.
              {IS_DEMO && ' Data is stored only in your browser.'}
            </p>
          </div>
          <p>
            <Link to="/admin" className="font-medium text-brand-300 underline-offset-4 hover:underline">Open the admin panel →</Link>
          </p>
        </div>
      </footer>
    </div>
  )
}
