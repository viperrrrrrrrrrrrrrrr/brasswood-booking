import type { Env } from '../../../server/env'
import { adminRouter } from '../../../server/routes/admin'

export const onRequest: PagesFunction<Env, string, { admin: string }> = (ctx) =>
  adminRouter.handle(ctx.request, ctx.env, '/api/admin', { admin: ctx.data.admin })
