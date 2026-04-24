export interface Concept2Token {
  access_token: string
  refresh_token: string
  // Unix seconds. Computed at token receipt (now + expires_in).
  expires_at: number
  token_type: string
  scope?: string
}

export interface Concept2User {
  user_id: string
  username: string
  first_name?: string
  last_name?: string
  email?: string
  // 'M' | 'F' | 'X' per Concept2 — not strictly typed so we don't reject
  // future values.
  gender?: string
  // Not always populated in /users/me; when present we can default the
  // upload weight_class from it.
  weight_class?: string
}

// Machine types accepted by POST /users/me/results.
export type Concept2MachineType =
  | 'rower' | 'skierg' | 'bike' | 'dynamic' | 'slides'
  | 'paddle' | 'water' | 'snow' | 'rollerski' | 'multierg'

// Subset of workout_type values we emit. The server accepts more.
export type Concept2WorkoutType =
  | 'JustRow'
  | 'FixedDistanceSplits' | 'FixedTimeSplits'
  | 'FixedTimeInterval' | 'FixedDistanceInterval'
  | 'VariableInterval'

// Per-stroke entry the Logbook uses to render the workout pace graph.
//   t   — elapsed time in tenths of a second
//   d   — cumulative distance in meters
//   p   — pace per 500m in tenths of a second (e.g. 1105 = 1:50.5)
//   spm — strokes per minute at that stroke
//   hr  — heart rate (0 when no HR strap)
export interface Concept2StrokeRecord {
  t: number
  d: number
  p: number
  spm: number
  hr?: number
}

// Per-interval entry. distance is meters; time + rest_time are tenths of a
// second to match the top-level units. stroke_rate is average SPM.
export interface Concept2IntervalRecord {
  distance?: number
  time?: number
  stroke_rate?: number
  rest_time?: number
  rest_distance?: number
  heart_rate?: { average?: number }
}

export interface Concept2ResultPayload {
  // 'yyyy-mm-dd hh:mm:ss' in the user's local time (Logbook doesn't want a TZ).
  date: string
  distance: number           // integer meters
  time: number               // integer tenths of second
  type: Concept2MachineType
  weight_class: 'H' | 'L'
  workout_type?: Concept2WorkoutType
  // Free-form text shown alongside the result on the Logbook page. We use it
  // to carry the workout's name so the user can identify their saved workout.
  comments?: string
  // Per-interval breakdown — populates the Logbook intervals table.
  workout?: {
    intervals?: Concept2IntervalRecord[]
  }
  // Per-stroke timeline — drives the Logbook pace graph (ErgData parity).
  stroke_data?: Concept2StrokeRecord[]
}
