// utils/course-validator.ts
// 课程必填、范围与冲突校验。

import { Course } from '../models/course'
import { DAYS, MAX_PERIOD } from '../constants/timetable'

export interface ValidateResult {
  ok: boolean
  errors: string[]
}

/** 两天同一节次区间是否重叠。 */
export function isOverlapping(
  a: { day: number; startPeriod: number; endPeriod: number },
  b: { day: number; startPeriod: number; endPeriod: number },
): boolean {
  return !(a.day !== b.day || a.endPeriod < b.startPeriod || a.startPeriod > b.endPeriod)
}

/**
 * 校验课程。all 为当前全部课程；excludeId 用于编辑时排除课程自身。
 * 返回是否通过及错误信息列表。
 */
export function validate(course: Course, all: Course[], excludeId?: string): ValidateResult {
  const errors: string[] = []

  if (!course.name || !course.name.trim()) {
    errors.push('请填写课程名称')
  }
  if (course.day < 1 || course.day > DAYS.length) {
    errors.push('请选择星期')
  }
  if (course.startPeriod < 1 || course.startPeriod > MAX_PERIOD) {
    errors.push('开始节次需要在 1–9 之间')
  }
  if (course.endPeriod < 1 || course.endPeriod > MAX_PERIOD) {
    errors.push('结束节次需要在 1–9 之间')
  }
  if (course.startPeriod > course.endPeriod) {
    errors.push('开始节次不能晚于结束节次')
  }

  if (course.day >= 1 && course.day <= DAYS.length && course.startPeriod <= course.endPeriod) {
    for (const other of all) {
      if (other.id === excludeId) continue
      if (isOverlapping(course, other)) {
        errors.push(
          `${DAYS[course.day - 1]} 第${course.startPeriod}–${course.endPeriod}节 与「${other.name}」冲突`,
        )
        break
      }
    }
  }

  return { ok: errors.length === 0, errors }
}
