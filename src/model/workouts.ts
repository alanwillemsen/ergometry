export type Rep =
  | { kind: 'distance'; meters: number }
  | { kind: 'duration'; seconds: number }

// The PM5 only supports time-based or no rest; distance-based rest isn't a
// real option on the hardware.
export type Rest =
  | { kind: 'duration'; seconds: number }
  | { kind: 'none' }

// Traditional rowing training bands, ordered from lightest to hardest.
// Each band pins the work-power directly from the athlete's fitted profile
// (see bandPower in pacing.ts) rather than being solved from a W' target.
// "Max" is a virtual selection in the UI (absence of a band — the solver
// pushes to the Morton ceiling) and is not represented in the Band union.
export type Band = 'UT2' | 'UT1' | 'AT'
export const BANDS: Band[] = ['UT2', 'UT1', 'AT']

export interface WorkoutInterval {
  work: Rep
  rest: Rest
  // 0–100. When set, the solver fixes W' after this interval's work phase
  // at this percentage of W'_max. Previous intervals are paced to hit that
  // target; subsequent intervals start from the resulting (post-rest) state.
  lockedWbalPercent?: number
  // When set, pin this interval's work-power to the band's target (derived
  // from the fitted profile). Band overrides lockedWbalPercent.
  band?: Band
}

export interface Workout {
  id: string
  name: string
  intervals: WorkoutInterval[]
}

export interface WorkoutPrediction {
  avgSplitSeconds: number
  perIntervalSplitsSeconds: number[]
  totalWorkSeconds: number
  totalMeters: number
  finalWPrimeJoules: number
  perIntervalWbalPercent: number[]
}
