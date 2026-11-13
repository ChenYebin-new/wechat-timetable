import type { Course, WeekMode } from '../models/course'
import { DAYS, MAX_PERIODS, MAX_TOTAL_WEEKS } from '../constants/timetable'
import { expandWeeks, normalizeWeeks } from './term'

const ALL_WEEKS = expandWeeks('all', MAX_TOTAL_WEEKS)

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

/** 基础字段已校验后使用；保留按原数组顺序找到的首对冲突。 */
export function firstCourseConflict(courses: Course[]): [Course, Course] | null {
  if (courses.length < 2) return null
  // 每格记录最早占用者的下标 + 1，0 表示空闲；旧版 [] 仍表示全部周。
  const occupied = new Int32Array(DAYS.length * MAX_PERIODS * MAX_TOTAL_WEEKS)
  let firstIndex = courses.length
  let conflict: [Course, Course] | null = null
  for (let index = 0; index < courses.length; index++) {
    const course = courses[index]
    const weeks = course.weeks.length ? course.weeks : ALL_WEEKS
    for (let period = course.startPeriod; period <= course.endPeriod; period++) {
      const offset = ((course.day - 1) * MAX_PERIODS + period - 1) * MAX_TOTAL_WEEKS
      for (const week of weeks) {
        const cell = offset + week - 1
        const previous = occupied[cell] - 1
        if (previous < 0) occupied[cell] = index + 1
        else if (previous < firstIndex && previous !== index) {
          firstIndex = previous
          conflict = [courses[previous], course]
        }
      }
    }
    if (firstIndex === 0) return conflict
  }
  return conflict
}
