// utils/timetable-layout.ts
// 根据课程计算它在课表内的绝对定位样式（基于"每个节次一格的固定高度"，单位 rpx）。
// 说明：这里刻意不使用 CSS Grid 的 grid-row/grid-column，以避免 iOS WebView 对 Grid 的兼容问题。

import { Course } from '../models/course'
import { CELL_HEIGHT } from '../constants/timetable'

export function computeCardStyle(course: Course): string {
  const top = (course.startPeriod - 1) * CELL_HEIGHT
  const height = (course.endPeriod - course.startPeriod + 1) * CELL_HEIGHT
  return `top: ${top}rpx; height: ${height}rpx;`
}
