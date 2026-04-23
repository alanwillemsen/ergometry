import { useEffect, useMemo, useRef, useState } from 'react'
import type { PM5Connection, PM5Telemetry } from '../lib/pm5'
import type { Workout, WorkoutPrediction } from '../model/workouts'
import { formatSplit } from '../lib/time'

export interface RowingDisplayProps {
  workout: Workout
  prediction: WorkoutPrediction
  conn: PM5Connection
  onClose: () => void
}

// Screen Orientation + Wake Lock APIs aren't in this project's lib target.
interface OrientationLock {
  lock?(o: 'landscape'): Promise<void>
  unlock?(): void
}
interface WakeLockSentinel {
  release(): Promise<void>
}
interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinel>
}

// Total planned workout seconds. Distance intervals contribute
// meters / target-split; rest is always seconds (or zero when 'none').
function plannedTotalSeconds(workout: Workout, prediction: WorkoutPrediction): number {
  let total = 0
  for (let i = 0; i < workout.intervals.length; i++) {
    const iv = workout.intervals[i]
    const split = prediction.perIntervalSplitsSeconds[i] ?? prediction.avgSplitSeconds
    total +=
      iv.work.kind === 'duration'
        ? iv.work.seconds
        : (iv.work.meters * split) / 500
    if (iv.rest.kind === 'duration') total += iv.rest.seconds
  }
  return total
}

export function RowingDisplay({ workout, prediction, conn, onClose }: RowingDisplayProps) {
  const [telemetry, setTelemetry] = useState<PM5Telemetry | null>(() => conn.getTelemetry())
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    return conn.onTelemetry((t) => setTelemetry({ ...t }))
  }, [conn])

  // Fullscreen + landscape lock (landscape lock silently fails on iOS Safari).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    el.requestFullscreen?.().catch(() => {})
    const orientation = (screen as unknown as { orientation?: OrientationLock }).orientation
    orientation?.lock?.('landscape').catch(() => {})

    const onFsChange = () => {
      if (!document.fullscreenElement) onCloseRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('keydown', onKey)
      orientation?.unlock?.()
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [])

  // Keep the screen awake. The OS/browser may drop the lock when the tab
  // becomes hidden (e.g., user switches apps), so we re-acquire on visibility.
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: WakeLockApi }
    if (!nav.wakeLock) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request('screen')
        if (cancelled) { s.release().catch(() => {}); return }
        sentinel = s
      } catch { /* user denied or API unavailable */ }
    }
    acquire()
    const onVis = () => {
      if (document.visibilityState === 'visible' && !sentinel) acquire()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      sentinel?.release().catch(() => {})
    }
  }, [])

  const totalPlanned = useMemo(
    () => plannedTotalSeconds(workout, prediction),
    [workout, prediction],
  )

  const totalIntervals = workout.intervals.length
  const rawIdx = telemetry?.intervalIndex ?? 0
  const intervalIdx = Math.min(Math.max(0, rawIdx), totalIntervals - 1)
  const targetSplit =
    prediction.perIntervalSplitsSeconds[intervalIdx] ?? prediction.avgSplitSeconds

  // Concept2 workout states 3/8/9 = INTERVAL_REST and its two work→rest
  // transitions. All three mean "not rowing the piece right now."
  const ws = telemetry?.workoutState
  const isResting = ws === 3 || ws === 8 || ws === 9

  const elapsed = telemetry?.elapsedSeconds ?? 0
  const progressFrac = totalPlanned > 0 ? Math.min(1, elapsed / totalPlanned) : 0

  return (
    <div ref={rootRef} className="rowing-display">
      <button
        type="button"
        className="rd-close"
        aria-label="Close display"
        onClick={onClose}
      >
        ×
      </button>
      <div className="rd-grid">
        <div className="rd-target">
          <div className={`rd-target-value${isResting ? ' is-rest' : ''}`}>
            {isResting ? 'REST' : formatSplit(targetSplit)}
          </div>
          {!isResting && <div className="rd-target-unit">/500m target</div>}
        </div>
        <div className="rd-interval">
          <div className="rd-interval-counts">
            <span className="rd-interval-cur">{intervalIdx + 1}</span>
            <span className="rd-interval-sep">of</span>
            <span className="rd-interval-total">{totalIntervals}</span>
          </div>
          <div className="rd-interval-label">interval</div>
        </div>
        <div className="rd-progress">
          <div className="rd-progress-bar">
            <div
              className="rd-progress-fill"
              style={{ width: `${progressFrac * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
