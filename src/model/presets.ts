import type { Workout } from './workouts'

export interface PresetGroup {
  label: string
  workouts: Workout[]
}

const test = (id: string, name: string, rep: { distance?: number; duration?: number }): Workout => ({
  id,
  name,
  segments: [
    {
      work: rep.distance
        ? { kind: 'distance', meters: rep.distance }
        : { kind: 'duration', seconds: rep.duration! },
      rest: { kind: 'none' },
      count: 1,
    },
  ],
})

const interval = (
  id: string,
  name: string,
  count: number,
  work: { distance?: number; duration?: number },
  rest: { distance?: number; duration?: number },
): Workout => ({
  id,
  name,
  segments: [
    {
      work: work.distance
        ? { kind: 'distance', meters: work.distance }
        : { kind: 'duration', seconds: work.duration! },
      rest: rest.distance
        ? { kind: 'distance', meters: rest.distance }
        : rest.duration !== undefined
          ? { kind: 'duration', seconds: rest.duration }
          : { kind: 'none' },
      count,
    },
  ],
})

export const PRESET_GROUPS: PresetGroup[] = [
  {
    label: 'Tests (continuous)',
    workouts: [
      test('2k', '2K', { distance: 2000 }),
      test('5k', '5K', { distance: 5000 }),
      test('6k', '6K', { distance: 6000 }),
      test('10k', '10K', { distance: 10000 }),
      test('30min', "30'", { duration: 1800 }),
      test('60min', "60'", { duration: 3600 }),
    ],
  },
  {
    label: 'Long intervals',
    workouts: [
      interval('4x2k-5', "4 \u00d7 2000m @ 5\u2032 rest", 4, { distance: 2000 }, { duration: 300 }),
      interval('3x2k-4', "3 \u00d7 2000m @ 4\u2032 rest", 3, { distance: 2000 }, { duration: 240 }),
      interval('4x10-2', "4 \u00d7 10\u2032 @ 2\u2032 rest", 4, { duration: 600 }, { duration: 120 }),
      interval('3x20-3', "3 \u00d7 20\u2032 @ 3\u2032 rest", 3, { duration: 1200 }, { duration: 180 }),
      interval('2x30-5', "2 \u00d7 30\u2032 @ 5\u2032 rest", 2, { duration: 1800 }, { duration: 300 }),
    ],
  },
  {
    label: 'Threshold intervals',
    workouts: [
      interval('5x1500-3', "5 \u00d7 1500m @ 3\u2032 rest", 5, { distance: 1500 }, { duration: 180 }),
      interval('6x1k-3', "6 \u00d7 1000m @ 3\u2032 rest", 6, { distance: 1000 }, { duration: 180 }),
      interval('4x1k-3', "4 \u00d7 1000m @ 3\u2032 rest", 4, { distance: 1000 }, { duration: 180 }),
      interval('5x5-2', "5 \u00d7 5\u2032 @ 2\u2032 rest", 5, { duration: 300 }, { duration: 120 }),
    ],
  },
  {
    label: 'VO\u2082 / short',
    workouts: [
      interval('8x500-2', "8 \u00d7 500m @ 2\u2032 rest", 8, { distance: 500 }, { duration: 120 }),
      interval('10x500-1', "10 \u00d7 500m @ 1\u2032 rest", 10, { distance: 500 }, { duration: 60 }),
      interval('5x4-2', "5 \u00d7 4\u2032 @ 2\u2032 rest", 5, { duration: 240 }, { duration: 120 }),
      interval('6x3-2', "6 \u00d7 3\u2032 @ 2\u2032 rest", 6, { duration: 180 }, { duration: 120 }),
    ],
  },
  {
    label: 'Anaerobic / sprint',
    workouts: [
      interval('20x1-1', "20 \u00d7 (1\u2032 on / 1\u2032 off)", 20, { duration: 60 }, { duration: 60 }),
      interval('18x1-1', "18 \u00d7 (1\u2032 on / 1\u2032 off)", 18, { duration: 60 }, { duration: 60 }),
      interval('20x40-20', "20 \u00d7 (40\u2033 on / 20\u2033 off)", 20, { duration: 40 }, { duration: 20 }),
      interval('8x30-30', "8 \u00d7 (30\u2033 on / 30\u2033 off)", 8, { duration: 30 }, { duration: 30 }),
      interval('20x100-200', '20 \u00d7 (100m on / 200m off)', 20, { distance: 100 }, { distance: 200 }),
    ],
  },
]

export const ALL_PRESETS: Workout[] = PRESET_GROUPS.flatMap((g) => g.workouts)
