import { useCallback, useEffect, useRef, useState } from 'react'
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

  // Keep a stable ref so the popstate handler always calls the latest onClose
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Push a history entry on mount so the Android/iOS back gesture dismisses
  // the modal instead of leaving the page. All close paths go through
  // handleClose, which pops the entry; popstate then fires onClose.
  // Programmatic closes (Save, Delete) skip handleClose — the cleanup pops
  // the entry they left behind.
  useEffect(() => {
    history.pushState({ modal: true }, '')
    const handlePop = () => onCloseRef.current()
    window.addEventListener('popstate', handlePop)
    return () => {
      window.removeEventListener('popstate', handlePop)
      if (history.state?.modal) history.back()
    }
  }, [])

  const handleClose = useCallback(() => {
    if (history.state?.modal) {
      history.back() // popstate fires → onClose
    } else {
      onClose()
    }
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleClose])

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
        if (e.target === e.currentTarget) handleClose()
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
            onClick={handleClose}
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
