// utils/course-validator.ts
// 课程必填、范围、周次与冲突校验（冲突 = 星期 + 节次 + 周次三者都重叠）。

import type { Course } from '../models/course'
import { DAYS, MAX_PERIOD, MAX_TOTAL_WEEKS, WEEK_MODES } from '../constants/timetable'
import { compressWeeks, weeksIntersect } from './term'

export interface ValidateResult {
  ok: boolean
  errors: string[]
}

const VALID_MODES = new Set(WEEK_MODES.map((m) => m.value))

/** 周次重叠判断：空数组表示"每周"，与任何周次重叠。 */
export function weeksOverlap(a: number[], b: number[]): boolean {
  if (!a.length || !b.length) return true
  return weeksIntersect(a, b)
}

/** 两门课程是否冲突：星期相同、节次区间重叠、周次有交集。 */
export function isOverlapping(
  a: { day: number; startPeriod: number; endPeriod: number; weeks: number[] },
  b: { day: number; startPeriod: number; endPeriod: number; weeks: number[] },
): boolean {
  if (a.day !== b.day) return false
  if (a.endPeriod < b.startPeriod || a.startPeriod > b.endPeriod) return false
  return weeksOverlap(a.weeks, b.weeks)
}

/**
 * 校验课程。all 为当前全部课程；excludeId 用于编辑时排除课程自身；totalWeeks 为当前学期总周数。
 */
export function validate(
  course: Course,
  all: Course[],
  excludeId?: string,
  totalWeeks = MAX_TOTAL_WEEKS,
): ValidateResult {
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

  if (!VALID_MODES.has(course.weekMode)) {
    errors.push('请选择课程周次模式')
  } else if (course.weekMode === 'custom') {
    if (!course.weeks || !course.weeks.length) {
      errors.push('请至少选择一个上课周次')
    } else {
      const bad = course.weeks.filter(
        (w) => !Number.isInteger(w) || w < 1 || w > totalWeeks,
      )
      if (bad.length) {
        errors.push(`周次需要在 1–${totalWeeks} 之间`)
      }
    }
  }

  if (
    !errors.length &&
    course.day >= 1 &&
    course.day <= DAYS.length &&
    course.startPeriod <= course.endPeriod
  ) {
    for (const other of all) {
      if (other.id === excludeId) continue
      if (isOverlapping(course, other)) {
        const common = course.weeks.filter((w) => other.weeks.includes(w))
        const weeksText = common.length ? `第${compressWeeks(common)}周` : '重叠周次'
        errors.push(
          `${DAYS[course.day - 1]} 第${course.startPeriod}–${course.endPeriod}节 ${weeksText} 与「${other.name}」冲突`,
        )
        break
      }
    }
  }

  return { ok: errors.length === 0, errors }
}
