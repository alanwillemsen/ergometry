import { forwardRef, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react'
import type { Workout, WorkoutPrediction, WorkoutSegment } from '../model/workouts'
import { formatSplit, formatTime } from '../lib/time'

function repTargets(segments: WorkoutSegment[], prediction: WorkoutPrediction, isOwned: boolean): string[] {
  const parts: string[] = []
  if (isOwned && segments.length > 1) {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (seg.count < 1) continue
      const splitStr = formatSplit(prediction.perSegmentSplitsSeconds[i])
      const prefix = seg.count > 1 ? `${seg.count} × ` : ''
      const restStr =
        seg.rest.kind === 'duration' ? `, ${formatTime(seg.rest.seconds)}r`
        : seg.rest.kind === 'distance' ? `, ${seg.rest.meters}m r`
        : ''
      if (seg.work.kind === 'distance') {
        parts.push(`${prefix}${seg.work.meters}m @ ${splitStr}${restStr}`)
      } else {
        parts.push(`${prefix}${formatTime(seg.work.seconds)} @ ${splitStr}${restStr}`)
      }
    }
  } else {
    const splitSeconds = prediction.avgSplitSeconds
    for (const seg of segments) {
      if (seg.count < 1) continue
      if (seg.work.kind === 'distance') {
        if (seg.count === 1) continue
        parts.push(`${seg.count} × ${seg.work.meters}m in ${formatTime((seg.work.meters * splitSeconds) / 500)}`)
      } else {
        parts.push(`${seg.count} × ${formatTime(seg.work.seconds)} ≈ ${((500 * seg.work.seconds) / splitSeconds).toFixed(0)}m`)
      }
    }
  }
  return parts
}

type DragHandleProps = HTMLAttributes<HTMLButtonElement>

export interface WorkoutCardProps {
  workout: Workout
  prediction: WorkoutPrediction | null
  onEdit?: () => void
  onDelete?: () => void
  onShare?: () => void
  onMoveTop?: () => void
  onMoveBottom?: () => void
  shareStatus?: 'copied' | 'error'
  dragHandleProps?: DragHandleProps
  style?: CSSProperties
  isDragging?: boolean
}

export const WorkoutCard = forwardRef<HTMLElement, WorkoutCardProps>(function WorkoutCard(
  {
    workout,
    prediction,
    onEdit,
    onDelete,
    onShare,
    onMoveTop,
    onMoveBottom,
    shareStatus,
    dragHandleProps,
    style,
    isDragging,
  },
  ref,
) {
  const reps = prediction ? repTargets(workout.segments, prediction, !!onEdit) : []
  const hasMenu = !!(onEdit || onDelete || onShare || onMoveTop || onMoveBottom)

  // Show transient share status as a banner under the title.
  const statusText =
    shareStatus === 'copied' ? 'link copied ✓' : shareStatus === 'error' ? 'copy failed' : null

  return (
    <article
      ref={ref}
      className={`workout-card${isDragging ? ' is-dragging' : ''}`}
      style={style}
    >
      <header>
        {dragHandleProps && (
          <button
            type="button"
            className="drag-handle"
            aria-label="Reorder workout"
            title="Drag to reorder"
            {...dragHandleProps}
          >
            ⠿
          </button>
        )}
        <h3>{workout.name}</h3>
        {hasMenu && (
          <WorkoutCardMenu
            onEdit={onEdit}
            onShare={onShare}
            onMoveTop={onMoveTop}
            onMoveBottom={onMoveBottom}
            onDelete={onDelete}
          />
        )}
      </header>
      {statusText && <div className="card-status">{statusText}</div>}
      {prediction ? (
        <>
          <div className="card-split">
            {formatSplit(prediction.avgSplitSeconds)}
            <span className="unit"> /500m</span>
          </div>
          <div className="card-meta">
            {formatTime(prediction.totalWorkSeconds)} work · {prediction.totalMeters.toFixed(0)}m
          </div>
          {reps.map((line, i) => <div key={i} className="card-reps">{line}</div>)}
        </>
      ) : (
        <div className="card-split">—</div>
      )}
    </article>
  )
})

function WorkoutCardMenu({
  onEdit,
  onShare,
  onMoveTop,
  onMoveBottom,
  onDelete,
}: {
  onEdit?: () => void
  onShare?: () => void
  onMoveTop?: () => void
  onMoveBottom?: () => void
  onDelete?: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = (fn?: () => void) => {
    setOpen(false)
    fn?.()
  }

  return (
    <div className="card-menu" ref={ref}>
      <button
        type="button"
        className="menu-trigger"
        aria-label="Workout actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ≡
      </button>
      {open && (
        <ul className="menu-list" role="menu">
          {onEdit && (
            <li><button type="button" role="menuitem" onClick={() => run(onEdit)}>Edit</button></li>
          )}
          {onShare && (
            <li><button type="button" role="menuitem" onClick={() => run(onShare)}>Share link</button></li>
          )}
          {onMoveTop && (
            <li><button type="button" role="menuitem" onClick={() => run(onMoveTop)}>Move to top</button></li>
          )}
          {onMoveBottom && (
            <li><button type="button" role="menuitem" onClick={() => run(onMoveBottom)}>Move to bottom</button></li>
          )}
          {onDelete && (
            <li><button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}>Delete</button></li>
          )}
        </ul>
      )}
    </div>
  )
}
