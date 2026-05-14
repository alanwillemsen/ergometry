// Synthetic PM5 connection for testing the rowing display without hardware.
// Enabled via `?mockpm5=1` in the URL — see pm5State.connect.
//
// The mock walks through the workout's intervals at the predicted pace, ticks
// telemetry at 1 Hz, fluctuates stroke rate around the interval's notes-
// extracted SPM target (or 22 if none), and ends with a sticky WORKOUTEND
// state so the post-workout "Open display" / upload UI can be exercised too.
// Distance, elapsed time, and interval boundaries advance realistically so
// the rd-progress bar and rd-target-next labels behave normally.

import type { Workout } from '../model/workouts'
import { extractSpmRange } from '../model/workouts'
import type {
  PM5Connection,
  PM5Telemetry,
  PM5TelemetryListener,
  PM5StrokeRecord,
  PM5SplitRecord,
} from './pm5'

// PM5 workout-state values we actually emit. Real PM uses many more; these
// are the ones RowingDisplay branches on (3/8/9 = rest, 4/5 = work, 10 = end).
const WS_INTERVAL_WORK_TIME = 4
const WS_INTERVAL_WORK_DISTANCE = 5
const WS_INTERVAL_REST = 8
const WS_WORKOUTEND = 10

export interface MockPM5Connection extends PM5Connection {
  __mock: true
  startMockWorkout(workout: Workout, perIntervalPaceSeconds?: number[]): void
  stopMockWorkout(): void
}

export function isMockConnection(c: PM5Connection): c is MockPM5Connection {
  return (c as MockPM5Connection).__mock === true
}

export function connectMockPM5(): MockPM5Connection {
  const listeners = new Set<PM5TelemetryListener>()
  let telemetry: PM5Telemetry | null = null
  let strokes: PM5StrokeRecord[] = []
  let splits: PM5SplitRecord[] = []
  let tickHandle: ReturnType<typeof setInterval> | null = null
  // Disconnect listeners aren't fired in the mock — we only honour the
  // explicit disconnect() path — but we capture them anyway so callers don't
  // throw when they try to register one.
  const disconnectListeners: Array<() => void> = []

  const emit = () => {
    if (!telemetry) return
    for (const fn of listeners) fn(telemetry)
  }

  const stopMockWorkout = () => {
    if (tickHandle) {
      clearInterval(tickHandle)
      tickHandle = null
    }
  }

  const startMockWorkout = (
    workout: Workout,
    perIntervalPaceSeconds?: number[],
  ) => {
    stopMockWorkout()
    strokes = []
    splits = []

    // Track simulation time via wall-clock deltas so a paused tab (which
    // freezes setInterval) doesn't stall the rowing display indefinitely on
    // resume — when the next tick fires, dt absorbs the gap and we catch up.
    const startedAt = performance.now()
    let lastTickAt = startedAt
    let elapsedTotal = 0
    let elapsedMetersTotal = 0
    let intervalIdx = 0
    // phase boundary semantics:
    //   work → rest → next-interval-work → rest → … → end
    // A zero rest is skipped so back-to-back work intervals chain cleanly.
    let phase: 'work' | 'rest' = 'work'
    let phaseElapsed = 0
    let endedSticky = false
    let strokeCount = 0
    let lastStrokeAt = -10  // seconds; primes the first stroke quickly

    const tick = () => {
      const now = performance.now()
      const dt = (now - lastTickAt) / 1000
      lastTickAt = now
      if (endedSticky || dt <= 0) return

      const iv = workout.intervals[intervalIdx]
      if (!iv) {
        endedSticky = true
      }

      const splitFor = perIntervalPaceSeconds?.[intervalIdx]
      // Fallback split: 2:00/500m if prediction wasn't provided (lets the
      // mock degrade gracefully when used outside the prediction path).
      const splitSec = splitFor && isFinite(splitFor) && splitFor > 0 ? splitFor : 120

      const workDuration =
        iv?.work.kind === 'duration'
          ? iv.work.seconds
          : iv
            ? (iv.work.meters * splitSec) / 500
            : 0
      const restDuration = iv?.rest.kind === 'duration' ? iv.rest.seconds : 0

      elapsedTotal += dt
      phaseElapsed += dt

      // Only work phases advance distance. Rest is on the elapsed clock but
      // metres are flat.
      if (phase === 'work' && iv) {
        const metersPerSec = 500 / splitSec
        elapsedMetersTotal += metersPerSec * dt

        // Emit a synthetic stroke roughly at the current SPM. Not used by
        // the rowing display (which reads strokeRateSpm), but the upload-
        // payload code path consumes strokes/splits, so we keep them
        // populated for that flow.
        const wobble = 1.5 * Math.sin((phaseElapsed * 2 * Math.PI) / 12)
        const range = extractSpmRange(iv.notes)
        const center = range ? (range.min + range.max) / 2 : 22
        const spm = Math.max(14, Math.min(50, Math.round(center + wobble)))
        const period = 60 / spm
        if (elapsedTotal - lastStrokeAt >= period) {
          strokeCount += 1
          lastStrokeAt = elapsedTotal
          const drive = period * 0.45
          const recovery = period - drive
          strokes.push({
            elapsedSeconds: phaseElapsed,
            distanceMeters: elapsedMetersTotal,
            intervalIndex: intervalIdx,
            driveTimeSec: drive,
            recoveryTimeSec: recovery,
            strokeDistanceMeters: metersPerSec * period,
            workPerStrokeJoules: 200,
            strokeCount,
            heartRate: 0,
          })
        }
      }

      // Phase transitions. Cross until we've consumed all the time spent in
      // a single tick — important for catch-up after long pauses.
      while (!endedSticky) {
        const phaseDuration = phase === 'work' ? workDuration : restDuration
        if (phaseElapsed < phaseDuration || phaseDuration <= 0) {
          if (phaseDuration <= 0 && phase === 'rest') {
            // Zero-rest interval — skip straight to next interval.
            phase = 'work'
            phaseElapsed = 0
            intervalIdx += 1
            if (intervalIdx >= workout.intervals.length) {
              endedSticky = true
              break
            }
            continue
          }
          break
        }
        // Phase exhausted — transition.
        const overshoot = phaseElapsed - phaseDuration
        if (phase === 'work') {
          // Emit a split record at every work→rest (or work→end) boundary.
          splits.push({
            elapsedSeconds: elapsedTotal,
            distanceMeters: elapsedMetersTotal,
            splitTimeSec: workDuration,
            splitDistanceMeters:
              iv?.work.kind === 'distance' ? iv.work.meters : (500 * workDuration) / splitSec,
            splitRestTimeSec: restDuration,
            splitRestDistanceMeters: 0,
            avgStrokeRate: Math.round(strokeCount > 0 ? strokeCount * 60 / phaseElapsed : 22),
            splitNumber: intervalIdx + 1,
          })
          if (restDuration > 0) {
            phase = 'rest'
            phaseElapsed = overshoot
          } else {
            intervalIdx += 1
            phase = 'work'
            phaseElapsed = overshoot
            if (intervalIdx >= workout.intervals.length) {
              endedSticky = true
            }
          }
        } else {
          // rest → next work
          intervalIdx += 1
          phase = 'work'
          phaseElapsed = overshoot
          if (intervalIdx >= workout.intervals.length) {
            endedSticky = true
          }
        }
        break  // one transition per tick is plenty for 1-Hz cadence
      }

      // Re-evaluate (intervalIdx may have moved). Re-load iv for telemetry.
      const liveIv = workout.intervals[Math.min(intervalIdx, workout.intervals.length - 1)]
      const wobble = 1.5 * Math.sin((phaseElapsed * 2 * Math.PI) / 12)
      const liveRange = liveIv ? extractSpmRange(liveIv.notes) : null
      const liveCenter = liveRange ? (liveRange.min + liveRange.max) / 2 : 22
      const liveSpm =
        endedSticky || phase === 'rest'
          ? 0
          : Math.max(14, Math.min(50, Math.round(liveCenter + wobble)))

      const workoutState = endedSticky
        ? WS_WORKOUTEND
        : phase === 'rest'
          ? WS_INTERVAL_REST
          : liveIv?.work.kind === 'distance'
            ? WS_INTERVAL_WORK_DISTANCE
            : WS_INTERVAL_WORK_TIME

      telemetry = {
        elapsedSeconds: elapsedTotal,
        elapsedMeters: elapsedMetersTotal,
        intervalIndex: Math.min(intervalIdx, workout.intervals.length - 1),
        workoutState,
        // 1/4 are reasonable "rowing / driving" placeholder bytes; the display
        // doesn't introspect these beyond the workoutState above.
        rowingState: phase === 'work' && !endedSticky ? 1 : 0,
        strokeState: phase === 'work' && !endedSticky ? 4 : 0,
        strokeRateSpm: liveSpm,
        isEnded: endedSticky,
      }
      emit()
    }

    // Prime telemetry so getTelemetry() returns something immediately.
    telemetry = {
      elapsedSeconds: 0,
      elapsedMeters: 0,
      intervalIndex: 0,
      workoutState:
        workout.intervals[0]?.work.kind === 'distance'
          ? WS_INTERVAL_WORK_DISTANCE
          : WS_INTERVAL_WORK_TIME,
      rowingState: 1,
      strokeState: 4,
      strokeRateSpm: 22,
      isEnded: false,
    }
    emit()
    tickHandle = setInterval(tick, 1000)
  }

  const device = {
    name: 'PM5 (mock)',
    gatt: {
      connected: true,
      disconnect: () => stopMockWorkout(),
    },
    addEventListener: (event: string, cb: () => void) => {
      if (event === 'gattserverdisconnected') disconnectListeners.push(cb)
    },
  } as unknown as PM5Connection['device']

  return {
    __mock: true,
    device,
    // tx / charMap / txUuid / responses are only used by the real sendWorkout
    // path; the mock send-equivalent is startMockWorkout below, so we hand
    // back inert placeholders that satisfy the interface.
    tx: {} as PM5Connection['tx'],
    charMap: 'mock',
    txUuid: 'mock',
    responses: [],
    getTelemetry: () => telemetry,
    onTelemetry: (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getStrokes: () => strokes,
    getSplits: () => splits,
    resetTelemetry: () => {
      telemetry = null
      strokes = []
      splits = []
    },
    startMockWorkout,
    stopMockWorkout,
  }
}
