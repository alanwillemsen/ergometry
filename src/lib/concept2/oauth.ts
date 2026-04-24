import {
  CONCEPT2_AUTH_URL,
  CONCEPT2_TOKEN_URL,
  CONCEPT2_CLIENT_ID,
  CONCEPT2_CLIENT_SECRET,
  CONCEPT2_SCOPE,
  getRedirectUri,
} from './config'
import type { Concept2Token } from './types'

// Random string for CSRF protection. Stored in sessionStorage before the
// redirect and verified on callback.
export function generateState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CONCEPT2_CLIENT_ID!,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: CONCEPT2_SCOPE,
    state,
  })
  return `${CONCEPT2_AUTH_URL}?${params.toString()}`
}

// Concept2 returns { access_token, refresh_token, expires_in, token_type, scope }.
// We normalize to Concept2Token with an absolute expires_at (unix seconds) so
// refresh timing doesn't depend on when the token was persisted.
function toToken(raw: Record<string, unknown>): Concept2Token {
  const access_token  = String(raw.access_token ?? '')
  const refresh_token = String(raw.refresh_token ?? '')
  const expires_in    = Number(raw.expires_in ?? 0)
  const token_type    = String(raw.token_type ?? 'Bearer')
  const scope         = typeof raw.scope === 'string' ? raw.scope : undefined
  if (!access_token || !refresh_token || !isFinite(expires_in)) {
    throw new Error('Concept2 token response missing fields')
  }
  return {
    access_token,
    refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + expires_in,
    token_type,
    scope,
  }
}

async function postToken(body: URLSearchParams): Promise<Concept2Token> {
  const res = await fetch(CONCEPT2_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Concept2 token endpoint ${res.status}: ${text.slice(0, 300)}`)
  }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Concept2 token response not JSON: ${text.slice(0, 300)}`)
  }
  return toToken(data)
}

export function exchangeCodeForToken(code: string): Promise<Concept2Token> {
  return postToken(new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    client_id:     CONCEPT2_CLIENT_ID!,
    client_secret: CONCEPT2_CLIENT_SECRET!,
    redirect_uri:  getRedirectUri(),
  }))
}

export function refreshAccessToken(refresh_token: string): Promise<Concept2Token> {
  return postToken(new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token,
    client_id:     CONCEPT2_CLIENT_ID!,
    client_secret: CONCEPT2_CLIENT_SECRET!,
    scope:         CONCEPT2_SCOPE,
  }))
}
