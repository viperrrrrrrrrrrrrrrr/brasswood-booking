/// <reference types="@cloudflare/workers-types" />

/** Bindings available to Pages Functions (see wrangler.toml and .dev.vars). */
export interface Env {
  DB: D1Database
  /** Admin login name. Defaults to "admin". */
  ADMIN_USERNAME?: string
  /** Plain admin password (secret). Used when ADMIN_PASSWORD_HASH is not set. */
  ADMIN_PASSWORD?: string
  /** Optional PBKDF2 hash: "pbkdf2-sha256$<iterations>$<saltB64>$<hashB64>" (npm run hash-password). Takes precedence. */
  ADMIN_PASSWORD_HASH?: string
}
