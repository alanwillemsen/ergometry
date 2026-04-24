import { useEffect, useMemo, useState } from 'react'
import type { FittedProfile } from '../model/pacing'
import {
  WorkoutBuilder,
  buildWorkoutFromIntervals,
  emptyInterval,
  ensureIntervalIds,
  type EditableInterval,
} from './WorkoutBuilder'
import { PM5Controls } from './PM5Controls'
import { predictWorkout } from '../model/wprime'
import type { PM5State } from '../lib/pm5State'
import type { Concept2State } from '../lib/concept2State'

export type WorkoutViewMode = 'create' | 'edit' | 'view-saved' | 'view-preset'
type SubTab = 'builder' | 'pm5'

export interface WorkoutViewProps {
  mode: WorkoutViewMode
  fit: FittedProfile | null
  pm5: PM5State
  concept2: Concept2State
  initialName?: string
  initialIntervals?: EditableInterval[]
  onSave?: (name: string, intervals: EditableInterval[]) => void
  onDelete?: () => void
  onEdit?: () => void
  onCopy?: () => void
  onClose: () => void
}

function titleFor(mode: WorkoutViewMode, name: string): string {
  switch (mode) {
    case 'create': return 'Create workout'
    case 'edit': return 'Edit workout'
    case 'view-saved':
    case 'view-preset':
      return name
  }
}

export function WorkoutView({
  mode,
  fit,
  pm5,
  concept2,
  initialName,
  initialIntervals,
  onSave,
  onDelete,
  onEdit,
  onCopy,
  onClose,
}: WorkoutViewProps) {
  const [name, setName] = useState(initialName ?? 'New workout')
  const [intervals, setIntervals] = useState<EditableInterval[]>(() => {
    const src = initialIntervals && initialIntervals.length > 0 ? initialIntervals : [emptyInterval()]
    return ensureIntervalIds(src)
  })
  const [subTab, setSubTab] = useState<SubTab>('builder')

  const workout = useMemo(() => buildWorkoutFromIntervals(name, intervals), [name, intervals])
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

  const isView = mode === 'view-saved' || mode === 'view-preset'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleDelete = () => {
    if (!onDelete) return
    if (!confirm('Delete this workout?')) return
    onDelete()
  }

  const showDelete = (mode === 'edit' || mode === 'view-saved') && !!onDelete

  let primaryBtn: { label: string; onClick: () => void } | null = null
  if (mode === 'view-saved' && onEdit) {
    primaryBtn = { label: 'Edit', onClick: onEdit }
  } else if (mode === 'view-preset' && onCopy) {
    primaryBtn = { label: 'Copy to my workouts', onClick: onCopy }
  } else if (mode === 'edit' && onSave) {
    primaryBtn = { label: 'Update workout', onClick: () => onSave(name, intervals) }
  } else if (mode === 'create' && onSave) {
    primaryBtn = { label: 'Save', onClick: () => onSave(name, intervals) }
  }

  return (
    <section className="workout-view">
      <header className="view-header">
        <button
          type="button"
          className="view-back-btn"
          onClick={onClose}
          aria-label="Back to workouts"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h2>{titleFor(mode, name)}</h2>
        <div className="view-header-spacer" />
      </header>

      <nav className="view-tab-bar" role="tablist">
        <button
          role="tab"
          aria-selected={subTab === 'builder'}
          className={`tab-btn${subTab === 'builder' ? ' active' : ''}`}
          onClick={() => setSubTab('builder')}
        >
          Workout
        </button>
        <button
          role="tab"
          aria-selected={subTab === 'pm5'}
          className={`tab-btn${subTab === 'pm5' ? ' active' : ''}`}
          onClick={() => setSubTab('pm5')}
        >
          PM5
        </button>
      </nav>

      {subTab === 'builder' && (
        <div className="view-panel">
          <WorkoutBuilder
            fit={fit}
            name={name}
            intervals={intervals}
            readOnly={isView}
            onChange={(patch) => {
              if (patch.name !== undefined) setName(patch.name)
              if (patch.intervals !== undefined) setIntervals(patch.intervals)
            }}
          />
          {(showDelete || primaryBtn) && (
            <div className="view-footer-actions">
              <div className="view-footer-left">
                {showDelete && (
                  <button
                    type="button"
                    className="view-secondary-btn"
                    onClick={handleDelete}
                  >
                    Delete
                  </button>
                )}
              </div>
              <div className="view-footer-right">
                {primaryBtn && (
                  <button
                    type="button"
                    className="view-primary-btn"
                    onClick={primaryBtn.onClick}
                  >
                    {primaryBtn.label}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'pm5' && (
        <div className="view-panel">
          <PM5Controls
            workout={workout}
            prediction={prediction}
            pm5={pm5}
            concept2={concept2}
          />
          {!workout && (
            <p className="error">Fix the workout before uploading.</p>
          )}
        </div>
      )}
    </section>
  )
}
