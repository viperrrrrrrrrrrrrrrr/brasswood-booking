// Dark "premium" building blocks for the client-facing pages (booking + manage).
// The admin keeps using the light components in ./ui — nothing there changes.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { cn } from './ui'

type Variant = 'gold' | 'outline' | 'ghost' | 'danger'
const variants: Record<Variant, string> = {
  gold: 'bg-brand-400 text-ink hover:bg-brand-300 shadow-[0_1px_0_rgba(255,255,255,.25)_inset]',
  outline: 'bg-transparent text-cream ring-1 ring-inset ring-line hover:ring-brand-400/70 hover:bg-white/[.03]',
  ghost: 'text-muted hover:text-cream hover:bg-white/[.04]',
  danger: 'bg-red-700 text-white hover:bg-red-600',
}

export function LuxButton({ variant = 'gold', size = 'md', loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold tracking-wide transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
        size === 'md' && 'h-11 px-5 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function LuxCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-line/80 bg-graphite shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]', className)}>{children}</div>
}

const fieldBase = 'w-full rounded-md border border-line bg-coal px-3.5 py-3 text-[15px] text-cream placeholder:text-faint outline-none transition-colors focus:border-brand-400 focus:ring-1 focus:ring-brand-400 aria-[invalid=true]:border-red-400/70'

export function LuxInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(fieldBase, className)} />
}
export function LuxTextarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(fieldBase, 'min-h-24 resize-y', className)} />
}

export function LuxField({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-2 block text-xs font-semibold tracking-[.14em] text-muted uppercase">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 flex items-center gap-1.5 text-[13px] text-red-300" role="alert"><AlertCircle className="size-3.5 shrink-0" />{error}</span>
      ) : hint ? <span className="mt-1.5 block text-xs text-faint">{hint}</span> : null}
    </label>
  )
}

export function LuxSpinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-sm text-muted', className)} role="status">
      <Loader2 className="size-5 animate-spin text-brand-400" />
      {label}
    </span>
  )
}

/** Thin brass rule with a centred label — used to separate sections. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('eyebrow flex items-center gap-3 text-brand-300', className)}>
      <span className="h-px w-6 bg-brand-400/70" aria-hidden />
      {children}
    </p>
  )
}
