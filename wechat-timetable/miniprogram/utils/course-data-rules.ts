import type { Course, WeekMode } from '../models/course'
import { expandWeeks, normalizeWeeks } from './term'
import { isOverlapping } from './course-validator'

export function isValidCourseColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

export function sameWeeks(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((week, index) => week === b[index])
}

/** 已校验基础类型后使用。只有历史入口可以允许 all + [] 这个旧表示法。 */
export function resolveStoredWeeks(mode: WeekMode, weeks: number[], totalWeeks: number, allowAllWeeksSentinel = false): number[] | null {
  const expected = mode === 'custom' ? normalizeWeeks(weeks, totalWeeks) : expandWeeks(mode, totalWeeks)
  if (mode === 'custom' && !expected.length) return null
  if (allowAllWeeksSentinel && mode === 'all' && !weeks.length) return expected
  return sameWeeks(weeks, expected) ? expected : null
}

/** 调用方保留各入口原有的错误文案和检查顺序。 */
export function registerCourseId(ids: Set<string>, id: string): boolean {
  if (ids.has(id)) return false
  ids.add(id)
  return true
}

export function sameCourseGroup(head: Course, course: Course): boolean {
  return head.name === course.name && head.teacher === course.teacher && head.location === course.location
    && head.color === course.color && head.weekMode === course.weekMode && sameWeeks(head.weeks, course.weeks)
}

export function firstCourseConflict(courses: Course[]): [Course, Course] | null {
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      if (isOverlapping(courses[i], courses[j])) return [courses[i], courses[j]]
    }
  }
  return null
}
