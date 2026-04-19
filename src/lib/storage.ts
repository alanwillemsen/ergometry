export interface SavedWorkout {
  id: string
  name: string
  segments: unknown  // EditableSegment[] at runtime
}

export interface PersistedState {
  twoKInput: string
  tier: string
  customMode: 'slider' | 'scores'
  customRatio: number
  sixKInput: string
  builderName: string
  builderSegments: unknown
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
