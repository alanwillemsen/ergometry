import type { Workout, WorkoutInterval, Band } from './workouts'

export interface PresetGroup {
  label: string
  workouts: Workout[]
}

function mkWork(r: { distance?: number; duration?: number }): WorkoutInterval['work'] {
  return r.distance
    ? { kind: 'distance', meters: r.distance }
    : { kind: 'duration', seconds: r.duration! }
}

function mkRest(r: { distance?: number; duration?: number }): WorkoutInterval['rest'] {
  return r.distance
    ? { kind: 'distance', meters: r.distance }
    : r.duration !== undefined
      ? { kind: 'duration', seconds: r.duration }
      : { kind: 'none' }
}

const test = (id: string, name: string, rep: { distance?: number; duration?: number }): Workout => ({
  id,
  name,
  intervals: [{ work: mkWork(rep), rest: { kind: 'none' } }],
})

const interval = (
  id: string,
  name: string,
  count: number,
  work: { distance?: number; duration?: number },
  rest: { distance?: number; duration?: number },
  band?: Band,
): Workout => {
  const one: WorkoutInterval = { work: mkWork(work), rest: mkRest(rest), ...(band ? { band } : {}) }
  return { id, name, intervals: Array.from({ length: count }, () => ({ ...one })) }
}

export const PRESET_GROUPS: PresetGroup[] = [
  {
    label: 'Tests (continuous)',
    workouts: [
      test('2k', '2K', { distance: 2000 }),
      test('5k', '5K', { distance: 5000 }),
      test('6k', '6K', { distance: 6000 }),
      test('10k', '10K', { distance: 10000 }),
      test('30min', "30′", { duration: 1800 }),
      test('60min', "60′", { duration: 3600 }),
    ],
  },
  {
    label: 'Long intervals — max effort',
    workouts: [
      interval('4x2k-5', "4 × 2000m @ 5′ rest", 4, { distance: 2000 }, { duration: 300 }),
      interval('3x2k-4', "3 × 2000m @ 4′ rest", 3, { distance: 2000 }, { duration: 240 }),
      interval('4x10-2', "4 × 10′ @ 2′ rest", 4, { duration: 600 }, { duration: 120 }),
      interval('3x20-3', "3 × 20′ @ 3′ rest", 3, { duration: 1200 }, { duration: 180 }),
      interval('2x30-5', "2 × 30′ @ 5′ rest", 2, { duration: 1800 }, { duration: 300 }),
    ],
  },
  {
    label: 'UT1 / steady-state',
    workouts: [
      interval('4x20-2-ut1', "4 × 20′ UT1 @ 2′ rest", 4, { duration: 1200 }, { duration: 120 }, 'UT1'),
      interval('3x30-5-ut1', "3 × 30′ UT1 @ 5′ rest", 3, { duration: 1800 }, { duration: 300 }, 'UT1'),
      interval('2x40-5-ut1', "2 × 40′ UT1 @ 5′ rest", 2, { duration: 2400 }, { duration: 300 }, 'UT1'),
      interval('2x45-5-ut1', "2 × 45′ UT1 @ 5′ rest", 2, { duration: 2700 }, { duration: 300 }, 'UT1'),
    ],
  },
  {
    label: 'Threshold intervals',
    workouts: [
      interval('5x1500-3', "5 × 1500m @ 3′ rest", 5, { distance: 1500 }, { duration: 180 }),
      interval('6x1k-3', "6 × 1000m @ 3′ rest", 6, { distance: 1000 }, { duration: 180 }),
      interval('4x1k-3', "4 × 1000m @ 3′ rest", 4, { distance: 1000 }, { duration: 180 }),
      interval('5x5-2', "5 × 5′ @ 2′ rest", 5, { duration: 300 }, { duration: 120 }),
    ],
  },
  {
    label: 'VO₂ / short',
    workouts: [
      interval('8x500-2', "8 × 500m @ 2′ rest", 8, { distance: 500 }, { duration: 120 }),
      interval('10x500-1', "10 × 500m @ 1′ rest", 10, { distance: 500 }, { duration: 60 }),
      interval('5x4-2', "5 × 4′ @ 2′ rest", 5, { duration: 240 }, { duration: 120 }),
      interval('6x3-2', "6 × 3′ @ 2′ rest", 6, { duration: 180 }, { duration: 120 }),
    ],
  },
  {
    label: 'Anaerobic / sprint',
    workouts: [
      interval('20x1-1', "20 × (1′ on / 1′ off)", 20, { duration: 60 }, { duration: 60 }),
      interval('18x1-1', "18 × (1′ on / 1′ off)", 18, { duration: 60 }, { duration: 60 }),
      interval('20x40-20', "20 × (40″ on / 20″ off)", 20, { duration: 40 }, { duration: 20 }),
      interval('8x30-30', "8 × (30″ on / 30″ off)", 8, { duration: 30 }, { duration: 30 }),
      interval('20x100-200', '20 × (100m on / 200m off)', 20, { distance: 100 }, { distance: 200 }),
    ],
  },
]

export const ALL_PRESETS: Workout[] = PRESET_GROUPS.flatMap((g) => g.workouts)
