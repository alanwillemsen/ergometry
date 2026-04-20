import { useMemo } from 'react'
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
import { predictWorkout } from '../model/wprime'
import { PRESET_GROUPS } from '../model/presets'
import { WorkoutCard, type WorkoutCardProps } from './WorkoutCard'
import { buildWorkoutFromSegments, type EditableSegment } from './WorkoutBuilder'
import type { SavedWorkout } from '../lib/storage'

export function WorkoutList({
  fit,
  savedWorkouts,
  shareStatuses,
  onEditWorkout,
  onDeleteWorkout,
  onShareWorkout,
  onReorderWorkouts,
  onMoveWorkoutToEdge,
}: {
  fit: FittedProfile | null
  savedWorkouts: SavedWorkout[]
  shareStatuses: Record<string, 'copied' | 'error'>
  onEditWorkout: (id: string) => void
  onDeleteWorkout: (id: string) => void
  onShareWorkout: (id: string) => void
  onReorderWorkouts: (activeId: string, overId: string) => void
  onMoveWorkoutToEdge: (id: string, edge: 'top' | 'bottom') => void
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      onReorderWorkouts(String(active.id), String(over.id))
    }
  }

  return (
    <div className="workout-list">
      {savedWorkouts.length > 0 && (
        <section className="preset-group">
          <h3 className="group-label">Yours</h3>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={savedWorkouts.map((sw) => sw.id)} strategy={verticalListSortingStrategy}>
              <div className="card-grid">
                {savedWorkouts.map((sw, idx) => {
                  const w = buildWorkoutFromSegments(sw.name, sw.segments as EditableSegment[])
                  return (
                    <SortableWorkoutCard
                      key={sw.id}
                      id={sw.id}
                      workout={w ?? { id: sw.id, name: sw.name, segments: [] }}
                      prediction={savedPredictions.get(sw.id) ?? null}
                      shareStatus={shareStatuses[sw.id]}
                      onEdit={() => onEditWorkout(sw.id)}
                      onDelete={() => onDeleteWorkout(sw.id)}
                      onShare={() => onShareWorkout(sw.id)}
                      onMoveTop={idx > 0 ? () => onMoveWorkoutToEdge(sw.id, 'top') : undefined}
                      onMoveBottom={idx < savedWorkouts.length - 1 ? () => onMoveWorkoutToEdge(sw.id, 'bottom') : undefined}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
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

function SortableWorkoutCard({ id, ...rest }: { id: string } & Omit<WorkoutCardProps, 'dragHandleProps' | 'style' | 'isDragging'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <WorkoutCard
      ref={setNodeRef}
      style={style}
      isDragging={isDragging}
      dragHandleProps={{ ...attributes, ...listeners }}
      {...rest}
    />
  )
}
