import type { Workout, WorkoutInterval, Rest } from '../model/workouts'

// ── BLE UUIDs (Concept2 PM5 BLE specification) ───────────────────────────────
// The PM5 exposes two distinct 128-bit services in the CE06 family:
//   CE060020 — PM Control Service: CSAFE command/response (we write frames here).
//   CE060030 — PM Rowing Service: notify-only stream of stroke/split/status data.
// Both are required at requestDevice time so Chrome grants access to each.
const PM_CONTROL_SERVICE = 'ce060020-43e5-11e4-916c-0800200c9a66'
const PM_ROWING_SERVICE  = 'ce060030-43e5-11e4-916c-0800200c9a66'

// Rowing-service characteristics:
//   0x0031 General Status — elapsed time/distance, workout/rowing/stroke state,
//     fired every ~500 ms. We derive the current interval index from state
//     transitions here; 0x0037 (Split/Interval Data) only fires at boundaries
//     and is not useful for continuous "interval X of Y" tracking.
//   0x0035 Stroke Data — fires at the end of every stroke (~30/min at race
//     pace). Provides the per-stroke timeline that drives the Logbook pace
//     graph for ErgData-style detailed uploads.
//   0x0037 Split/Interval Data — fires once per split or interval boundary.
//     Provides per-interval distance/time/SPM for the Logbook intervals table.
const ROW_GENERAL_STATUS_UUID = 'ce060031-43e5-11e4-916c-0800200c9a66'
const ROW_STROKE_DATA_UUID    = 'ce060035-43e5-11e4-916c-0800200c9a66'
const ROW_SPLIT_DATA_UUID     = 'ce060037-43e5-11e4-916c-0800200c9a66'

// ── CSAFE frame constants ─────────────────────────────────────────────────────
// Bytes in 0xF0..0xF3 are reserved as frame delimiters; any occurrence inside
// the payload is escaped as [0xF3, raw - 0xF0]. This matches Concept2's
// published BLE stuffing scheme — the XOR-based scheme in some CSAFE docs is
// for other transports.
const FRAME_START = 0xF1
const FRAME_END   = 0xF2
const FRAME_STUFF = 0xF3

// PM proprietary wrapper for workout configuration (C2 extension). This is
// distinct from standard CSAFE_SETUSERCFG1 (0x1A) — writing PM sub-commands
// under 0x1A collides with the standard AUTOUPLOAD_CMD space and triggers
// firmware assertions on the PM5 (e.g. code 165-301).
const SETPMCFG_CMD = 0x76

// PM proprietary sub-commands (inside SETPMCFG_CMD wrapper).
const PM_SET_WORKOUTTYPE          = 0x01
const PM_SET_WORKOUTDURATION      = 0x03
const PM_SET_RESTDURATION         = 0x04
const PM_SET_SPLITDURATION        = 0x05
const PM_SET_TARGETPACETIME       = 0x06
const PM_SET_SCREENSTATE          = 0x13
const PM_CONFIGURE_WORKOUT        = 0x14
const PM_SET_INTERVALTYPE         = 0x17
const PM_SET_WORKOUTINTERVALCOUNT = 0x18

// Default target pace = 2:00 /500m (120s = 12000 csec). Used as a fallback
// when no prediction is passed through; the PM displays this as the reference
// split (pace boat), but it doesn't affect workout validity.
const DEFAULT_TARGET_PACE_CSEC = 12000

// PM5 firmware-enforced minimums per interval. Below these values, the PM
// silently rejects the interval programming, so we validate up front.
const MIN_INTERVAL_METERS  = 100
const MIN_INTERVAL_SECONDS = 20

// Duration-type byte (inside PM_SET_WORKOUTDURATION / PM_SET_SPLITDURATION).
const DUR_TIME     = 0x00  // value in 1/100-second units
const DUR_DISTANCE = 0x80  // value in meters

// Workout type values (the "-Splits" variants are what ErgometerJS uses).
const WT_FIXED_DISTANCE_SPLITS = 3
const WT_FIXED_TIME_SPLITS     = 5
const WT_VARIABLE_INTERVAL     = 8

// PM IntervalType values (per-interval work unit; carried by PM_SET_INTERVALTYPE).
const IT_TIME     = 0
const IT_DISTANCE = 1

// Screen state payload for PM_SET_SCREENSTATE: [screenType, screenValue]
const SCREEN_TYPE_WORKOUT         = 0x01
const SCREEN_VALUE_PREPARE_TO_ROW = 0x01

// ── CSAFE encoding ────────────────────────────────────────────────────────────

// 4-byte big-endian (MSB first) — the PM expects this order for duration
// values, despite CSAFE typically being little-endian elsewhere.
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]
}

function u16be(n: number): number[] {
  return [(n >>> 8) & 0xFF, n & 0xFF]
}

// PM5 rest is time-based. We still take the Rest type directly so the union's
// 'none' case is handled at the boundary (rather than requiring each caller
// to special-case it).
function restSeconds(rest: Rest): number {
  return rest.kind === 'duration' ? Math.max(0, Math.round(rest.seconds)) : 0
}

// One PM sub-command entry: [subCmd] [innerLen] [...data]
function pmSub(subCmd: number, data: number[]): number[] {
  return [subCmd, data.length, ...data]
}

// Wraps one or more PM sub-commands in a single SETPMCFG_CMD wrapper:
//   [0x76] [wrapperLen] [subCmd1, innerLen1, ...data1] [subCmd2, innerLen2, ...data2] ...
function pmWrapper(subs: number[][]): number[] {
  const all: number[] = []
  for (const s of subs) all.push(...s)
  return [SETPMCFG_CMD, all.length, ...all]
}

function xorOf(bytes: number[]): number {
  return bytes.reduce((acc, b) => acc ^ b, 0)
}

function stuffed(bytes: number[]): number[] {
  const out: number[] = []
  for (const b of bytes) {
    if (b >= 0xF0 && b <= 0xF3) {
      out.push(FRAME_STUFF, b - 0xF0)
    } else {
      out.push(b)
    }
  }
  return out
}

function frame(cmdBytes: number[]): Uint8Array {
  const payload = stuffed([...cmdBytes, xorOf(cmdBytes)])
  return new Uint8Array([FRAME_START, ...payload, FRAME_END])
}

export interface EncodeOpts {
  // Predicted target split in seconds per 500m, per interval. Used to set the
  // pace boat on the PM display. Indexes match the workout's intervals array.
  perIntervalPaceSeconds?: number[]
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.round(s - m * 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

// Throws on work values the PM will silently reject.
function validateWorkout(workout: Workout): void {
  workout.intervals.forEach((iv, i) => {
    if (iv.work.kind === 'distance' && iv.work.meters < MIN_INTERVAL_METERS) {
      throw new Error(
        `Interval ${i + 1} is ${iv.work.meters}m — PM5 requires at least ${MIN_INTERVAL_METERS}m`,
      )
    }
    if (iv.work.kind === 'duration' && iv.work.seconds < MIN_INTERVAL_SECONDS) {
      throw new Error(
        `Interval ${i + 1} is ${formatSec(iv.work.seconds)} — PM5 requires at least ${formatSec(MIN_INTERVAL_SECONDS)}`,
      )
    }
  })
}

export function encodeWorkout(workout: Workout, opts?: EncodeOpts): Uint8Array[] {
  const { intervals } = workout
  if (intervals.length === 0) throw new Error('Workout has no intervals')
  validateWorkout(workout)

  const hasRest = intervals.some(iv => iv.rest.kind !== 'none')
  if (intervals.length === 1 && !hasRest) {
    return encodeSingle(intervals[0])
  }
  return encodeVariableInterval(intervals, opts?.perIntervalPaceSeconds)
}

// Single-piece workout (1 interval, no rest): fixed-distance-splits or
// fixed-time-splits with one big split equal to the total target.
function encodeSingle(iv: WorkoutInterval): Uint8Array[] {
  const { work } = iv
  const isDistance = work.kind === 'distance'
  const wt      = isDistance ? WT_FIXED_DISTANCE_SPLITS : WT_FIXED_TIME_SPLITS
  const durType = isDistance ? DUR_DISTANCE : DUR_TIME
  const value   = isDistance ? work.meters : Math.round(work.seconds * 100)

  const frame1 = frame(pmWrapper([
    pmSub(PM_SET_WORKOUTTYPE,     [wt]),
    pmSub(PM_SET_WORKOUTDURATION, [durType, ...u32be(value)]),
  ]))
  const frame2 = frame(pmWrapper([
    pmSub(PM_SET_SPLITDURATION,   [durType, ...u32be(value)]),
    pmSub(PM_CONFIGURE_WORKOUT,   [0x01]),
    pmSub(PM_SET_SCREENSTATE,     [SCREEN_TYPE_WORKOUT, SCREEN_VALUE_PREPARE_TO_ROW]),
  ]))
  return [frame1, frame2]
}

// Variable-interval workout: each interval can have its own work unit and its
// own rest. Programmed interval-by-interval with a 0-based INDEX (not a count)
// passed to PM_SET_WORKOUTINTERVALCOUNT. PM_SET_WORKOUTTYPE(variableInterval)
// is sent only once, inside interval 0's block.
//
// Per-interval sequence (split across multiple small frames to stay ≤20 bytes):
//   Frame A: SET_WORKOUTINTERVALCOUNT(i) [+ SET_WORKOUTTYPE if i=0] + SET_INTERVALTYPE
//   Frame B: SET_WORKOUTDURATION + SET_RESTDURATION
//   Frame C: SET_CONFIGURE_WORKOUT(1)
// Final:
//   SET_SCREENSTATE(Workout, PrepareToRowWorkout)
function encodeVariableInterval(
  intervals: WorkoutInterval[],
  perIntervalPaceSeconds?: number[],
): Uint8Array[] {
  const frames: Uint8Array[] = []

  intervals.forEach((iv, i) => {
    const itype   = iv.work.kind === 'distance' ? IT_DISTANCE  : IT_TIME
    const durType = iv.work.kind === 'distance' ? DUR_DISTANCE : DUR_TIME
    const value   = iv.work.kind === 'distance' ? iv.work.meters : Math.round(iv.work.seconds * 100)
    const restSec = restSeconds(iv.rest)
    const paceSec = perIntervalPaceSeconds?.[i]
    const paceCsec = paceSec && isFinite(paceSec) && paceSec > 0
      ? Math.round(paceSec * 100)
      : DEFAULT_TARGET_PACE_CSEC

    const subsA: number[][] = [pmSub(PM_SET_WORKOUTINTERVALCOUNT, [i])]
    if (i === 0) subsA.push(pmSub(PM_SET_WORKOUTTYPE, [WT_VARIABLE_INTERVAL]))
    subsA.push(pmSub(PM_SET_INTERVALTYPE, [itype]))
    frames.push(frame(pmWrapper(subsA)))

    frames.push(frame(pmWrapper([
      pmSub(PM_SET_WORKOUTDURATION, [durType, ...u32be(value)]),
      pmSub(PM_SET_RESTDURATION,    u16be(restSec)),
    ])))

    // Each interval's programming block ends with target pace + configure.
    // Both are required — omitting the pace causes the PM to reject the
    // interval's workout/rest duration pair with status 0x01.
    frames.push(frame(pmWrapper([
      pmSub(PM_SET_TARGETPACETIME, u32be(paceCsec)),
      pmSub(PM_CONFIGURE_WORKOUT,  [0x01]),
    ])))
  })

  frames.push(frame(pmWrapper([
    pmSub(PM_SET_SCREENSTATE, [SCREEN_TYPE_WORKOUT, SCREEN_VALUE_PREPARE_TO_ROW]),
  ])))

  return frames
}

// ── Rowing-service telemetry ──────────────────────────────────────────────────
//
// Fields sourced from two characteristics on CE060030. We merge them into one
// snapshot so the UI doesn't need to care which one fired last. Bytes are
// little-endian per the Concept2 PM BLE spec; 24-bit fields need manual reads.

export interface PM5Telemetry {
  // Total workout elapsed time — ticks through rest too (source: 0x0031).
  elapsedSeconds: number
  // Cumulative distance rowed — only advances during work phases.
  elapsedMeters: number
  // 0-based index of the current interval. Derived client-side from
  // workoutState transitions on 0x0031, because 0x0038 (Split/Interval Data)
  // only fires at interval boundaries and so leaves the index stale mid-rep.
  intervalIndex: number
  // Workout/rowing/stroke state bytes from 0x0031. Kept raw; consumer can
  // interpret against the Concept2 enums if needed.
  workoutState: number
  rowingState: number
  strokeState: number
  // True once the PM has entered a terminal workout state at least once.
  // Sticky — subsequent non-terminal states do not clear it, so a button
  // that appears at end-of-workout doesn't blink away on the next poll.
  isEnded: boolean
}

// Concept2 PM workout-state values we care about for interval tracking.
// 4 = INTERVALWORKTIME, 5 = INTERVALWORKDISTANCE. A rest→work transition
// into one of these marks the start of a new interval's work phase.
const WORK_STATES = new Set([4, 5])

// Terminal PM workout states. 10 = WORKOUTEND, 11 = TERMINATE,
// 12 = WORKOUTLOGGED. Once seen, we freeze the last non-terminal totals as
// the official result — entering WORKOUTEND typically keeps elapsed/meters
// at their final values but we latch to be safe.
const END_STATES = new Set([10, 11, 12])

// Exported so UIs can name states without re-declaring the enum.
export const PM5_WORKOUT_STATE = {
  WORKOUTEND: 10,
  TERMINATE: 11,
  WORKOUTLOGGED: 12,
} as const

export type PM5TelemetryListener = (t: PM5Telemetry) => void

function read24LE(v: DataView, off: number): number {
  return v.getUint8(off) | (v.getUint8(off + 1) << 8) | (v.getUint8(off + 2) << 16)
}

// One stroke as reported by 0x0035 Stroke Data. Fields are converted from
// PM5's raw fixed-point units to friendlier seconds/meters/joules; SPM and
// pace are derivable per-stroke from drive+recovery time.
//
// elapsedSeconds/distanceMeters are per-interval (reset at each interval
// boundary) — matches how ErgData serializes stroke_data so Logbook can
// group strokes into intervals by detecting t/d resets. intervalIndex is
// the 0-based count of interval boundaries seen before this stroke.
export interface PM5StrokeRecord {
  elapsedSeconds: number
  distanceMeters: number
  intervalIndex: number
  driveTimeSec: number
  recoveryTimeSec: number
  strokeDistanceMeters: number
  workPerStrokeJoules: number
  strokeCount: number
}

// One split or interval boundary as reported by 0x0037 Split/Interval Data.
// "splitNumber" is the 0-based index of the split that just ended, per the
// PM5 spec; for variable-interval workouts this is the interval index.
export interface PM5SplitRecord {
  elapsedSeconds: number
  distanceMeters: number
  splitTimeSec: number
  splitDistanceMeters: number
  splitRestTimeSec: number
  splitRestDistanceMeters: number
  avgStrokeRate: number
  splitNumber: number
}

// Parses just the raw per-interval fields. intervalIndex is assigned by the
// caller based on boundary-reset detection, since a single packet can't know
// which interval it belongs to.
type ParsedStroke = Omit<PM5StrokeRecord, 'intervalIndex'>

function parseStrokeRecord(v: DataView): ParsedStroke | null {
  // Spec says 20 bytes; tolerate slightly shorter frames as long as we have
  // the fields we use (through workPerStroke at offset 17). strokeCount is
  // at 18-19 — fall back to 0 if missing.
  if (v.byteLength < 18) return null
  return {
    elapsedSeconds:       read24LE(v, 0) * 0.01,
    distanceMeters:       read24LE(v, 3) * 0.1,
    // Byte 6 = drive length, skipped (we don't surface it).
    driveTimeSec:         v.getUint8(7) * 0.01,
    recoveryTimeSec:      v.getUint16(8, true) * 0.01,
    strokeDistanceMeters: v.getUint16(10, true) * 0.01,
    // Bytes 12-15 = peak/avg drive force, skipped.
    workPerStrokeJoules:  v.getUint16(16, true) * 0.1,
    strokeCount:          v.byteLength >= 20 ? v.getUint16(18, true) : 0,
  }
}

function parseSplitRecord(v: DataView): PM5SplitRecord | null {
  if (v.byteLength < 18) return null
  // 0x0037 mixes *three* different time scales within the same packet — none
  // of this is hinted at by the spec, all confirmed from Logbook output:
  //   bytes 0-2   (elapsed time)    — 0.01s, matches General Status
  //   bytes 3-5   (cum distance)    — 0.1m,  matches General Status
  //   bytes 6-8   (split time)      — 0.1s
  //   bytes 9-11  (split distance)  — 1m
  //   bytes 12-13 (rest time)       — 1s  ← whole seconds
  //   bytes 14-15 (rest distance)   — 1m
  return {
    elapsedSeconds:           read24LE(v, 0) * 0.01,
    distanceMeters:           read24LE(v, 3) * 0.1,
    splitTimeSec:             read24LE(v, 6) * 0.1,
    splitDistanceMeters:      read24LE(v, 9),
    splitRestTimeSec:         v.getUint16(12, true),
    splitRestDistanceMeters:  v.getUint16(14, true),
    avgStrokeRate:            v.getUint8(16),
    splitNumber:              v.getUint8(17),
  }
}

// ── Minimal Web Bluetooth types (not in this project's lib scope) ─────────────

interface BLECharProperties {
  write: boolean
  writeWithoutResponse: boolean
  notify: boolean
  read: boolean
}
interface BLECharacteristic {
  uuid?: string
  properties?: BLECharProperties
  value?: DataView
  writeValue(value: Uint8Array<ArrayBufferLike> | ArrayBuffer): Promise<void>
  writeValueWithResponse?(value: Uint8Array<ArrayBufferLike> | ArrayBuffer): Promise<void>
  writeValueWithoutResponse?(value: Uint8Array<ArrayBufferLike> | ArrayBuffer): Promise<void>
  startNotifications?(): Promise<BLECharacteristic>
  addEventListener?(event: string, cb: (e: Event) => void): void
}
interface BLECharacteristicWithUuid extends BLECharacteristic {
  uuid: string
}
interface BLEService {
  getCharacteristic(uuid: string): Promise<BLECharacteristic>
  getCharacteristics(): Promise<BLECharacteristicWithUuid[]>
}
interface BLEServer {
  getPrimaryService(uuid: string): Promise<BLEService>
}
interface BLEDevice {
  name?: string
  gatt?: { connect(): Promise<BLEServer>; disconnect(): void }
  addEventListener(event: 'gattserverdisconnected', cb: () => void): void
}
interface BLENav {
  requestDevice(opts: {
    filters: Array<{ namePrefix?: string }>
    optionalServices: string[]
  }): Promise<BLEDevice>
}

// ── BLE connection ────────────────────────────────────────────────────────────

export interface PM5Connection {
  device: BLEDevice
  tx: BLECharacteristic
  // Discovery snapshot used for error diagnostics.
  charMap: string
  // Short UUID fragment of the characteristic we chose for writes.
  txUuid: string
  // Bytes captured from notify characteristics; pushed as hex strings each
  // time the PM fires a notification.
  responses: string[]
  // Latest rowing-service telemetry snapshot, or null if the rowing service
  // wasn't available / no notification has fired yet.
  getTelemetry(): PM5Telemetry | null
  // Subscribe to telemetry updates. Returns an unsubscribe function.
  onTelemetry(fn: PM5TelemetryListener): () => void
  // Per-stroke records captured since the last resetTelemetry. Empty if the
  // stroke-data characteristic was unavailable or no strokes have fired.
  // Returns a snapshot — safe to mutate.
  getStrokes(): PM5StrokeRecord[]
  // Per-split/interval records, in the order they fired.
  getSplits(): PM5SplitRecord[]
  // Drop cumulative state (epoch bases, last-raw values, interval count,
  // ended-sticky, strokes/splits) so the next notification starts a fresh
  // workout from zero. Called by sendWorkout; the accumulator lives in the
  // long-lived connection closure, so without this the PM reporting
  // rawElapsed=0 after reprogramming would be treated as an interval reset
  // and bank the prior workout's total into elapsedEpochBase.
  resetTelemetry(): void
}

function describeChars(chars: BLECharacteristicWithUuid[]): string {
  return chars
    .map(c => {
      const flags = [
        c.properties?.write && 'w',
        c.properties?.writeWithoutResponse && 'wnr',
        c.properties?.notify && 'n',
        c.properties?.read && 'r',
      ].filter(Boolean).join(',')
      return `${c.uuid.slice(4, 8)}[${flags || '-'}]`
    })
    .join(' ')
}

export async function connectPM5(): Promise<PM5Connection> {
  const bt = (navigator as Navigator & { bluetooth: BLENav }).bluetooth
  const device = await bt.requestDevice({
    filters: [{ namePrefix: 'PM5' }],
    optionalServices: [PM_CONTROL_SERVICE, PM_ROWING_SERVICE],
  })
  const server = await device.gatt!.connect()
  const service = await server.getPrimaryService(PM_CONTROL_SERVICE)

  // Enumerate all characteristics in the control service and pick the first
  // one that actually advertises a write property. Chrome on Android has
  // been seen to misreport properties for hardcoded UUIDs, so letting the
  // discovery drive selection is more robust.
  const chars = await service.getCharacteristics()
  const charMap = describeChars(chars)

  const writable = chars.find(
    c => c.properties?.write || c.properties?.writeWithoutResponse,
  )
  if (!writable) {
    throw new Error(`No writable characteristic in PM control service. Chars: ${charMap}`)
  }
  const tx = writable
  const txUuid = writable.uuid.slice(4, 8)

  const responses: string[] = []

  // Subscribe to every notify characteristic in the service so we can see
  // whatever the PM sends back in response to our writes.
  const notifiers = chars.filter(c => c.properties?.notify)
  for (const n of notifiers) {
    const short = n.uuid.slice(4, 8)
    n.addEventListener?.('characteristicvaluechanged', (event: Event) => {
      const target = event.target as BLECharacteristic | null
      const v = target?.value
      if (!v) return
      const bytes: string[] = []
      for (let i = 0; i < v.byteLength; i++) {
        bytes.push(v.getUint8(i).toString(16).padStart(2, '0'))
      }
      responses.push(`${short}:${bytes.join('')}`)
    })
    await n.startNotifications?.()
  }

  // Rowing-service telemetry. Best-effort: if the service or its
  // characteristics aren't exposed, getTelemetry stays null forever and the
  // display falls back to static planned values.
  let telemetry: PM5Telemetry | null = null
  const listeners = new Set<PM5TelemetryListener>()
  const emit = () => {
    if (!telemetry) return
    for (const fn of listeners) fn(telemetry)
  }

  // Client-side interval tracking. 0x0038 only fires at interval *end*, so
  // its own interval-number field is stale during a rep. We instead count
  // rest→work transitions observed on 0x0031: each entry into a work state
  // from a non-work state is a new interval's work phase starting.
  let prevWorkoutState: number | null = null
  let workStartsCount = 0

  // In variable-interval workouts the PM5's General Status elapsed time /
  // distance resets per interval. To report cumulative workout totals we
  // accumulate each "epoch" of monotonically-increasing values; whenever the
  // new raw value drops below the previous one (a reset), we bank the previous
  // peak and start the next epoch. Works for both cases: if the PM doesn't
  // reset, the last-observed values just keep climbing and nothing is banked.
  let elapsedEpochBase = 0
  let metersEpochBase  = 0
  let lastRawElapsed   = 0
  let lastRawMeters    = 0
  let endedSticky      = false
  let strokes: PM5StrokeRecord[] = []
  let splits:  PM5SplitRecord[]  = []
  // Stroke characteristic 0x0035 resets its elapsed/distance fields at each
  // interval boundary. We store records with those raw per-interval values
  // (not workout-cumulative) — Logbook's per-interval pace graph relies on
  // detecting the t-reset to group strokes into intervals, matching ErgData's
  // upload format. We track which interval each stroke belongs to via a
  // counter bumped on each detected reset.
  let strokeIntervalIndex = 0
  let lastStrokeRawElapsed = 0
  // Dedup state — PM5 can fire 0x0035 multiple times per physical stroke
  // (e.g. at drive-end and again at recovery-end), and the raw SPM computed
  // from counts would be 2x actual. Track the monotonic strokeCount field
  // (bytes 18-19) and fall back to a minimum time delta when that byte isn't
  // populated on a given firmware. Both trackers reset at interval boundaries
  // so the first real stroke of a new interval always passes.
  let lastPushedStrokeCount = -1
  let lastPushedRawElapsed  = -1
  // Splits 0x0037 carries an "elapsed at end-of-split" field that resets per
  // interval the same way. We accumulate so each split record reports a
  // monotonic workout-cumulative elapsed.
  let splitEpochElapsed = 0
  let splitEpochMeters  = 0
  let lastSplitRawElapsed = 0
  let lastSplitRawMeters  = 0

  try {
    const rowingService = await server.getPrimaryService(PM_ROWING_SERVICE)
    const general = await rowingService.getCharacteristic(ROW_GENERAL_STATUS_UUID).catch(() => null)
    if (general) {
      general.addEventListener?.('characteristicvaluechanged', (event: Event) => {
        const v = (event.target as BLECharacteristic | null)?.value
        if (!v || v.byteLength < 11) return
        const rawElapsed = read24LE(v, 0) * 0.01
        const rawMeters  = read24LE(v, 3) * 0.1
        const workoutState = v.getUint8(8)
        const rowingState  = v.getUint8(9)
        const strokeState  = v.getUint8(10)

        // 1-second / 1-meter threshold avoids counting rounding jitter as a
        // reset while still catching interval-boundary drops to ~0.
        if (lastRawElapsed - rawElapsed > 1) elapsedEpochBase += lastRawElapsed
        if (lastRawMeters  - rawMeters  > 1) metersEpochBase  += lastRawMeters
        lastRawElapsed = rawElapsed
        lastRawMeters  = rawMeters

        if (prevWorkoutState !== null) {
          const wasWork = WORK_STATES.has(prevWorkoutState)
          const isWork  = WORK_STATES.has(workoutState)
          if (isWork && !wasWork) workStartsCount += 1
        } else if (WORK_STATES.has(workoutState)) {
          // First notification already in a work state — count it.
          workStartsCount = 1
        }
        prevWorkoutState = workoutState
        if (END_STATES.has(workoutState)) endedSticky = true

        telemetry = {
          elapsedSeconds: elapsedEpochBase + rawElapsed,
          elapsedMeters:  metersEpochBase  + rawMeters,
          intervalIndex: Math.max(0, workStartsCount - 1),
          workoutState,
          rowingState,
          strokeState,
          isEnded: endedSticky,
        }
        emit()
      })
      await general.startNotifications?.()
    }

    // Stroke data — best-effort. Each fire is one completed stroke; we keep
    // them all so the upload payload mirrors what ErgData sends.
    const stroke = await rowingService.getCharacteristic(ROW_STROKE_DATA_UUID).catch(() => null)
    if (stroke) {
      stroke.addEventListener?.('characteristicvaluechanged', (event: Event) => {
        const v = (event.target as BLECharacteristic | null)?.value
        if (!v) return
        const rec = parseStrokeRecord(v)
        if (!rec) return
        // PM5 emits glitchy strokes around interval boundaries / workout-end
        // transitions, and warm-up handle-taps before real rowing begins.
        // Both produce nonsense derived metrics (3000 SPM, 12000 s/500m pace,
        // etc.) that distort Logbook's pace-graph y-axis.
        //
        // Thresholds picked to reject noise while keeping real sprint strokes:
        //   period   ≥ 0.7s  (≤ 86 SPM; ErgData's observed max was 81 SPM)
        //   strokeDistance ≥ 2m  (real strokes are 4–12m; taps are <1m)
        const period = rec.driveTimeSec + rec.recoveryTimeSec
        if (period < 0.7 || rec.strokeDistanceMeters < 2) return
        // The stroke characteristic's elapsed/distance fields reset per
        // interval, same as General Status. Bank prior interval totals when
        // a backward jump is detected, then store cumulative values.
        // Detect interval boundary: the stroke char's elapsed resets to ~0
        // at the start of each new interval. Bump the interval counter and
        // clear the dedup trackers so the interval's first stroke isn't
        // rejected as a "close-in-time" duplicate relative to the previous
        // interval's last stroke.
        if (lastStrokeRawElapsed - rec.elapsedSeconds > 1) {
          strokeIntervalIndex++
          lastPushedStrokeCount = -1
          lastPushedRawElapsed  = -1
        }
        lastStrokeRawElapsed = rec.elapsedSeconds

        // Dedupe duplicate fires of the same physical stroke. strokeCount is
        // the authoritative signal when present (u16 at byte 18-19, monotonic
        // across the workout); the time-delta guard is a safety net for
        // firmwares that don't populate it. 0.3s is well below our 0.7s
        // period floor, so real consecutive strokes always pass.
        if (rec.strokeCount > 0 && rec.strokeCount === lastPushedStrokeCount) return
        if (lastPushedRawElapsed >= 0 && rec.elapsedSeconds - lastPushedRawElapsed < 0.3) return
        lastPushedStrokeCount = rec.strokeCount
        lastPushedRawElapsed  = rec.elapsedSeconds

        strokes.push({ ...rec, intervalIndex: strokeIntervalIndex })
      })
      await stroke.startNotifications?.()
    }

    // Split/interval data — fires once per split or interval boundary. The
    // split-internal fields (splitTimeSec, splitDistanceMeters) are already
    // per-segment, but the leading elapsed/distance fields are workout-
    // cumulative-but-reset, so we apply the same epoch banking.
    const split = await rowingService.getCharacteristic(ROW_SPLIT_DATA_UUID).catch(() => null)
    if (split) {
      split.addEventListener?.('characteristicvaluechanged', (event: Event) => {
        const v = (event.target as BLECharacteristic | null)?.value
        if (!v) return
        const rec = parseSplitRecord(v)
        if (!rec) return
        if (lastSplitRawElapsed - rec.elapsedSeconds > 1) {
          splitEpochElapsed += lastSplitRawElapsed
        }
        if (lastSplitRawMeters - rec.distanceMeters > 1) {
          splitEpochMeters += lastSplitRawMeters
        }
        lastSplitRawElapsed = rec.elapsedSeconds
        lastSplitRawMeters  = rec.distanceMeters
        splits.push({
          ...rec,
          elapsedSeconds: splitEpochElapsed + rec.elapsedSeconds,
          distanceMeters: splitEpochMeters  + rec.distanceMeters,
        })
      })
      await split.startNotifications?.()
    }
  } catch {
    // Rowing service unavailable — telemetry/stroke/split accessors stay empty.
  }

  await new Promise(r => setTimeout(r, 250))

  const resetTelemetry = () => {
    elapsedEpochBase = 0
    metersEpochBase  = 0
    lastRawElapsed   = 0
    lastRawMeters    = 0
    prevWorkoutState = null
    workStartsCount  = 0
    endedSticky      = false
    telemetry        = null
    strokes          = []
    splits           = []
    strokeIntervalIndex  = 0
    lastStrokeRawElapsed = 0
    lastPushedStrokeCount = -1
    lastPushedRawElapsed  = -1
    splitEpochElapsed    = 0
    splitEpochMeters     = 0
    lastSplitRawElapsed  = 0
    lastSplitRawMeters   = 0
  }

  return {
    device,
    tx,
    charMap,
    txUuid,
    responses,
    getTelemetry: () => telemetry,
    onTelemetry: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    getStrokes: () => strokes.slice(),
    getSplits:  () => splits.slice(),
    resetTelemetry,
  }
}

// Pick the right write method based on the characteristic's advertised
// properties, falling back through all available methods if the preferred
// one throws. Collects per-attempt errors so we can surface them if all fail.
async function writeChar(
  char: BLECharacteristic,
  data: Uint8Array<ArrayBufferLike>,
): Promise<void> {
  const p = char.properties
  const attempts: Array<{ name: string; run: () => Promise<void> }> = []

  // Order: follow advertised capability; if properties aren't exposed, try
  // withResponse first (PM5 typically advertises WRITE).
  const preferResponse = p ? p.write : true
  const preferWithout  = p ? p.writeWithoutResponse : true

  if (preferResponse && char.writeValueWithResponse) {
    attempts.push({ name: 'writeValueWithResponse', run: () => char.writeValueWithResponse!(data) })
  }
  if (preferWithout && char.writeValueWithoutResponse) {
    attempts.push({ name: 'writeValueWithoutResponse', run: () => char.writeValueWithoutResponse!(data) })
  }
  attempts.push({ name: 'writeValue', run: () => char.writeValue(data) })

  const errors: string[] = []
  for (const { name, run } of attempts) {
    try {
      await run()
      return
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`)
    }
  }
  throw new Error(errors.join(' | '))
}

// Stringifies characteristic properties for error diagnostics.
function propsStr(p: BLECharProperties | undefined): string {
  if (!p) return 'props=unknown'
  const flags = [
    p.write && 'write',
    p.writeWithoutResponse && 'writeWithoutResponse',
    p.notify && 'notify',
    p.read && 'read',
  ].filter(Boolean).join(',')
  return `props=[${flags}]`
}

export async function sendWorkout(
  conn: PM5Connection,
  workout: Workout,
  opts?: EncodeOpts,
): Promise<string> {
  const frames = encodeWorkout(workout, opts)
  const startResponseIdx = conn.responses.length

  // Drop any accumulated state from a prior workout on this connection before
  // the PM starts emitting notifications for the new one.
  conn.resetTelemetry()

  for (let i = 0; i < frames.length; i++) {
    try {
      await writeChar(conn.tx, frames[i])
    } catch (e) {
      const hex = Array.from(frames[i])
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ')
      throw new Error(
        `PM5 write failed on frame ${i + 1}/${frames.length} [${hex}] (tx=${conn.txUuid} ${propsStr(conn.tx.properties)} chars=${conn.charMap}): ${(e as Error).message}`,
      )
    }
    await new Promise(r => setTimeout(r, 30))
  }

  // Give the PM ~400ms to send any response notifications.
  await new Promise(r => setTimeout(r, 400))

  const newResponses = conn.responses.slice(startResponseIdx)
  const summary = `wrote to ${conn.txUuid}; chars=${conn.charMap}; responses=[${newResponses.join(' | ') || 'none'}]`
  return summary
}
