import { useEffect, useState, useCallback, type DependencyList } from 'react'
import { api } from './index'

/** Run an async query against the data source and re-run it whenever data changes. */
export function useQuery<T>(fn: () => Promise<T>, deps: DependencyList): { data: T | undefined; loading: boolean; error: Error | null; refetch: () => void } {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)
  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => api.subscribe(refetch), [refetch])

  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { data, loading, error, refetch }
}

/** Common reference data used across pages. */
export function useCatalog() {
  const services = useQuery(() => api.services.list(), [])
  const staff = useQuery(() => api.staff.list(), [])
  const settings = useQuery(() => api.settings.get(), [])
  return {
    services: services.data ?? [],
    staff: staff.data ?? [],
    settings: settings.data,
    ready: !!services.data && !!staff.data && !!settings.data,
  }
}
