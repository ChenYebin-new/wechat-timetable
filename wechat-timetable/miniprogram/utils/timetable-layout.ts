// utils/timetable-layout.ts
// 根据课程计算它在课表内的绝对定位样式（基于"每个节次一格的固定高度"，单位 rpx）。
// 说明：这里刻意不使用 CSS Grid 的 grid-row/grid-column，以避免 iOS WebView 对 Grid 的兼容问题。

import type { Course } from '../models/course'
import { CELL_HEIGHT, DAYS } from '../constants/timetable'
import { getContrastText } from './color'
import { rangesToKeys } from './grid-selection'

export interface TimetableCardItem {
  id: string
  course: Course
  style: string
  textColor: string
}

export interface WeekPanel {
  week: number
  active: boolean
  daySlots: TimetableCardItem[][]
  disabledKeys: string[]
}

/** 课表外框上下内边距 16rpx + 星期栏 80rpx + 动态节次高度。 */
export function timetableGridHeightRpx(periodCount: number): number {
  return 96 + periodCount * CELL_HEIGHT
}

export function computeCardStyle(course: Course): string {
  const cardInset = 4
  const top = (course.startPeriod - 1) * CELL_HEIGHT + cardInset
  const height = (course.endPeriod - course.startPeriod + 1) * CELL_HEIGHT - cardInset * 2
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
      textColor: getContrastText(course.color),
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
