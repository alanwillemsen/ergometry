import { useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { FittedProfile } from '../model/pacing'
import { predictWorkout } from '../model/wprime'
import type { Band, Workout, WorkoutInterval } from '../model/workouts'
import { BANDS, extractSpmRange } from '../model/workouts'
import { parseTime, formatSplit, formatDuration } from '../lib/time'

export type RepKind = 'distance' | 'duration'

// restValue is always m:ss — "0:00" means no rest. The input defaults to
// "0:00" and snaps back to that on blur if cleared. The PM5 doesn't support
// distance-based rest, so there's no explicit kind to choose.
export interface EditableInterval {
  id?: string
  workKind: RepKind
  workValue: string
  restValue: string
  lockedWbalPercent?: number
  band?: Band
  // Free-form coaching note (e.g. "r22-24, neg split rep 1"). Rate target is
  // auto-extracted from this string at display time.
  notes?: string
}

let intervalIdCounter = 0
function newIntervalId(): string {
  intervalIdCounter += 1
  return `iv-${Date.now().toString(36)}-${intervalIdCounter.toString(36)}`
}

export function ensureIntervalIds(intervals: EditableInterval[]): EditableInterval[] {
  const seen = new Set<string>()
  return intervals.map((iv) => {
    if (iv.id && !seen.has(iv.id)) {
      seen.add(iv.id)
      return iv
    }
    const id = newIntervalId()
    seen.add(id)
    return { ...iv, id }
  })
}

export function emptyInterval(): EditableInterval {
  return { id: newIntervalId(), workKind: 'duration', workValue: '5:00', restValue: '0:00' }
}

function parseValue(kind: RepKind, raw: string): number {
  if (kind === 'distance') {
    const n = Number(raw)
    return isFinite(n) && n > 0 ? n : NaN
  }
  return parseTime(raw)
}

export function workoutToEditableIntervals(workout: Workout): EditableInterval[] {
  return workout.intervals.map((iv) => {
    const workKind: RepKind = iv.work.kind
    const workValue =
      iv.work.kind === 'distance' ? String(iv.work.meters) : formatDuration(iv.work.seconds)
    const restValue = iv.rest.kind === 'duration' ? formatDuration(iv.rest.seconds) : '0:00'
    const e: EditableInterval = { id: newIntervalId(), workKind, workValue, restValue }
    if (iv.band) e.band = iv.band
    if (typeof iv.lockedWbalPercent === 'number') e.lockedWbalPercent = iv.lockedWbalPercent
    if (iv.notes) e.notes = iv.notes
    return e
  })
}

export function buildWorkoutFromIntervals(name: string, intervals: EditableInterval[]): Workout | null {
  const built: WorkoutInterval[] = []
  for (const s of intervals) {
    const workVal = parseValue(s.workKind, s.workValue)
    if (!isFinite(workVal) || workVal <= 0) return null
    const work =
      s.workKind === 'distance'
        ? { kind: 'distance' as const, meters: workVal }
        : { kind: 'duration' as const, seconds: workVal }
    let rest: WorkoutInterval['rest']
    const restRaw = s.restValue.trim()
    if (restRaw === '') {
      rest = { kind: 'none' }
    } else {
      const restVal = parseTime(restRaw)
      if (!isFinite(restVal) || restVal < 0) return null
      rest = restVal === 0 ? { kind: 'none' } : { kind: 'duration', seconds: restVal }
    }
    const iv: WorkoutInterval = { work, rest }
    if (s.band) iv.band = s.band
    else if (typeof s.lockedWbalPercent === 'number') iv.lockedWbalPercent = s.lockedWbalPercent
    if (s.notes && s.notes.trim() !== '') iv.notes = s.notes.trim()
    built.push(iv)
  }
  return { id: 'custom', name: name || 'Custom workout', intervals: built }
}

// ── WorkoutBuilder ────────────────────────────────────────────────────────────

export interface WorkoutBuilderProps {
  fit: FittedProfile | null
  name: string
  intervals: EditableInterval[]
  onChange: (patch: { name?: string; intervals?: EditableInterval[] }) => void
  readOnly?: boolean
}

export function WorkoutBuilder({ fit, name, intervals, onChange, readOnly = false }: WorkoutBuilderProps) {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const enterSelectMode = () => setSelectMode(true)
  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }
  const toggleSelect = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const copySelected = () => {
    if (selected.size === 0) return
    const entries = intervals
      .map((iv, i) => ({ iv, i, id: iv.id ?? `idx-${i}` }))
      .filter(({ id }) => selected.has(id))
    if (entries.length === 0) return
    const lastIdx = entries[entries.length - 1].i
    const copies = entries.map(({ iv }) => ({ ...iv, id: newIntervalId() }))
    const next = intervals.slice()
    next.splice(lastIdx + 1, 0, ...copies)
    onChange({ intervals: next })
    exitSelectMode()
  }
  const workout = useMemo(() => buildWorkoutFromIntervals(name, intervals), [name, intervals])
  const buildError = useMemo(() => {
    if (workout) return null
    const hasBadRest = intervals.some((s) => {
      const raw = s.restValue.trim()
      if (raw === '') return false
      const v = parseTime(raw)
      return !isFinite(v) || v < 0
    })
    if (hasBadRest) return 'Invalid rest duration — enter m:ss (use 0:00 for no rest).'
    return 'Fix the inputs above to see a prediction.'
  }, [workout, intervals])
  const prediction = useMemo(() => {
    if (!workout || !fit) return null
    return predictWorkout(
      workout,
      fit.cpWatts,
      fit.wPrimeJoules,
      undefined,
      0,
      fit.decayK,
      fit.wPrimeMortonJoules,
      fit.kSeconds,
    )
  }, [workout, fit])

  const setInt = (i: number, patch: Partial<EditableInterval>) => {
    onChange({ intervals: intervals.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) })
  }
  const setLock = (i: number, pct: number | undefined) => {
    onChange({
      intervals: intervals.map((s, idx) => {
        if (idx !== i) return s
        if (pct === undefined) {
          const next = { ...s }
          delete next.lockedWbalPercent
          return next
        }
        // Setting a lock clears any band (they're mutually exclusive).
        const next = { ...s, lockedWbalPercent: pct }
        delete next.band
        return next
      }),
    })
  }
  const setBand = (i: number, band: Band | undefined) => {
    onChange({
      intervals: intervals.map((s, idx) => {
        if (idx !== i) return s
        const next = { ...s }
        if (band === undefined) {
          // "Max" means default/unconstrained — clear both band and any lock
          // so clicking Max visibly resets the interval to solo-max pacing.
          delete next.band
          delete next.lockedWbalPercent
        } else {
          next.band = band
          // Band overrides lock — clear any lock that was set on this interval.
          delete next.lockedWbalPercent
        }
        return next
      }),
    })
  }
  // Toggle the "Anaerobic" pill. On activation, default the lock to the
  // midpoint of the slider's range: left endpoint = end-of-interval W'bal
  // when this interval runs at AT (P=CP), right endpoint = end-of-interval
  // W'bal under Max pacing (the holistic solver). Without a fit, fall back
  // to 50%.
  const setAnaerobic = (i: number, on: boolean) => {
    if (!on) {
      setLock(i, undefined)
      return
    }
    let defaultPct = 50
    if (workout && fit) {
      const ends = computeAnaerobicEndpoints(workout, i, fit)
      if (ends) defaultPct = Math.round(((ends.atEndPct + ends.maxEndPct) / 2) * 10) / 10
    }
    onChange({
      intervals: intervals.map((s, idx) => {
        if (idx !== i) return s
        const next = { ...s, lockedWbalPercent: defaultPct }
        delete next.band
        return next
      }),
    })
  }
  const addInt = () => {
    const template = intervals.length > 0
      ? { ...intervals[intervals.length - 1], id: newIntervalId() }
      : emptyInterval()
    onChange({ intervals: [...intervals, template] })
  }
  const duplicateInt = (i: number) => {
    const source = intervals[i]
    if (!source) return
    const copy = { ...source, id: newIntervalId() }
    const next = intervals.slice()
    next.splice(i + 1, 0, copy)
    onChange({ intervals: next })
  }
  const removeInt = (i: number) => {
    if (intervals.length === 1) return
    onChange({ intervals: intervals.filter((_, idx) => idx !== i) })
  }
  const reorderInt = (activeId: string, overId: string) => {
    const from = intervals.findIndex((iv) => iv.id === activeId)
    const to = intervals.findIndex((iv) => iv.id === overId)
    if (from < 0 || to < 0 || from === to) return
    const next = intervals.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange({ intervals: next })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorderInt(String(active.id), String(over.id))
    }
  }

  const sortableIds = useMemo(
    () => intervals.map((iv, idx) => iv.id ?? `idx-${idx}`),
    [intervals],
  )

  return (
    <div className={`builder${readOnly ? ' is-readonly' : ''}`}>
      {!readOnly && (
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {intervals.map((iv, i) => {
            const id = iv.id ?? `idx-${i}`
            return (
              <SortableIntervalCard
                key={id}
                id={id}
                iv={iv}
                idx={i}
                readOnly={readOnly}
                canRemove={intervals.length > 1}
                selectMode={selectMode}
                isSelected={selected.has(id)}
                onToggleSelect={() => toggleSelect(id)}
                setInt={setInt}
                setBand={setBand}
                setLock={setLock}
                setAnaerobic={setAnaerobic}
                onDuplicate={() => duplicateInt(i)}
                onRemove={() => removeInt(i)}
                prediction={prediction}
                workout={workout}
                fit={fit}
              />
            )
          })}
        </SortableContext>
      </DndContext>

      {!readOnly && !selectMode && (
        <div className="seg-controls">
          <button className="add-seg" type="button" onClick={addInt}>
            + Add interval
          </button>
          {intervals.length >= 2 && (
            <button className="select-btn" type="button" onClick={enterSelectMode}>
              Select
            </button>
          )}
        </div>
      )}
      {!readOnly && selectMode && (
        <div className="seg-controls">
          <button
            className="copy-selected-btn"
            type="button"
            onClick={copySelected}
            disabled={selected.size === 0}
          >
            {selected.size === 0
              ? 'Select intervals above'
              : `Duplicate ${selected.size} interval${selected.size > 1 ? 's' : ''}`}
          </button>
          <button className="cancel-select-btn" type="button" onClick={exitSelectMode}>
            Cancel
          </button>
        </div>
      )}

      {!workout && <p className="error">{buildError}</p>}
      {workout && fit && prediction && (
        <div className="builder-summary">
          <div className="card-split">
            {formatSplit(prediction.avgSplitSeconds)}
            <span className="unit"> /500m</span>
          </div>
          <div className="card-meta">
            {formatDuration(prediction.totalWorkSeconds)} work ·{' '}
            {prediction.totalMeters.toFixed(0)}m
          </div>
        </div>
      )}
      {!fit && <p className="error">Enter a 2K time in Profile to see predictions.</p>}
    </div>
  )
}

interface SortableIntervalCardProps {
  id: string
  iv: EditableInterval
  idx: number
  readOnly: boolean
  canRemove: boolean
  selectMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
  setInt: (i: number, patch: Partial<EditableInterval>) => void
  setBand: (i: number, band: Band | undefined) => void
  setLock: (i: number, pct: number | undefined) => void
  setAnaerobic: (i: number, on: boolean) => void
  onDuplicate: () => void
  onRemove: () => void
  prediction: ReturnType<typeof predictWorkout> | null
  workout: Workout | null
  fit: FittedProfile | null
}

function SortableIntervalCard({
  id,
  iv,
  idx: i,
  readOnly,
  canRemove,
  selectMode,
  isSelected,
  onToggleSelect,
  setInt,
  setBand,
  setLock,
  setAnaerobic,
  onDuplicate,
  onRemove,
  prediction,
  workout,
  fit,
}: SortableIntervalCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: readOnly || selectMode,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`builder-seg${isDragging ? ' is-dragging' : ''}${isSelected ? ' is-selected' : ''}`}
    >
      {!readOnly && (
        <div className="seg-toolbar">
          <div className="seg-toolbar-left">
            {selectMode && (
              <input
                type="checkbox"
                className="seg-checkbox"
                checked={isSelected}
                onChange={onToggleSelect}
                aria-label={`Select interval ${i + 1}`}
              />
            )}
            <span className="seg-index">{i + 1}</span>
            <button
              type="button"
              className="drag-handle"
              aria-label="Reorder interval"
              title="Drag to reorder"
              {...attributes}
              {...listeners}
            >
              ⠿
            </button>
          </div>
          <div className="seg-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="Duplicate interval"
              title="Duplicate interval"
              onClick={onDuplicate}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              aria-label="Remove interval"
              title="Remove interval"
              onClick={onRemove}
              disabled={!canRemove}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <div className="seg-row">
        <label className="seg-work">
          <span>Work</span>
          <input
            type="text"
            value={iv.workValue}
            onChange={(e) => setInt(i, { workValue: e.target.value })}
            placeholder={iv.workKind === 'distance' ? 'meters' : 'm:ss'}
            disabled={readOnly}
          />
          <select
            value={iv.workKind}
            onChange={(e) =>
              setInt(i, {
                workKind: e.target.value as RepKind,
                workValue: e.target.value === 'distance' ? '2000' : '5:00',
              })
            }
            disabled={readOnly}
          >
            <option value="distance">meters</option>
            <option value="duration">time</option>
          </select>
        </label>
        {(() => {
          const restNum = parseTime(iv.restValue)
          const restIsZero = isFinite(restNum) && restNum === 0
          return (
            <label className={`seg-rest${restIsZero ? ' is-zero' : ''}`}>
              <span>Rest</span>
              <input
                type="text"
                value={iv.restValue}
                onChange={(e) => setInt(i, { restValue: e.target.value })}
                onBlur={(e) => {
                  if (e.target.value.trim() === '') setInt(i, { restValue: '0:00' })
                }}
                placeholder="m:ss"
                disabled={readOnly}
              />
            </label>
          )
        })()}
      </div>
      <label className="seg-notes">
        <span>Notes</span>
        <input
          type="text"
          value={iv.notes ?? ''}
          onChange={(e) => setInt(i, { notes: e.target.value })}
          disabled={readOnly}
        />
      </label>
      {(() => {
        const hasLock = typeof iv.lockedWbalPercent === 'number'
        const anaerobicActive = !iv.band && hasLock
        const maxActive = !iv.band && !hasLock
        return (
          <div className="seg-bands" role="group" aria-label="Training band">
            <span className="seg-bands-label">Band</span>
            {BANDS.map((b) => {
              const active = iv.band === b
              return (
                <button
                  key={b}
                  type="button"
                  className={`band-pill${active ? ' is-active' : ''}`}
                  onClick={() => setBand(i, iv.band === b ? undefined : b)}
                  title={bandDescription(b)}
                  disabled={readOnly}
                >
                  {b}
                </button>
              )
            })}
            <button
              type="button"
              className={`band-pill${anaerobicActive ? ' is-active' : ''}`}
              onClick={() => setAnaerobic(i, !anaerobicActive)}
              title="Anaerobic — between AT and max (use the slider to set intensity)"
              disabled={readOnly}
            >
              Anaerobic
            </button>
            <button
              type="button"
              className={`band-pill${maxActive ? ' is-active' : ''}`}
              onClick={() => setBand(i, undefined)}
              title="Max — hardest feasible pace for this set"
              disabled={readOnly}
            >
              Max
            </button>
          </div>
        )
      })()}
      {!readOnly && !iv.band && typeof iv.lockedWbalPercent === 'number' && workout && fit && (
        <AnaerobicSlider
          workout={workout}
          intervalIdx={i}
          fit={fit}
          currentPct={
            prediction?.perIntervalWbalPercent[i] != null
              ? Math.max(0, Math.min(100, prediction.perIntervalWbalPercent[i]))
              : iv.lockedWbalPercent
          }
          lockedValue={iv.lockedWbalPercent}
          onChange={(pctVal) => setLock(i, pctVal)}
        />
      )}
      {prediction && prediction.perIntervalSplitsSeconds[i] != null && (() => {
        const split = prediction.perIntervalSplitsSeconds[i]
        const workVal = parseValue(iv.workKind, iv.workValue)
        if (!isFinite(workVal) || workVal <= 0) return null
        const repDetail =
          iv.workKind === 'distance'
            ? `interval ${formatDuration((workVal * split) / 500)}`
            : `interval ≈ ${((500 * workVal) / split).toFixed(0)}m`
        const pctRaw = prediction.perIntervalWbalPercent[i]
        const pct = pctRaw != null ? Math.max(0, Math.min(100, pctRaw)) : null
        const banded = !!iv.band
        const bandSuffix = banded ? ` @ ${iv.band}` : ''
        const rateParsed = extractSpmRange(iv.notes)
        const rateLabel = rateParsed
          ? rateParsed.min === rateParsed.max
            ? ` · r${rateParsed.min}`
            : ` · r${rateParsed.min}-${rateParsed.max}`
          : ''
        return (
          <div className="seg-target">
            <div className="seg-target-row">
              <div>
                target <span className="seg-split-hi">{formatSplit(split)}<span className="seg-split-unit">/500m</span></span>
                {bandSuffix} · {repDetail}{rateLabel}
              </div>
              {pct != null && <BatteryIndicator pct={pct} />}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function BatteryIndicator({ pct }: { pct: number }) {
  const title = `${pct.toFixed(0)}% anaerobic battery at end of interval`
  return (
    <div className="battery-indicator" title={title} aria-label={title}>
      <div className="battery-bar">
        <div className="battery-fill" style={{ width: `${pct}%` }} />
        <div className="battery-text">{pct.toFixed(0)}%</div>
      </div>
      <div className="battery-terminal" />
    </div>
  )
}

function bandDescription(b: Band): string {
  switch (b) {
    case 'UT2':
      return 'Utilisation 2 — deep aerobic, 75% of CP'
    case 'UT1':
      return 'Utilisation 1 — top aerobic, 90% of CP'
    case 'AT':
      return 'Anaerobic threshold — at CP'
  }
}

// Compute the W'bal % at end of this interval under the two Anaerobic-slider
// endpoint scenarios: this interval at AT (P=CP, left end) vs this interval
// in Max mode (holistic solver, right end). Other intervals keep their
// existing band/lock settings so the slider's endpoints exactly mirror what
// would happen if the user clicked the AT or Max pill for this interval.
// Returns null if predictions are unavailable.
function computeAnaerobicEndpoints(
  workout: Workout,
  intervalIdx: number,
  fit: FittedProfile,
): { atEndPct: number; maxEndPct: number } | null {
  const probeWith = (override: { band?: Band }): Workout => ({
    ...workout,
    intervals: workout.intervals.map((iv, idx) =>
      idx === intervalIdx
        ? { work: iv.work, rest: iv.rest, ...(override.band ? { band: override.band } : {}) }
        : iv,
    ),
  })
  const predAt = predictWorkout(
    probeWith({ band: 'AT' }),
    fit.cpWatts, fit.wPrimeJoules, undefined, 0,
    fit.decayK, fit.wPrimeMortonJoules, fit.kSeconds,
  )
  const predMax = predictWorkout(
    probeWith({}),
    fit.cpWatts, fit.wPrimeJoules, undefined, 0,
    fit.decayK, fit.wPrimeMortonJoules, fit.kSeconds,
  )
  const atEndPct = predAt.perIntervalWbalPercent[intervalIdx]
  const maxEndPct = predMax.perIntervalWbalPercent[intervalIdx]
  if (atEndPct == null || maxEndPct == null) return null
  return {
    atEndPct: Math.max(0, Math.min(100, atEndPct)),
    maxEndPct: Math.max(0, Math.min(100, maxEndPct)),
  }
}

// Slider for the "Anaerobic" pill. Axis is intensity (0 = AT on the left,
// 100 = Max on the right). Internally maps to a lockedWbalPercent that runs
// between the AT-pill outcome (full battery, P=CP) and the Max-pill outcome
// (the holistic solver's end W'bal for this interval). Picking either
// endpoint yields the same split as clicking the corresponding pill.
function AnaerobicSlider({
  workout,
  intervalIdx,
  fit,
  currentPct,
  lockedValue,
  onChange,
}: {
  workout: Workout
  intervalIdx: number
  fit: FittedProfile
  currentPct: number
  lockedValue: number
  onChange: (pct: number) => void
}) {
  const ends = useMemo(
    () => computeAnaerobicEndpoints(workout, intervalIdx, fit),
    [workout, intervalIdx, fit],
  )

  if (!ends) {
    // No prediction available (shouldn't happen given the render guard, but
    // bail out gracefully rather than crash).
    return null
  }

  const atEnd = ends.atEndPct
  const maxEnd = ends.maxEndPct
  // AT end is the "easier" side → higher W'bal remaining. If the two ends
  // collapse (e.g. very long aerobic-only interval where Max ≈ AT) the
  // slider has no range; treat any value as the single endpoint.
  const lo = Math.min(atEnd, maxEnd)
  const hi = Math.max(atEnd, maxEnd)
  const range = hi - lo

  const lockFromIntensity = (it: number) => atEnd - (it / 100) * (atEnd - maxEnd)
  const intensityFromLock = (lp: number) =>
    range > 0 ? Math.max(0, Math.min(100, ((atEnd - lp) / (atEnd - maxEnd)) * 100)) : 0

  const clampedLock = Math.max(lo, Math.min(hi, lockedValue))
  const intensity = intensityFromLock(clampedLock)

  const handle = (raw: number) => {
    const lp = lockFromIntensity(raw)
    onChange(Math.round(lp * 10) / 10)
  }

  return (
    <div className="anaerobic-slider">
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={intensity}
        onChange={(e) => handle(Number(e.target.value))}
        onInput={(e) => handle(Number((e.target as HTMLInputElement).value))}
        aria-label="Anaerobic intensity from AT (left) to Max (right)"
      />
      <div className="anaerobic-slider-ticks" aria-hidden="true">
        {Array.from({ length: 11 }).map((_, k) => (
          <span key={k} />
        ))}
      </div>
      <div className="anaerobic-slider-ends" aria-hidden="true">
        <span>AT</span>
        <span>Max</span>
      </div>
      {Math.abs(clampedLock - currentPct) > 1 && (
        <p className="lock-panel-warning">
          ⚠ target unreachable given earlier settings — actual will be{' '}
          {Math.round(currentPct)}%.
        </p>
      )}
    </div>
  )
}
