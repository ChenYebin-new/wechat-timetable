// utils/course-validator.ts
// 课程必填、范围、周次与冲突校验（冲突 = 星期 + 节次 + 周次三者都重叠）。

import type { Course } from '../models/course'
import { DAYS, MAX_PERIODS, MAX_TOTAL_WEEKS, WEEK_MODES } from '../constants/timetable'
import { compressWeeks, expandWeeks, normalizeWeeks, weeksIntersect } from './term'

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
  maxPeriod = MAX_PERIODS,
): ValidateResult {
  const errors: string[] = []

  if (!course.name || !course.name.trim()) {
    errors.push('请填写课程名称')
  }
  if (!Number.isInteger(course.day) || course.day < 1 || course.day > DAYS.length) {
    errors.push('请选择星期')
  }
  if (!Number.isInteger(course.startPeriod) || course.startPeriod < 1 || course.startPeriod > maxPeriod) {
    errors.push(`开始节次需要在 1–${maxPeriod} 之间`)
  }
  if (!Number.isInteger(course.endPeriod) || course.endPeriod < 1 || course.endPeriod > maxPeriod) {
    errors.push(`结束节次需要在 1–${maxPeriod} 之间`)
  }
  if (course.startPeriod > course.endPeriod) {
    errors.push('开始节次不能晚于结束节次')
  }

  let activeWeeks = Array.isArray(course.weeks) ? course.weeks : []
  if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > MAX_TOTAL_WEEKS) {
    errors.push('请先设置有效学期')
  } else if (!VALID_MODES.has(course.weekMode)) {
    errors.push('请选择课程周次模式')
  } else if (course.weekMode === 'custom') {
    if (!Array.isArray(course.weeks) || !course.weeks.length) {
      errors.push('请至少选择一个上课周次')
    } else {
      const bad = course.weeks.filter(
        (w) => !Number.isInteger(w) || w < 1 || w > totalWeeks,
      )
      if (bad.length) {
        errors.push(`周次需要在 1–${totalWeeks} 之间`)
      } else {
        activeWeeks = normalizeWeeks(course.weeks, totalWeeks)
        if (activeWeeks.length !== course.weeks.length) {
          errors.push('指定周次不能重复')
        }
      }
    }
  } else {
    activeWeeks = expandWeeks(course.weekMode, totalWeeks)
  }

  if (
    !errors.length &&
    course.day >= 1 &&
    course.day <= DAYS.length &&
    course.startPeriod <= course.endPeriod
  ) {
    const candidate = { ...course, weeks: activeWeeks }
    for (const other of all) {
      if (other.id === excludeId) continue
      if (isOverlapping(candidate, other)) {
        const otherWeeks = other.weeks.length ? other.weeks : expandWeeks('all', totalWeeks)
        const common = activeWeeks.filter((w) => otherWeeks.includes(w))
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
