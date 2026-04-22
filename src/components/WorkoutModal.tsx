import { useEffect, useRef, useState } from 'react'
import type { FittedProfile } from '../model/pacing'
import { WorkoutBuilder, emptyInterval, ensureIntervalIds, type EditableInterval } from './WorkoutBuilder'

export type WorkoutModalMode = 'create' | 'edit' | 'view-saved' | 'view-preset'

export interface WorkoutModalProps {
  mode: WorkoutModalMode
  fit: FittedProfile | null
  initialName?: string
  initialIntervals?: EditableInterval[]
  onSave?: (name: string, intervals: EditableInterval[]) => void
  onDelete?: () => void
  onEdit?: () => void
  onCopy?: () => void
  onClose: () => void
}

function titleFor(mode: WorkoutModalMode): string {
  switch (mode) {
    case 'create': return 'Create workout'
    case 'edit': return 'Edit workout'
    case 'view-saved': return 'Workout'
    case 'view-preset': return 'Preset workout'
  }
}

export function WorkoutModal({
  mode,
  fit,
  initialName,
  initialIntervals,
  onSave,
  onDelete,
  onEdit,
  onCopy,
  onClose,
}: WorkoutModalProps) {
  const [name, setName] = useState(initialName ?? 'New workout')
  const [intervals, setIntervals] = useState<EditableInterval[]>(() => {
    const src = initialIntervals && initialIntervals.length > 0 ? initialIntervals : [emptyInterval()]
    return ensureIntervalIds(src)
  })
  const dialogRef = useRef<HTMLDivElement>(null)

  const isView = mode === 'view-saved' || mode === 'view-preset'

  // Stable ref so the popstate handler always has the latest onClose.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Push a history entry on mount so the Android/iOS back gesture dismisses
  // the modal instead of leaving the page.
  // - Back button: popstate fires → onClose().
  // - ×/backdrop/Escape/Save/Delete: call onClose() directly; cleanup pops
  //   the history entry we pushed.
  useEffect(() => {
    // Unique key so the listener ignores stale entries from StrictMode's
    // double-invocation: cleanup calls history.back(), which pops to the
    // key1 entry, not to a non-modal state, so the remounted listener skips it.
    const key = `m${Date.now()}`
    history.pushState({ modalKey: key }, '')
    const handlePop = (e: PopStateEvent) => {
      // Only close when we've navigated back to a non-modal state.
      if (!e.state?.modalKey) onCloseRef.current()
    }
    window.addEventListener('popstate', handlePop)
    return () => {
      window.removeEventListener('popstate', handlePop)
      if (history.state?.modalKey === key) history.back()
    }
  }, [])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

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
    primaryBtn = { label: 'Save workout', onClick: () => onSave(name, intervals) }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={titleFor(mode)}
        ref={dialogRef}
      >
        <header className="modal-header">
          <h2>{titleFor(mode)}</h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="modal-body">
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
        </div>
        {(showDelete || primaryBtn) && (
          <footer className="modal-footer">
            <div className="modal-footer-left">
              {showDelete && (
                <button
                  type="button"
                  className="modal-secondary-btn"
                  onClick={handleDelete}
                >
                  Delete
                </button>
              )}
            </div>
            <div className="modal-footer-right">
              {primaryBtn && (
                <button
                  type="button"
                  className="modal-primary-btn"
                  onClick={primaryBtn.onClick}
                >
                  {primaryBtn.label}
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}
