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
  // Optional free-form coaching note for this interval (e.g. "r22-24, neg
  // split rep 1"). Display-only — predictor and PM5 programming ignore it.
  // The rowing display scans this string for a stroke-rate pattern via
  // extractSpmRange so the live SPM colour-codes against the target.
  notes?: string
}

// Pull a stroke-rate target out of a free-form notes string. Recognised
// shapes, in priority order:
//   1.  r22  /  r22-24  /  rate 22  /  rate 22-24   (explicit prefix)
//   2.  22 spm  /  22-24 spm                        (explicit suffix)
//   3.  22-24                                       (bare hyphenated range)
// Numbers outside the plausible SPM band [14, 50] are rejected so things
// like "5x1k" don't masquerade as a rate. Returns null when no pattern
// matches.
export function extractSpmRange(notes: string | undefined): { min: number; max: number } | null {
  const text = notes ?? ''
  if (!text) return null
  const tryMatch = (re: RegExp): { min: number; max: number } | null => {
    const m = text.match(re)
    if (!m) return null
    const lo = Number(m[1])
    const hi = m[2] ? Number(m[2]) : lo
    if (!isFinite(lo) || !isFinite(hi)) return null
    if (lo < 14 || lo > 50 || hi < 14 || hi > 50) return null
    if (lo > hi) return null
    return { min: lo, max: hi }
  }
  return (
    tryMatch(/\br(?:ate)?\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\b/i) ??
    tryMatch(/\b(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*spm\b/i) ??
    tryMatch(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b/)
  )
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
