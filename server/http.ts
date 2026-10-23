/** Consistent JSON responses and errors for the API. */
export type ErrorCode = 'validation' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'payload_too_large' | 'internal'

export class HttpError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly headers: Record<string, string>
  constructor(status: number, code: ErrorCode, message: string, headers: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.headers = headers
  }
}

export const badRequest = (msg: string) => new HttpError(400, 'validation', msg)
export const notFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg)
export const conflict = (msg = 'That time was just taken. Please pick another slot.') => new HttpError(409, 'conflict', msg)
export const unauthorized = (msg = 'Sign in required') => new HttpError(401, 'unauthorized', msg)
export const forbidden = (msg = 'Forbidden') => new HttpError(403, 'forbidden', msg)

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } })
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, e.status, e.headers)
  console.error('Unhandled API error', e)
  return json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } }, 500)
}

const MAX_BODY = 64 * 1024

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) throw badRequest('Expected a JSON body (Content-Type: application/json)')
  const text = await req.text()
  if (text.length > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'Request body too large')
  try {
    const v = JSON.parse(text) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
    return v as Record<string, unknown>
  } catch {
    throw badRequest('Invalid JSON body')
  }
}
