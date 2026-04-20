// Generate docs/decay.svg — how many seconds/500m the long-duration CP decay
// adds to the sustainable split, as a function of piece duration, across the
// three tiers. The decay is off for t ≤ 1200s (20 min) and grows logarithmically
// after; bite scales with (1 − CP/P_2K), so less-aerobic tiers feel it more.
//
// Athlete 2K is fixed (7:00) so the three lines differ only by tier ratio.
//
// Run: npx tsx scripts/plot-decay.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { fitProfile } from '../src/model/pacing.ts'
import { predictWorkout } from '../src/model/wprime.ts'

const TWO_K_SECONDS = 420
const TIERS = [
  { id: 'world-class', label: 'World-class', color: '#0ea5e9' },
  { id: 'competitive', label: 'Competitive', color: '#2563eb' },
  { id: 'recreational', label: 'Recreational', color: '#dc2626' },
]

const T_MIN = 300  // 5 min
const T_MAX = 5400 // 90 min
const N = 80

function sustainableSplit(fit, seconds, withDecay) {
  const workout = {
    id: 't', name: 't',
    segments: [{ work: { kind: 'duration', seconds }, rest: { kind: 'none' }, count: 1 }],
  }
  const p = predictWorkout(
    workout,
    fit.cpWatts,
    fit.wPrimeJoules,
    undefined,
    0,
    withDecay ? fit.decayK : 0,
    fit.wPrimeMortonJoules,
    fit.kSeconds,
  )
  return p.avgSplitSeconds
}

const series = TIERS.map(({ id, label, color }) => {
  const fit = fitProfile({ twoKSeconds: TWO_K_SECONDS, tier: id })
  const points = []
  for (let i = 0; i < N; i++) {
    const t = T_MIN * Math.pow(T_MAX / T_MIN, i / (N - 1))
    const delta = sustainableSplit(fit, t, true) - sustainableSplit(fit, t, false)
    points.push({ t, delta })
  }
  return { id, label, color, fit, points }
})

// Layout
const W = 720, H = 380
const M = { top: 40, right: 170, bottom: 50, left: 70 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom

const xAt = (t) => M.left + (Math.log(t) - Math.log(T_MIN)) / (Math.log(T_MAX) - Math.log(T_MIN)) * PW

const maxDelta = Math.max(...series.flatMap((s) => s.points.map((p) => p.delta)))
const yMin = 0
const yMax = Math.ceil(maxDelta * 1.1 * 2) / 2 // round up to nearest 0.5
const yAt = (d) => M.top + PH - (d - yMin) / (yMax - yMin) * PH

const xTicks = [
  { t: 300, label: '5 min' },
  { t: 600, label: '10 min' },
  { t: 1200, label: '20 min' },
  { t: 1800, label: '30 min' },
  { t: 3600, label: '60 min' },
  { t: 5400, label: '90 min' },
]

const yTicks = []
const yStep = yMax > 3 ? 1 : 0.5
for (let d = 0; d <= yMax + 1e-9; d += yStep) yTicks.push(d)

const pathFor = (points) =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(p.t).toFixed(1)},${yAt(p.delta).toFixed(1)}`).join(' ')

const COLOR_AXIS = '#888'
const COLOR_GRID = '#88888833'
const COLOR_TEXT = '#555'
const COLOR_ONSET = '#999'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace, Consolas, monospace" font-size="12">
  <title>Additional seconds per 500m from the long-duration CP decay, by piece duration and tier (7:00 2K)</title>

  <!-- Grid -->
  ${yTicks.map((d) => `<line x1="${M.left}" y1="${yAt(d).toFixed(1)}" x2="${M.left + PW}" y2="${yAt(d).toFixed(1)}" stroke="${COLOR_GRID}" />`).join('\n  ')}
  ${xTicks.map((tk) => `<line x1="${xAt(tk.t).toFixed(1)}" y1="${M.top}" x2="${xAt(tk.t).toFixed(1)}" y2="${M.top + PH}" stroke="${COLOR_GRID}" />`).join('\n  ')}

  <!-- Decay-onset marker at 20 min -->
  <line x1="${xAt(1200).toFixed(1)}" y1="${M.top}" x2="${xAt(1200).toFixed(1)}" y2="${M.top + PH}" stroke="${COLOR_ONSET}" stroke-dasharray="4 3" stroke-width="1" />
  <text x="${(xAt(1200) + 6).toFixed(1)}" y="${(M.top + 12).toFixed(1)}" fill="${COLOR_TEXT}" font-size="11">decay onset (20 min)</text>

  <!-- Axes -->
  <line x1="${M.left}" y1="${M.top + PH}" x2="${M.left + PW}" y2="${M.top + PH}" stroke="${COLOR_AXIS}" />
  <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${M.top + PH}" stroke="${COLOR_AXIS}" />

  <!-- X tick labels -->
  ${xTicks.map((tk) => `<text x="${xAt(tk.t).toFixed(1)}" y="${(M.top + PH + 18).toFixed(1)}" fill="${COLOR_TEXT}" text-anchor="middle">${tk.label}</text>`).join('\n  ')}

  <!-- Y tick labels -->
  ${yTicks.map((d) => `<text x="${M.left - 8}" y="${(yAt(d) + 4).toFixed(1)}" fill="${COLOR_TEXT}" text-anchor="end">${yStep >= 1 ? d.toFixed(0) : d.toFixed(1)}s</text>`).join('\n  ')}

  <!-- Axis titles -->
  <text x="${(M.left + PW / 2).toFixed(1)}" y="${(M.top + PH + 40).toFixed(1)}" fill="${COLOR_TEXT}" text-anchor="middle" font-size="13">piece duration</text>
  <text x="20" y="${(M.top + PH / 2).toFixed(1)}" fill="${COLOR_TEXT}" text-anchor="middle" font-size="13" transform="rotate(-90 20 ${(M.top + PH / 2).toFixed(1)})">Δ split /500m</text>

  <!-- Curves -->
  ${series.map((s) => `<path d="${pathFor(s.points)}" fill="none" stroke="${s.color}" stroke-width="2" />`).join('\n  ')}

  <!-- Legend -->
  <g transform="translate(${M.left + PW + 20}, ${M.top + 6})" font-size="12">
    <text fill="${COLOR_TEXT}" font-size="11" y="-10">tier (k = 0.16·(1−r))</text>
    ${series.map((s, i) => `
    <line x1="0" y1="${i * 20}" x2="22" y2="${i * 20}" stroke="${s.color}" stroke-width="2" />
    <text x="28" y="${i * 20 + 4}" fill="${COLOR_TEXT}">${s.label}</text>
    <text x="28" y="${i * 20 + 17}" fill="${COLOR_TEXT}" font-size="10">k = ${s.fit.decayK.toFixed(3)}</text>`).join('')}
  </g>

  <!-- Caption -->
  <text x="${M.left}" y="${(M.top - 18).toFixed(1)}" fill="${COLOR_TEXT}" font-size="12">Extra seconds per 500m added by the long-duration decay — 7:00 2K, no rest phases</text>
</svg>
`

mkdirSync(new URL('../docs', import.meta.url), { recursive: true })
writeFileSync(new URL('../docs/decay.svg', import.meta.url), svg)

// Data echo
console.log(`2K = ${Math.floor(TWO_K_SECONDS / 60)}:${(TWO_K_SECONDS % 60).toString().padStart(2, '0')}\n`)
const probeMinutes = [10, 20, 30, 45, 60, 90]
const header = 'duration'.padEnd(10) + TIERS.map((t) => t.label.padStart(14)).join('')
console.log(header)
for (const min of probeMinutes) {
  const cells = series.map((s) => {
    const t = min * 60
    const delta = sustainableSplit(s.fit, t, true) - sustainableSplit(s.fit, t, false)
    return `${delta.toFixed(2)}s`.padStart(14)
  })
  console.log(`${(min + ' min').padEnd(10)}${cells.join('')}`)
}
console.log(`\nwrote docs/decay.svg`)
