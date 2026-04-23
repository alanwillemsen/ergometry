import type { PersistedState } from './storage'
import { migrateIntervals } from './storage'

// base64url encode/decode without padding — URL-safe and short.
function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// Profile share URL — encodes full user profile state.
export function encodeState(state: Partial<PersistedState>): string {
  return 'v1.' + b64urlEncode(JSON.stringify(state))
}

export function decodeState(hash: string): Partial<PersistedState> | null {
  const clean = hash.replace(/^#/, '')
  if (!clean.startsWith('v1.')) return null
  try {
    return JSON.parse(b64urlDecode(clean.slice(3))) as PersistedState
  } catch {
    return null
  }
}

export function readHashState(): Partial<PersistedState> | null {
  if (typeof location === 'undefined' || !location.hash) return null
  return decodeState(location.hash)
}

export function buildShareUrl(state: Partial<PersistedState>): string {
  const base = `${location.origin}${location.pathname}`
  return `${base}#${encodeState(state)}`
}

// Workout share URL — encodes only the workout definition, not the user's profile.
// Recipients apply their own 2K time and tier for predictions.
export function buildWorkoutShareUrl(w: { name: string; intervals: unknown }): string {
  const base = `${location.origin}${location.pathname}`
  const intervals = Array.isArray(w.intervals)
    ? w.intervals.map(({ id: _id, ...rest }: Record<string, unknown>) => rest)
    : w.intervals
  return `${base}#wkt.v1.${b64urlEncode(JSON.stringify({ name: w.name, intervals }))}`
}

export function readHashWorkout(): { name: string; intervals: unknown[] } | null {
  if (typeof location === 'undefined' || !location.hash) return null
  const clean = location.hash.replace(/^#/, '')
  if (!clean.startsWith('wkt.v1.')) return null
  try {
    const parsed = JSON.parse(b64urlDecode(clean.slice(7))) as {
      name?: unknown
      intervals?: unknown
      segments?: unknown
    }
    if (typeof parsed?.name !== 'string') return null
    const raw = parsed.intervals ?? parsed.segments
    if (!Array.isArray(raw)) return null
    return { name: parsed.name, intervals: migrateIntervals(raw) }
  } catch {
    return null
  }
}
