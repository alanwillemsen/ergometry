// Fit CP/W' from (2K, 6K) pairs and report CP/P_2K ratios.
const K = 2.80 * 500 ** 3

function parseTime(s) {
  const [h, m, sec] = s.split(':').map(Number)
  return h * 3600 + m * 60 + sec
}

function splitToPower(split) {
  return K / split ** 3
}

const data = [
  ['0:07:06', '0:22:30'],
  ['0:07:13', '0:23:13'],
  ['0:07:17', '0:24:34'],
  ['0:07:16', '0:23:39'],
  ['0:07:30', '0:23:43'],
  ['0:07:58', '0:25:47'],
  ['0:08:07', '0:26:08'],
  ['0:08:37', '0:28:24'],
  ['0:08:15', '0:26:26'],
  ['0:08:54', '0:28:50'],
  ['0:07:50', '0:25:16'],
  ['0:09:44', '0:31:25'],
  ['0:07:32', '0:24:57'],
  ['0:06:45', '0:22:24'],
  ['0:06:54', '0:22:35'],
  ['0:06:53', '0:22:49'],
  ['0:07:16', '0:23:49'],
  ['0:07:23', '0:23:57'],
  ['0:07:36', '0:24:42'],
  ['0:07:40', '0:25:15'],
  ['0:08:20', '0:26:42'],
  ['0:08:26', '0:27:04'],
  ['0:08:52', '0:28:48'],
  ['0:09:02', '0:29:08'],
]

const rows = data.map(([a, b]) => {
  const t2 = parseTime(a)
  const t6 = parseTime(b)
  const p2 = splitToPower(t2 / 4)
  const p6 = splitToPower(t6 / 12)
  // Linear 2x2: CP + W'/t = P
  const wp = (p2 - p6) / (1 / t2 - 1 / t6)
  const cp = p2 - wp / t2
  const ratio = cp / p2
  const s2 = t2 / 4
  const s6 = t6 / 12
  const gap6vs2 = s6 - s2 // seconds slower on 6K vs 2K
  return { t2, t6, s2, s6, p2, p6, cp, wp, ratio, gap6vs2 }
})

function fmt(t) {
  const m = Math.floor(t / 60)
  const s = (t - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

console.log(
  '2K      6K       |   P_2K  P_6K  |   CP    W\u2032(kJ) |  CP/P2K  |  6K-2K split gap'
)
for (const r of rows) {
  console.log(
    `${fmt(r.t2)}  ${fmt(r.t6)}  |  ${r.p2.toFixed(0).padStart(3)}  ${r.p6.toFixed(0).padStart(3)}  |  ${r.cp
      .toFixed(0)
      .padStart(3)}  ${(r.wp / 1000).toFixed(1).padStart(5)}  |  ${r.ratio.toFixed(
      3,
    )}  |  +${r.gap6vs2.toFixed(1)}s`
  )
}

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length
const ratios = rows.map((r) => r.ratio)
const gaps = rows.map((r) => r.gap6vs2)
const wps = rows.map((r) => r.wp / 1000)

ratios.sort((a, b) => a - b)
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

console.log('\nFleet stats:')
console.log(
  `  CP/P_2K ratio:  mean=${mean(rows.map((r) => r.ratio)).toFixed(3)}  median=${median(
    rows.map((r) => r.ratio),
  ).toFixed(3)}  range=${ratios[0].toFixed(3)}\u2013${ratios[ratios.length - 1].toFixed(3)}`
)
console.log(
  `  W\u2032 (kJ):       mean=${mean(wps).toFixed(1)}  median=${median(wps).toFixed(1)}`
)
console.log(
  `  6K-2K split:   mean=+${mean(gaps).toFixed(1)}s  median=+${median(gaps).toFixed(1)}s`
)

// Split by 2K time tier (fast / mid / slow thirds)
const sorted = [...rows].sort((a, b) => a.t2 - b.t2)
const third = Math.ceil(sorted.length / 3)
const tiers = [
  ['Fastest third', sorted.slice(0, third)],
  ['Middle third', sorted.slice(third, 2 * third)],
  ['Slowest third', sorted.slice(2 * third)],
]
for (const [label, group] of tiers) {
  const rs = group.map((r) => r.ratio)
  console.log(
    `  ${label.padEnd(16)} (n=${group.length}): mean ratio=${mean(rs).toFixed(3)}  mean 6K-2K gap=+${mean(group.map((r) => r.gap6vs2)).toFixed(1)}s`
  )
}
