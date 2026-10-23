import type { Env } from '../../../server/env'
import { assertSameOrigin, getSession } from '../../../server/auth'
import { unauthorized } from '../../../server/http'

/** Every /api/admin/* request needs a valid server-side session (HttpOnly cookie). */
export const onRequest: PagesFunction<Env, string, { admin: string }> = async (ctx) => {
  const admin = await getSession(ctx.env.DB, ctx.request)
  if (!admin) throw unauthorized()
  assertSameOrigin(ctx.request)
  ctx.data.admin = admin
  return ctx.next()
}
