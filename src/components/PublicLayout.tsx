import { Link, NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'
import { cn } from './ui'

export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="14" fill={light ? '#fff' : '#1c1917'} />
        <path d="M20 44 L32 16 L44 44" stroke="#b98232" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M25 34h14" stroke="#b98232" strokeWidth="5" strokeLinecap="round" />
      </svg>
      <span className={cn('whitespace-nowrap font-display text-base font-semibold leading-none tracking-tight', !compact && 'sm:text-lg', light ? 'text-white' : 'text-ink')}>
        Brasswood <span className="text-brand-500">Barber<span className="max-[420px]:hidden"> Co.</span></span>
      </span>
    </span>
  )
}

/** `stickyBar`: page shows the fixed mobile action bar (< lg), so reserve its height below the footer. */
export function PublicLayout({ children, stickyBar }: { children: ReactNode; stickyBar?: boolean }) {
  const link = ({ isActive }: { isActive: boolean }) =>
    cn('whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm sm:px-3 font-medium transition', isActive ? 'bg-white/10 text-white' : 'text-stone-300 hover:text-white')
  return (
    <div className={cn('min-h-dvh bg-stone-50', stickyBar && 'max-lg:pb-[calc(3.75rem+1px+max(.75rem,env(safe-area-inset-bottom)))]')}>
      <header className="bg-ink">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Home"><Logo light /></Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={link}>Book</NavLink>
            <NavLink to="/manage" className={link}>My booking</NavLink>
            <Link to="/admin" className="ml-1 hidden rounded-lg px-3 py-1.5 text-sm font-medium text-brand-300 ring-1 ring-brand-300/40 hover:bg-brand-300/10 sm:inline-block">Admin demo</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Brasswood Barber Co. is a fictional business. This is a product demo — data is stored only in your browser.</p>
          <p>
            <Link to="/admin" className="font-medium text-stone-700 underline-offset-2 hover:underline">Open the admin panel →</Link>
          </p>
        </div>
      </footer>
    </div>
  )
}
