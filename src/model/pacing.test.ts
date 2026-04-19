import { describe, it, expect } from 'vitest'
import {
  powerFromSplit,
  splitFromPower,
  solveSplitForDistance,
  distanceTimeFromSplit,
  fitFromTier,
  fitLinearCPWPrime,
  fitProfile,
  impliedDistanceTime,
  K_C2,
} from './pacing'

describe('power/split round-trip', () => {
  it('splitFromPower(powerFromSplit(s)) === s', () => {
    for (const split of [90, 100, 110, 120, 130]) {
      expect(splitFromPower(powerFromSplit(split))).toBeCloseTo(split, 10)
    }
  })
  it('matches C2 published anchors', () => {
    // 2:00/500m split ≈ 202 W per Concept2 pace/watts calc
    expect(powerFromSplit(120)).toBeCloseTo(202.55, 1)
    // 1:30/500m ≈ 480 W
    expect(powerFromSplit(90)).toBeCloseTo(480.11, 1)
  })
  it('K_C2 equals 350,000,000', () => {
    expect(K_C2).toBe(350_000_000)
  })
})

describe('solveSplitForDistance', () => {
  it('recovers the 2K split when the athlete is exactly defined by P_2K', () => {
    // If we set CP+W'/t_2K = P_2K and solve for the 2K distance, we should
    // recover the 2K split.
    const twoKSplit = 108 // 7:12 pace
    const p2k = powerFromSplit(twoKSplit)
    const cp = 0.88 * p2k
    const wPrime = (p2k - cp) * 432
    const split = solveSplitForDistance(cp, wPrime, 2000)
    expect(split).toBeCloseTo(twoKSplit, 2)
  })
  it('fractional 1K-vs-2K gap is invariant to 2K time at a fixed tier', () => {
    // Mathematical property of CP + W'/t with CP = r*P_2K: the cubic for split
    // becomes r*u^3 + ((1-r)*D_ref/D)*u^2 - 1 = 0 where u = split/split_2K.
    // No dependence on absolute 2K time. This is a non-obvious property worth
    // locking in.
    const fast = fitFromTier(360, 0.88)
    const slow = fitFromTier(450, 0.88)
    const fastGap = (90 - solveSplitForDistance(fast.cpWatts, fast.wPrimeJoules, 1000)) / 90
    const slowGap =
      (112.5 - solveSplitForDistance(slow.cpWatts, slow.wPrimeJoules, 1000)) / 112.5
    expect(fastGap).toBeCloseTo(slowGap, 10)
  })
  it('lower tier (larger W\u2032 fraction) predicts a faster 1K vs 2K', () => {
    // This is the correct "tier matters for distance reps" assertion:
    // a recreational rower (low CP ratio → large W') has more anaerobic
    // reserve relative to aerobic, so their 1K pace is further below 2K pace.
    const twoKSeconds = 420
    const twoKSplit = twoKSeconds / 4
    const elite = fitFromTier(twoKSeconds, 0.93)
    const rec = fitFromTier(twoKSeconds, 0.83)
    const elite1K = solveSplitForDistance(elite.cpWatts, elite.wPrimeJoules, 1000)
    const rec1K = solveSplitForDistance(rec.cpWatts, rec.wPrimeJoules, 1000)
    const eliteGap = twoKSplit - elite1K
    const recGap = twoKSplit - rec1K
    expect(eliteGap).toBeGreaterThan(0)
    expect(recGap).toBeGreaterThan(eliteGap)
  })
})

describe('fitFromTier', () => {
  it('CP equals ratio * P_2K and W\u2032 reconstructs P_2K', () => {
    const { cpWatts, wPrimeJoules } = fitFromTier(420, 0.88) // 7:00 2K
    const p2k = powerFromSplit(105)
    expect(cpWatts).toBeCloseTo(0.88 * p2k, 5)
    // P_2K = CP + W'/t_2K must hold exactly
    expect(cpWatts + wPrimeJoules / 420).toBeCloseTo(p2k, 5)
  })
  it('produces plausible CP/W\u2032 for a 7:00 2K competitive rower', () => {
    const { cpWatts, wPrimeJoules } = fitFromTier(420, 0.88)
    expect(cpWatts).toBeGreaterThan(200)
    expect(cpWatts).toBeLessThan(320)
    expect(wPrimeJoules).toBeGreaterThan(8_000)
    expect(wPrimeJoules).toBeLessThan(25_000)
  })
})

describe('fitLinearCPWPrime', () => {
  it('recovers synthetic (CP, W\u2032) from 3 exact points', () => {
    const CP = 280
    const WP = 18_000
    const points = [60, 420, 1320].map((t) => ({
      powerWatts: CP + WP / t,
      durationSeconds: t,
    }))
    const { cpWatts, wPrimeJoules } = fitLinearCPWPrime(points)
    expect(cpWatts).toBeCloseTo(CP, 4)
    expect(wPrimeJoules).toBeCloseTo(WP, 0)
  })
  it('solves exactly with 2 points (determined system)', () => {
    const CP = 300
    const WP = 20_000
    const points = [60, 420].map((t) => ({
      powerWatts: CP + WP / t,
      durationSeconds: t,
    }))
    const { cpWatts, wPrimeJoules } = fitLinearCPWPrime(points)
    expect(cpWatts).toBeCloseTo(CP, 4)
    expect(wPrimeJoules).toBeCloseTo(WP, 0)
  })
})

describe('fitProfile', () => {
  it('2K-only uses tier', () => {
    const fit = fitProfile({ twoKSeconds: 420, tier: 'competitive' })
    expect(fit.source).toBe('tier')
  })
  it('2K + 6K uses refinement', () => {
    const fit = fitProfile({ twoKSeconds: 420, tier: 'competitive', sixKSeconds: 1350 })
    expect(fit.source).toBe('tier+refinement')
  })
  it('custom tier reported as custom source', () => {
    const fit = fitProfile({ twoKSeconds: 420, tier: 'custom', customCpRatio: 0.9 })
    expect(fit.source).toBe('custom')
  })
  it('decayK scales with aerobic fraction', () => {
    const wc = fitProfile({ twoKSeconds: 420, tier: 'world-class' })
    const comp = fitProfile({ twoKSeconds: 420, tier: 'competitive' })
    const rec = fitProfile({ twoKSeconds: 420, tier: 'recreational' })
    expect(wc.decayK).toBeLessThan(comp.decayK)
    expect(comp.decayK).toBeLessThan(rec.decayK)
    // world-class ratio 0.75 → k = 0.16 × 0.25 = 0.04
    expect(wc.decayK).toBeCloseTo(0.04, 3)
  })
})

describe('impliedDistanceTime', () => {
  it('impliedDistanceTime(2000m) at the fitted profile \u2248 twoKSeconds', () => {
    const fit = fitFromTier(420, 0.88)
    const t = impliedDistanceTime(fit.cpWatts, fit.wPrimeJoules, 2000)
    expect(t).toBeCloseTo(420, 0)
  })
})

describe('distanceTimeFromSplit', () => {
  it('2000m at 1:45 (105s) = 7:00 (420s)', () => {
    expect(distanceTimeFromSplit(105, 2000)).toBe(420)
  })
})
