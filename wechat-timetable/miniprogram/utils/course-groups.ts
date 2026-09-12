import type { Course } from '../models/course'
import { isOverlapping } from './course-validator'

export type GroupMergeDecisionKind = 'add' | 'duplicate' | 'conflict'

export interface GroupMergeDecision {
  groupId: string
  courses: Course[]
  kind: GroupMergeDecisionKind
  reason?: string
}

function sameWeeks(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((week, index) => week === b[index])
}

function isDuplicateCourse(a: Course, b: Course): boolean {
  if (a.id === b.id) return true
  return (
    a.name.trim() === b.name.trim() &&
    a.day === b.day &&
    a.startPeriod === b.startPeriod &&
    a.endPeriod === b.endPeriod &&
    sameWeeks(a.weeks, b.weeks)
  )
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
  return groupCourses(incoming).map((courses) => {
    const duplicate = courses.some((course) => existing.some((item) => isDuplicateCourse(course, item)))
    const conflict = courses.some((course) => existing.some((item) => isOverlapping(course, item)))
    if (duplicate) {
      return {
        groupId: courses[0].groupId,
        courses,
        kind: 'duplicate',
        reason: `「${courses[0].name}」包含与当前课表重复的时段，整门课程已跳过`,
      }
    }
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
