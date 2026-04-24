import type { Workout } from '../../model/workouts'
import type { PM5Telemetry, PM5SplitRecord, PM5StrokeRecord } from '../pm5'
import type {
  Concept2IntervalRecord,
  Concept2ResultPayload,
  Concept2StrokeRecord,
  Concept2WorkoutType,
} from './types'

// 'yyyy-mm-dd hh:mm:ss' in local time — Concept2 Logbook expects a naive
// datetime string and treats it as the user's local time.
function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

// True iff every interval has the same work value AND the same rest value.
// "FixedTime/DistanceInterval" in Concept2's vocabulary requires uniform
// intervals; anything that varies across reps is VariableInterval.
function intervalsAreUniform(workout: Workout): boolean {
  const { intervals } = workout
  if (intervals.length <= 1) return true
  const first = intervals[0]
  return intervals.every(iv => {
    if (iv.work.kind !== first.work.kind) return false
    if (first.work.kind === 'distance' && iv.work.kind === 'distance' &&
        iv.work.meters !== first.work.meters) return false
    if (first.work.kind === 'duration' && iv.work.kind === 'duration' &&
        iv.work.seconds !== first.work.seconds) return false
    if (iv.rest.kind !== first.rest.kind) return false
    if (first.rest.kind === 'duration' && iv.rest.kind === 'duration' &&
        iv.rest.seconds !== first.rest.seconds) return false
    return true
  })
}

// Maps the app's workout shape to Concept2's workout_type string. The server
// accepts more values (Calorie/WattMinute variants) — we don't emit those.
//
// "rest.kind === 'duration' && seconds > 0" is the check for *actual* rest:
// our builder sometimes stores 'duration' with seconds=0 for "no rest", and
// that's functionally identical to 'none'.
function workoutTypeFor(workout: Workout): Concept2WorkoutType {
  const { intervals } = workout
  if (intervals.length === 0) return 'JustRow'
  const hasActualRest = intervals.some(iv =>
    iv.rest.kind === 'duration' && iv.rest.seconds > 0,
  )
  const allDistance = intervals.every(iv => iv.work.kind === 'distance')
  const allDuration = intervals.every(iv => iv.work.kind === 'duration')

  if (!hasActualRest) {
    if (allDistance) return 'FixedDistanceSplits'
    if (allDuration) return 'FixedTimeSplits'
    return 'VariableInterval'
  }
  if (!intervalsAreUniform(workout)) return 'VariableInterval'
  if (allDistance) return 'FixedDistanceInterval'
  if (allDuration) return 'FixedTimeInterval'
  return 'VariableInterval'
}

export interface BuildUploadArgs {
  workout: Workout
  telemetry: PM5Telemetry
  weightClass: 'H' | 'L'
  // Optional richer telemetry — when present, the upload includes the per-
  // stroke timeline and per-interval breakdown so the Logbook can render the
  // pace graph and intervals table (ErgData-parity view).
  strokes?: PM5StrokeRecord[]
  splits?: PM5SplitRecord[]
  completedAt?: Date
}

// PM5 stroke → Concept2 stroke_data entry. SPM and pace are derived from the
// stroke's drive+recovery period; pace is in tenths of a second per 500m to
// match the top-level `time` field's units.
function strokeToPayload(s: PM5StrokeRecord): Concept2StrokeRecord {
  const periodSec = s.driveTimeSec + s.recoveryTimeSec
  const spm  = periodSec > 0 ? Math.round(60 / periodSec) : 0
  const paceTenths = s.strokeDistanceMeters > 0
    ? Math.round((periodSec * 500 / s.strokeDistanceMeters) * 10)
    : 0
  return {
    t:   Math.max(0, Math.round(s.elapsedSeconds * 10)),
    d:   Math.max(0, Math.round(s.distanceMeters)),
    p:   Math.max(0, paceTenths),
    spm: Math.max(0, spm),
    hr:  0,
  }
}

// Derive avg SPM from per-stroke records instead of trusting 0x0037's
// avgStrokeRate field — the PM we tested against reported 0 there for every
// split, so the Logbook S/M column was always blank.
// Strokes carry the intervalIndex we assigned when capturing them (bumped on
// each per-interval reset in the stroke characteristic).
function computeSpm(
  strokes: PM5StrokeRecord[],
  intervalIdx: number,
  splitTimeSec: number,
): number {
  if (splitTimeSec <= 0) return 0
  const count = strokes.filter(s => s.intervalIndex === intervalIdx).length
  return Math.round((count / splitTimeSec) * 60)
}

function splitToInterval(s: PM5SplitRecord, strokeRate: number): Concept2IntervalRecord {
  const out: Concept2IntervalRecord = {
    distance:    Math.max(0, Math.round(s.splitDistanceMeters)),
    time:        Math.max(0, Math.round(s.splitTimeSec * 10)),
    stroke_rate: Math.max(0, strokeRate),
  }
  if (s.splitRestTimeSec > 0) {
    out.rest_time = Math.round(s.splitRestTimeSec * 10)
  }
  if (s.splitRestDistanceMeters > 0) {
    out.rest_distance = Math.round(s.splitRestDistanceMeters)
  }
  return out
}

// Concept2's /users/me may return weight_class as a code ('H'/'L') or a long
// form ('heavyweight'/'lightweight'). Returns null when neither matches so the
// caller can surface a clear "set this on your Logbook profile" error instead
// of guessing.
export function normalizeWeightClass(raw: string | undefined | null): 'H' | 'L' | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (s === 'h' || s === 'heavyweight') return 'H'
  if (s === 'l' || s === 'lightweight') return 'L'
  return null
}

export function buildUploadPayload({
  workout,
  telemetry,
  weightClass,
  strokes,
  splits,
  completedAt = new Date(),
}: BuildUploadArgs): Concept2ResultPayload {
  // Prefer summing per-split totals when split data is available: the PM5's
  // elapsed counter includes pre-workout setup and any post-workout rowing,
  // which inflates the displayed time vs. what the user actually programmed
  // (e.g. a planned 20+20+30s workout was showing as 1:27 instead of 1:10).
  // Sum-of-splits exactly captures the structured workout and matches what
  // ErgData uploads.
  const haveSplits = !!splits && splits.length > 0
  const totalTimeSec = haveSplits
    ? splits!.reduce((acc, s) => acc + s.splitTimeSec + s.splitRestTimeSec, 0)
    : telemetry.elapsedSeconds
  const totalDistanceM = haveSplits
    ? splits!.reduce((acc, s) => acc + s.splitDistanceMeters + s.splitRestDistanceMeters, 0)
    : telemetry.elapsedMeters

  const timeTenths = Math.max(0, Math.round(totalTimeSec * 10))
  const distanceM  = Math.max(0, Math.round(totalDistanceM))

  const payload: Concept2ResultPayload = {
    type: 'rower',
    date: formatLocalDateTime(completedAt),
    distance: distanceM,
    time: timeTenths,
    weight_class: weightClass,
    workout_type: workoutTypeFor(workout),
  }

  const name = workout.name?.trim()
  if (name) payload.comments = name

  if (splits && splits.length > 0) {
    payload.workout = {
      intervals: splits.map((s, i) => {
        const spm = strokes && strokes.length > 0
          ? computeSpm(strokes, i, s.splitTimeSec)
          : s.avgStrokeRate
        return splitToInterval(s, spm)
      }),
    }
  }
  if (strokes && strokes.length > 0) {
    payload.stroke_data = strokes.map(strokeToPayload)
  }
  return payload
}
