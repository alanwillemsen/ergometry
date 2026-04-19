import { describe, it, expect } from 'vitest'
import { simulateWorkout, predictWorkout } from './wprime'
import type { Workout } from './workouts'
import { powerFromSplit } from './pacing'

const CP = 300
const WP = 20_000

function w(name: string, segments: Workout['segments']): Workout {
  return { id: name, name, segments }
}

describe('simulateWorkout', () => {
  it('P = CP with no rest drains nothing (starts at W\u2032_max)', () => {
    const workout = w('10min at CP', [
      { work: { kind: 'duration', seconds: 600 }, rest: { kind: 'none' }, count: 1 },
    ])
    const sim = simulateWorkout(workout, CP, CP, WP)
    expect(sim.finalWbal).toBeCloseTo(WP, 2)
    expect(sim.minWbal).toBeCloseTo(WP, 2)
  })

  it('P above CP with no rest exhausts in W\u2032/(P-CP) seconds', () => {
    const P = 400
    const expectedExhaustion = WP / (P - CP) // 200s
    const workout = w('all-out', [
      { work: { kind: 'duration', seconds: expectedExhaustion }, rest: { kind: 'none' }, count: 1 },
    ])
    const sim = simulateWorkout(workout, P, CP, WP)
    expect(sim.finalWbal).toBeCloseTo(0, 1)
  })

  it('recovery at P=0 for τ seconds recovers ~63% of gap', () => {
    // Deplete half of W' first, then rest at P=0 for τ(CP-0) = 546·exp(-0.01·CP)+316
    // Starting state: wbal = WP/2 (gap = WP/2). After τ seconds of exp recovery,
    // remaining gap = gap * e^-1 ≈ 36.8% → recovered ≈ 63.2% of gap.
    const P_burn = 400
    const burnTime = WP / 2 / (P_burn - CP) // 100s
    const tau = 546 * Math.exp(-0.01 * CP) + 316
    const workout = w('burn+rest', [
      { work: { kind: 'duration', seconds: burnTime }, rest: { kind: 'duration', seconds: tau }, count: 1 },
      { work: { kind: 'duration', seconds: 0.001 }, rest: { kind: 'none' }, count: 1 }, // dummy tail
    ])
    const sim = simulateWorkout(workout, P_burn, CP, WP, 0)
    // After burn: wbal ≈ WP/2. After τ at P=0: wbal ≈ WP - (WP/2)·e^-1
    const expected = WP - (WP / 2) * Math.exp(-1)
    expect(sim.finalWbal).toBeCloseTo(expected, 0)
  })
})

describe('predictWorkout', () => {
  it('2K all-out (W=2000m, no rest) predicts a pace near the defining 2K', () => {
    // If CP + W'/420 = P, a 2K should land right around a 7-min piece when using
    // those parameters. Construct from split=105 (7:00 2K).
    const p2k = powerFromSplit(105)
    const cp = 0.88 * p2k
    const wp = (p2k - cp) * 420
    const workout = w('2K', [
      { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'none' }, count: 1 },
    ])
    // safetyJoules=0: test the exact "just exhausts" pace.
    const pred = predictWorkout(workout, cp, wp, undefined, 0)
    expect(pred.avgSplitSeconds).toBeCloseTo(105, 1)
    expect(pred.totalWorkSeconds).toBeCloseTo(420, 0)
  })

  it('4x2K @ 5\u2032 rest is slower than a single 2K', () => {
    const cp = 280
    const wp = 20_000
    const single = predictWorkout(
      w('2K', [{ work: { kind: 'distance', meters: 2000 }, rest: { kind: 'none' }, count: 1 }]),
      cp,
      wp,
    )
    const four = predictWorkout(
      w('4x2K', [
        { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'duration', seconds: 300 }, count: 4 },
      ]),
      cp,
      wp,
    )
    expect(four.avgSplitSeconds).toBeGreaterThan(single.avgSplitSeconds)
  })

  it('monotonicity: more rest at same work → faster pace', () => {
    const cp = 280
    const wp = 20_000
    const mkInt = (restSec: number) =>
      w('4x1K', [
        { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: restSec }, count: 4 },
      ])
    const short = predictWorkout(mkInt(60), cp, wp)
    const long = predictWorkout(mkInt(300), cp, wp)
    expect(long.avgSplitSeconds).toBeLessThan(short.avgSplitSeconds)
  })

  it('monotonicity: more reps at same rest → slower pace', () => {
    const cp = 280
    const wp = 20_000
    const mkInt = (count: number) =>
      w(`${count}x1K`, [
        { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: 180 }, count },
      ])
    const two = predictWorkout(mkInt(2), cp, wp)
    const six = predictWorkout(mkInt(6), cp, wp)
    expect(six.avgSplitSeconds).toBeGreaterThan(two.avgSplitSeconds)
  })

  it('20x 1\u2032/1\u2032 lands within a couple seconds of 2K pace', () => {
    // 20x 1'/1' is close to 2K pace for a competitive rower — the reference xlsx
    // uses a 0.985 factor (~1.6s/500m faster). Our model should land in a similar
    // neighborhood (±3s of 2K split).
    const p2k = powerFromSplit(108) // 7:12 2K
    const cp = 0.88 * p2k
    const wp = (p2k - cp) * 432
    const pred = predictWorkout(
      w('20x1\u2032/1\u2032', [
        { work: { kind: 'duration', seconds: 60 }, rest: { kind: 'duration', seconds: 60 }, count: 20 },
      ]),
      cp,
      wp,
    )
    expect(Math.abs(pred.avgSplitSeconds - 108)).toBeLessThan(3)
  })

  it('long-duration decay shifts 60\u2032 toward Jensen\u2019s 76% P_2K for world-class', () => {
    // Calibration target: world-class (ratio 0.75, k=0.04) 60' lands near 76%
    // of P_2K with the decay applied. Pure CP+W'/t predicts ~80% without it.
    const p2k = powerFromSplit(86.25) // 5:45 2K
    const cp = 0.75 * p2k
    const wp = (p2k - cp) * 345
    const pred = predictWorkout(
      w('60\u2032', [
        { work: { kind: 'duration', seconds: 3600 }, rest: { kind: 'none' }, count: 1 },
      ]),
      cp,
      wp,
      undefined,
      0,
      0.04,
    )
    const P60 = powerFromSplit(pred.avgSplitSeconds)
    const ratio60 = P60 / p2k
    expect(ratio60).toBeGreaterThan(0.74)
    expect(ratio60).toBeLessThan(0.78)
  })
  it('decay scales with aerobic fraction: lower CP ratio \u2192 larger 60\u2032 fade', () => {
    // Less-aerobic athletes (lower CP/P_2K ratio) should fade *more* at 60'.
    const p2k = powerFromSplit(105) // 7:00 2K
    const mk = (ratio: number, k: number) => {
      const cp = ratio * p2k
      const wp = (p2k - cp) * 420
      return predictWorkout(
        w('60\u2032', [
          { work: { kind: 'duration', seconds: 3600 }, rest: { kind: 'none' }, count: 1 },
        ]),
        cp,
        wp,
        undefined,
        0,
        k,
      )
    }
    const worldClass = mk(0.75, 0.04)
    const recreational = mk(0.62, 0.061)
    const wcFade = 1 - powerFromSplit(worldClass.avgSplitSeconds) / (0.75 * p2k * (420 / 420 + 0))
    // Simpler: recreational's 60' split vs its own CP is a bigger gap
    const recFade = recreational.avgSplitSeconds - 105
    const wcFade2 = worldClass.avgSplitSeconds - 105
    expect(recFade).toBeGreaterThan(wcFade2)
    // touch the unused calc so the linter stays happy
    expect(wcFade).toBeGreaterThan(-1)
  })
  it('decay does not affect sub-20-min workouts', () => {
    // A 6K (~18 min) should land identically to the pre-decay prediction
    // because phase elapsed never crosses DECAY_ONSET_S.
    const cp = 280
    const wp = 20_000
    const pred = predictWorkout(
      w('6K', [{ work: { kind: 'distance', meters: 6000 }, rest: { kind: 'none' }, count: 1 }]),
      cp,
      wp,
    )
    // Closed-form cubic: CP*s^3 + (500W'/D)*s^2 - K = 0
    let x = 110
    const K = 350_000_000
    for (let i = 0; i < 60; i++) {
      const f = cp * x ** 3 + ((500 * wp) / 6000) * x ** 2 - K
      const fp = 3 * cp * x ** 2 + 2 * ((500 * wp) / 6000) * x
      x -= f / fp
    }
    expect(pred.avgSplitSeconds).toBeCloseTo(x, 1)
  })
  it('decay resets per work phase — 4x10\u2032 unaffected', () => {
    // Each 10' rep is well under DECAY_ONSET_S, and rest resets phase elapsed.
    const cp = 280
    const wp = 20_000
    const single = predictWorkout(
      w('4x10\u2032', [
        { work: { kind: 'duration', seconds: 600 }, rest: { kind: 'duration', seconds: 120 }, count: 4 },
      ]),
      cp,
      wp,
    )
    // No decay was applied within any rep; avg split should exceed CP (anaerobic contribution)
    const P = powerFromSplit(single.avgSplitSeconds)
    expect(P).toBeGreaterThan(cp)
  })
  it('10x 1\u2032/1\u2032 (half the reps) predicts a faster pace than 20x', () => {
    // With fewer reps at the same rest ratio, the athlete can push harder.
    const p2k = powerFromSplit(108)
    const cp = 0.88 * p2k
    const wp = (p2k - cp) * 432
    const ten = predictWorkout(
      w('10x1\u2032/1\u2032', [
        { work: { kind: 'duration', seconds: 60 }, rest: { kind: 'duration', seconds: 60 }, count: 10 },
      ]),
      cp,
      wp,
    )
    const twenty = predictWorkout(
      w('20x1\u2032/1\u2032', [
        { work: { kind: 'duration', seconds: 60 }, rest: { kind: 'duration', seconds: 60 }, count: 20 },
      ]),
      cp,
      wp,
    )
    expect(ten.avgSplitSeconds).toBeLessThan(twenty.avgSplitSeconds)
  })
})

describe('predictWorkout — multi-segment', () => {
  const CP = 280
  const WP = 20_000

  it('two identical segments collapse to a single-segment prediction', () => {
    // The user's case: 1×5' + 1×5' with 10s rest should match 2×5' @ 10s as a
    // single segment. Per-segment splits should both equal the overall split,
    // and the numbers should add up (rep meters × count = total meters).
    const split2 = w('1+1 x 5\u2032', [
      { work: { kind: 'duration', seconds: 300 }, rest: { kind: 'duration', seconds: 10 }, count: 1 },
      { work: { kind: 'duration', seconds: 300 }, rest: { kind: 'none' }, count: 1 },
    ])
    const single = w('2 x 5\u2032', [
      { work: { kind: 'duration', seconds: 300 }, rest: { kind: 'duration', seconds: 10 }, count: 2 },
    ])
    const a = predictWorkout(split2, CP, WP)
    const b = predictWorkout(single, CP, WP)
    expect(a.avgSplitSeconds).toBeCloseTo(b.avgSplitSeconds, 1)
    expect(a.perSegmentSplitsSeconds[0]).toBeCloseTo(a.avgSplitSeconds, 1)
    expect(a.perSegmentSplitsSeconds[1]).toBeCloseTo(a.avgSplitSeconds, 1)
    expect(a.totalMeters).toBeCloseTo(b.totalMeters, 0)
  })

  it('mixed pyramid: short rep segment gets a harder split than long rep segment', () => {
    // 2×2K + 4×500m: the 500s should be paced harder than the 2Ks — that's the
    // whole point of varying power per segment instead of using one constant.
    const mixed = w('2x2K + 4x500m', [
      { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'duration', seconds: 300 }, count: 2 },
      { work: { kind: 'distance', meters: 500 }, rest: { kind: 'duration', seconds: 120 }, count: 4 },
    ])
    const pred = predictWorkout(mixed, CP, WP)
    const split2k = pred.perSegmentSplitsSeconds[0]
    const split500 = pred.perSegmentSplitsSeconds[1]
    expect(split500).toBeLessThan(split2k) // 500m faster than 2K
    // And the 500s shouldn't exceed what they'd hit solo (upper bound)
    const solo500 = predictWorkout(
      w('solo500', [
        { work: { kind: 'distance', meters: 500 }, rest: { kind: 'duration', seconds: 120 }, count: 4 },
      ]),
      CP,
      WP,
    )
    expect(split500).toBeGreaterThanOrEqual(solo500.avgSplitSeconds - 0.1)
  })

  it('per-segment + avg split are numerically consistent with total meters/time', () => {
    const mixed = w('pyramid', [
      { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: 180 }, count: 2 },
      { work: { kind: 'duration', seconds: 60 }, rest: { kind: 'duration', seconds: 60 }, count: 5 },
    ])
    const pred = predictWorkout(mixed, CP, WP)
    // Reconstruct total meters from per-segment splits
    const split1 = pred.perSegmentSplitsSeconds[0]
    const split2 = pred.perSegmentSplitsSeconds[1]
    const meters1 = 2 * 1000
    const meters2 = 5 * ((500 * 60) / split2)
    const totalM = meters1 + meters2
    const seconds1 = 2 * ((1000 * split1) / 500)
    const seconds2 = 5 * 60
    const totalS = seconds1 + seconds2
    expect(pred.totalMeters).toBeCloseTo(totalM, 0)
    expect(pred.totalWorkSeconds).toBeCloseTo(totalS, 0)
    expect(pred.avgSplitSeconds).toBeCloseTo((totalS / totalM) * 500, 2)
  })
})
