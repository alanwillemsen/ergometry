import { describe, it, expect } from 'vitest'
import { simulateWorkout, predictWorkout, computeIntervalBounds } from './wprime'
import type { Workout, WorkoutInterval } from './workouts'
import { bandPower, fitProfile, powerFromSplit } from './pacing'

const CP = 300
const WP = 20_000

function w(name: string, intervals: Workout['intervals']): Workout {
  return { id: name, name, intervals }
}

// Helper: expand a count-based interval spec into N individual intervals.
function rep(n: number, interval: WorkoutInterval): WorkoutInterval[] {
  return Array.from({ length: n }, () => ({ ...interval }))
}

describe('simulateWorkout', () => {
  it('P = CP with no rest drains nothing (starts at W\u2032_max)', () => {
    const workout = w('10min at CP', [
      { work: { kind: 'duration', seconds: 600 }, rest: { kind: 'none' } },
    ])
    const sim = simulateWorkout(workout, CP, CP, WP)
    expect(sim.finalWbal).toBeCloseTo(WP, 2)
    expect(sim.minWbal).toBeCloseTo(WP, 2)
  })

  it('P above CP with no rest exhausts in W\u2032/(P-CP) seconds', () => {
    const P = 400
    const expectedExhaustion = WP / (P - CP) // 200s
    const workout = w('all-out', [
      { work: { kind: 'duration', seconds: expectedExhaustion }, rest: { kind: 'none' } },
    ])
    const sim = simulateWorkout(workout, P, CP, WP)
    expect(sim.finalWbal).toBeCloseTo(0, 1)
  })

  it('recovery at P=0 for τ seconds recovers ~63% of gap', () => {
    const P_burn = 400
    const burnTime = WP / 2 / (P_burn - CP) // 100s
    const tau = 546 * Math.exp(-0.01 * CP) + 316
    const workout = w('burn+rest', [
      { work: { kind: 'duration', seconds: burnTime }, rest: { kind: 'duration', seconds: tau } },
      { work: { kind: 'duration', seconds: 0.001 }, rest: { kind: 'none' } }, // dummy tail
    ])
    const sim = simulateWorkout(workout, P_burn, CP, WP, 0)
    const expected = WP - (WP / 2) * Math.exp(-1)
    expect(sim.finalWbal).toBeCloseTo(expected, 0)
  })
})

describe('predictWorkout', () => {
  it('2K all-out (W=2000m, no rest) predicts a pace near the defining 2K', () => {
    const p2k = powerFromSplit(105)
    const cp = 0.88 * p2k
    const wp = (p2k - cp) * 420
    const workout = w('2K', [
      { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'none' } },
    ])
    const pred = predictWorkout(workout, cp, wp, undefined, 0)
    expect(pred.avgSplitSeconds).toBeCloseTo(105, 1)
    expect(pred.totalWorkSeconds).toBeCloseTo(420, 0)
  })

  it('4x2K @ 5\u2032 rest is slower than a single 2K', () => {
    const cp = 280
    const wp = 20_000
    const single = predictWorkout(
      w('2K', [{ work: { kind: 'distance', meters: 2000 }, rest: { kind: 'none' } }]),
      cp,
      wp,
    )
    const four = predictWorkout(
      w(
        '4x2K',
        rep(4, { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'duration', seconds: 300 } }),
      ),
      cp,
      wp,
    )
    expect(four.avgSplitSeconds).toBeGreaterThan(single.avgSplitSeconds)
  })

  it('monotonicity: more rest at same work → faster pace', () => {
    const cp = 280
    const wp = 20_000
    const mkInt = (restSec: number) =>
      w(
        '4x1K',
        rep(4, { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: restSec } }),
      )
    const short = predictWorkout(mkInt(60), cp, wp)
    const long = predictWorkout(mkInt(300), cp, wp)
    expect(long.avgSplitSeconds).toBeLessThan(short.avgSplitSeconds)
  })

  it('monotonicity: more reps at same rest → slower pace', () => {
    const cp = 280
    const wp = 20_000
    const mkInt = (count: number) =>
      w(
        `${count}x1K`,
        rep(count, { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: 180 } }),
      )
    const two = predictWorkout(mkInt(2), cp, wp)
    const six = predictWorkout(mkInt(6), cp, wp)
    expect(six.avgSplitSeconds).toBeGreaterThan(two.avgSplitSeconds)
  })

  it('20x 1\u2032/1\u2032 lands within a couple seconds of 2K pace', () => {
    const p2k = powerFromSplit(108) // 7:12 2K
    const cp = 0.88 * p2k
    const wp = (p2k - cp) * 432
    const pred = predictWorkout(
      w(
        '20x1\u2032/1\u2032',
        rep(20, { work: { kind: 'duration', seconds: 60 }, rest: { kind: 'duration', seconds: 60 } }),
      ),
      cp,
      wp,
    )
    expect(Math.abs(pred.avgSplitSeconds - 108)).toBeLessThan(3)
  })

  it('long-duration decay shifts 60\u2032 toward Jensen\u2019s 76% P_2K for world-class', () => {
    const p2k = powerFromSplit(86.25) // 5:45 2K
    const cp = 0.75 * p2k
    const wp = (p2k - cp) * 345
    const pred = predictWorkout(
      w('60\u2032', [
        { work: { kind: 'duration', seconds: 3600 }, rest: { kind: 'none' } },
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
    const p2k = powerFromSplit(105) // 7:00 2K
    const mk = (ratio: number, k: number) => {
      const cp = ratio * p2k
      const wp = (p2k - cp) * 420
      return predictWorkout(
        w('60\u2032', [
          { work: { kind: 'duration', seconds: 3600 }, rest: { kind: 'none' } },
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
    const recFade = recreational.avgSplitSeconds - 105
    const wcFade2 = worldClass.avgSplitSeconds - 105
    expect(recFade).toBeGreaterThan(wcFade2)
    expect(wcFade).toBeGreaterThan(-1)
  })
  it('decay does not affect sub-20-min workouts', () => {
    const cp = 280
    const wp = 20_000
    const pred = predictWorkout(
      w('6K', [{ work: { kind: 'distance', meters: 6000 }, rest: { kind: 'none' } }]),
      cp,
      wp,
    )
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
    const cp = 280
    const wp = 20_000
    const single = predictWorkout(
      w(
        '4x10\u2032',
        rep(4, { work: { kind: 'duration', seconds: 600 }, rest: { kind: 'duration', seconds: 120 } }),
      ),
      cp,
      wp,
    )
    const P = powerFromSplit(single.avgSplitSeconds)
    expect(P).toBeGreaterThan(cp)
  })
  it('10x 1\u2032/1\u2032 (half the reps) predicts a faster pace than 20x', () => {
    const p2k = powerFromSplit(108)
    const cp = 0.88 * p2k
    const wp = (p2k - cp) * 432
    const ten = predictWorkout(
      w(
        '10x1\u2032/1\u2032',
        rep(10, { work: { kind: 'duration', seconds: 60 }, rest: { kind: 'duration', seconds: 60 } }),
      ),
      cp,
      wp,
    )
    const twenty = predictWorkout(
      w(
        '20x1\u2032/1\u2032',
        rep(20, { work: { kind: 'duration', seconds: 60 }, rest: { kind: 'duration', seconds: 60 } }),
      ),
      cp,
      wp,
    )
    expect(ten.avgSplitSeconds).toBeLessThan(twenty.avgSplitSeconds)
  })
})

describe('predictWorkout — mixed intervals', () => {
  const CP = 280
  const WP = 20_000

  it('two identical 5\u2032 intervals match a single 2×5\u2032 block', () => {
    const split2 = w('1+1 x 5\u2032', [
      { work: { kind: 'duration', seconds: 300 }, rest: { kind: 'duration', seconds: 10 } },
      { work: { kind: 'duration', seconds: 300 }, rest: { kind: 'none' } },
    ])
    const dup = w(
      '2 x 5\u2032',
      rep(2, { work: { kind: 'duration', seconds: 300 }, rest: { kind: 'duration', seconds: 10 } }),
    )
    const a = predictWorkout(split2, CP, WP)
    const b = predictWorkout(dup, CP, WP)
    expect(a.avgSplitSeconds).toBeCloseTo(b.avgSplitSeconds, 1)
    expect(a.perIntervalSplitsSeconds[0]).toBeCloseTo(a.avgSplitSeconds, 1)
    expect(a.perIntervalSplitsSeconds[1]).toBeCloseTo(a.avgSplitSeconds, 1)
    expect(a.totalMeters).toBeCloseTo(b.totalMeters, 0)
  })

  it('mixed pyramid: short intervals get harder splits than long intervals', () => {
    // 2×2K + 4×500m: the 500s should be paced harder than the 2Ks.
    const mixed = w('2x2K + 4x500m', [
      ...rep(2, { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'duration', seconds: 300 } }),
      ...rep(4, { work: { kind: 'distance', meters: 500 }, rest: { kind: 'duration', seconds: 120 } }),
    ])
    const pred = predictWorkout(mixed, CP, WP)
    const split2k = pred.perIntervalSplitsSeconds[0]
    const split500 = pred.perIntervalSplitsSeconds[2]
    expect(split500).toBeLessThan(split2k)
    // 500s bounded above by their solo-set pace
    const solo500 = predictWorkout(
      w(
        'solo500',
        rep(4, { work: { kind: 'distance', meters: 500 }, rest: { kind: 'duration', seconds: 120 } }),
      ),
      CP,
      WP,
    )
    expect(split500).toBeGreaterThanOrEqual(solo500.avgSplitSeconds - 0.1)
  })

  it('locking an interval forces its end-of-work W\u2032 to the target', () => {
    const workout = w(
      '4x2K',
      rep(4, { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'duration', seconds: 300 } }),
    )
    workout.intervals[1].lockedWbalPercent = 60
    const pred = predictWorkout(workout, CP, WP)
    expect(pred.perIntervalWbalPercent[1]).toBeCloseTo(60, 0)
  })

  it('locking the first interval at 100% pins pace to CP (AT-band equivalent)', () => {
    // Starting at full W' and targeting full W' at end means the effort is
    // power-neutral — any P <= CP holds at W'_max. The solver should pick CP
    // (matching the AT band) rather than an arbitrary near-zero power.
    const workout = w('2K locked 100', [
      { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'none' }, lockedWbalPercent: 100 },
    ])
    const pred = predictWorkout(workout, CP, WP)
    expect(powerFromSplit(pred.avgSplitSeconds)).toBeCloseTo(CP, 0)
  })

  it('lower lock target forces earlier intervals to push harder', () => {
    const base = w(
      '3x1K',
      rep(3, { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: 180 } }),
    )
    const easy = { ...base, intervals: base.intervals.map((iv) => ({ ...iv })) }
    easy.intervals[1].lockedWbalPercent = 70
    const hard = { ...base, intervals: base.intervals.map((iv) => ({ ...iv })) }
    hard.intervals[1].lockedWbalPercent = 30
    const easyPred = predictWorkout(easy, CP, WP)
    const hardPred = predictWorkout(hard, CP, WP)
    // Lower W' target at interval 1 means faster pace on intervals 0 and 1
    expect(hardPred.perIntervalSplitsSeconds[0]).toBeLessThan(easyPred.perIntervalSplitsSeconds[0])
    expect(hardPred.perIntervalSplitsSeconds[1]).toBeLessThan(easyPred.perIntervalSplitsSeconds[1])
  })

  it('tail intervals after the last lock still use the minWbal=0 criterion', () => {
    const workout = w(
      '4x1K',
      rep(4, { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: 180 } }),
    )
    workout.intervals[0].lockedWbalPercent = 80
    const pred = predictWorkout(workout, CP, WP)
    // Last interval should exhaust W' — perIntervalWbalPercent[3] ≈ 0
    expect(pred.perIntervalWbalPercent[3]).toBeGreaterThanOrEqual(-0.1)
    expect(pred.perIntervalWbalPercent[3]).toBeLessThan(1)
  })

  it('locks at both ends partition into independent sub-problems', () => {
    const workout = w(
      '4x1K',
      rep(4, { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: 180 } }),
    )
    workout.intervals[0].lockedWbalPercent = 75
    workout.intervals[2].lockedWbalPercent = 25
    const pred = predictWorkout(workout, CP, WP)
    expect(pred.perIntervalWbalPercent[0]).toBeCloseTo(75, 0)
    expect(pred.perIntervalWbalPercent[2]).toBeCloseTo(25, 0)
  })

  it('computeIntervalBounds returns min ≤ max, both within [0, 100]', () => {
    const workout = w(
      '4x2K',
      rep(4, { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'duration', seconds: 300 } }),
    )
    const bounds = computeIntervalBounds(workout, 1, CP, WP)
    expect(bounds.minPct).toBeGreaterThanOrEqual(0)
    expect(bounds.maxPct).toBeLessThanOrEqual(100)
    expect(bounds.minPct).toBeLessThanOrEqual(bounds.maxPct)
  })

  // Competitive 7:00 rower, fitted via the app's own profile pipeline so CP,
  // W', Morton W'_M and k are all internally consistent (rp=1.8, r=0.70).
  const comp = fitProfile({ twoKSeconds: 420, tier: 'competitive' })

  it('bandPower: UT2/UT1/AT are 0.75/0.90/1.00 of CP', () => {
    expect(bandPower('UT2', comp.cpWatts)).toBeCloseTo(0.75 * comp.cpWatts, 6)
    expect(bandPower('UT1', comp.cpWatts)).toBeCloseTo(0.90 * comp.cpWatts, 6)
    expect(bandPower('AT', comp.cpWatts)).toBeCloseTo(comp.cpWatts, 6)
  })

  it('banded interval pins power to its band value, independent of W′ room', () => {
    const expectedUT2 = 0.75 * comp.cpWatts
    const expectedUT1 = 0.90 * comp.cpWatts
    const expectedAT = comp.cpWatts

    const workout = w('4x2K banded', [
      { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'duration', seconds: 300 }, band: 'UT2' },
      { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'duration', seconds: 300 }, band: 'UT1' },
      { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'duration', seconds: 300 }, band: 'AT' },
      { work: { kind: 'distance', meters: 2000 }, rest: { kind: 'none' }, band: 'UT2' },
    ])
    const pred = predictWorkout(
      workout,
      comp.cpWatts,
      comp.wPrimeJoules,
      undefined,
      0,
      0,
      comp.wPrimeMortonJoules,
      comp.kSeconds,
    )
    expect(powerFromSplit(pred.perIntervalSplitsSeconds[0])).toBeCloseTo(expectedUT2, 0)
    expect(powerFromSplit(pred.perIntervalSplitsSeconds[1])).toBeCloseTo(expectedUT1, 0)
    expect(powerFromSplit(pred.perIntervalSplitsSeconds[2])).toBeCloseTo(expectedAT, 0)
    expect(powerFromSplit(pred.perIntervalSplitsSeconds[3])).toBeCloseTo(expectedUT2, 0)
  })

  it('UT2 band recovers W′ — even many reps stay near full', () => {
    const workout = w(
      '10x5′ UT2',
      rep(10, { work: { kind: 'duration', seconds: 300 }, rest: { kind: 'duration', seconds: 60 }, band: 'UT2' }),
    )
    const pred = predictWorkout(
      workout,
      comp.cpWatts,
      comp.wPrimeJoules,
      undefined,
      0,
      0,
      comp.wPrimeMortonJoules,
      comp.kSeconds,
    )
    // At 0.75·CP, W' rebuilds during work — every interval ends near full W'.
    for (const pct of pred.perIntervalWbalPercent) {
      expect(pct).toBeGreaterThan(95)
    }
  })

  it('mixed band + unbanded: banded interval pinned, unbanded pace responds', () => {
    // 3×1K where the middle rep is banded AT; the two unbanded reps should be
    // paced above CP (harder than AT) to use up remaining W' safely.
    const workout = w('3x1K mixed', [
      { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: 180 } },
      { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: 180 }, band: 'AT' },
      { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'none' } },
    ])
    const pred = predictWorkout(
      workout,
      comp.cpWatts,
      comp.wPrimeJoules,
      undefined,
      0,
      0,
      comp.wPrimeMortonJoules,
      comp.kSeconds,
    )
    // Middle rep pinned at CP.
    expect(powerFromSplit(pred.perIntervalSplitsSeconds[1])).toBeCloseTo(comp.cpWatts, 0)
    // Flanking reps above CP (they have W' to spend before and after the AT rep).
    expect(powerFromSplit(pred.perIntervalSplitsSeconds[0])).toBeGreaterThan(comp.cpWatts)
    expect(powerFromSplit(pred.perIntervalSplitsSeconds[2])).toBeGreaterThan(comp.cpWatts)
  })

  it('per-interval + avg split are numerically consistent with total meters/time', () => {
    const mixed = w('pyramid', [
      ...rep(2, { work: { kind: 'distance', meters: 1000 }, rest: { kind: 'duration', seconds: 180 } }),
      ...rep(5, { work: { kind: 'duration', seconds: 60 }, rest: { kind: 'duration', seconds: 60 } }),
    ])
    const pred = predictWorkout(mixed, CP, WP)
    // Reconstruct totals from per-interval splits
    let totalM = 0
    let totalS = 0
    for (let i = 0; i < mixed.intervals.length; i++) {
      const iv = mixed.intervals[i]
      const s = pred.perIntervalSplitsSeconds[i]
      if (iv.work.kind === 'distance') {
        totalM += iv.work.meters
        totalS += (iv.work.meters * s) / 500
      } else {
        totalS += iv.work.seconds
        totalM += (500 * iv.work.seconds) / s
      }
    }
    expect(pred.totalMeters).toBeCloseTo(totalM, 0)
    expect(pred.totalWorkSeconds).toBeCloseTo(totalS, 0)
    expect(pred.avgSplitSeconds).toBeCloseTo((totalS / totalM) * 500, 2)
  })
})
