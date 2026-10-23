export interface AuthClient {
  /** false while the server hasn't answered yet (api mode only). */
  known(): boolean
  isLoggedIn(): boolean
  /** Re-validates the session (api: GET /api/auth/me). */
  check(): Promise<boolean>
  /** Resolves to an error message, or null on success. */
  login(username: string, password: string): Promise<string | null>
  logout(): Promise<void>
  onChange(listener: () => void): () => void
  /** Only the static demo exposes credentials on the login page. */
  readonly demoCredentials?: { username: string; password: string }
}
