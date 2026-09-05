// utils/timetable-layout.ts
// 根据课程计算它在 CSS Grid 中的定位样式。
// 列：第 1 列为时间栏，第 2..8 列为周一..周日；行：第 1 行为表头，第 2..10 行为第 1..9 节。

import { Course } from '../models/course'

export function computeCardStyle(course: Course): string {
  const column = course.day + 1 // day 1..7 -> 列 2..8
  const row = course.startPeriod + 1 // startPeriod 1..9 -> 行 2..10
  const span = course.endPeriod - course.startPeriod + 1
  return `grid-row: ${row} / span ${span}; grid-column: ${column};`
}
