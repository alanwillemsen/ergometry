// Compare actual 6K times vs Competitive-tier predicted 6K times.
import { fitFromTier, solveSplitForDistance, distanceTimeFromSplit } from '../src/model/pacing.ts'

const COMP_RATIO = 0.70

function parseHMS(s) {
  const [h, m, sec] = s.split(':').map(Number)
  return h * 3600 + m * 60 + sec
}
function fmt(sec) {
  if (!isFinite(sec)) return '—'
  const sign = sec < 0 ? '-' : '+'
  sec = Math.abs(sec)
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return m > 0 ? `${sign}${m}:${s.toFixed(1).padStart(4, '0')}` : `${sign}${s.toFixed(1)}s`
}
function clock(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec - h * 3600 - m * 60
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toFixed(0).padStart(2, '0')}`
    : `${m}:${s.toFixed(0).padStart(2, '0')}`
}

const data = [
  ['0:07:06', '0:22:30'], ['0:07:13', '0:23:13'], ['0:07:17', '0:24:34'],
  ['0:07:16', '0:23:39'], ['0:07:30', '0:23:43'], ['0:07:58', '0:25:47'],
  ['0:08:07', '0:26:08'], ['0:08:37', '0:28:24'], ['0:08:15', '0:26:26'],
  ['0:08:54', '0:28:50'], ['0:07:50', '0:25:16'], ['0:09:44', '0:31:25'],
  ['0:07:32', '0:24:57'], ['0:06:45', '0:22:24'], ['0:06:54', '0:22:35'],
  ['0:06:53', '0:22:49'], ['0:07:16', '0:23:49'], ['0:07:23', '0:23:57'],
  ['0:07:36', '0:24:42'], ['0:07:40', '0:25:15'], ['0:08:20', '0:26:42'],
  ['0:08:26', '0:27:04'], ['0:08:52', '0:28:48'], ['0:09:02', '0:29:08'],
]

console.log('   2K      6K actual   6K predicted   Δ (pred − actual)   6K split actual / predicted')
console.log('  ─────── ─────────── ─────────────── ─────────────────── ──────────────────────────')

const rows = data.map(([t2, t6]) => {
  const tw = parseHMS(t2)
  const sx = parseHMS(t6)
  const fit = fitFromTier(tw, COMP_RATIO)
  const predSplit6 = solveSplitForDistance(fit.cpWatts, fit.wPrimeJoules, 6000)
  const predTime = distanceTimeFromSplit(predSplit6, 6000)
  const actualSplit6 = sx / 12
  const delta = predTime - sx
  return { tw, sx, predTime, actualSplit6, predSplit6, delta }
})

for (const r of rows) {
  const dSplit = r.predSplit6 - r.actualSplit6
  console.log(
    `  ${clock(r.tw).padEnd(6)} ${clock(r.sx).padEnd(8)}   ${clock(r.predTime).padEnd(9)}   ${fmt(r.delta).padStart(7)}            ${(r.actualSplit6).toFixed(1)}s  /  ${r.predSplit6.toFixed(1)}s  (${dSplit >= 0 ? '+' : ''}${dSplit.toFixed(1)}s/500m)`
  )
}

const deltas = rows.map((r) => r.delta)
const splitDeltas = rows.map((r) => r.predSplit6 - r.actualSplit6)
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}
const stdev = (a) => {
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}

console.log('\nSummary (n=' + rows.length + '):')
console.log(
  `  6K total-time delta (predicted − actual):  mean ${fmt(mean(deltas))}  median ${fmt(median(deltas))}  stdev ${stdev(deltas).toFixed(1)}s`
)
console.log(
  `  6K split delta (predicted − actual):       mean ${splitDeltas.reduce((a, b) => a + b, 0) / splitDeltas.length > 0 ? '+' : ''}${mean(splitDeltas).toFixed(2)}s/500m  median ${median(splitDeltas) >= 0 ? '+' : ''}${median(splitDeltas).toFixed(2)}s/500m`
)
const under = rows.filter((r) => r.delta < 0).length
const over = rows.filter((r) => r.delta > 0).length
console.log(`  Model under-predicts (too fast): ${under}/${rows.length}`)
console.log(`  Model over-predicts (too slow):  ${over}/${rows.length}`)
