import type { Course } from '../models/course'
import { DAYS, MAX_PERIODS, MAX_TOTAL_WEEKS } from '../constants/timetable'

export type GroupMergeDecisionKind = 'add' | 'duplicate' | 'conflict'

export interface GroupMergeDecision {
  groupId: string
  courses: Course[]
  kind: GroupMergeDecisionKind
  reason?: string
}

function courseIdentity(course: Course): string {
  return JSON.stringify([course.name.trim(), course.day, course.startPeriod, course.endPeriod, course.weeks])
}

function weekMask(weeks: number[]): number {
  // 周次已通过 1–30 范围校验；旧版空数组代表全部周。
  if (!weeks.length) return (1 << MAX_TOTAL_WEEKS) - 1
  return weeks.reduce((mask, week) => mask | (1 << (week - 1)), 0)
}

export function groupCourses(courses: Course[]): Course[][] {
  const groups = new Map<string, Course[]>()
  for (const course of courses) {
    const group = groups.get(course.groupId)
    if (group) group.push(course)
    else groups.set(course.groupId, [course])
  }
  return [...groups.values()]
}

export function courseGroupCount(courses: Course[]): number {
  return groupCourses(courses).length
}

/** 合并以课程组为最小单位，避免只导入同一门课程的部分时段。 */
export function planCourseGroupMerge(incoming: Course[], existing: Course[]): GroupMergeDecision[] {
  const ids = new Set<string>()
  const identities = new Set<string>()
  const occupied = new Int32Array(DAYS.length * MAX_PERIODS)
  for (const course of existing) {
    ids.add(course.id)
    identities.add(courseIdentity(course))
    const mask = weekMask(course.weeks)
    const offset = (course.day - 1) * MAX_PERIODS - 1
    for (let period = course.startPeriod; period <= course.endPeriod; period++) occupied[offset + period] |= mask
  }
  return groupCourses(incoming).map((courses) => {
    const duplicate = courses.some((course) => ids.has(course.id) || identities.has(courseIdentity(course)))
    if (duplicate) {
      return {
        groupId: courses[0].groupId,
        courses,
        kind: 'duplicate',
        reason: `「${courses[0].name}」包含与当前课表重复的时段，整门课程已跳过`,
      }
    }
    const conflict = courses.some((course) => {
      const mask = weekMask(course.weeks)
      const offset = (course.day - 1) * MAX_PERIODS - 1
      for (let period = course.startPeriod; period <= course.endPeriod; period++) {
        if (occupied[offset + period] & mask) return true
      }
      return false
    })
    if (conflict) {
      return {
        groupId: courses[0].groupId,
        courses,
        kind: 'conflict',
        reason: `「${courses[0].name}」包含与当前课表冲突的时段，整门课程已跳过`,
      }
    }
    return { groupId: courses[0].groupId, courses, kind: 'add' }
  })
}
