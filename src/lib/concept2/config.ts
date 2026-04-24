// Concept2 Logbook OAuth + API config. Credentials come from .env.local
// (Vite only exposes vars prefixed VITE_). The client_secret lives in the
// bundle — acceptable for a self-hosted personal tool, not for a public app.
// If we ever publish this, move the token exchange behind a tiny proxy.

export const CONCEPT2_AUTH_URL  = 'https://log.concept2.com/oauth/authorize'
export const CONCEPT2_TOKEN_URL = 'https://log.concept2.com/oauth/access_token'
export const CONCEPT2_API_BASE  = 'https://log.concept2.com/api'

// results:write is required to POST workouts. user:read lets us greet by name.
export const CONCEPT2_SCOPE = 'user:read,results:write'

export const CONCEPT2_CLIENT_ID     = import.meta.env.VITE_CONCEPT2_CLIENT_ID     as string | undefined
export const CONCEPT2_CLIENT_SECRET = import.meta.env.VITE_CONCEPT2_CLIENT_SECRET as string | undefined

export const CONCEPT2_CALLBACK_PATH = '/auth/concept2/callback'

// Derived from window.location at call time so the URI matches whichever
// origin the user loaded the app from (localhost, LAN IP, tunnel, etc.).
// Each origin used must be registered in the Concept2 app settings.
export function getRedirectUri(): string {
  return `${window.location.origin}${CONCEPT2_CALLBACK_PATH}`
}

export function isConcept2Configured(): boolean {
  return !!(CONCEPT2_CLIENT_ID && CONCEPT2_CLIENT_SECRET)
}
