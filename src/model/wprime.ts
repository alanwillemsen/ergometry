import type { Workout, WorkoutSegment } from './workouts'
import { mortonPowerAtDuration, powerFromSplit, solveSplitForDistanceMorton, splitFromPower } from './pacing'

/**
 * Skiba integral W'bal model:
 *   Above CP: W'bal drops at rate (P - CP) J/s
 *   Below CP: W'bal recovers exponentially toward W'_max with
 *     τ = 546·exp(-0.01·D_CP) + 316 seconds, D_CP = CP − P_current
 *   Continuous-time solution over a step dt:
 *     work: W'bal ← W'bal - (P - CP)·dt
 *     rest: W'bal ← W'_max + (W'bal - W'_max)·exp(-dt/τ)
 */

export const DEFAULT_REST_POWER = 100

// Long-duration CP decay. The pure CP + W'/t curve overstates sustainable
// power beyond ~20 min (a 60' piece predicts ~80% of P_2K whereas Jensen's
// empirical data puts it at 76%). Apply a phase-local log decay:
//   CP_eff(t_phase) = CP · (1 − k · log10(t_phase / DECAY_ONSET_S))
// The decay is reset whenever a rest phase begins (so intervals are
// untouched; only uninterrupted efforts beyond 20 min see any change).
// `k` is carried on the fitted profile (see `decayKForRatio` in pacing.ts)
// so less-aerobic athletes fade more on 30+ min pieces.
export const DECAY_ONSET_S = 1200

function effectiveCp(cpWatts: number, phaseElapsedS: number, decayK: number): number {
  if (phaseElapsedS <= DECAY_ONSET_S || decayK <= 0) return cpWatts
  return cpWatts * (1 - decayK * Math.log10(phaseElapsedS / DECAY_ONSET_S))
}

interface Phase {
  power: number
  seconds: number
  meters: number
  isWork: boolean
}

function expandPhases(
  workout: Workout,
  workPower: number | number[],
  restPower: number,
): Phase[] {
  const restSplit = splitFromPower(Math.max(restPower, 1))
  const phases: Phase[] = []

  for (let segIdx = 0; segIdx < workout.segments.length; segIdx++) {
    const seg = workout.segments[segIdx]
    const segPower = Array.isArray(workPower) ? workPower[segIdx] : workPower
    const workSplit = splitFromPower(segPower)
    for (let i = 0; i < seg.count; i++) {
      let workSec: number
      let workMeters: number
      if (seg.work.kind === 'distance') {
        workMeters = seg.work.meters
        workSec = (workMeters * workSplit) / 500
      } else {
        workSec = seg.work.seconds
        workMeters = (500 * workSec) / workSplit
      }
      phases.push({ power: segPower, seconds: workSec, meters: workMeters, isWork: true })

      const isLastRep = segIdx === workout.segments.length - 1 && i === seg.count - 1
      if (!isLastRep && seg.rest.kind !== 'none') {
        let restSec: number
        let restMeters: number
        if (seg.rest.kind === 'distance') {
          restMeters = seg.rest.meters
          restSec = (restMeters * restSplit) / 500
        } else {
          restSec = seg.rest.seconds
          restMeters = (500 * restSec) / restSplit
        }
        phases.push({
          power: restPower,
          seconds: restSec,
          meters: restMeters,
          isWork: false,
        })
      }
    }
  }
  return phases
}

export interface SimResult {
  finalWbal: number
  minWbal: number
  totalSeconds: number
  totalMeters: number
  perRepSplitSeconds: number[]
}

export function simulateWorkout(
  workout: Workout,
  workPower: number | number[],
  cpWatts: number,
  wPrimeJoules: number,
  restPower = DEFAULT_REST_POWER,
  decayK = 0,
): SimResult {
  const phases = expandPhases(workout, workPower, restPower)
  let wbal = wPrimeJoules
  let minWbal = wbal
  let totalSec = 0
  let totalMeters = 0
  let workPhaseElapsed = 0 // resets on any rest phase; feeds the CP decay
  const perRepSplit: number[] = []

  for (const phase of phases) {
    if (!phase.isWork) workPhaseElapsed = 0
    // Sub-second integration for very short phases (e.g. 20s sprints)
    const nSteps = Math.max(1, Math.ceil(phase.seconds))
    const dt = phase.seconds / nSteps
    for (let s = 0; s < nSteps; s++) {
      const cpEff = phase.isWork
        ? effectiveCp(cpWatts, workPhaseElapsed + dt / 2, decayK)
        : cpWatts
      if (phase.power > cpEff) {
        wbal -= (phase.power - cpEff) * dt
      } else {
        const tau = 546 * Math.exp(-0.01 * (cpEff - phase.power)) + 316
        const gap = wPrimeJoules - wbal
        wbal += gap * (1 - Math.exp(-dt / tau))
      }
      if (phase.isWork) workPhaseElapsed += dt
      if (wbal < minWbal) minWbal = wbal
    }
    if (phase.isWork && phase.meters > 0) {
      perRepSplit.push((phase.seconds / phase.meters) * 500)
    }
    totalSec += phase.seconds
    totalMeters += phase.meters
  }

  return {
    finalWbal: wbal,
    minWbal,
    totalSeconds: totalSec,
    totalMeters,
    perRepSplitSeconds: perRepSplit,
  }
}

// Per-rep Morton ceiling: the physiological max power the athlete can hold for
// a single rep of the segment's length. Replaces the old flat pMax cap — for
// short reps this naturally rises toward P_peak, for long reps it merges with
// the CP + W'/t curve (so 2K+ predictions are unchanged).
function mortonCeilingForSegment(
  seg: WorkoutSegment,
  cpWatts: number,
  wPrimeMortonJoules: number,
  kSeconds: number,
): number {
  if (seg.work.kind === 'distance') {
    const split = solveSplitForDistanceMorton(
      cpWatts,
      wPrimeMortonJoules,
      kSeconds,
      seg.work.meters,
    )
    return powerFromSplit(split)
  }
  return mortonPowerAtDuration(cpWatts, wPrimeMortonJoules, kSeconds, seg.work.seconds)
}

// Bisection bounds. Lower must be a guaranteed-sustainable power; with CP
// decay on long pieces, even CP can be infeasible, so we drop the floor to
// CP × 0.5. Upper is the per-rep Morton ceiling when Morton params are given;
// otherwise a large finite fallback (for tests that don't provide them).
function bisectPower(
  workout: Workout,
  cpWatts: number,
  wPrimeJoules: number,
  restPower: number,
  safetyJoules: number,
  decayK: number,
  wPrimeMortonJoules = Infinity,
  kSeconds = 0,
): number {
  const seg = workout.segments[0]
  const ceilingW =
    isFinite(wPrimeMortonJoules) && seg !== undefined
      ? mortonCeilingForSegment(seg, cpWatts, wPrimeMortonJoules, kSeconds)
      : cpWatts + wPrimeJoules
  let lo = cpWatts * 0.5
  let hi = ceilingW
  for (let iter = 0; iter < 80; iter++) {
    const mid = (lo + hi) / 2
    const sim = simulateWorkout(workout, mid, cpWatts, wPrimeJoules, restPower, decayK)
    if (sim.minWbal < safetyJoules) hi = mid
    else lo = mid
    if (hi - lo < 0.01) break
  }
  return lo
}

/**
 * Find per-segment work-powers that maximize effort while keeping W'bal
 * feasible over the whole workout.
 *
 * Two-stage algorithm:
 *   1. For each segment, solve its standalone max power p_i^solo (segment alone
 *      starting with full W'). Short/hard reps have large (p_i^solo − CP),
 *      long reps have small excess.
 *   2. Bisect on a shared scalar α ∈ [0, 1]:
 *        p_i(α) = CP + α · (p_i^solo − CP)
 *      At α=1 every segment runs at its solo max — only feasible if rests
 *      fully recover W' between segments. Smaller α scales all segments'
 *      excess down uniformly, so the pace on a 500m stays harder than the
 *      pace on a 2K, mirroring how coaches actually prescribe mixed sets.
 *
 * Reduces to a single bisection (the original algorithm) when there is only
 * one segment.
 */
export function predictWorkout(
  workout: Workout,
  cpWatts: number,
  wPrimeJoules: number,
  restPower = DEFAULT_REST_POWER,
  safetyJoules = 0,
  decayK = 0,
  wPrimeMortonJoules = Infinity,
  kSeconds = 0,
): WorkoutPrediction {
  const N = workout.segments.length
  let finalPowers: number[]

  if (N <= 1) {
    finalPowers = [
      bisectPower(
        workout,
        cpWatts,
        wPrimeJoules,
        restPower,
        safetyJoules,
        decayK,
        wPrimeMortonJoules,
        kSeconds,
      ),
    ]
  } else {
    const soloPowers = workout.segments.map((seg) => {
      const solo: Workout = { id: `${workout.id}-solo`, name: 'solo', segments: [seg] }
      return bisectPower(
        solo,
        cpWatts,
        wPrimeJoules,
        restPower,
        safetyJoules,
        decayK,
        wPrimeMortonJoules,
        kSeconds,
      )
    })

    // Bisect on α. Monotonic for typical workouts (all soloPowers > CP):
    // larger α → higher per-segment power → more W' drain → lower minWbal.
    let aLo = 0
    let aHi = 1
    for (let iter = 0; iter < 80; iter++) {
      const mid = (aLo + aHi) / 2
      const powers = soloPowers.map((sp) => cpWatts + mid * (sp - cpWatts))
      const sim = simulateWorkout(workout, powers, cpWatts, wPrimeJoules, restPower, decayK)
      if (sim.minWbal < safetyJoules) aHi = mid
      else aLo = mid
      if (aHi - aLo < 1e-5) break
    }
    finalPowers = soloPowers.map((sp) => cpWatts + aLo * (sp - cpWatts))
  }

  const sim = simulateWorkout(workout, finalPowers, cpWatts, wPrimeJoules, restPower, decayK)

  // Compute total WORK meters/time (for display) — excludes rests
  let totalWorkMeters = 0
  let totalWorkSeconds = 0
  const perSegmentSplits: number[] = []
  for (let i = 0; i < workout.segments.length; i++) {
    const seg = workout.segments[i]
    const segSplit = splitFromPower(finalPowers[i])
    perSegmentSplits.push(segSplit)
    for (let r = 0; r < seg.count; r++) {
      if (seg.work.kind === 'distance') {
        totalWorkMeters += seg.work.meters
        totalWorkSeconds += (seg.work.meters * segSplit) / 500
      } else {
        totalWorkSeconds += seg.work.seconds
        totalWorkMeters += (500 * seg.work.seconds) / segSplit
      }
    }
  }
  const avgSplit =
    totalWorkMeters > 0
      ? (totalWorkSeconds / totalWorkMeters) * 500
      : splitFromPower(finalPowers[0])

  return {
    avgSplitSeconds: avgSplit,
    perRepSplitsSeconds: sim.perRepSplitSeconds,
    perSegmentSplitsSeconds: perSegmentSplits,
    totalWorkSeconds,
    totalMeters: totalWorkMeters,
    finalWPrimeJoules: sim.finalWbal,
  }
}
