import { lazy, Suspense, useEffect, useReducer, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider, Spinner } from './components/ui'
import BookingPage from './pages/booking/BookingPage'
import ManagePage from './pages/booking/ManagePage'
import { auth } from './lib/auth'

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const LoginPage = lazy(() => import('./pages/admin/LoginPage'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const SchedulePage = lazy(() => import('./pages/admin/SchedulePage'))
const ServicesPage = lazy(() => import('./pages/admin/ServicesPage'))
const StaffPage = lazy(() => import('./pages/admin/StaffPage'))
const HoursPage = lazy(() => import('./pages/admin/HoursPage'))
const ClientsPage = lazy(() => import('./pages/admin/ClientsPage'))

function RequireAuth({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  useEffect(() => auth.onChange(rerender), [])
  // Re-validate the server session on every admin navigation (expired sessions bounce to login).
  useEffect(() => {
    void auth.check()
  }, [loc.pathname])
  if (!auth.known()) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>
  return auth.isLoggedIn() ? children : <Navigate to="/admin/login" replace state={{ from: loc.pathname }} />
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="flex h-dvh items-center justify-center"><Spinner /></div>}>
          <Routes>
            <Route path="/" element={<BookingPage />} />
            <Route path="/manage" element={<ManagePage />} />
            <Route path="/admin/login" element={<LoginPage />} />
            <Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
              <Route index element={<Dashboard />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="hours" element={<HoursPage />} />
              <Route path="clients" element={<ClientsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  )
}
