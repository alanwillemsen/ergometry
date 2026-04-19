import { TIER_DEFS, DEFAULT_CUSTOM_CP_RATIO, DEFAULT_CUSTOM_PEAK_RATIO, type Tier } from './tiers'

// Concept2's published relation: watts = 2.80 / (pace_in_seconds_per_meter)^3
// With split expressed as seconds per 500m: pace = split/500, so
//   watts = 2.80 * 500^3 / split^3 = K / split^3, K = 350,000,000
export const K_C2 = 2.80 * 500 ** 3

export function powerFromSplit(splitSecondsPer500m: number): number {
  return K_C2 / splitSecondsPer500m ** 3
}

export function splitFromPower(powerWatts: number): number {
  return Math.cbrt(K_C2 / powerWatts)
}

export function distanceTimeFromSplit(splitSeconds: number, meters: number): number {
  return (meters * splitSeconds) / 500
}

// Solve for the split an athlete (CP, W') would hold over `meters`, assuming
// a single all-out effort with no partial recovery. Derivation:
//   P = K / split^3   and   P = CP + W'/t   and   t = D*split/500
// => CP * split^3 + (500*W'/D) * split^2 - K = 0
// Newton iteration converges in <10 steps from any reasonable start.
export function solveSplitForDistance(
  cpWatts: number,
  wPrimeJoules: number,
  meters: number,
  initialSplit = 110, // ~1:50
): number {
  const a = cpWatts
  const b = (500 * wPrimeJoules) / meters
  let x = initialSplit
  for (let i = 0; i < 60; i++) {
    const f = a * x ** 3 + b * x ** 2 - K_C2
    const fp = 3 * a * x ** 2 + 2 * b * x
    const dx = f / fp
    x -= dx
    if (Math.abs(dx) < 1e-9) break
  }
  return x
}

// Morton 3-param: solve K/s^3 = CP + W'_M/(D*s/500 + k) for the split s of a
// single all-out effort over `meters`. Morton places a finite P_peak asymptote
// at t→0, so unlike the 2-param CP+W'/t curve it doesn't blow up at short
// distances and can serve as the physiological ceiling without a flat cap.
// Newton iteration on s.
export function solveSplitForDistanceMorton(
  cpWatts: number,
  wPrimeMortonJoules: number,
  kSeconds: number,
  meters: number,
  initialSplit = 110,
): number {
  let x = initialSplit
  for (let i = 0; i < 80; i++) {
    const t = (meters * x) / 500
    const denom = t + kSeconds
    const f = K_C2 / x ** 3 - cpWatts - wPrimeMortonJoules / denom
    // df/dx = -3K/x^4 - dP/dx; dP/dx = -W'_M · (meters/500) / (t+k)^2
    const fp = -3 * K_C2 / x ** 4 + (wPrimeMortonJoules * (meters / 500)) / denom ** 2
    const dx = f / fp
    x -= dx
    if (Math.abs(dx) < 1e-9) break
  }
  return x
}

// Morton P(t) evaluated at a known duration (for time-based work phases).
export function mortonPowerAtDuration(
  cpWatts: number,
  wPrimeMortonJoules: number,
  kSeconds: number,
  seconds: number,
): number {
  return cpWatts + wPrimeMortonJoules / (seconds + kSeconds)
}

export interface AthleteProfile {
  twoKSeconds: number
  tier: Tier
  customCpRatio?: number
  sixKSeconds?: number
  restPowerWatts?: number
}

export interface FittedProfile {
  cpWatts: number
  /** Skiba 2-param W' used by the W'bal simulator for interval dynamics. */
  wPrimeJoules: number
  /**
   * Morton 3-param W', paired with kSeconds below. Used only for the
   * short-duration ceiling P(t) = CP + W'_M/(t+k); it's larger than
   * wPrimeJoules by a factor (t_2K+k)/t_2K.
   */
  wPrimeMortonJoules: number
  /**
   * Morton time offset (seconds). Sets P_peak = CP + W'_M/k at t→0:
   *   k = t_2K · (1 − r) / (peakRatio − 1)
   * where r = CP/P_2K. Smaller k → higher peak, steeper curve at short t.
   */
  kSeconds: number
  /**
   * Long-duration CP decay coefficient (log10 form), scaled by the athlete's
   * aerobic fraction so less-aerobic athletes fade more on 30+ min efforts:
   *   k = 0.16 · (1 − CP/P_2K)
   * Anchored at world-class (ratio 0.75, k = 0.04 — matches Jensen 60').
   */
  decayK: number
  source: 'tier' | 'tier+refinement' | 'custom'
}

const DECAY_COEFF = 0.16
export function decayKForRatio(cpRatio: number): number {
  return DECAY_COEFF * Math.max(0, 1 - cpRatio)
}

export function cpRatioForTier(tier: Tier, customCpRatio?: number): number {
  if (tier === 'custom') return customCpRatio ?? DEFAULT_CUSTOM_CP_RATIO
  return TIER_DEFS[tier].cpRatio
}

export function peakRatioForTier(tier: Tier): number {
  if (tier === 'custom') return DEFAULT_CUSTOM_PEAK_RATIO
  return TIER_DEFS[tier].peakRatio
}

// Morton k from tier ratios: k = t_2K · (1−r) / (rp−1).
// Derived so P(t_2K) = P_2K and P(0) = rp·P_2K both hold exactly.
export function mortonKFromRatios(
  twoKSeconds: number,
  cpRatio: number,
  peakRatio: number,
): number {
  return (twoKSeconds * (1 - cpRatio)) / (peakRatio - 1)
}

// Derive CP and W' from a single (P_2K, t_2K) point plus a tier-implied CP ratio.
// CP = ratio * P_2K; W' follows exactly from P_2K = CP + W'/t_2K.
export function fitFromTier(
  twoKSeconds: number,
  cpRatio: number,
): { cpWatts: number; wPrimeJoules: number } {
  const twoKSplit = twoKSeconds / 4
  const p2k = powerFromSplit(twoKSplit)
  const cp = cpRatio * p2k
  const wPrime = (p2k - cp) * twoKSeconds
  return { cpWatts: cp, wPrimeJoules: wPrime }
}

// Least-squares fit of P = CP + W'/t to N >= 2 (P, t) points.
// Linear in (CP, W') with design columns [1, 1/t]. Closed-form normal equations.
export function fitLinearCPWPrime(
  points: Array<{ powerWatts: number; durationSeconds: number }>,
): { cpWatts: number; wPrimeJoules: number } {
  let sumInvT = 0,
    sumInvT2 = 0,
    sumP = 0,
    sumPInvT = 0
  const n = points.length
  for (const p of points) {
    const invT = 1 / p.durationSeconds
    sumInvT += invT
    sumInvT2 += invT * invT
    sumP += p.powerWatts
    sumPInvT += p.powerWatts * invT
  }
  const det = n * sumInvT2 - sumInvT * sumInvT
  const cp = (sumInvT2 * sumP - sumInvT * sumPInvT) / det
  const wPrime = (n * sumPInvT - sumInvT * sumP) / det
  return { cpWatts: cp, wPrimeJoules: wPrime }
}

export function fitProfile(profile: AthleteProfile): FittedProfile {
  const ratio = cpRatioForTier(profile.tier, profile.customCpRatio)
  const peakRatio = peakRatioForTier(profile.tier)
  const twoKSplit = profile.twoKSeconds / 4
  const p2k = powerFromSplit(twoKSplit)

  let cpWatts: number
  let wPrimeJoules: number
  let cpRatioActual: number
  let source: FittedProfile['source']

  if (profile.sixKSeconds !== undefined) {
    const split6k = profile.sixKSeconds / 12
    const points = [
      { powerWatts: p2k, durationSeconds: profile.twoKSeconds },
      { powerWatts: powerFromSplit(split6k), durationSeconds: profile.sixKSeconds },
    ]
    const fit = fitLinearCPWPrime(points)
    cpWatts = fit.cpWatts
    wPrimeJoules = fit.wPrimeJoules
    cpRatioActual = cpWatts / p2k
    source = profile.tier === 'custom' ? 'custom' : 'tier+refinement'
  } else {
    const fit = fitFromTier(profile.twoKSeconds, ratio)
    cpWatts = fit.cpWatts
    wPrimeJoules = fit.wPrimeJoules
    cpRatioActual = ratio
    source = profile.tier === 'custom' ? 'custom' : 'tier'
  }

  // Morton ceiling params: W'_M is sized so that P(t_2K) = P_2K exactly using
  // the same CP. The peakRatio is taken from the tier (not re-fitted from 6K),
  // since a single additional 6K point doesn't constrain the sprint end.
  const kSeconds = mortonKFromRatios(profile.twoKSeconds, cpRatioActual, peakRatio)
  const wPrimeMortonJoules = (p2k - cpWatts) * (profile.twoKSeconds + kSeconds)

  return {
    cpWatts,
    wPrimeJoules,
    wPrimeMortonJoules,
    kSeconds,
    decayK: decayKForRatio(cpRatioActual),
    source,
  }
}

// Time an athlete covers `meters` at their CP/W' optimal pace (no rest).
export function impliedDistanceTime(cpWatts: number, wPrimeJoules: number, meters: number): number {
  const split = solveSplitForDistance(cpWatts, wPrimeJoules, meters)
  return distanceTimeFromSplit(split, meters)
}
