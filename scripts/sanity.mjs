import { fitProfile } from '../src/model/pacing.ts'
import { predictWorkout } from '../src/model/wprime.ts'

const workouts = [
  { id: '2k', name: '2K', segments: [{ work: {kind:'distance',meters:2000}, rest: {kind:'none'}, count: 1 }] },
  { id: '6k', name: '6K', segments: [{ work: {kind:'distance',meters:6000}, rest: {kind:'none'}, count: 1 }] },
  { id: '5k', name: '5K', segments: [{ work: {kind:'distance',meters:5000}, rest: {kind:'none'}, count: 1 }] },
  { id: '10k', name: '10K', segments: [{ work: {kind:'distance',meters:10000}, rest: {kind:'none'}, count: 1 }] },
  { id: '60m', name: "60'", segments: [{ work: {kind:'duration',seconds:3600}, rest: {kind:'none'}, count: 1 }] },
  { id: '4x2k', name: '4x2K @5\u2032', segments: [{ work: {kind:'distance',meters:2000}, rest: {kind:'duration',seconds:300}, count: 4 }] },
  { id: '4x1k', name: '4x1K @3\u2032', segments: [{ work: {kind:'distance',meters:1000}, rest: {kind:'duration',seconds:180}, count: 4 }] },
  { id: '4x10m', name: "4x10' @2\u2032", segments: [{ work: {kind:'duration',seconds:600}, rest: {kind:'duration',seconds:120}, count: 4 }] },
  { id: '20x1', name: "20x1'/1'", segments: [{ work: {kind:'duration',seconds:60}, rest: {kind:'duration',seconds:60}, count: 20 }] },
  { id: '8x500', name: '8x500 @2\u2032', segments: [{ work: {kind:'distance',meters:500}, rest: {kind:'duration',seconds:120}, count: 8 }] },
]

function fmt(s) { const m=Math.floor(s/60); const r=(s-m*60).toFixed(1).padStart(4,'0'); return `${m}:${r}` }

for (const twoK of [360, 420, 450]) {
  for (const tier of ['world-class','competitive','recreational']) {
    const fit = fitProfile({ twoKSeconds: twoK, tier })
    console.log(`\n=== 2K=${fmt(twoK)} @ ${tier}: CP=${fit.cpWatts.toFixed(0)}W  W'=${(fit.wPrimeJoules/1000).toFixed(1)}kJ ===`)
    for (const w of workouts) {
      const p = predictWorkout(w, fit.cpWatts, fit.wPrimeJoules)
      console.log(`  ${w.name.padEnd(14)} ${fmt(p.avgSplitSeconds)}/500m   (${fmt(p.totalWorkSeconds)} · ${p.totalMeters.toFixed(0)}m)`)
    }
  }
}
