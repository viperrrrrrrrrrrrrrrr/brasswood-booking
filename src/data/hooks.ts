import { useEffect, useState, useCallback, type DependencyList } from 'react'
import { shopNow, type ShopNow } from '../lib/shopTime'
import { api } from './index'
import type { DataScope } from './repository'

/**
 * Run an async query against the data source and re-run it when data in `scopes` changes
 * (default: any change). Pass the narrowest scopes so polling refetches only what moved.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: DependencyList, scopes?: readonly DataScope[]): { data: T | undefined; loading: boolean; error: Error | null; refetch: () => void } {
  const [data, setData] = useState<T>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)
  const refetch = useCallback(() => setTick((t) => t + 1), [])

  const scopeKey = scopes?.join(',') ?? ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => api.subscribe(refetch, scopes), [refetch, scopeKey])

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

const CATALOG: readonly DataScope[] = ['catalog']

/** Common reference data used across pages. */
export function useCatalog() {
  const services = useQuery(() => api.services.list(), [], CATALOG)
  const staff = useQuery(() => api.staff.list(), [], CATALOG)
  const settings = useQuery(() => api.settings.get(), [], CATALOG)
  return {
    services: services.data ?? [],
    staff: staff.data ?? [],
    settings: settings.data,
    ready: !!services.data && !!staff.data && !!settings.data,
  }
}

/** Value that settles `ms` after the last change (search boxes → fewer server queries). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** "Now" in the shop timezone, re-rendering every minute (today/now-line roll over at shop midnight, not browser midnight). */
export function useShopClock(): ShopNow {
  const [now, setNow] = useState(() => shopNow())
  useEffect(() => {
    const id = setInterval(() => {
      const n = shopNow()
      setNow((p) => (p.date === n.date && p.minutes === n.minutes ? p : n))
    }, 15_000)
    return () => clearInterval(id)
  }, [])
  return now
}
