export interface SavedWorkout {
  id: string
  name: string
  intervals: unknown // EditableInterval[] at runtime
}

export interface PersistedState {
  twoKInput: string
  tier: string
  customMode: 'slider' | 'scores'
  customRatio: number
  sixKInput: string
  savedWorkouts: SavedWorkout[]
}

const KEY = 'key-workouts-state-v5'

export function loadState(): Partial<PersistedState> | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedState
  } catch {
    return null
  }
}

export function saveState(state: Partial<PersistedState>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // quota exceeded or disabled — ignore
  }
}

// Migrates legacy `{ count, workKind, workValue, restKind, restValue }` entries
// (pre-intervals schema) into a flat list of single-rep EditableInterval
// objects. Normalizations applied:
//   - Legacy `restKind: 'distance'` is converted to time rest (meters / 4 m/s,
//     matching the old pm5.ts approximation) since the PM5 doesn't support
//     rest-by-distance.
//   - Legacy `restKind` is dropped.
//   - Empty `restValue` (old "no rest" encoding) becomes "0:00", matching the
//     current UI where the rest input always shows m:ss.
export function migrateIntervals(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return []
  const out: unknown[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const countRaw = obj.count
    const count =
      typeof countRaw === 'number' && isFinite(countRaw) && countRaw >= 1
        ? Math.floor(countRaw)
        : 1
    const rest = { ...obj }
    delete rest.count
    if (rest.restKind === 'distance') {
      const meters = Number(rest.restValue)
      const seconds = isFinite(meters) && meters > 0 ? Math.round(meters / 4) : 120
      const m = Math.floor(seconds / 60)
      const s = seconds - m * 60
      rest.restValue = `${m}:${s.toString().padStart(2, '0')}`
    } else if (rest.restKind === 'none') {
      rest.restValue = '0:00'
    }
    delete rest.restKind
    if (typeof rest.restValue !== 'string' || rest.restValue.trim() === '') {
      rest.restValue = '0:00'
    }
    for (let i = 0; i < count; i++) out.push({ ...rest })
  }
  return out
}

// Reads the intervals field from a saved workout, accepting both the new
// `intervals` name and the legacy `segments` name, then migrating to the
// single-rep interval format.
export function readWorkoutIntervals(sw: SavedWorkout): unknown[] {
  const raw =
    (sw as unknown as { intervals?: unknown }).intervals ??
    (sw as unknown as { segments?: unknown }).segments
  return migrateIntervals(raw)
}
