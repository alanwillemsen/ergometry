import { useMemo } from 'react'
import type { FittedProfile } from '../model/pacing'
import { predictWorkout } from '../model/wprime'
import type { Workout, WorkoutSegment } from '../model/workouts'
import { parseTime, formatSplit, formatTime } from '../lib/time'

export type RepKind = 'distance' | 'duration'
export type RestKind = 'distance' | 'duration' | 'none'

export interface EditableSegment {
  count: number
  workKind: RepKind
  workValue: string
  restKind: RestKind
  restValue: string
}

export function emptySegment(): EditableSegment {
  return { count: 1, workKind: 'distance', workValue: '2000', restKind: 'none', restValue: '2:00' }
}

function parseValue(kind: RepKind | 'none', raw: string): number {
  if (kind === 'none') return 0
  if (kind === 'distance') {
    const n = Number(raw)
    return isFinite(n) && n > 0 ? n : NaN
  }
  return parseTime(raw)
}

export function buildWorkoutFromSegments(name: string, segments: EditableSegment[]): Workout | null {
  const built: WorkoutSegment[] = []
  for (const s of segments) {
    if (!isFinite(s.count) || s.count < 1) return null
    const workVal = parseValue(s.workKind, s.workValue)
    if (!isFinite(workVal) || workVal <= 0) return null
    const work =
      s.workKind === 'distance'
        ? { kind: 'distance' as const, meters: workVal }
        : { kind: 'duration' as const, seconds: workVal }
    let rest: WorkoutSegment['rest']
    if (s.restKind === 'none') rest = { kind: 'none' }
    else {
      const restVal = parseValue(s.restKind, s.restValue)
      if (!isFinite(restVal) || restVal <= 0) return null
      rest =
        s.restKind === 'distance'
          ? { kind: 'distance', meters: restVal }
          : { kind: 'duration', seconds: restVal }
    }
    built.push({ count: Math.floor(s.count), work, rest })
  }
  return { id: 'custom', name: name || 'Custom workout', segments: built }
}

export interface WorkoutBuilderProps {
  fit: FittedProfile | null
  name: string
  segments: EditableSegment[]
  onChange: (patch: { name?: string; segments?: EditableSegment[] }) => void
  onSave?: (name: string, segments: EditableSegment[]) => void
  saveLabel?: string
}

export function WorkoutBuilder({ fit, name, segments, onChange, onSave, saveLabel = 'Save to library' }: WorkoutBuilderProps) {
  const workout = useMemo(() => buildWorkoutFromSegments(name, segments), [name, segments])
  const buildError = useMemo(() => {
    if (workout) return null
    const hasZeroRest = segments.some(
      s => s.restKind !== 'none' && parseValue(s.restKind, s.restValue) === 0
    )
    if (hasZeroRest) return 'Rest cannot be 0 — enter a rest duration or switch to "none".'
    return 'Fix the inputs above to see a prediction.'
  }, [workout, segments])
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

  const setSeg = (i: number, patch: Partial<EditableSegment>) => {
    onChange({ segments: segments.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) })
  }
  const addSeg = () => {
    const template = segments.length > 0 ? { ...segments[segments.length - 1] } : emptySegment()
    onChange({ segments: [...segments, template] })
  }
  const removeSeg = (i: number) => {
    if (segments.length === 1) return
    onChange({ segments: segments.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="builder">
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>

      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1
        const restIrrelevant = isLast && seg.count <= 1
        return (
          <div key={i} className="builder-seg">
            <div className={`seg-row ${restIrrelevant ? 'no-rest' : ''}`}>
              <label className="seg-count">
                <span>Reps</span>
                <input
                  type="number"
                  min="1"
                  value={seg.count}
                  onChange={(e) => setSeg(i, { count: Number(e.target.value) })}
                />
              </label>
              <label className="seg-work">
                <span>Work</span>
                <div className="inline">
                  <input
                    type="text"
                    value={seg.workValue}
                    onChange={(e) => setSeg(i, { workValue: e.target.value })}
                    placeholder={seg.workKind === 'distance' ? 'meters' : 'm:ss'}
                  />
                  <select
                    value={seg.workKind}
                    onChange={(e) =>
                      setSeg(i, {
                        workKind: e.target.value as RepKind,
                        workValue: e.target.value === 'distance' ? '2000' : '5:00',
                      })
                    }
                  >
                    <option value="distance">meters</option>
                    <option value="duration">time</option>
                  </select>
                </div>
              </label>
              {!restIrrelevant && (
                <label className="seg-rest">
                  <span>Rest</span>
                  <div className="inline">
                    {seg.restKind !== 'none' && (
                      <input
                        type="text"
                        value={seg.restValue}
                        onChange={(e) => setSeg(i, { restValue: e.target.value })}
                        placeholder={seg.restKind === 'distance' ? 'meters' : 'm:ss'}
                      />
                    )}
                    <select
                      value={seg.restKind}
                      onChange={(e) =>
                        setSeg(i, {
                          restKind: e.target.value as RestKind,
                          restValue:
                            e.target.value === 'distance'
                              ? '500'
                              : e.target.value === 'duration'
                                ? '2:00'
                                : seg.restValue,
                        })
                      }
                    >
                      <option value="duration">time</option>
                      <option value="distance">meters</option>
                      <option value="none">none</option>
                    </select>
                  </div>
                </label>
              )}
              {segments.length > 1 && (
                <button
                  className="link-button"
                  type="button"
                  onClick={() => removeSeg(i)}
                  aria-label="Remove segment"
                >
                  remove
                </button>
              )}
            </div>
            {prediction && prediction.perSegmentSplitsSeconds[i] != null && (() => {
              const split = prediction.perSegmentSplitsSeconds[i]
              const workVal = parseValue(seg.workKind, seg.workValue)
              if (!isFinite(workVal) || workVal <= 0) return null
              const repDetail =
                seg.workKind === 'distance'
                  ? `rep ${formatTime((workVal * split) / 500)}`
                  : `rep ≈ ${((500 * workVal) / split).toFixed(0)}m`
              return (
                <div className="seg-target">
                  target {formatSplit(split)}/500m · {repDetail}
                </div>
              )
            })()}
          </div>
        )
      })}

      <button className="add-seg" type="button" onClick={addSeg}>
        + Add segment
      </button>

      {!workout && <p className="error">{buildError}</p>}
      {workout && fit && prediction && (
        <div className="builder-summary">
          <div className="card-split">
            {formatSplit(prediction.avgSplitSeconds)}
            <span className="unit"> /500m</span>
          </div>
          <div className="card-meta">
            {formatTime(prediction.totalWorkSeconds)} work ·{' '}
            {prediction.totalMeters.toFixed(0)}m
          </div>
          {onSave && (
            <button
              className="save-workout-btn"
              type="button"
              onClick={() => onSave(name, segments)}
            >
              {saveLabel}
            </button>
          )}
        </div>
      )}
      {!fit && <p className="error">Enter a 2K time in Profile to see predictions.</p>}
    </div>
  )
}
