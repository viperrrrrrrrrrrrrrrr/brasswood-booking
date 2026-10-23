import { useEffect, useReducer, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { KeyRound, ArrowLeft } from 'lucide-react'
import { auth } from '../../lib/auth'
import { Button, Card, Field, Input, Spinner } from '../../components/ui'
import { Logo } from '../../components/PublicLayout'

export default function LoginPage() {
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  useEffect(() => auth.onChange(rerender), [])
  useEffect(() => {
    if (!auth.known()) void auth.check()
  }, [])
  // Constant-folded: the demo-credentials box does not exist in the api bundle at all.
  const demo = import.meta.env.VITE_DATA_SOURCE === 'local' ? auth.demoCredentials : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const err = await auth.login(username, password)
    setBusy(false)
    if (err === null) nav(loc.state?.from ?? '/admin', { replace: true })
    else setError(err)
  }
  const fill = () => {
    if (!demo) return
    setUsername(demo.username)
    setPassword(demo.password)
    setError('')
  }

  if (!auth.known()) return <div className="flex min-h-dvh items-center justify-center bg-ink"><Spinner /></div>
  // Already signed in (e.g. reached via Back/Forward): don't show the form again.
  if (auth.isLoggedIn()) return <Navigate to={loc.state?.from ?? '/admin'} replace />

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ink px-4 py-10">
      <Logo light />
      <Card className="mt-8 w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">Staff sign in</h1>
        <p className="mt-1 text-sm text-stone-500">Manage bookings, staff and services.</p>
        {demo && (
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm ring-1 ring-brand-100">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-brand-600" />
            <div className="flex-1">
              <p className="font-medium text-brand-900">Demo credentials</p>
              <p className="text-brand-800">Username <code className="rounded bg-white px-1 font-mono">{demo.username}</code> · Password <code className="rounded bg-white px-1 font-mono">{demo.password}</code></p>
            </div>
            <button type="button" onClick={fill} className="text-xs font-semibold text-brand-700 hover:underline">Fill in</button>
          </div>
        )}
        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="Username"><Input name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          <Field label="Password" error={error}><Input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
      </Card>
      <Link to="/" className="mt-6 flex items-center gap-1 text-sm text-stone-400 hover:text-white"><ArrowLeft className="size-4" />Back to booking page</Link>
    </div>
  )
}
