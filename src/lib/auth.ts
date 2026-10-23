/** Demo-only auth. A real deployment would use the backend's session/JWT. */
const KEY = 'brasswood-admin-session'
export const DEMO_CREDENTIALS = { username: 'admin', password: 'demo' }

export const auth = {
  isLoggedIn: () => sessionStorage.getItem(KEY) === '1',
  login(username: string, password: string) {
    const ok = username.trim().toLowerCase() === DEMO_CREDENTIALS.username && password === DEMO_CREDENTIALS.password
    if (ok) sessionStorage.setItem(KEY, '1')
    return ok
  },
  logout: () => sessionStorage.removeItem(KEY),
}
