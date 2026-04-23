import { forwardRef, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Workout, WorkoutPrediction, WorkoutInterval, Rep, Rest } from '../model/workouts'
import { formatSplit, formatDuration } from '../lib/time'

function sameRep(a: Rep, b: Rep): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'distance' ? a.meters === (b as typeof a).meters : a.seconds === (b as typeof a).seconds
}
function sameRest(a: Rest, b: Rest): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'none') return true
  return a.seconds === (b as typeof a).seconds
}
function sameInterval(a: WorkoutInterval, b: WorkoutInterval): boolean {
  return sameRep(a.work, b.work) && sameRest(a.rest, b.rest)
}

interface IntervalGroup {
  count: number
  interval: WorkoutInterval
  startIdx: number
}
function groupIntervals(intervals: WorkoutInterval[]): IntervalGroup[] {
  const groups: IntervalGroup[] = []
  for (let i = 0; i < intervals.length; i++) {
    const prev = groups[groups.length - 1]
    if (prev && sameInterval(prev.interval, intervals[i])) {
      prev.count++
    } else {
      groups.push({ count: 1, interval: intervals[i], startIdx: i })
    }
  }
  // Rest on the final interval is dropped on save (nothing follows it), which
  // would otherwise split "4 × 10' w/ 2'r" into a 3-group + a lone 1-group.
  // Coalesce that trailing bare rep back into the preceding group for display.
  if (groups.length >= 2) {
    const last = groups[groups.length - 1]
    const prev = groups[groups.length - 2]
    if (
      last.count === 1 &&
      last.interval.rest.kind === 'none' &&
      prev.interval.rest.kind !== 'none' &&
      sameRep(prev.interval.work, last.interval.work)
    ) {
      prev.count += 1
      groups.pop()
    }
  }
  return groups
}

function repTargets(intervals: WorkoutInterval[], prediction: WorkoutPrediction, isOwned: boolean): string[] {
  const groups = groupIntervals(intervals)
  const parts: string[] = []
  if (isOwned) {
    for (const g of groups) {
      const splitStr = formatSplit(prediction.perIntervalSplitsSeconds[g.startIdx])
      const prefix = g.count > 1 ? `${g.count} \u00d7 ` : ''
      const restStr =
        g.interval.rest.kind === 'duration' ? `, ${formatDuration(g.interval.rest.seconds)}r` : ''
      if (g.interval.work.kind === 'distance') {
        parts.push(`${prefix}${g.interval.work.meters}m @ ${splitStr}${restStr}`)
      } else {
        parts.push(`${prefix}${formatDuration(g.interval.work.seconds)} @ ${splitStr}${restStr}`)
      }
    }
  } else {
    const splitSeconds = prediction.avgSplitSeconds
    for (const g of groups) {
      if (g.interval.work.kind === 'distance') {
        if (g.count === 1) continue
        parts.push(`${g.count} \u00d7 ${g.interval.work.meters}m in ${formatDuration((g.interval.work.meters * splitSeconds) / 500)}`)
      } else {
        parts.push(`${g.count} \u00d7 ${formatDuration(g.interval.work.seconds)} \u2248 ${((500 * g.interval.work.seconds) / splitSeconds).toFixed(0)}m`)
      }
    }
  }
  return parts
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
  const reps = prediction ? repTargets(workout.intervals, prediction, !!isOwned) : []
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
          {reps.map((line, i) => <div key={i} className="card-reps">{line}</div>)}
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
