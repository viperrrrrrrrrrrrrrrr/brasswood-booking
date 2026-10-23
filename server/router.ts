import type { Env } from './env'
import { notFound, HttpError, json } from './http'

export interface RouteCtx {
  req: Request
  env: Env
  url: URL
  params: Record<string, string>
  /** Admin username when the request carries a valid session (set by the admin middleware). */
  admin?: string
}
type Handler = (c: RouteCtx) => Promise<Response> | Response

/** Minimal method + path router for a catch-all Pages Function. Patterns like '/bookings/:id/status'. */
export class Router {
  private routes: { method: string; parts: string[]; handler: Handler }[] = []
  private add(method: string, pattern: string, handler: Handler) {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler })
    return this
  }
  get = (p: string, h: Handler) => this.add('GET', p, h)
  post = (p: string, h: Handler) => this.add('POST', p, h)
  put = (p: string, h: Handler) => this.add('PUT', p, h)
  patch = (p: string, h: Handler) => this.add('PATCH', p, h)
  delete = (p: string, h: Handler) => this.add('DELETE', p, h)

  async handle(req: Request, env: Env, prefix: string, extra: Partial<RouteCtx> = {}): Promise<Response> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith(prefix)) throw notFound()
    const segs = url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent)
    let pathMatched = false
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue
      const params: Record<string, string> = {}
      const ok = r.parts.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = segs[i]), true) : p === segs[i]))
      if (!ok) continue
      pathMatched = true
      if (r.method !== req.method && !(req.method === 'HEAD' && r.method === 'GET')) continue
      return r.handler({ req, env, url, params, ...extra })
    }
    if (pathMatched) throw new HttpError(405, 'validation', `Method ${req.method} not allowed`)
    throw notFound('Unknown API endpoint')
  }
}

export const noContent = () => json(null, 204)
