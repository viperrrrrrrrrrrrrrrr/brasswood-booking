import type { Env } from '../../server/env'
import { errorResponse } from '../../server/http'
import { applyTestClock } from '../../server/clock'

/** Runs for every /api/* request: turns thrown errors into consistent JSON responses. */
export const onRequest: PagesFunction<Env> = async (ctx) => {
  try {
    if (!ctx.env.DB) throw new Error('D1 binding "DB" is missing — check wrangler.toml / Pages project bindings')
    applyTestClock(ctx.env, ctx.request)
    return await ctx.next()
  } catch (e) {
    return errorResponse(e)
  }
}
