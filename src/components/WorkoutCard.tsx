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

export function WorkoutCard({
  workout,
  prediction,
  onEdit,
  onDelete,
  onShare,
  shareStatus,
}: {
  workout: Workout
  prediction: WorkoutPrediction | null
  onEdit?: () => void
  onDelete?: () => void
  onShare?: () => void
  shareStatus?: 'copied' | 'error'
}) {
  const reps = prediction ? repTargets(workout.segments, prediction, !!onEdit) : []
  return (
    <article className="workout-card">
      <header>
        <h3>{workout.name}</h3>
        {(onShare || onEdit || onDelete) && (
          <div className="card-actions">
            {onShare && (
              <button
                className="link-button"
                onClick={onShare}
                aria-label="Share workout"
              >
                {shareStatus === 'copied' ? 'copied ✓' : shareStatus === 'error' ? 'failed' : 'share'}
              </button>
            )}
            {onEdit && (
              <button className="link-button" onClick={onEdit} aria-label="Edit workout">
                edit
              </button>
            )}
            {onDelete && (
              <button
                className="link-button link-button-danger"
                onClick={onDelete}
                aria-label="Delete workout"
              >
                delete
              </button>
            )}
          </div>
        )}
      </header>
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
}
