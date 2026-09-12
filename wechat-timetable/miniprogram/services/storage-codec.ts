import { SCHEMA_VERSION } from '../constants/timetable'
import type { Course, PeriodSettings, TermSettings, TimetableStorage } from '../models/course'
import { isOverlapping } from '../utils/course-validator'
import { clonePeriodSettings, validatePeriodSettings } from '../utils/period-settings'
import { expandWeeks, normalizeWeeks, validateTerm } from '../utils/term'

export type StorageReadKind =
  | 'missing'
  | 'current'
  | 'legacy'
  | 'unsupported'
  | 'corrupt'
  | 'io-error'

export type TimetableStorageView = Omit<TimetableStorage, 'schemaVersion'> & { schemaVersion: number }

export type StorageReadResult<T = TimetableStorageView> =
  | { kind: 'missing'; data: T; raw: null }
  | { kind: 'current'; data: T; raw: unknown }
  | { kind: 'legacy'; data: T; raw: unknown }
  | { kind: 'unsupported'; data: T; raw: unknown; reason: string }
  | { kind: 'corrupt'; data: T; raw: unknown; reason: string }
  | { kind: 'io-error'; reason: string }

export interface StorageValidationResult {
  ok: boolean
  data?: TimetableStorage
  reason?: string
}

export type StorageClassification =
  | { kind: 'missing' }
  | { kind: 'current'; data: TimetableStorage }
  | { kind: 'legacy'; schemaVersion: number; raw: Record<string, unknown> }
  | { kind: 'unsupported'; schemaVersion: number; raw: Record<string, unknown>; reason: string }
  | { kind: 'corrupt'; raw: unknown; reason: string }

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const WEEK_MODES = new Set(['all', 'odd', 'even', 'custom'])
const ROOT_KEYS = new Set(['schemaVersion', 'term', 'courses', 'periodSettings'])
const TERM_KEYS = new Set(['startDate', 'totalWeeks'])
const COURSE_KEYS = new Set([
  'id', 'groupId', 'name', 'day', 'startPeriod', 'endPeriod', 'teacher', 'location',
  'color', 'createdAt', 'updatedAt', 'weekMode', 'weeks',
])
const PERIOD_SETTINGS_KEYS = new Set(['durationMinutes', 'breakMinutes', 'firstStart', 'overrides', 'periods'])
const PERIOD_KEYS = new Set(['start', 'end'])
const OVERRIDE_KEYS = new Set(['period', 'start', 'durationMinutes'])
export const LEGACY_SCHEMA_VERSIONS = [1, 2, 3, 4] as const
export const SUPPORTED_SCHEMA_VERSIONS = [...LEGACY_SCHEMA_VERSIONS, SCHEMA_VERSION] as const

export function isLegacySchemaVersion(value: number): boolean {
  return (LEGACY_SCHEMA_VERSIONS as readonly number[]).includes(value)
}

export function isSupportedSchemaVersion(value: number): boolean {
  return (SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(value)
}

/** 只识别和验证 Storage 值，不访问 wx API，也不执行迁移或写入。 */
export function classifyStorageValue(raw: unknown): StorageClassification {
  if (raw === '' || raw === null || raw === undefined) return { kind: 'missing' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'corrupt', raw, reason: '当前课表数据不是有效对象' }
  }
  const value = raw as Record<string, unknown>
  if (!Number.isInteger(value.schemaVersion)) {
    return { kind: 'corrupt', raw, reason: '当前课表数据版本缺失或格式不正确' }
  }
  const schemaVersion = value.schemaVersion as number
  if (schemaVersion === SCHEMA_VERSION) {
    const checked = validateCurrentStorage(raw)
    return checked.ok && checked.data
      ? { kind: 'current', data: checked.data }
      : { kind: 'corrupt', raw, reason: checked.reason || '当前 V5 课表字段无效' }
  }
  if (isLegacySchemaVersion(schemaVersion)) return { kind: 'legacy', schemaVersion, raw: value }
  return {
    kind: 'unsupported',
    schemaVersion,
    raw: value,
    reason: `当前课表数据版本为 V${schemaVersion}，此版本小程序无法安全修改`,
  }
}

export function isValidCourseColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function validateCourse(course: unknown, totalWeeks: number, maxPeriod: number, index: number): string | null {
  if (!course || typeof course !== 'object' || Array.isArray(course)) return `第 ${index + 1} 个课程时段不是有效对象`
  const value = course as Record<string, unknown>
  if (!hasOnlyKeys(value, COURSE_KEYS)) return `第 ${index + 1} 个课程时段包含未知字段`
  if (typeof value.id !== 'string' || !value.id.trim() || value.id !== value.id.trim()) return `第 ${index + 1} 个课程时段 ID 无效`
  if (typeof value.groupId !== 'string' || !value.groupId.trim() || value.groupId !== value.groupId.trim()) return `第 ${index + 1} 个课程组 ID 无效`
  if (typeof value.name !== 'string' || !value.name.trim()) return `第 ${index + 1} 个课程名称为空`
  if (!Number.isInteger(value.day) || (value.day as number) < 1 || (value.day as number) > 7) return `第 ${index + 1} 个课程星期无效`
  if (!Number.isInteger(value.startPeriod) || (value.startPeriod as number) < 1 || (value.startPeriod as number) > maxPeriod) return `第 ${index + 1} 个课程开始节次无效`
  if (!Number.isInteger(value.endPeriod) || (value.endPeriod as number) < 1 || (value.endPeriod as number) > maxPeriod) return `第 ${index + 1} 个课程结束节次无效`
  if ((value.startPeriod as number) > (value.endPeriod as number)) return `第 ${index + 1} 个课程节次顺序无效`
  if (!isValidCourseColor(value.color)) return `第 ${index + 1} 个课程颜色无效`
  if (!Number.isSafeInteger(value.createdAt) || (value.createdAt as number) < 0) return `第 ${index + 1} 个课程创建时间无效`
  if (!Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) < 0) return `第 ${index + 1} 个课程更新时间无效`
  if (value.teacher !== undefined && typeof value.teacher !== 'string') return `第 ${index + 1} 个课程教师字段无效`
  if (value.location !== undefined && typeof value.location !== 'string') return `第 ${index + 1} 个课程教室字段无效`
  if (typeof value.weekMode !== 'string' || !WEEK_MODES.has(value.weekMode)) return `第 ${index + 1} 个课程周次模式无效`
  if (!Array.isArray(value.weeks) || value.weeks.some((week) => !Number.isInteger(week))) return `第 ${index + 1} 个课程周次数组无效`

  const weeks = value.weeks as number[]
  const expected = value.weekMode === 'custom'
    ? normalizeWeeks(weeks, totalWeeks)
    : expandWeeks(value.weekMode as Course['weekMode'], totalWeeks)
  if (!expected.length || !sameNumbers(weeks, expected)) return `第 ${index + 1} 个课程周次与模式或学期不一致`
  return null
}

/** 严格验证当前 V5 快照；不修复、不丢弃字段，也不执行写入。 */
export function validateCurrentStorage(raw: unknown): StorageValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: '当前课表数据不是有效对象' }
  const value = raw as Record<string, unknown>
  if (value.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: `当前课表不是 V${SCHEMA_VERSION} 数据` }
  if (!hasOnlyKeys(value, ROOT_KEYS)) return { ok: false, reason: '当前课表根数据包含未知字段' }

  const term = value.term as TermSettings | null
  if (term !== null) {
    if (!term || typeof term !== 'object' || Array.isArray(term) || !hasOnlyKeys(term as unknown as Record<string, unknown>, TERM_KEYS)) {
      return { ok: false, reason: '学期设置包含未知或无效字段' }
    }
    const termCheck = validateTerm(term)
    if (!termCheck.ok) return { ok: false, reason: termCheck.reason || '学期设置无效' }
  }
  if (!Array.isArray(value.courses)) return { ok: false, reason: '课程数据不是数组' }
  if (!term && value.courses.length > 0) return { ok: false, reason: '已有课程但缺少有效学期设置' }

  if (!value.periodSettings || typeof value.periodSettings !== 'object' || Array.isArray(value.periodSettings)) {
    return { ok: false, reason: '课程时间设置不是有效对象' }
  }
  const rawPeriodSettings = value.periodSettings as Record<string, unknown>
  if (
    !hasOnlyKeys(rawPeriodSettings, PERIOD_SETTINGS_KEYS) ||
    !Array.isArray(rawPeriodSettings.periods) ||
    rawPeriodSettings.periods.some((period) => !period || typeof period !== 'object' || Array.isArray(period) || !hasOnlyKeys(period as Record<string, unknown>, PERIOD_KEYS)) ||
    !Array.isArray(rawPeriodSettings.overrides) ||
    rawPeriodSettings.overrides.some((override) => !override || typeof override !== 'object' || Array.isArray(override) || !hasOnlyKeys(override as Record<string, unknown>, OVERRIDE_KEYS))
  ) {
    return { ok: false, reason: '课程时间设置包含未知或无效字段' }
  }
  const periodCheck = validatePeriodSettings(value.periodSettings)
  if (!periodCheck.ok) return { ok: false, reason: periodCheck.reason || '课程时间设置无效' }
  const periodSettings = clonePeriodSettings(value.periodSettings as PeriodSettings)
  const totalWeeks = term ? term.totalWeeks : 0
  const courses = value.courses as Course[]
  const ids = new Set<string>()
  const groupHeads = new Map<string, Course>()

  for (let index = 0; index < courses.length; index++) {
    const reason = validateCourse(courses[index], totalWeeks, periodSettings.periods.length, index)
    if (reason) return { ok: false, reason }
    if (ids.has(courses[index].id)) return { ok: false, reason: `课程包含重复 ID：${courses[index].id}` }
    ids.add(courses[index].id)
    const head = groupHeads.get(courses[index].groupId)
    if (!head) groupHeads.set(courses[index].groupId, courses[index])
    else if (
      head.name !== courses[index].name ||
      head.teacher !== courses[index].teacher ||
      head.location !== courses[index].location ||
      head.color !== courses[index].color ||
      head.weekMode !== courses[index].weekMode ||
      !sameNumbers(head.weeks, courses[index].weeks)
    ) {
      return { ok: false, reason: `课程组「${courses[index].name}」的共同信息不一致` }
    }
  }

  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      if (isOverlapping(courses[i], courses[j])) {
        return { ok: false, reason: `课程「${courses[i].name}」与「${courses[j].name}」存在时间冲突` }
      }
    }
  }

  return {
    ok: true,
    data: {
      schemaVersion: SCHEMA_VERSION,
      term: term ? { ...term } : null,
      courses: courses.map((course) => ({ ...course, weeks: [...course.weeks] })),
      periodSettings,
    },
  }
}
