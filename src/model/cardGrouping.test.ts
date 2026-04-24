import { describe, it, expect } from 'vitest'
import { groupIntervals } from './cardGrouping'
import type { WorkoutInterval } from './workouts'

const D = (meters: number, restSec?: number): WorkoutInterval => ({
  work: { kind: 'distance', meters },
  rest: restSec === undefined ? { kind: 'none' } : { kind: 'duration', seconds: restSec },
})
const T = (seconds: number, restSec?: number): WorkoutInterval => ({
  work: { kind: 'duration', seconds },
  rest: restSec === undefined ? { kind: 'none' } : { kind: 'duration', seconds: restSec },
})

describe('groupIntervals', () => {
  it('collapses adjacent identical intervals', () => {
    const groups = groupIntervals([D(1000, 60), D(1000, 60), D(1000, 60)])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
  })

  it('coalesces trailing bare rep back into preceding rest group', () => {
    // "4 × 10' w/ 2'r" saved → last interval has rest dropped
    const intervals = [T(600, 120), T(600, 120), T(600, 120), T(600)]
    const groups = groupIntervals(intervals)
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(4)
    expect(groups[0].interval.rest.kind).toBe('duration')
  })

  it('keeps distinct adjacent intervals as separate groups', () => {
    // Sprint-then-steady alternation collapses pairwise where adjacent match.
    const A = T(30)
    const B = T(210)
    const groups = groupIntervals([A, B, A, B])
    expect(groups).toHaveLength(4)
  })
})
