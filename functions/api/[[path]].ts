import type { Env } from '../../server/env'
import { publicRouter } from '../../server/routes/public'

/** Public API + auth endpoints: /api/services, /api/availability/*, /api/bookings, /api/auth/* … */
export const onRequest: PagesFunction<Env> = (ctx) => publicRouter.handle(ctx.request, ctx.env, '/api')
