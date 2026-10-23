import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { KeyRound, ArrowLeft } from 'lucide-react'
import { auth, DEMO_CREDENTIALS } from '../../lib/auth'
import { Button, Card, Field, Input } from '../../components/ui'
import { Logo } from '../../components/PublicLayout'

export default function LoginPage() {
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (auth.login(username, password)) nav(loc.state?.from ?? '/admin', { replace: true })
    else setError('Invalid username or password')
  }
  const fill = () => {
    setUsername(DEMO_CREDENTIALS.username)
    setPassword(DEMO_CREDENTIALS.password)
    setError('')
  }

  // Already signed in (e.g. reached via Back/Forward): don't show the form again.
  if (auth.isLoggedIn()) return <Navigate to={loc.state?.from ?? '/admin'} replace />

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ink px-4 py-10">
      <Logo light />
      <Card className="mt-8 w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">Staff sign in</h1>
        <p className="mt-1 text-sm text-stone-500">Manage bookings, staff and services.</p>
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm ring-1 ring-brand-100">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-brand-600" />
          <div className="flex-1">
            <p className="font-medium text-brand-900">Demo credentials</p>
            <p className="text-brand-800">Username <code className="rounded bg-white px-1 font-mono">admin</code> · Password <code className="rounded bg-white px-1 font-mono">demo</code></p>
          </div>
          <button type="button" onClick={fill} className="text-xs font-semibold text-brand-700 hover:underline">Fill in</button>
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="Username"><Input name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          <Field label="Password" error={error}><Input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" size="lg" className="w-full">Sign in</Button>
        </form>
      </Card>
      <Link to="/" className="mt-6 flex items-center gap-1 text-sm text-stone-400 hover:text-white"><ArrowLeft className="size-4" />Back to booking page</Link>
    </div>
  )
}
