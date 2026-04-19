import { useMemo } from 'react'
import type { FittedProfile } from '../model/pacing'
import { predictWorkout } from '../model/wprime'
import { PRESET_GROUPS } from '../model/presets'
import { WorkoutCard } from './WorkoutCard'
import { buildWorkoutFromSegments, type EditableSegment } from './WorkoutBuilder'
import type { SavedWorkout } from '../lib/storage'

export function WorkoutList({
  fit,
  savedWorkouts,
  shareStatuses,
  onEditWorkout,
  onDeleteWorkout,
  onShareWorkout,
}: {
  fit: FittedProfile | null
  savedWorkouts: SavedWorkout[]
  shareStatuses: Record<string, 'copied' | 'error'>
  onEditWorkout: (id: string) => void
  onDeleteWorkout: (id: string) => void
  onShareWorkout: (id: string) => void
}) {
  const presetPredictions = useMemo(() => {
    if (!fit) return new Map()
    const map = new Map()
    for (const group of PRESET_GROUPS) {
      for (const w of group.workouts) {
        map.set(
          w.id,
          predictWorkout(
            w,
            fit.cpWatts,
            fit.wPrimeJoules,
            undefined,
            0,
            fit.decayK,
            fit.wPrimeMortonJoules,
            fit.kSeconds,
          ),
        )
      }
    }
    return map
  }, [fit])

  const savedPredictions = useMemo(() => {
    const map = new Map()
    for (const sw of savedWorkouts) {
      if (!fit) { map.set(sw.id, null); continue }
      const w = buildWorkoutFromSegments(sw.name, sw.segments as EditableSegment[])
      map.set(
        sw.id,
        w
          ? predictWorkout(
              w,
              fit.cpWatts,
              fit.wPrimeJoules,
              undefined,
              0,
              fit.decayK,
              fit.wPrimeMortonJoules,
              fit.kSeconds,
            )
          : null,
      )
    }
    return map
  }, [savedWorkouts, fit])

  return (
    <div className="workout-list">
      {savedWorkouts.length > 0 && (
        <section className="preset-group">
          <h3 className="group-label">My workouts</h3>
          <div className="card-grid">
            {savedWorkouts.map((sw) => {
              const w = buildWorkoutFromSegments(sw.name, sw.segments as EditableSegment[])
              return (
                <WorkoutCard
                  key={sw.id}
                  workout={w ?? { id: sw.id, name: sw.name, segments: [] }}
                  prediction={savedPredictions.get(sw.id) ?? null}
                  shareStatus={shareStatuses[sw.id]}
                  onEdit={() => onEditWorkout(sw.id)}
                  onDelete={() => onDeleteWorkout(sw.id)}
                  onShare={() => onShareWorkout(sw.id)}
                />
              )
            })}
          </div>
        </section>
      )}

      {PRESET_GROUPS.map((group) => (
        <section key={group.label} className="preset-group">
          <h3 className="group-label">{group.label}</h3>
          <div className="card-grid">
            {group.workouts.map((w) => (
              <WorkoutCard key={w.id} workout={w} prediction={presetPredictions.get(w.id) ?? null} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
