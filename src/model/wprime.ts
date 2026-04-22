import type { Workout, WorkoutPrediction, WorkoutInterval } from './workouts'
import { bandPower, mortonPowerAtDuration, powerFromSplit, solveSplitForDistanceMorton, splitFromPower } from './pacing'

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

// Lower bound for recovery-regime bisection. Avoids P=0 (which makes
// splitFromPower return ∞ and distance intervals run for infinite time)
// while staying well inside the recovery branch.
const MIN_RECOVERY_POWER = 1

// Upper bound for the recovery regime's usable range. At P=CP exactly, the
// split equals CP-pace — the same pace produced at the drain-regime boundary
// (P=CP+ε). Snapping the slider to that point makes "first valid non-zero"
// indistinguishable from the drain point. Cap the recovery band at 2% below
// CP so the first recovery-side value lands on a meaningfully slower split.
const RECOVERY_BOUNDARY_FACTOR = 0.98

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

  for (let i = 0; i < workout.intervals.length; i++) {
    const interval = workout.intervals[i]
    const p = Array.isArray(workPower) ? workPower[i] : workPower
    const workSplit = splitFromPower(p)
    let workSec: number
    let workMeters: number
    if (interval.work.kind === 'distance') {
      workMeters = interval.work.meters
      workSec = (workMeters * workSplit) / 500
    } else {
      workSec = interval.work.seconds
      workMeters = (500 * workSec) / workSplit
    }
    phases.push({ power: p, seconds: workSec, meters: workMeters, isWork: true })

    const isLast = i === workout.intervals.length - 1
    if (!isLast && interval.rest.kind !== 'none') {
      let restSec: number
      let restMeters: number
      if (interval.rest.kind === 'distance') {
        restMeters = interval.rest.meters
        restSec = (restMeters * restSplit) / 500
      } else {
        restSec = interval.rest.seconds
        restMeters = (500 * restSec) / restSplit
      }
      phases.push({ power: restPower, seconds: restSec, meters: restMeters, isWork: false })
    }
  }
  return phases
}

export interface SimResult {
  finalWbal: number
  minWbal: number
  totalSeconds: number
  totalMeters: number
  perIntervalSplitSeconds: number[]
  perIntervalWbal: number[]
}

export function simulateWorkout(
  workout: Workout,
  workPower: number | number[],
  cpWatts: number,
  wPrimeJoules: number,
  restPower = DEFAULT_REST_POWER,
  decayK = 0,
  initialWbal = wPrimeJoules,
): SimResult {
  const phases = expandPhases(workout, workPower, restPower)
  let wbal = initialWbal
  let minWbal = wbal
  let totalSec = 0
  let totalMeters = 0
  let workPhaseElapsed = 0 // resets on any rest phase; feeds the CP decay
  const perIntervalSplit: number[] = []
  const perIntervalWbal: number[] = []

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
      perIntervalSplit.push((phase.seconds / phase.meters) * 500)
      perIntervalWbal.push(wbal)
    }
    totalSec += phase.seconds
    totalMeters += phase.meters
  }

  return {
    finalWbal: wbal,
    minWbal,
    totalSeconds: totalSec,
    totalMeters,
    perIntervalSplitSeconds: perIntervalSplit,
    perIntervalWbal,
  }
}

// Per-interval Morton ceiling: the physiological max power the athlete can
// hold for a single interval of that length. Replaces the old flat pMax cap —
// for short reps this naturally rises toward P_peak, for long reps it merges
// with the CP + W'/t curve (so 2K+ predictions are unchanged).
function mortonCeilingForInterval(
  interval: WorkoutInterval,
  cpWatts: number,
  wPrimeMortonJoules: number,
  kSeconds: number,
): number {
  if (interval.work.kind === 'distance') {
    const split = solveSplitForDistanceMorton(
      cpWatts,
      wPrimeMortonJoules,
      kSeconds,
      interval.work.meters,
    )
    return powerFromSplit(split)
  }
  return mortonPowerAtDuration(cpWatts, wPrimeMortonJoules, kSeconds, interval.work.seconds)
}

// Bisection bounds. Lower must be a guaranteed-sustainable power; with CP
// decay on long pieces, even CP can be infeasible, so we drop the floor to
// CP × 0.5. Upper is the per-interval Morton ceiling when Morton params are
// given; otherwise a large finite fallback (for tests that don't provide them).
function bisectPower(
  workout: Workout,
  cpWatts: number,
  wPrimeJoules: number,
  restPower: number,
  safetyJoules: number,
  decayK: number,
  wPrimeMortonJoules = Infinity,
  kSeconds = 0,
  initialWbal = wPrimeJoules,
): number {
  const interval = workout.intervals[0]
  const ceilingW =
    isFinite(wPrimeMortonJoules) && interval !== undefined
      ? mortonCeilingForInterval(interval, cpWatts, wPrimeMortonJoules, kSeconds)
      : cpWatts + wPrimeJoules
  let lo = cpWatts * 0.5
  let hi = ceilingW
  for (let iter = 0; iter < 80; iter++) {
    const mid = (lo + hi) / 2
    const sim = simulateWorkout(workout, mid, cpWatts, wPrimeJoules, restPower, decayK, initialWbal)
    if (sim.minWbal < safetyJoules) hi = mid
    else lo = mid
    if (hi - lo < 0.01) break
  }
  return lo
}

// Bisect a single-interval sub-problem's power such that the end-of-work W'
// equals a target. Used when the last interval of a sub-problem is locked.
//
// finalWbal(P) is piecewise monotonic with a discontinuity at P = CP:
//   - drain branch (P > CP):   finalWbal ∈ (−∞, initialWbal], decreasing in P
//   - recovery branch (P ≤ CP): finalWbal ∈ [CP-limit, P=0-limit], decreasing in P
//     (the CP-limit here is typically well above initialWbal for long intervals)
// Bisect in each branch, then return whichever gets closer to the target.
// When the target lies in the gap between the two branches, the chosen P
// still gives the closest achievable value and the UI flags the mismatch.
function bisectPowerForTarget(
  subWorkout: Workout,
  cpWatts: number,
  wPrimeJoules: number,
  restPower: number,
  decayK: number,
  wPrimeMortonJoules: number,
  kSeconds: number,
  initialWbal: number,
  targetWbal: number,
): number {
  const interval = subWorkout.intervals[0]
  const ceilingW =
    isFinite(wPrimeMortonJoules) && interval !== undefined
      ? mortonCeilingForInterval(interval, cpWatts, wPrimeMortonJoules, kSeconds)
      : cpWatts + wPrimeJoules

  const run = (p: number) =>
    simulateWorkout(subWorkout, p, cpWatts, wPrimeJoules, restPower, decayK, initialWbal).finalWbal

  // Drain branch search (P > CP).
  let drainLo = cpWatts + 0.01
  let drainHi = ceilingW
  for (let iter = 0; iter < 80; iter++) {
    const mid = (drainLo + drainHi) / 2
    if (run(mid) > targetWbal) drainLo = mid
    else drainHi = mid
    if (drainHi - drainLo < 0.01) break
  }
  const drainP = (drainLo + drainHi) / 2

  // Recovery branch search (MIN_RECOVERY_POWER ≤ P ≤ CP·factor). finalWbal decreases in P here.
  let recLo = MIN_RECOVERY_POWER
  let recHi = cpWatts * RECOVERY_BOUNDARY_FACTOR
  for (let iter = 0; iter < 80; iter++) {
    const mid = (recLo + recHi) / 2
    if (run(mid) > targetWbal) recLo = mid
    else recHi = mid
    if (recHi - recLo < 0.01) break
  }
  const recP = (recLo + recHi) / 2

  const drainGap = Math.abs(run(drainP) - targetWbal)
  const recGap = Math.abs(run(recP) - targetWbal)

  // P = CP sits at the drain/recovery boundary: finalWbal ≈ initialWbal (no
  // drain, trivial recovery). When the target is essentially at that boundary
  // — e.g. a first interval locked at 100% — both bisections converge to
  // endpoints (CP+ε or MIN_RECOVERY_POWER) that happen to match numerically
  // but produce wildly different splits. Include CP as a third candidate so
  // a 100% lock lands on AT-band pace instead of a near-zero power.
  const cpGap = Math.abs(run(cpWatts) - targetWbal)
  let bestP = cpWatts
  let bestGap = cpGap
  if (drainGap < bestGap) {
    bestP = drainP
    bestGap = drainGap
  }
  if (recGap < bestGap) {
    bestP = recP
  }
  return bestP
}

// Simulate just a rest phase starting from a given W'.
function applyRestPhase(
  interval: WorkoutInterval,
  startWbal: number,
  cpWatts: number,
  wPrimeJoules: number,
  restPower: number,
): number {
  if (interval.rest.kind === 'none') return startWbal
  const restSec =
    interval.rest.kind === 'distance'
      ? (interval.rest.meters * splitFromPower(Math.max(restPower, 1))) / 500
      : interval.rest.seconds
  if (restSec <= 0) return startWbal
  let wbal = startWbal
  const nSteps = Math.max(1, Math.ceil(restSec))
  const dt = restSec / nSteps
  for (let s = 0; s < nSteps; s++) {
    if (restPower > cpWatts) {
      wbal -= (restPower - cpWatts) * dt
    } else {
      const tau = 546 * Math.exp(-0.01 * (cpWatts - restPower)) + 316
      const gap = wPrimeJoules - wbal
      wbal += gap * (1 - Math.exp(-dt / tau))
    }
  }
  return wbal
}

// Compute the achievable range of end-of-work W' for the interval at
// `targetIdx`, given the existing locks on earlier intervals.
//
// Returns bounds in percent of W'_max (0–100):
//   minPct / maxPct   — overall achievable extremes (clamped to [0, 100])
//   drainMaxPct       — upper end of the drain-regime reachable set (P > CP)
//   recoveryMinPct    — lower end of the recovery-regime reachable set (P ≤ CP)
// When recoveryMinPct − drainMaxPct > 0, the interval has a "forbidden zone"
// between them that no single constant pace can hit.
export function computeIntervalBounds(
  workout: Workout,
  targetIdx: number,
  cpWatts: number,
  wPrimeJoules: number,
  restPower = DEFAULT_REST_POWER,
  decayK = 0,
  wPrimeMortonJoules = Infinity,
  kSeconds = 0,
): { minPct: number; maxPct: number; drainMaxPct: number; recoveryMinPct: number } {
  // Walk earlier locks to determine segStart / segStartWbal for the
  // sub-problem that ends at targetIdx.
  let segStart = 0
  let segStartWbal = wPrimeJoules
  for (let i = 0; i < targetIdx; i++) {
    const lockPct = workout.intervals[i].lockedWbalPercent
    if (typeof lockPct === 'number' && lockPct >= 0 && lockPct <= 100) {
      const postWork = (lockPct / 100) * wPrimeJoules
      segStartWbal = applyRestPhase(
        workout.intervals[i],
        postWork,
        cpWatts,
        wPrimeJoules,
        restPower,
      )
      segStart = i + 1
    }
  }

  const subIntervals = workout.intervals.slice(segStart, targetIdx + 1)
  const subWorkout: Workout = { id: `${workout.id}-bounds`, name: 'b', intervals: subIntervals }

  // Banded intervals have fixed power; their contribution is constant across
  // all four strategies below, shrinking the achievable W' range at targetIdx
  // accordingly.
  const subBandPowers = subIntervals.map((iv) =>
    iv.band ? bandPower(iv.band, cpWatts) : undefined,
  )

  // Max: all unbanded work at MIN_RECOVERY_POWER (deep in recovery branch).
  // Gives the maximum W' achievable at the end.
  const lazyPowers = subIntervals.map((_, i) => subBandPowers[i] ?? MIN_RECOVERY_POWER)
  const lazySim = simulateWorkout(
    subWorkout,
    lazyPowers,
    cpWatts,
    wPrimeJoules,
    restPower,
    decayK,
    segStartWbal,
  )
  const maxWbal = lazySim.finalWbal

  // Recovery-regime minimum: all unbanded work at P just below CP (the
  // practical lower bound of visibly-slower-than-CP pacing).
  const recMinPowers = subIntervals.map((_, i) => subBandPowers[i] ?? cpWatts * RECOVERY_BOUNDARY_FACTOR)
  const recMinSim = simulateWorkout(
    subWorkout,
    recMinPowers,
    cpWatts,
    wPrimeJoules,
    restPower,
    decayK,
    segStartWbal,
  )
  const recoveryMinWbal = recMinSim.finalWbal

  // Drain-regime maximum: unbanded work just above CP (tiny drain per interval).
  const drainMaxPowers = subIntervals.map((_, i) => subBandPowers[i] ?? cpWatts + 0.01)
  const drainMaxSim = simulateWorkout(
    subWorkout,
    drainMaxPowers,
    cpWatts,
    wPrimeJoules,
    restPower,
    decayK,
    segStartWbal,
  )
  const drainMaxWbal = drainMaxSim.finalWbal

  // Hardest: each unbanded interval at its solo-max; banded stay pinned.
  const hardPowers = subIntervals.map((iv, i) => {
    if (subBandPowers[i] !== undefined) return subBandPowers[i]!
    const solo: Workout = { id: 'solo', name: 'solo', intervals: [iv] }
    return bisectPower(
      solo,
      cpWatts,
      wPrimeJoules,
      restPower,
      0,
      decayK,
      wPrimeMortonJoules,
      kSeconds,
    )
  })
  const hardSim = simulateWorkout(
    subWorkout,
    hardPowers,
    cpWatts,
    wPrimeJoules,
    restPower,
    decayK,
    segStartWbal,
  )
  const minWbal = hardSim.finalWbal

  return {
    minPct: Math.max(0, (minWbal / wPrimeJoules) * 100),
    maxPct: Math.min(100, (maxWbal / wPrimeJoules) * 100),
    drainMaxPct: Math.max(0, Math.min(100, (drainMaxWbal / wPrimeJoules) * 100)),
    recoveryMinPct: Math.max(0, Math.min(100, (recoveryMinWbal / wPrimeJoules) * 100)),
  }
}

// Solve a sub-problem of one or more intervals.
// Criterion:
//   - { type: 'target', wbal } → last interval's end-of-work W' = wbal
//   - { type: 'safety', joules } → minWbal across the sub-problem ≥ joules
// Returns per-interval powers.
type SubCriterion = { type: 'target'; wbal: number } | { type: 'safety'; joules: number }

function solveSubProblem(
  subWorkout: Workout,
  cpWatts: number,
  wPrimeJoules: number,
  restPower: number,
  decayK: number,
  wPrimeMortonJoules: number,
  kSeconds: number,
  initialWbal: number,
  criterion: SubCriterion,
  // Banded intervals have a fixed power (from bandPower). Unbanded entries are
  // undefined. Parallel to subWorkout.intervals.
  subBandPowers?: (number | undefined)[],
): number[] {
  const N = subWorkout.intervals.length
  const bands = subBandPowers ?? new Array<number | undefined>(N).fill(undefined)

  if (N === 1) {
    if (bands[0] !== undefined) return [bands[0]!]
    if (criterion.type === 'target') {
      return [
        bisectPowerForTarget(
          subWorkout,
          cpWatts,
          wPrimeJoules,
          restPower,
          decayK,
          wPrimeMortonJoules,
          kSeconds,
          initialWbal,
          criterion.wbal,
        ),
      ]
    }
    return [
      bisectPower(
        subWorkout,
        cpWatts,
        wPrimeJoules,
        restPower,
        criterion.joules,
        decayK,
        wPrimeMortonJoules,
        kSeconds,
        initialWbal,
      ),
    ]
  }

  // If every interval in the sub-problem is banded, powers are fully determined
  // and α has no effect — no need to bisect.
  if (bands.every((b) => b !== undefined)) {
    return bands.map((b) => b!)
  }

  // Multi-interval sub-problem: compute each unbanded interval's solo-max (at
  // full W') as a reference, then bisect a shared α on unbanded intervals only.
  // Banded intervals stay pinned to their band power across all α values.
  const soloPowers = subWorkout.intervals.map((iv, idx) => {
    if (bands[idx] !== undefined) return bands[idx]! // placeholder; unused for banded
    const solo: Workout = { id: `${subWorkout.id}-solo`, name: 'solo', intervals: [iv] }
    return bisectPower(
      solo,
      cpWatts,
      wPrimeJoules,
      restPower,
      0,
      decayK,
      wPrimeMortonJoules,
      kSeconds,
    )
  })

  // α parameterization that spans both regimes (for unbanded intervals):
  //   α ∈ [0, 1]:   recovery regime, P_i mapped from MIN_RECOVERY_POWER → CP·factor
  //   α ∈ (1, 2]:   drain regime,    P_i = CP + (α−1)·(solo_i − CP) (CP → solo)
  // finalWbal(α) is decreasing in each half with a discontinuity at α = 1.
  const recoveryCap = cpWatts * RECOVERY_BOUNDARY_FACTOR
  const powersForAlpha = (alpha: number): number[] => {
    if (alpha <= 1) {
      const p = MIN_RECOVERY_POWER + alpha * (recoveryCap - MIN_RECOVERY_POWER)
      return soloPowers.map((_sp, i) => (bands[i] !== undefined ? bands[i]! : p))
    }
    return soloPowers.map((sp, i) => {
      if (bands[i] !== undefined) return bands[i]!
      return cpWatts + (alpha - 1) * (sp - cpWatts)
    })
  }

  const runPowers = (powers: number[]) =>
    simulateWorkout(subWorkout, powers, cpWatts, wPrimeJoules, restPower, decayK, initialWbal)

  if (criterion.type === 'safety') {
    // Standard minWbal ≥ safety. Higher α → lower minWbal (monotonic in drain
    // half; recovery half only makes minWbal larger, so search drain half).
    let aLo = 1
    let aHi = 2
    for (let iter = 0; iter < 80; iter++) {
      const mid = (aLo + aHi) / 2
      const sim = runPowers(powersForAlpha(mid))
      if (sim.minWbal < criterion.joules) aHi = mid
      else aLo = mid
      if (aHi - aLo < 1e-5) break
    }
    return powersForAlpha(aLo)
  }

  // Target criterion: bisect in each half, return the α whose finalWbal is
  // closer to the target. When target is in the forbidden gap, this yields
  // the closest achievable value; the UI surfaces the mismatch.
  const target = criterion.wbal

  let dLo = 1.001 // just above the discontinuity
  let dHi = 2
  for (let iter = 0; iter < 80; iter++) {
    const mid = (dLo + dHi) / 2
    if (runPowers(powersForAlpha(mid)).finalWbal > target) dLo = mid
    else dHi = mid
    if (dHi - dLo < 1e-5) break
  }
  const dPowers = powersForAlpha((dLo + dHi) / 2)
  const dGap = Math.abs(runPowers(dPowers).finalWbal - target)

  let rLo = 0
  let rHi = 1
  for (let iter = 0; iter < 80; iter++) {
    const mid = (rLo + rHi) / 2
    if (runPowers(powersForAlpha(mid)).finalWbal > target) rLo = mid
    else rHi = mid
    if (rHi - rLo < 1e-5) break
  }
  const rPowers = powersForAlpha((rLo + rHi) / 2)
  const rGap = Math.abs(runPowers(rPowers).finalWbal - target)

  return dGap <= rGap ? dPowers : rPowers
}

/**
 * Find per-interval work-powers that maximize effort while keeping W'bal
 * feasible over the whole workout.
 *
 * Two-stage algorithm:
 *   1. For each interval, solve its standalone max power p_i^solo (interval
 *      alone starting with full W'). Short/hard reps have large (p_i^solo −
 *      CP), long reps have small excess.
 *   2. Bisect on a shared scalar α ∈ [0, 1]:
 *        p_i(α) = CP + α · (p_i^solo − CP)
 *      At α=1 every interval runs at its solo max — only feasible if rests
 *      fully recover W' between intervals. Smaller α scales all intervals'
 *      excess down uniformly, so a 500m still runs harder than a 2K, mirroring
 *      how coaches actually prescribe mixed sets.
 *
 * Reduces to a single bisection when there is only one interval.
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
  const N = workout.intervals.length

  // Pre-compute band powers for every interval. Banded intervals get a fixed
  // power derived directly from CP; α-scaling skips them.
  const bandPowers: (number | undefined)[] = workout.intervals.map((iv) =>
    iv.band ? bandPower(iv.band, cpWatts) : undefined,
  )

  // Partition intervals into sub-problems at lock boundaries. Each sub-problem
  // either ends with a lock (criterion: hit target W') or is the unlocked tail
  // (criterion: minWbal ≥ safety). Adjacent sub-problems carry W' across the
  // locked interval's rest phase.
  const finalPowers: number[] = new Array(N)
  let segStart = 0
  let segStartWbal = wPrimeJoules

  for (let i = 0; i < N; i++) {
    const lockPct = workout.intervals[i].lockedWbalPercent
    const hasLock = typeof lockPct === 'number' && lockPct >= 0 && lockPct <= 100
    const isTail = i === N - 1 && !hasLock
    if (!hasLock && !isTail) continue

    const subIntervals = workout.intervals.slice(segStart, i + 1)
    const subWorkout: Workout = { id: `${workout.id}-sub${segStart}`, name: 'sub', intervals: subIntervals }
    const subBandPowers = bandPowers.slice(segStart, i + 1)

    const criterion: SubCriterion = hasLock
      ? { type: 'target', wbal: (lockPct! / 100) * wPrimeJoules }
      : { type: 'safety', joules: safetyJoules }

    const subPowers = solveSubProblem(
      subWorkout,
      cpWatts,
      wPrimeJoules,
      restPower,
      decayK,
      wPrimeMortonJoules,
      kSeconds,
      segStartWbal,
      criterion,
      subBandPowers,
    )
    for (let j = 0; j < subPowers.length; j++) {
      finalPowers[segStart + j] = subPowers[j]
    }

    if (hasLock) {
      // Carry wbal across the locked interval's rest phase (if any) to the
      // next sub-problem's starting point.
      const postWork = (lockPct! / 100) * wPrimeJoules
      segStartWbal = applyRestPhase(
        workout.intervals[i],
        postWork,
        cpWatts,
        wPrimeJoules,
        restPower,
      )
      segStart = i + 1
    }
  }

  const sim = simulateWorkout(workout, finalPowers, cpWatts, wPrimeJoules, restPower, decayK)

  // Compute total WORK meters/time (for display) — excludes rests
  let totalWorkMeters = 0
  let totalWorkSeconds = 0
  const perIntervalSplits: number[] = []
  for (let i = 0; i < workout.intervals.length; i++) {
    const interval = workout.intervals[i]
    const split = splitFromPower(finalPowers[i])
    perIntervalSplits.push(split)
    if (interval.work.kind === 'distance') {
      totalWorkMeters += interval.work.meters
      totalWorkSeconds += (interval.work.meters * split) / 500
    } else {
      totalWorkSeconds += interval.work.seconds
      totalWorkMeters += (500 * interval.work.seconds) / split
    }
  }
  const avgSplit =
    totalWorkMeters > 0
      ? (totalWorkSeconds / totalWorkMeters) * 500
      : splitFromPower(finalPowers[0])

  const perIntervalWbalPercent = sim.perIntervalWbal.map((w) => (w / wPrimeJoules) * 100)

  return {
    avgSplitSeconds: avgSplit,
    perIntervalSplitsSeconds: perIntervalSplits,
    totalWorkSeconds,
    totalMeters: totalWorkMeters,
    finalWPrimeJoules: sim.finalWbal,
    perIntervalWbalPercent,
  }
}
