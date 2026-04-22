// Format/parse m:ss.t style times (e.g., "7:12.3") and split strings ("1:45.2 /500m").
// All internal durations are seconds (floats).

export function formatTime(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return '—'
  const total = totalSeconds
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total - h * 3600 - m * 60
  const sStr = s.toFixed(1).padStart(4, '0') // "07.3"
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sStr}`
  return `${m}:${sStr}`
}

export function formatSplit(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

// Whole-second rendering for work/rest durations. Split-precision tenths
// would be noise for interval lengths like "10:00" or "2:00r".
export function formatDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return '—'
  const total = Math.round(totalSeconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total - h * 3600 - m * 60
  const sStr = s.toString().padStart(2, '0')
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sStr}`
  return `${m}:${sStr}`
}

// Parse "7:12", "7:12.3", "1:45.1", "420", "420.5", "72:00" → seconds.
// Returns NaN for invalid input.
export function parseTime(input: string): number {
  const trimmed = input.trim()
  if (!trimmed) return NaN
  const parts = trimmed.split(':').map((p) => p.trim())
  if (parts.length === 1) {
    const n = Number(parts[0])
    return isFinite(n) ? n : NaN
  }
  if (parts.length === 2) {
    const m = Number(parts[0])
    const s = Number(parts[1])
    if (!isFinite(m) || !isFinite(s)) return NaN
    return m * 60 + s
  }
  if (parts.length === 3) {
    const h = Number(parts[0])
    const m = Number(parts[1])
    const s = Number(parts[2])
    if (!isFinite(h) || !isFinite(m) || !isFinite(s)) return NaN
    return h * 3600 + m * 60 + s
  }
  return NaN
}
