import type { Concept2Token } from './types'
import { refreshAccessToken } from './oauth'

const TOKEN_KEY  = 'concept2-token-v1'
const STATE_KEY  = 'concept2-oauth-state'
const RETURN_KEY = 'concept2-oauth-return'

// Refresh a minute before actual expiry so an in-flight request doesn't
// race the server's clock.
const EXPIRY_SKEW_SEC = 60

export function loadToken(): Concept2Token | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Concept2Token
  } catch {
    return null
  }
}

export function saveToken(t: Concept2Token): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(t))
  } catch {
    // quota exceeded — ignore; caller can still use the in-memory token.
  }
}

export function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}

export function isExpired(t: Concept2Token, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return nowSec + EXPIRY_SKEW_SEC >= t.expires_at
}

// Returns a token that is guaranteed (best-effort) to be unexpired. Refreshes
// on demand and persists the new token. If refresh fails, the cached token is
// cleared and the error is propagated — caller treats this as "re-connect".
export async function getFreshToken(): Promise<Concept2Token | null> {
  const t = loadToken()
  if (!t) return null
  if (!isExpired(t)) return t
  try {
    const next = await refreshAccessToken(t.refresh_token)
    saveToken(next)
    return next
  } catch (e) {
    clearToken()
    throw e
  }
}

// ── OAuth-flow short-lived storage (sessionStorage so it dies with the tab) ──

export function saveOAuthState(state: string): void {
  try { sessionStorage.setItem(STATE_KEY, state) } catch { /* ignore */ }
}
export function consumeOAuthState(): string | null {
  try {
    const v = sessionStorage.getItem(STATE_KEY)
    if (v !== null) sessionStorage.removeItem(STATE_KEY)
    return v
  } catch {
    return null
  }
}

// Where to send the user after a successful callback. Defaults to "/".
export function saveReturnPath(path: string): void {
  try { sessionStorage.setItem(RETURN_KEY, path) } catch { /* ignore */ }
}
export function consumeReturnPath(): string {
  try {
    const v = sessionStorage.getItem(RETURN_KEY)
    if (v !== null) sessionStorage.removeItem(RETURN_KEY)
    return v ?? '/'
  } catch {
    return '/'
  }
}
