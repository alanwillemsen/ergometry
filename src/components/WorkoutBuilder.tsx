import { useEffect, useMemo, useRef, useState } from 'react'
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
import { computeIntervalBounds, predictWorkout } from '../model/wprime'
import type { Band, Workout, WorkoutInterval } from '../model/workouts'
import { BANDS } from '../model/workouts'
import { parseTime, formatSplit, formatDuration } from '../lib/time'

export type RepKind = 'distance' | 'duration'
export type RestKind = 'distance' | 'duration' | 'none'

export interface EditableInterval {
  id?: string
  workKind: RepKind
  workValue: string
  restKind: RestKind
  restValue: string
  lockedWbalPercent?: number
  band?: Band
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
  return { id: newIntervalId(), workKind: 'distance', workValue: '2000', restKind: 'none', restValue: '2:00' }
}

function parseValue(kind: RepKind | 'none', raw: string): number {
  if (kind === 'none') return 0
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
    const restKind: RestKind = iv.rest.kind
    const restValue =
      iv.rest.kind === 'distance'
        ? String(iv.rest.meters)
        : iv.rest.kind === 'duration'
          ? formatDuration(iv.rest.seconds)
          : '2:00'
    const e: EditableInterval = { id: newIntervalId(), workKind, workValue, restKind, restValue }
    if (iv.band) e.band = iv.band
    if (typeof iv.lockedWbalPercent === 'number') e.lockedWbalPercent = iv.lockedWbalPercent
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
    if (s.restKind === 'none') rest = { kind: 'none' }
    else {
      const restVal = parseValue(s.restKind, s.restValue)
      if (!isFinite(restVal) || restVal <= 0) return null
      rest =
        s.restKind === 'distance'
          ? { kind: 'distance', meters: restVal }
          : { kind: 'duration', seconds: restVal }
    }
    const iv: WorkoutInterval = { work, rest }
    if (s.band) iv.band = s.band
    else if (typeof s.lockedWbalPercent === 'number') iv.lockedWbalPercent = s.lockedWbalPercent
    built.push(iv)
  }
  return { id: 'custom', name: name || 'Custom workout', intervals: built }
}

export interface WorkoutBuilderProps {
  fit: FittedProfile | null
  name: string
  intervals: EditableInterval[]
  onChange: (patch: { name?: string; intervals?: EditableInterval[] }) => void
  readOnly?: boolean
}

export function WorkoutBuilder({ fit, name, intervals, onChange, readOnly = false }: WorkoutBuilderProps) {
  const [openLockIdx, setOpenLockIdx] = useState<number | null>(null)
  const workout = useMemo(() => buildWorkoutFromIntervals(name, intervals), [name, intervals])
  const buildError = useMemo(() => {
    if (workout) return null
    const hasZeroRest = intervals.some(
      s => s.restKind !== 'none' && parseValue(s.restKind, s.restValue) === 0
    )
    if (hasZeroRest) return 'Rest cannot be 0 — enter a rest duration or switch to "none".'
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
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={readOnly}
        />
      </label>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {intervals.map((iv, i) => (
            <SortableIntervalCard
              key={iv.id ?? `idx-${i}`}
              id={iv.id ?? `idx-${i}`}
              iv={iv}
              idx={i}
              readOnly={readOnly}
              canRemove={intervals.length > 1}
              setInt={setInt}
              setBand={setBand}
              setLock={setLock}
              onDuplicate={() => duplicateInt(i)}
              onRemove={() => removeInt(i)}
              prediction={prediction}
              workout={workout}
              fit={fit}
              openLockIdx={openLockIdx}
              setOpenLockIdx={setOpenLockIdx}
            />
          ))}
        </SortableContext>
      </DndContext>

      {!readOnly && (
        <button className="add-seg" type="button" onClick={addInt}>
          + Add interval
        </button>
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
  setInt: (i: number, patch: Partial<EditableInterval>) => void
  setBand: (i: number, band: Band | undefined) => void
  setLock: (i: number, pct: number | undefined) => void
  onDuplicate: () => void
  onRemove: () => void
  prediction: ReturnType<typeof predictWorkout> | null
  workout: Workout | null
  fit: FittedProfile | null
  openLockIdx: number | null
  setOpenLockIdx: (v: number | null) => void
}

function SortableIntervalCard({
  id,
  iv,
  idx: i,
  readOnly,
  canRemove,
  setInt,
  setBand,
  setLock,
  onDuplicate,
  onRemove,
  prediction,
  workout,
  fit,
  openLockIdx,
  setOpenLockIdx,
}: SortableIntervalCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: readOnly,
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
      className={`builder-seg${isDragging ? ' is-dragging' : ''}`}
    >
      {!readOnly && (
        <div className="seg-toolbar">
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
          <div className="inline">
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
          </div>
        </label>
        <label className="seg-rest">
          <span>Rest</span>
          <div className="inline">
            <input
              type="text"
              value={iv.restKind === 'none' ? '' : iv.restValue}
              onChange={(e) => setInt(i, { restValue: e.target.value })}
              placeholder={
                iv.restKind === 'none'
                  ? ''
                  : iv.restKind === 'distance'
                    ? 'meters'
                    : 'm:ss'
              }
              disabled={readOnly || iv.restKind === 'none'}
            />
            <select
              value={iv.restKind}
              onChange={(e) =>
                setInt(i, {
                  restKind: e.target.value as RestKind,
                  restValue:
                    e.target.value === 'distance'
                      ? '500'
                      : e.target.value === 'duration'
                        ? '2:00'
                        : iv.restValue,
                })
              }
              disabled={readOnly}
            >
              <option value="duration">time</option>
              <option value="distance">meters</option>
              <option value="none">none</option>
            </select>
          </div>
        </label>
      </div>
      {(() => {
        const lockPct = iv.lockedWbalPercent
        const hasLock = typeof lockPct === 'number'
        // At lock = 100% the solver pins P to CP, which is the AT band.
        // Surface that equivalence visually so the slider maps smoothly
        // onto the band pills.
        const atEquivalent = hasLock && lockPct >= 99.5
        // Max pill's fill = "effort level" = (100 − lockPct)%. No lock +
        // no band → fully filled (equivalent to current is-active look).
        const maxFillPct = hasLock
          ? Math.max(0, Math.min(100, 100 - lockPct))
          : iv.band === undefined
            ? 100
            : 0
        const maxPillClass =
          maxFillPct <= 0
            ? 'band-pill'
            : maxFillPct >= 100
              ? 'band-pill is-active'
              : 'band-pill has-fill'
        return (
          <div className="seg-bands" role="group" aria-label="Training band">
            <span className="seg-bands-label">Band</span>
            {BANDS.map((b) => {
              const active = iv.band === b || (b === 'AT' && atEquivalent)
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
              className={maxPillClass}
              style={maxFillPct > 0 && maxFillPct < 100 ? { ['--max-fill' as string]: `${maxFillPct}%` } : undefined}
              onClick={() => setBand(i, undefined)}
              title="Max — hardest feasible pace for this set"
              disabled={readOnly}
            >
              Max
            </button>
          </div>
        )
      })()}
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
        const locked = typeof iv.lockedWbalPercent === 'number'
        const banded = !!iv.band
        const bandSuffix = banded ? ` @ ${iv.band}` : ''
        return (
          <div className="seg-target">
            <div>
            target <span className="seg-split-hi">{formatSplit(split)}<span className="seg-split-unit">/500m</span></span>
            {bandSuffix} · {repDetail}
          </div>
            {pct != null && (
              <div className="seg-battery">
                <BatteryButton
                  pct={pct}
                  locked={locked}
                  banded={banded || readOnly}
                  hideLockBadge={readOnly}
                  onClick={
                    readOnly || banded ? undefined : () => setOpenLockIdx(openLockIdx === i ? null : i)
                  }
                />
              </div>
            )}
            {!readOnly && !banded && openLockIdx === i && workout && fit && (
              <BatteryLockPanel
                workout={workout}
                intervalIdx={i}
                fit={fit}
                currentPct={pct ?? 0}
                locked={locked}
                lockedValue={iv.lockedWbalPercent}
                onChange={(pctVal) => setLock(i, pctVal)}
                onClose={() => setOpenLockIdx(null)}
              />
            )}
          </div>
        )
      })()}
    </div>
  )
}

function BatteryButton({
  pct,
  locked,
  banded,
  hideLockBadge,
  onClick,
}: {
  pct: number
  locked: boolean
  banded?: boolean
  hideLockBadge?: boolean
  onClick?: () => void
}) {
  const title = banded
    ? `${pct.toFixed(0)}% anaerobic battery at end of interval (set by band)`
    : locked
      ? `Locked at ${pct.toFixed(0)}% anaerobic battery — click to adjust`
      : `${pct.toFixed(0)}% anaerobic battery remaining — click to lock`
  const clickable = !!onClick && !banded
  return (
    <button
      type="button"
      className={`battery-indicator battery-button${locked ? ' is-locked' : ''}${banded ? ' is-banded' : ''}`}
      title={title}
      onClick={clickable ? onClick : undefined}
      aria-label={title}
      disabled={!clickable}
    >
      <div className="battery-bar">
        <div className="battery-fill" style={{ width: `${pct}%` }} />
        <div className="battery-text">{pct.toFixed(0)}%</div>
      </div>
      <div className="battery-terminal" />
      {!hideLockBadge && locked && (
        <svg className="battery-lock-badge" aria-hidden="true"
          width="11" height="13" viewBox="0 0 10 12"
          fill="none" stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <rect x="1.5" y="5" width="7" height="6" rx="1" />
          <path d="M3.25 5V3.5a1.75 1.75 0 0 1 3.5 0V5" />
        </svg>
      )}
      {!hideLockBadge && clickable && !locked && (
        <svg className="battery-lock-badge battery-unlock-badge" aria-hidden="true"
          width="13" height="13" viewBox="0 0 10 12"
          fill="none" stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <rect x="1.5" y="5" width="7" height="6" rx="1" />
          <path d="M6.5 5V3a2 2 0 0 1 4 0V5" />
        </svg>
      )}
    </button>
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

function BatteryLockPanel({
  workout,
  intervalIdx,
  fit,
  currentPct,
  locked,
  lockedValue,
  onChange,
  onClose,
}: {
  workout: Workout
  intervalIdx: number
  fit: FittedProfile
  currentPct: number
  locked: boolean
  lockedValue: number | undefined
  onChange: (pct: number | undefined) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  const bounds = useMemo(() => {
    // Strip this interval's own lock when computing bounds so the slider range
    // reflects what's achievable independently of the current setting.
    const probe: Workout = {
      ...workout,
      intervals: workout.intervals.map((iv, idx) =>
        idx === intervalIdx && iv.lockedWbalPercent !== undefined
          ? { work: iv.work, rest: iv.rest }
          : iv,
      ),
    }
    return computeIntervalBounds(
      probe,
      intervalIdx,
      fit.cpWatts,
      fit.wPrimeJoules,
      undefined,
      fit.decayK,
      fit.wPrimeMortonJoules,
      fit.kSeconds,
    )
  }, [workout, intervalIdx, fit])

  // Slider uses 0.1 % steps so the steep region near P=CP is resolvable.
  const min = Math.floor(bounds.minPct * 10) / 10
  const max = Math.ceil(bounds.maxPct * 10) / 10
  const drainMax = bounds.drainMaxPct
  const recoveryMin = bounds.recoveryMinPct
  // A physical "forbidden zone" exists where no constant pace reaches the
  // target. Snap slider drags through it to the nearer endpoint so the slider
  // only lands on values the solver can actually hit.
  const hasGap = recoveryMin - drainMax > 1
  const snap = (v: number): number => {
    if (!hasGap) return v
    if (v <= drainMax) return v
    if (v >= recoveryMin) return v
    // In the gap: jump to the closer edge. Tie → recoveryMin (so a drag from 0
    // pops over to where splits start changing, matching user expectation).
    return v - drainMax < recoveryMin - v ? drainMax : recoveryMin
  }
  const sliderValue = locked && lockedValue !== undefined ? lockedValue : currentPct
  const rounded = Math.round(sliderValue * 10) / 10
  const clamped = Math.max(min, Math.min(max, rounded))

  return (
    <div className="lock-panel" ref={ref}>
      <div className="lock-panel-row">
        <label className="lock-slider-label">
          <span>Lock anaerobic battery at end of this interval</span>
          <input
            type="range"
            min={min}
            max={max}
            step={0.1}
            value={clamped}
            onChange={(e) => onChange(snap(Number(e.target.value)))}
            onInput={(e) => onChange(snap(Number((e.target as HTMLInputElement).value)))}
          />
          <span className="lock-slider-value">
            <strong>{clamped.toFixed(1)}%</strong>
            <span className="lock-slider-range">
              {hasGap
                ? `range ${min.toFixed(1)}, ${recoveryMin.toFixed(1)}–${max.toFixed(1)}%`
                : `range ${min.toFixed(1)}–${max.toFixed(1)}%`}
            </span>
          </span>
        </label>
      </div>
      {locked && lockedValue !== undefined && Math.abs(lockedValue - currentPct) > 1 && (
        <p className="lock-panel-warning">
          ⚠ target unreachable given earlier settings — actual will be{' '}
          {Math.round(currentPct)}%.
        </p>
      )}
      <div className="lock-panel-actions">
        {locked && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              onChange(undefined)
            }}
          >
            Unlock
          </button>
        )}
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
