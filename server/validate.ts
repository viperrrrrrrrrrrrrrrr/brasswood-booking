import { badRequest } from './http'

type Obj = Record<string, unknown>
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function str(o: Obj, key: string, opts: { required?: boolean; max?: number; min?: number } = {}): string | undefined {
  const v = o[key]
  if (v === undefined || v === null) {
    if (opts.required) throw badRequest(`${key} is required`)
    return undefined
  }
  if (typeof v !== 'string') throw badRequest(`${key} must be a string`)
  const s = v.trim()
  if (opts.required && !s) throw badRequest(`${key} is required`)
  if (opts.min && s.length < opts.min) throw badRequest(`${key} is too short`)
  if (s.length > (opts.max ?? 500)) throw badRequest(`${key} is too long (max ${opts.max ?? 500})`)
  return s
}

export function int(o: Obj, key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
  const v = o[key]
  if (v === undefined || v === null) {
    if (opts.required) throw badRequest(`${key} is required`)
    return undefined
  }
  if (typeof v !== 'number' || !Number.isInteger(v)) throw badRequest(`${key} must be an integer`)
  if (opts.min !== undefined && v < opts.min) throw badRequest(`${key} must be ≥ ${opts.min}`)
  if (opts.max !== undefined && v > opts.max) throw badRequest(`${key} must be ≤ ${opts.max}`)
  return v
}

export function num(o: Obj, key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
  const v = o[key]
  if (v === undefined || v === null) {
    if (opts.required) throw badRequest(`${key} is required`)
    return undefined
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest(`${key} must be a number`)
  if (opts.min !== undefined && v < opts.min) throw badRequest(`${key} must be ≥ ${opts.min}`)
  if (opts.max !== undefined && v > opts.max) throw badRequest(`${key} must be ≤ ${opts.max}`)
  return v
}

export function bool(o: Obj, key: string): boolean | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw badRequest(`${key} must be true or false`)
  return v
}

export function date(o: Obj, key: string, required = true): string | undefined {
  const v = o[key]
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`${key} is required`)
    return undefined
  }
  if (!isDate(v)) throw badRequest(`${key} must be a date YYYY-MM-DD`)
  return v
}

export function id(v: unknown, key = 'id'): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw badRequest(`${key} is invalid`)
  return v
}

export function idList(o: Obj, key: string): string[] | undefined {
  const v = o[key]
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.length > 200) throw badRequest(`${key} must be a list`)
  return [...new Set(v.map((x) => id(x, key)))]
}

export function obj(v: unknown, key: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${key} must be an object`)
  return v as Obj
}

export const normEmail = (s: string) => s.trim().toLowerCase()
export const phoneDigits = (s: string) => s.replace(/\D/g, '')
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
