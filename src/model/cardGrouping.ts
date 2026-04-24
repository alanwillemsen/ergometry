import type { Rep, Rest, WorkoutInterval } from './workouts'

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

export interface IntervalGroup {
  count: number
  interval: WorkoutInterval
  startIdx: number
}

export function groupIntervals(intervals: WorkoutInterval[]): IntervalGroup[] {
  const groups: IntervalGroup[] = []
  for (let i = 0; i < intervals.length; i++) {
    const prev = groups[groups.length - 1]
    if (prev && sameInterval(prev.interval, intervals[i])) {
      prev.count++
    } else {
      groups.push({ count: 1, interval: intervals[i], startIdx: i })
    }
  }
  // Legacy saves (pre-0:00-default) dropped rest on the final interval, which
  // would split "4 × 10' w/ 2'r" into a 3-group + a lone 1-group. Coalesce
  // that trailing bare rep into the preceding group so those workouts still
  // display intact.
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
