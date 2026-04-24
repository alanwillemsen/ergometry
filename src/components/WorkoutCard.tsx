import { forwardRef, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Workout, WorkoutPrediction, WorkoutInterval } from '../model/workouts'
import { formatSplit, formatDuration } from '../lib/time'
import { groupIntervals, type IntervalGroup } from '../model/cardGrouping'

const MAX_REP_LINES = 4

function formatOwnedGroup(g: IntervalGroup, prediction: WorkoutPrediction): string {
  const splitStr = formatSplit(prediction.perIntervalSplitsSeconds[g.startIdx])
  const prefix = g.count > 1 ? `${g.count} × ` : ''
  const restStr =
    g.interval.rest.kind === 'duration' ? `, ${formatDuration(g.interval.rest.seconds)}r` : ''
  const work =
    g.interval.work.kind === 'distance'
      ? `${g.interval.work.meters}m`
      : formatDuration(g.interval.work.seconds)
  return `${prefix}${work} @ ${splitStr}${restStr}`
}

function repLines(
  intervals: WorkoutInterval[],
  prediction: WorkoutPrediction,
  isOwned: boolean,
): string[] {
  const groups = groupIntervals(intervals)
  if (!isOwned) {
    // Saved tests are continuous; retain the existing aggregate-meters phrasing.
    const splitSeconds = prediction.avgSplitSeconds
    const out: string[] = []
    for (const g of groups) {
      if (g.interval.work.kind === 'distance') {
        if (g.count === 1) continue
        out.push(
          `${g.count} × ${g.interval.work.meters}m in ${formatDuration((g.interval.work.meters * splitSeconds) / 500)}`,
        )
      } else {
        out.push(
          `${g.count} × ${formatDuration(g.interval.work.seconds)} ≈ ${((500 * g.interval.work.seconds) / splitSeconds).toFixed(0)}m`,
        )
      }
    }
    return out
  }
  return groups.map((g) => formatOwnedGroup(g, prediction))
}

type DragHandleProps = HTMLAttributes<HTMLButtonElement>

export interface WorkoutCardProps {
  workout: Workout
  prediction: WorkoutPrediction | null
  isOwned?: boolean
  onOpen?: () => void
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
    isOwned,
    onOpen,
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
  const lines = prediction ? repLines(workout.intervals, prediction, !!isOwned) : []
  const visible = lines.slice(0, MAX_REP_LINES)
  const overflow = lines.length - visible.length
  const hasMenu = !!(onShare || onMoveTop || onMoveBottom)
  const clickable = !!onOpen

  // Show transient share status as a banner under the title.
  const statusText =
    shareStatus === 'copied' ? 'link copied ✓' : shareStatus === 'error' ? 'copy failed' : null

  const handleClick = () => {
    if (onOpen) onOpen()
  }
  const handleKey = (e: ReactKeyboardEvent) => {
    if (!onOpen) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }

  return (
    <article
      ref={ref}
      className={`workout-card${isDragging ? ' is-dragging' : ''}${clickable ? ' is-clickable' : ''}`}
      style={style}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={clickable ? handleKey : undefined}
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `Open ${workout.name}` : undefined}
    >
      <header>
        {dragHandleProps && (
          <button
            type="button"
            className="drag-handle"
            aria-label="Reorder workout"
            title="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
            {...dragHandleProps}
          >
            ⠿
          </button>
        )}
        <h3>{workout.name}</h3>
        {hasMenu && (
          <WorkoutCardMenu
            onShare={onShare}
            onMoveTop={onMoveTop}
            onMoveBottom={onMoveBottom}
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
            {formatDuration(prediction.totalWorkSeconds)} work · {prediction.totalMeters.toFixed(0)}m
          </div>
          {visible.map((line, i) => {
            const isFade = overflow > 0 && i === visible.length - 1
            return (
              <div key={i} className={`card-reps${isFade ? ' is-fade' : ''}`}>{line}</div>
            )
          })}
          {overflow > 0 && <div className="card-reps card-more">+{overflow} more</div>}
        </>
      ) : (
        <div className="card-split">—</div>
      )}
    </article>
  )
})

function WorkoutCardMenu({
  onShare,
  onMoveTop,
  onMoveBottom,
}: {
  onShare?: () => void
  onMoveTop?: () => void
  onMoveBottom?: () => void
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
    <div className="card-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
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
          {onShare && (
            <li><button type="button" role="menuitem" onClick={() => run(onShare)}>Share link</button></li>
          )}
          {onMoveTop && (
            <li><button type="button" role="menuitem" onClick={() => run(onMoveTop)}>Move to top</button></li>
          )}
          {onMoveBottom && (
            <li><button type="button" role="menuitem" onClick={() => run(onMoveBottom)}>Move to bottom</button></li>
          )}
        </ul>
      )}
    </div>
  )
}
