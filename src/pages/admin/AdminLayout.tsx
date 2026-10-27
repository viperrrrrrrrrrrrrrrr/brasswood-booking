import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom'
import { LayoutDashboard, CalendarRange, Scissors, Users, Clock, Contact, LogOut, RotateCcw, Menu, X, ExternalLink } from 'lucide-react'
import { api } from '../../data'
import { auth } from '../../lib/auth'
import { cn, useToast } from '../../components/ui'
import { Logo } from '../../components/PublicLayout'

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/schedule', label: 'Schedule', icon: CalendarRange },
  { to: '/admin/clients', label: 'Clients', icon: Contact },
  { to: '/admin/services', label: 'Services', icon: Scissors },
  { to: '/admin/staff', label: 'Staff', icon: Users },
  { to: '/admin/hours', label: 'Hours & days off', icon: Clock },
]

export default function AdminLayout() {
  const nav = useNavigate()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const reset = async () => {
    if (!window.confirm('Reset all sample data? Your changes will be replaced with fresh sample data.')) return
    setResetting(true)
    await api.resetDemoData()
    setResetting(false)
    toast('Sample data has been reset')
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5"><Link to="/admin"><Logo light compact /></Link></div>
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
            className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-white/10 text-white' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200')}>
            <Icon className="size-[18px]" />{label}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-white/10 px-3 py-3">
        <a href="/" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-stone-400 hover:bg-white/5 hover:text-stone-200"><ExternalLink className="size-[18px]" />Open booking page</a>
        {api.canResetDemoData && (
          <button onClick={reset} disabled={resetting} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-stone-400 hover:bg-white/5 hover:text-stone-200" data-testid="reset-demo">
            <RotateCcw className={cn('size-[18px]', resetting && 'animate-spin')} />Reset sample data
          </button>
        )}
        <button onClick={async () => { await auth.logout().catch(() => undefined); nav('/admin/login', { replace: true }) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-stone-400 hover:bg-white/5 hover:text-stone-200"><LogOut className="size-[18px]" />Sign out</button>
      </div>
    </div>
  )

  return (
    <div className="min-h-dvh bg-stone-100/60 lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-ink lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-64 bg-ink animate-fade-up">
            <button onClick={() => setOpen(false)} className="absolute top-4 right-3 p-1 text-stone-400" aria-label="Close menu"><X className="size-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-stone-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-1 p-1"><Menu className="size-6" /></button>
        <span className="font-semibold">Brasswood Admin</span>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  )
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-stone-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
