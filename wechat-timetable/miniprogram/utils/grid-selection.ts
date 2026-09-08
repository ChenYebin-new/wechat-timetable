import type { CourseRange, GridCell } from '../models/course'
import { DAYS, MAX_PERIOD } from '../constants/timetable'

export function cellKey(day: number, period: number): string {
  return `${day}-${period}`
}

export function parseCellKey(key: string): GridCell | null {
  const match = /^(\d+)-(\d+)$/.exec(key)
  if (!match) return null
  const day = Number(match[1])
  const period = Number(match[2])
  if (!Number.isInteger(day) || day < 1 || day > DAYS.length) return null
  if (!Number.isInteger(period) || period < 1 || period > MAX_PERIOD) return null
  return { day, period }
}

export function cellsToRanges(cells: GridCell[]): CourseRange[] {
  const unique = new Map<string, GridCell>()
  for (const cell of cells) {
    if (
      Number.isInteger(cell.day) &&
      cell.day >= 1 &&
      cell.day <= DAYS.length &&
      Number.isInteger(cell.period) &&
      cell.period >= 1 &&
      cell.period <= MAX_PERIOD
    ) {
      unique.set(cellKey(cell.day, cell.period), { day: cell.day, period: cell.period })
    }
  }

  const sorted = [...unique.values()].sort((a, b) => a.day - b.day || a.period - b.period)
  const ranges: CourseRange[] = []
  for (const cell of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && last.day === cell.day && last.endPeriod + 1 === cell.period) {
      last.endPeriod = cell.period
    } else {
      ranges.push({ day: cell.day, startPeriod: cell.period, endPeriod: cell.period })
    }
  }
  return ranges
}

export function rangesToCells(ranges: CourseRange[]): GridCell[] {
  const cells: GridCell[] = []
  for (const range of ranges) {
    if (
      !Number.isInteger(range.day) ||
      range.day < 1 ||
      range.day > DAYS.length ||
      !Number.isInteger(range.startPeriod) ||
      !Number.isInteger(range.endPeriod) ||
      range.startPeriod < 1 ||
      range.endPeriod > MAX_PERIOD ||
      range.startPeriod > range.endPeriod
    ) {
      continue
    }
    for (let period = range.startPeriod; period <= range.endPeriod; period++) {
      cells.push({ day: range.day, period })
    }
  }
  return cells
}

export function keysToRanges(keys: string[]): CourseRange[] {
  const cells: GridCell[] = []
  for (const key of keys) {
    const cell = parseCellKey(key)
    if (cell) cells.push(cell)
  }
  return cellsToRanges(cells)
}

export function rangesToKeys(ranges: CourseRange[]): string[] {
  return rangesToCells(ranges).map((cell) => cellKey(cell.day, cell.period))
}

export function formatRanges(ranges: CourseRange[]): string {
  return ranges
    .map((range) => {
      const periods =
        range.startPeriod === range.endPeriod
          ? `第${range.startPeriod}节`
          : `第${range.startPeriod}–${range.endPeriod}节`
      return `${DAYS[range.day - 1]} ${periods}`
    })
    .join('、')
}
