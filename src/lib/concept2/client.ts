import { CONCEPT2_API_BASE } from './config'
import { clearToken, getFreshToken } from './tokens'
import type { Concept2ResultPayload, Concept2User } from './types'

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getFreshToken()
  if (!token) throw new Error('Not connected to Concept2 Logbook')
  const headers = new Headers(init.headers ?? {})
  headers.set('Authorization', `Bearer ${token.access_token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Accept', 'application/json')
  const res = await fetch(`${CONCEPT2_API_BASE}${path}`, { ...init, headers })
  // 401 after a getFreshToken() means the refresh token itself is dead —
  // drop the token so the UI demotes to "not connected".
  if (res.status === 401) clearToken()
  return res
}

async function jsonOrThrow<T>(res: Response, ctx: string): Promise<T> {
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${ctx} ${res.status}: ${text.slice(0, 500)}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${ctx} response not JSON: ${text.slice(0, 300)}`)
  }
}

// /users/me is wrapped in { data: {...} } for some deployments and naked for
// others (erg-warriors handles both) — accept either shape.
interface MeEnvelope { data?: unknown }

function parseUser(raw: unknown): Concept2User {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const idVal = obj.user_id ?? obj.id
  if (idVal === undefined || idVal === null) {
    throw new Error('Concept2 /users/me missing user id')
  }
  return {
    user_id:      String(idVal),
    username:     typeof obj.username === 'string' ? obj.username : '',
    first_name:   typeof obj.first_name === 'string' ? obj.first_name : undefined,
    last_name:    typeof obj.last_name === 'string' ? obj.last_name : undefined,
    email:        typeof obj.email === 'string' ? obj.email : undefined,
    gender:       typeof obj.gender === 'string' ? obj.gender : undefined,
    weight_class: typeof obj.weight_class === 'string' ? obj.weight_class : undefined,
  }
}

export async function getMe(): Promise<Concept2User> {
  const res = await authedFetch('/users/me')
  const env = await jsonOrThrow<MeEnvelope>(res, 'Concept2 /users/me')
  return parseUser(env.data ?? env)
}

// POST /users/me/results. Returns whatever the server echoes so the UI can
// show a link back to the logbook entry if desired.
export async function postResult(payload: Concept2ResultPayload): Promise<unknown> {
  const res = await authedFetch('/users/me/results', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return jsonOrThrow(res, 'Concept2 POST /users/me/results')
}
