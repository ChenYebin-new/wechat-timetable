// utils/timetable-layout.ts
// 根据课程计算它在课表内的绝对定位样式（基于"每个节次一格的固定高度"，单位 rpx）。
// 说明：这里刻意不使用 CSS Grid 的 grid-row/grid-column，以避免 iOS WebView 对 Grid 的兼容问题。

import type { Course } from '../models/course'
import { CELL_HEIGHT, DAYS } from '../constants/timetable'
import { rangesToKeys } from './grid-selection'

export interface TimetableCardItem {
  id: string
  course: Course
  style: string
}

export interface WeekPanel {
  week: number
  active: boolean
  daySlots: TimetableCardItem[][]
  disabledKeys: string[]
}

/** The grid, cards and swiper use the same dimensions for each visual theme. */
export function timetableMetrics(themeId?: string) {
  return themeId === 'aqua'
    ? { cellHeight: 140, headHeight: 120, padding: 0, cardInset: 0 }
    : { cellHeight: CELL_HEIGHT, headHeight: 80, padding: 16, cardInset: 4 }
}

export function timetableGridHeightRpx(periodCount: number, themeId?: string): number {
  const { cellHeight, headHeight, padding } = timetableMetrics(themeId)
  return padding + headHeight + periodCount * cellHeight
}

/** Multiply after rpx conversion so native pixel rounding cannot accumulate. */
export function timetableGridHeightStyle(periodCount: number, themeId?: string): string {
  const { cellHeight, headHeight } = timetableMetrics(themeId)
  return themeId === 'aqua'
    ? `calc(${headHeight}rpx + ${periodCount} * ${cellHeight}rpx)`
    : `${timetableGridHeightRpx(periodCount, themeId)}rpx`
}

export function computeCardStyle(course: Course, themeId?: string): string {
  if (themeId === 'aqua') {
    return `top: calc(var(--cell-height) * ${course.startPeriod - 1}); height: calc(var(--cell-height) * ${course.endPeriod - course.startPeriod + 1});`
  }
  const { cellHeight, cardInset } = timetableMetrics(themeId)
  const top = (course.startPeriod - 1) * cellHeight + cardInset
  const height = (course.endPeriod - course.startPeriod + 1) * cellHeight - cardInset * 2
  return `top: ${top}rpx; height: ${height}rpx;`
}

export function buildDaySlots(courses: Course[]): TimetableCardItem[][] {
  const slots: TimetableCardItem[][] = DAYS.map(() => [])
  for (const course of courses) {
    if (course.day < 1 || course.day > DAYS.length) continue
    slots[course.day - 1].push({
      id: course.id,
      course,
      style: computeCardStyle(course),
    })
  }
  return slots
}

export function coursesForWeek(courses: Course[], week: number): Course[] {
  return courses.filter((course) => course.weeks.length === 0 || course.weeks.includes(week))
}

function buildPanel(courses: Course[], week: number): WeekPanel {
  return {
    week,
    active: true,
    daySlots: buildDaySlots(courses),
    disabledKeys: rangesToKeys(courses.map((course) => ({
      day: course.day,
      startPeriod: course.startPeriod,
      endPeriod: course.endPeriod,
    }))),
  }
}

/** 仅为当前周及相邻周构建完整网格，其余周保留轻量 swiper 外壳。 */
export function buildWeekPanels(
  courses: Course[],
  currentWeek: number,
  totalWeeks?: number,
): WeekPanel[] {
  if (!totalWeeks) return [buildPanel(courses, 1)]

  const panels: WeekPanel[] = []
  for (let week = 1; week <= totalWeeks; week++) {
    if (Math.abs(week - currentWeek) <= 1) {
      panels.push(buildPanel(coursesForWeek(courses, week), week))
    } else {
      panels.push({ week, active: false, daySlots: [], disabledKeys: [] })
    }
  }
  return panels
}
