import { describe, it, expect } from 'vitest'
import { formatTime, formatSplit, parseTime } from './time'

describe('parseTime', () => {
  it('parses m:ss', () => {
    expect(parseTime('7:00')).toBe(420)
    expect(parseTime('1:45.5')).toBeCloseTo(105.5, 5)
  })
  it('parses raw seconds', () => {
    expect(parseTime('420')).toBe(420)
  })
  it('parses h:mm:ss', () => {
    expect(parseTime('1:02:30')).toBe(3750)
  })
  it('rejects nonsense', () => {
    expect(Number.isNaN(parseTime('abc'))).toBe(true)
    expect(Number.isNaN(parseTime(''))).toBe(true)
  })
})

describe('formatTime', () => {
  it('formats sub-hour as m:ss.t', () => {
    expect(formatTime(420)).toBe('7:00.0')
    expect(formatTime(105.5)).toBe('1:45.5')
  })
  it('formats hours as h:mm:ss.t', () => {
    expect(formatTime(3750)).toBe('1:02:30.0')
  })
  it('handles invalid input', () => {
    expect(formatTime(-1)).toBe('—')
    expect(formatTime(NaN)).toBe('—')
  })
})

describe('formatSplit', () => {
  it('formats split as m:ss.t', () => {
    expect(formatSplit(105)).toBe('1:45.0')
    expect(formatSplit(120.4)).toBe('2:00.4')
  })
})
