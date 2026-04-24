import { useEffect, useRef, useState } from 'react'
import type { PM5Connection, PM5Telemetry } from '../lib/pm5'
import type { Workout, WorkoutPrediction } from '../model/workouts'
import { formatSplit } from '../lib/time'
import type { Concept2State } from '../lib/concept2State'

export interface RowingDisplayProps {
  workout: Workout
  prediction: WorkoutPrediction
  conn: PM5Connection
  concept2: Concept2State
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

// Planned seconds (work + rest) for a single interval, given the predicted
// split for that interval. Only used to size the within-interval slice of
// the progress bar; actual pace may differ from prediction.
function intervalPlannedSeconds(iv: Workout['intervals'][number], split: number): number {
  const work = iv.work.kind === 'duration' ? iv.work.seconds : (iv.work.meters * split) / 500
  const rest = iv.rest.kind === 'duration' ? iv.rest.seconds : 0
  return work + rest
}

export function RowingDisplay({ workout, prediction, conn, concept2, onClose }: RowingDisplayProps) {
  const [telemetry, setTelemetry] = useState<PM5Telemetry | null>(() => conn.getTelemetry())
  const [isFullscreen, setIsFullscreen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    return conn.onTelemetry((t) => setTelemetry({ ...t }))
  }, [conn])

  // Fullscreen + landscape lock (landscape lock silently fails on iOS Safari).
  // Exiting fullscreen does NOT close the display — the user may just want to
  // pick a song, then tap to resume. Only explicit × closes it.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    el.requestFullscreen?.().catch(() => {})
    const orientation = (screen as unknown as { orientation?: OrientationLock }).orientation
    orientation?.lock?.('landscape').catch(() => {})

    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    const onKey = (e: KeyboardEvent) => {
      // Only close on Esc when already out of fullscreen — when we're IN
      // fullscreen the browser consumes Esc to exit, and if it also fires a
      // keydown we'd close on the same press the user just used to minimize.
      if (e.key === 'Escape' && !document.fullscreenElement) onCloseRef.current()
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

  const enterFullscreen = () => {
    rootRef.current?.requestFullscreen?.().catch(() => {})
    const orientation = (screen as unknown as { orientation?: OrientationLock }).orientation
    orientation?.lock?.('landscape').catch(() => {})
  }

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

  const totalIntervals = workout.intervals.length
  const rawIdx = telemetry?.intervalIndex ?? 0
  const intervalIdx = Math.min(Math.max(0, rawIdx), totalIntervals - 1)
  const targetSplit =
    prediction.perIntervalSplitsSeconds[intervalIdx] ?? prediction.avgSplitSeconds
  const nextSplit = intervalIdx + 1 < totalIntervals
    ? (prediction.perIntervalSplitsSeconds[intervalIdx + 1] ?? prediction.avgSplitSeconds)
    : null

  // Concept2 workout states 3/8/9 = INTERVAL_REST and its two work→rest
  // transitions. All three mean "not rowing the piece right now."
  const ws = telemetry?.workoutState
  const isResting = ws === 3 || ws === 8 || ws === 9

  const elapsed = telemetry?.elapsedSeconds ?? 0
  const isEnded = telemetry?.isEnded ?? false

  // Capture wall-clock elapsed at each interval transition so within-interval
  // progress is measured against the current interval, not the plan's sum.
  // If interval 1 runs long, the bar stays at 1/N until interval 2 actually
  // starts — it no longer races to 100% off a beaten prediction.
  const intervalStartRef = useRef<{ idx: number; at: number }>({ idx: intervalIdx, at: elapsed })
  if (intervalStartRef.current.idx !== intervalIdx) {
    intervalStartRef.current = { idx: intervalIdx, at: elapsed }
  }
  const curIvPlanned = intervalPlannedSeconds(workout.intervals[intervalIdx], targetSplit)
  const sinceIvStart = Math.max(0, elapsed - intervalStartRef.current.at)
  const withinIvFrac = curIvPlanned > 0 ? Math.min(1, sinceIvStart / curIvPlanned) : 0
  const progressFrac = isEnded
    ? 1
    : Math.min(1, (intervalIdx + withinIvFrac) / totalIntervals)

  const canUpload =
    isEnded &&
    (concept2.status === 'connected' ||
     concept2.status === 'uploading' ||
     concept2.status === 'upload-done' ||
     concept2.status === 'error')

  const uploadLabel =
    concept2.status === 'uploading' ? 'Uploading…'
      : concept2.status === 'upload-done' ? 'Uploaded ✓'
      : concept2.status === 'error' ? 'Retry upload'
      : 'Upload to Logbook'

  const onUpload = () => {
    if (!telemetry) return
    concept2.upload({
      workout,
      telemetry,
      strokes: conn.getStrokes(),
      splits:  conn.getSplits(),
    })
  }

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
      {!isFullscreen && (
        <button
          type="button"
          className="rd-enter-fs"
          aria-label="Resume fullscreen"
          onClick={enterFullscreen}
        >
          ⛶ Fullscreen
        </button>
      )}
      <div className="rd-title">{workout.name}</div>
      <div className="rd-grid">
        <div className="rd-target">
          {isEnded ? (
            <div className="rd-target-value is-done">DONE</div>
          ) : (
            <>
              <div className={`rd-target-value${isResting ? ' is-rest' : ''}`}>
                {isResting ? 'REST' : formatSplit(targetSplit)}
              </div>
              {!isResting && <div className="rd-target-unit">/500m target</div>}
              {nextSplit !== null && (
                <div className="rd-target-next">
                  next {formatSplit(nextSplit)}
                </div>
              )}
            </>
          )}
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
          {isEnded ? (
            <div className="rd-finish">
              {canUpload && (
                <button
                  type="button"
                  className="rd-upload"
                  onClick={onUpload}
                  disabled={concept2.status === 'uploading' || concept2.status === 'upload-done'}
                >
                  {uploadLabel}
                </button>
              )}
              {concept2.status === 'disconnected' && (
                <p className="rd-finish-msg">Connect Logbook from the Profile tab to upload results.</p>
              )}
              {concept2.error && concept2.status === 'error' && (
                <p className="rd-finish-msg is-error">{concept2.error}</p>
              )}
            </div>
          ) : (
            <div className="rd-progress-bar">
              <div
                className="rd-progress-fill"
                style={{ width: `${progressFrac * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
