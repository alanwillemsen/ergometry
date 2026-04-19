export type Rep =
  | { kind: 'distance'; meters: number }
  | { kind: 'duration'; seconds: number }

export type Rest =
  | { kind: 'distance'; meters: number }
  | { kind: 'duration'; seconds: number }
  | { kind: 'none' }

export interface WorkoutSegment {
  work: Rep
  rest: Rest
  count: number
}

export interface Workout {
  id: string
  name: string
  segments: WorkoutSegment[]
}

export interface WorkoutPrediction {
  avgSplitSeconds: number
  perRepSplitsSeconds: number[]
  perSegmentSplitsSeconds: number[]
  totalWorkSeconds: number
  totalMeters: number
  finalWPrimeJoules: number
}
