/** 无 Storage 副作用的格式兼容层。两个入口保留本地读取与备份导入的不同历史规则。 */
import type { Course, PeriodSettings, TermSettings, TimetableStorage, WeekMode } from '../models/course'
import type { SupportedTimetableStorage } from '../models/course-legacy'
import { DEFAULT_PERIOD_SETTINGS, DAYS, MAX_PERIODS, TIMETABLE_SCHEMA_VERSION } from '../constants/timetable'
import { expandWeeks, validateTerm } from '../utils/term'
import { clonePeriodSettings, migrateV4PeriodSettings, validatePeriodSettings } from '../utils/period-settings'
import { isValidCourseColor, resolveStoredWeeks, registerCourseId, sameCourseGroup, firstCourseConflict } from '../utils/course-data-rules'
import { classifyStorageValue, isLegacySchemaVersion, isSupportedSchemaVersion, validateCurrentStorage } from './storage-codec'
import type { StorageReadKind, TimetableStorageView } from './storage-codec'

export interface DecodedStoredTimetable {
  kind: Exclude<StorageReadKind, 'io-error'>
  data: TimetableStorageView
  reason?: string
  /** 仅候选值；调用方先备份，再决定是否写入。 */
  next?: TimetableStorage
}
function decoded(data: TimetableStorageView, kind: DecodedStoredTimetable['kind'], reason?: string): DecodedStoredTimetable {
  return { data, kind, reason }
}
function defaultStorage(): TimetableStorage {
  return {
    schemaVersion: TIMETABLE_SCHEMA_VERSION,
    term: null,
    courses: [],
    periodSettings: clonePeriodSettings(DEFAULT_PERIOD_SETTINGS),
  }
}

const LEGACY_ROOT_KEYS: Record<number, Set<string>> = {
  1: new Set(['schemaVersion', 'courses']),
  2: new Set(['schemaVersion', 'term', 'courses']),
  3: new Set(['schemaVersion', 'term', 'courses']),
  4: new Set(['schemaVersion', 'term', 'courses', 'periodSettings']),
}
const LEGACY_TERM_KEYS = new Set(['startDate', 'totalWeeks'])
const LEGACY_COURSE_BASE_KEYS = [
  'id', 'name', 'day', 'startPeriod', 'endPeriod', 'teacher', 'location',
  'color', 'createdAt', 'updatedAt',
]
const LEGACY_COURSE_KEYS: Record<number, Set<string>> = {
  1: new Set(LEGACY_COURSE_BASE_KEYS),
  2: new Set([...LEGACY_COURSE_BASE_KEYS, 'weekMode', 'weeks']),
  3: new Set([...LEGACY_COURSE_BASE_KEYS, 'weekMode', 'weeks', 'groupId']),
  4: new Set([...LEGACY_COURSE_BASE_KEYS, 'weekMode', 'weeks', 'groupId']),
  5: new Set([...LEGACY_COURSE_BASE_KEYS, 'weekMode', 'weeks', 'groupId']),
}
const LEGACY_V4_PERIOD_SETTINGS_KEYS = new Set(['durationMinutes', 'breakMinutes', 'periods'])
const LEGACY_PERIOD_KEYS = new Set(['start', 'end'])

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function toWeekMode(v: unknown): WeekMode {
  return v === 'odd' || v === 'even' || v === 'custom' ? v : 'all'
}

function sanitizeTerm(raw: unknown): TermSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as Record<string, unknown>
  if (!hasOnlyKeys(t, LEGACY_TERM_KEYS)) return null
  const startDate = typeof t.startDate === 'string' ? t.startDate : ''
  const totalWeeks = typeof t.totalWeeks === 'number' ? t.totalWeeks : 0
  const result = validateTerm({ startDate, totalWeeks })
  return result.ok ? { startDate, totalWeeks } : null
}

function sanitizeCourse(raw: unknown, totalWeeks: number, schemaVersion: number, maxPeriod: number): Course | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  const allowedKeys = LEGACY_COURSE_KEYS[schemaVersion]
  if (!allowedKeys || !hasOnlyKeys(c, allowedKeys)) return null
  if (typeof c.id !== 'string' || !c.id.trim() || c.id !== c.id.trim()) return null
  if (typeof c.name !== 'string' || !c.name.trim()) return null
  if (typeof c.day !== 'number' || !Number.isInteger(c.day) || c.day < 1 || c.day > DAYS.length) return null
  if (typeof c.startPeriod !== 'number' || !Number.isInteger(c.startPeriod) || c.startPeriod < 1 || c.startPeriod > maxPeriod) return null
  if (typeof c.endPeriod !== 'number' || !Number.isInteger(c.endPeriod) || c.endPeriod < 1 || c.endPeriod > maxPeriod) return null
  if (c.startPeriod > c.endPeriod) return null
  if (!isValidCourseColor(c.color)) return null
  if (!Number.isSafeInteger(c.createdAt) || (c.createdAt as number) < 0) return null
  if (!Number.isSafeInteger(c.updatedAt) || (c.updatedAt as number) < 0) return null
  if (c.teacher !== undefined && typeof c.teacher !== 'string') return null
  if (c.location !== undefined && typeof c.location !== 'string') return null

  let weekMode: WeekMode = 'all'
  let weeks = totalWeeks > 0 ? expandWeeks('all', totalWeeks) : []
  if (schemaVersion >= 2) {
    if (c.weekMode !== 'all' && c.weekMode !== 'odd' && c.weekMode !== 'even' && c.weekMode !== 'custom') return null
    if (!Array.isArray(c.weeks) || c.weeks.some((week) => !Number.isInteger(week))) return null
    weekMode = c.weekMode
    const rawWeeks = c.weeks as number[]
    const resolved = resolveStoredWeeks(weekMode, rawWeeks, totalWeeks, true)
    if (!resolved) return null
    weeks = resolved
  }
  const groupId =
    schemaVersion >= 3
      ? typeof c.groupId === 'string' && c.groupId.trim()
        ? c.groupId
        : ''
      : c.id
  if (!groupId || groupId !== groupId.trim()) return null
  return {
    id: c.id,
    groupId,
    name: c.name,
    day: c.day,
    startPeriod: c.startPeriod,
    endPeriod: c.endPeriod,
    teacher: typeof c.teacher === 'string' ? c.teacher : undefined,
    location: typeof c.location === 'string' ? c.location : undefined,
    color: c.color,
    createdAt: c.createdAt as number,
    updatedAt: c.updatedAt as number,
    weekMode,
    weeks,
  }
}

function isStrictLegacyRoot(data: Record<string, unknown>, schemaVersion: number): boolean {
  const allowedKeys = LEGACY_ROOT_KEYS[schemaVersion]
  return !!allowedKeys && Object.keys(data).length === allowedKeys.size && hasOnlyKeys(data, allowedKeys)
}

function isStrictV4PeriodSettings(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const value = raw as Record<string, unknown>
  return hasOnlyKeys(value, LEGACY_V4_PERIOD_SETTINGS_KEYS)
    && Array.isArray(value.periods)
    && value.periods.every((period) => (
      !!period
      && typeof period === 'object'
      && !Array.isArray(period)
      && hasOnlyKeys(period as Record<string, unknown>, LEGACY_PERIOD_KEYS)
    ))
}

/** 本地读取保持文本原样，并提供原有迁移候选；不写盘。 */
export function decodeStoredTimetable(raw: unknown): DecodedStoredTimetable {
  const classification = classifyStorageValue(raw)
  if (classification.kind === 'missing') {
    return decoded(defaultStorage(), 'missing')
  }
  if (classification.kind === 'current') return decoded(classification.data, 'current')
  if (classification.kind === 'corrupt' && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
    return decoded(defaultStorage(), 'corrupt', `${classification.reason}，为保护原数据已停止写入`)
  }
  const data = raw as Record<string, unknown>
  const schemaVersion =
    typeof data.schemaVersion === 'number' ? data.schemaVersion : TIMETABLE_SCHEMA_VERSION
  const legacySchema = isLegacySchemaVersion(schemaVersion)
  const legacyRootInvalid = legacySchema && !isStrictLegacyRoot(data, schemaVersion)
  const term = sanitizeTerm(data.term)
  const totalWeeks = term ? term.totalWeeks : 0
  const rawCourses = Array.isArray(data.courses) ? (data.courses as unknown[]) : []
  const periodCheck = validatePeriodSettings(data.periodSettings)
  const migratedV4Settings = schemaVersion === 4 && isStrictV4PeriodSettings(data.periodSettings)
    ? migrateV4PeriodSettings(data.periodSettings)
    : null
  const periodSettings = schemaVersion === TIMETABLE_SCHEMA_VERSION && periodCheck.ok
    ? clonePeriodSettings(data.periodSettings as PeriodSettings)
    : migratedV4Settings || clonePeriodSettings(DEFAULT_PERIOD_SETTINGS)
  const periodSettingsInvalid =
    (schemaVersion === TIMETABLE_SCHEMA_VERSION && !periodCheck.ok) || (schemaVersion === 4 && !migratedV4Settings)
  const maxPeriod = periodSettingsInvalid ? MAX_PERIODS : periodSettings.periods.length
  const courses: Course[] = []
  for (const r of rawCourses) {
    const course = sanitizeCourse(r, totalWeeks, schemaVersion, maxPeriod)
    if (course) courses.push(course)
  }
  const storage: TimetableStorageView = { schemaVersion, term, courses, periodSettings }

  if (
    legacySchema && (
      legacyRootInvalid ||
      !Array.isArray(data.courses) ||
      (
        schemaVersion >= 2 && (
          (data.term !== null && !term) ||
          (!term && rawCourses.length > 0)
        )
      ) ||
      rawCourses.length !== courses.length ||
      periodSettingsInvalid
    )
  ) {
    return decoded(storage, 'corrupt', '旧版课表字段缺失或损坏，为保护原数据已停止写入')
  }

  if (schemaVersion === TIMETABLE_SCHEMA_VERSION) {
    const reason = classification.kind === 'corrupt' ? classification.reason : '字段无效'
    return decoded(storage, 'corrupt', `当前 V5 课表数据缺失或损坏：${reason}，为保护原数据已停止写入`)
  }

  if (
    (schemaVersion === 2 || schemaVersion === 3 || schemaVersion === 4) &&
    (term || rawCourses.length === 0) &&
    rawCourses.length === courses.length &&
    !periodSettingsInvalid
  ) {
    const migrated: TimetableStorage = {
      schemaVersion: TIMETABLE_SCHEMA_VERSION,
      term,
      courses: courses.map((course) => ({ ...course, groupId: schemaVersion === 2 ? course.id : course.groupId })),
      periodSettings: clonePeriodSettings(periodSettings),
    }
    const migrationCheck = validateCurrentStorage(migrated)
    if (!migrationCheck.ok || !migrationCheck.data) {
      return decoded(storage, 'corrupt', `旧版课表无法安全升级：${migrationCheck.reason || '字段无效'}，为保护原数据已停止写入`)
    }
    return { ...decoded(storage, 'legacy'), next: migrationCheck.data }
  }

  if (isLegacySchemaVersion(schemaVersion)) return decoded(storage, 'legacy')
  return decoded(storage, 'unsupported', `当前课表数据版本为 V${schemaVersion}，此版本小程序无法安全修改`)
}

interface CourseValidationResult { course?: Course; reason?: string }
/** 备份导入历史上会整理文本；本地读取不会调用这里。 */
function normalizeImportedCourse(source: Course): Course {
  const { id, groupId, name, day, startPeriod, endPeriod, color, createdAt, updatedAt, weekMode, weeks } = source
  const course: Course = { id, groupId, name: name.trim(), day, startPeriod, endPeriod, color, createdAt, updatedAt, weekMode, weeks }
  if (typeof source.teacher === 'string' && source.teacher.trim()) course.teacher = source.teacher.trim()
  if (typeof source.location === 'string' && source.location.trim()) course.location = source.location.trim()
  return course
}

/** V1 备份补充学期后，按历史规则展开全部周；不访问 Storage。 */
export function expandV1CoursesWithTerm(courses: Course[], term: TermSettings): Course[] {
  return courses.map((course) => ({
    ...course,
    groupId: course.groupId || course.id,
    weekMode: 'all',
    weeks: expandWeeks('all', term.totalWeeks),
  }))
}

/** 严格校验单门备份课程的基础字段，返回规范化结果（周次在备份解码入口中按学期处理）。 */
function validateBackupCourse(raw: unknown, schemaVersion: number, maxPeriod: number): CourseValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { reason: '课程不是有效对象' }
  }
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || !c.id.trim() || c.id !== c.id.trim()) {
    return { reason: '课程 ID 缺失或格式不正确' }
  }
  const groupId = schemaVersion >= 3 ? c.groupId : c.id
  if (typeof groupId !== 'string' || !groupId.trim() || groupId !== groupId.trim()) {
    return { reason: '课程组 ID 缺失或格式不正确' }
  }
  if (typeof c.name !== 'string' || !c.name.trim()) {
    return { reason: '课程名称不能为空' }
  }
  if (typeof c.day !== 'number' || !Number.isInteger(c.day) || c.day < 1 || c.day > 7) {
    return { reason: '星期必须是 1–7 的整数' }
  }
  if (
    typeof c.startPeriod !== 'number' ||
    !Number.isInteger(c.startPeriod) ||
    c.startPeriod < 1 ||
    c.startPeriod > maxPeriod
  ) {
    return { reason: `开始节次必须是 1–${maxPeriod} 的整数` }
  }
  if (
    typeof c.endPeriod !== 'number' ||
    !Number.isInteger(c.endPeriod) ||
    c.endPeriod < 1 ||
    c.endPeriod > maxPeriod
  ) {
    return { reason: `结束节次必须是 1–${maxPeriod} 的整数` }
  }
  if (c.startPeriod > c.endPeriod) {
    return { reason: '开始节次不能晚于结束节次' }
  }
  if (!isValidCourseColor(c.color)) {
    return { reason: '课程颜色必须是六位十六进制颜色' }
  }
  if (typeof c.createdAt !== 'number' || !Number.isSafeInteger(c.createdAt) || c.createdAt < 0) {
    return { reason: '创建时间戳必须是非负安全整数' }
  }
  if (typeof c.updatedAt !== 'number' || !Number.isSafeInteger(c.updatedAt) || c.updatedAt < 0) {
    return { reason: '更新时间戳必须是非负安全整数' }
  }
  if (c.teacher !== undefined && typeof c.teacher !== 'string') {
    return { reason: '教师字段必须是文本' }
  }
  if (c.location !== undefined && typeof c.location !== 'string') {
    return { reason: '教室字段必须是文本' }
  }
  const weekMode = toWeekMode(c.weekMode)
  if (c.weekMode !== undefined && c.weekMode !== weekMode) {
    return { reason: '课程周次模式无效' }
  }
  if (c.weeks !== undefined && (!Array.isArray(c.weeks) || c.weeks.some((w) => !Number.isInteger(w)))) {
    return { reason: '课程周次数组无效' }
  }
  const course: Course = {
    id: c.id,
    groupId,
    name: c.name,
    day: c.day,
    startPeriod: c.startPeriod,
    endPeriod: c.endPeriod,
    color: c.color,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    weekMode,
    weeks: Array.isArray(c.weeks) ? (c.weeks as number[]) : [],
  }
  if (typeof c.teacher === 'string') course.teacher = c.teacher
  if (typeof c.location === 'string') course.location = c.location
  return { course: normalizeImportedCourse(course) }
}

export type DecodedBackupTimetable =
  | { ok: false; errors: string[] }
  | { ok: true; errors: string[]; courses: Course[]; term: TermSettings | null; periodSettings: PeriodSettings; needsTerm: boolean }

/** 备份入口保持原来的文本整理、错误顺序和旧版宽容策略。 */
export function decodeBackupTimetable(data: SupportedTimetableStorage): DecodedBackupTimetable {
  const errors: string[] = []

  const schemaVersion = data.schemaVersion
  if (!Number.isInteger(schemaVersion)) {
    errors.push('备份数据版本缺失或格式不正确')
  } else if (!isSupportedSchemaVersion(schemaVersion)) {
    errors.push(`不支持的课表数据版本：${schemaVersion}`)
  }

  if (!errors.length && schemaVersion === TIMETABLE_SCHEMA_VERSION) {
    const checked = validateCurrentStorage(data)
    if (!checked.ok || !checked.data) {
      return { ok: false, errors: [`备份 V5 快照无效：${checked.reason || '字段不完整'}`] }
    }
    return {
      ok: true, errors: [],
      courses: checked.data.courses.map(normalizeImportedCourse),
      term: checked.data.term,
      periodSettings: clonePeriodSettings(checked.data.periodSettings),
      needsTerm: false,
    }
  }

  // V2–V4 的空课表可尚未设置学期；只要存在课程就必须带有效学期。V1 备份无学期。
  let term: TermSettings | null = null
  const needsTerm = schemaVersion === 1
  if (schemaVersion === 2 || schemaVersion === 3 || schemaVersion === 4) {
    const emptyWithoutTerm = data.term === null
      && Array.isArray(data.courses)
      && data.courses.length === 0
    if (!emptyWithoutTerm) {
      const termCheck = validateTerm(data.term as TermSettings | null)
      if (!termCheck.ok) {
        errors.push(`备份学期设置无效：${termCheck.reason || '缺少学期设置'}`)
      } else {
        term = data.term as TermSettings
      }
    } else {
      term = null
    }
  }

  const totalWeeks = term ? term.totalWeeks : 0
  let periodSettings = clonePeriodSettings(DEFAULT_PERIOD_SETTINGS)
  if (schemaVersion === 4) {
    const migrated = migrateV4PeriodSettings(data.periodSettings)
    if (!migrated) errors.push('备份课程时间设置无效：无法识别 V4 作息')
    else periodSettings = migrated
  }
  const maxPeriod = periodSettings.periods.length

  const backupCourses: Course[] = []
  const courseIds = new Set<string>()
  if (Array.isArray(data.courses)) {
    for (let index = 0; index < data.courses.length; index++) {
      const rawCourse = data.courses[index]
      if (
        (schemaVersion === 2 || schemaVersion === 3 || schemaVersion === 4) &&
        (!rawCourse ||
          typeof rawCourse !== 'object' ||
          Array.isArray(rawCourse) ||
          !('weekMode' in rawCourse) ||
          !('weeks' in rawCourse))
      ) {
        errors.push(`第 ${index + 1} 门课程缺少周次字段`)
        break
      }
      if (
        schemaVersion >= 3 &&
        (!rawCourse || typeof rawCourse !== 'object' || Array.isArray(rawCourse) || !('groupId' in rawCourse))
      ) {
        errors.push(`第 ${index + 1} 门课程缺少 V3 课程组字段`)
        break
      }
      const validated = validateBackupCourse(rawCourse, schemaVersion, maxPeriod)
      if (!validated.course) {
        errors.push(`第 ${index + 1} 门课程无效：${validated.reason || '字段不完整'}`)
        break
      }
      if (!registerCourseId(courseIds, validated.course.id)) {
        errors.push(`备份包含重复课程 ID：${validated.course.id}`)
        break
      }

      // 按学期规范化周次；V1 备份的课程先以"全部周"处理（导入时按所选学期展开）。
      let course = validated.course
      if (totalWeeks > 0) {
        const weeks = resolveStoredWeeks(course.weekMode, course.weeks, totalWeeks, schemaVersion >= 2 && schemaVersion <= 4)
        if (!weeks) {
          errors.push(course.weekMode === 'custom'
            ? `课程「${course.name}」的指定周次无效或超出学期范围`
            : `课程「${course.name}」的周次模式与实际上课周次不一致`)
          break
        }
        course = { ...course, weeks }
      } else if (needsTerm) {
        course = { ...course, weekMode: 'all', weeks: [] }
      }
      backupCourses.push(course)
    }
  } else {
    errors.push('备份课程数据不是数组')
  }

  // 同一课程组的共同字段必须一致，避免导入后出现无法整体编辑的脏数据。
  if (!errors.length && schemaVersion >= 3) {
    const groupHeads = new Map<string, Course>()
    for (const course of backupCourses) {
      const head = groupHeads.get(course.groupId)
      if (!head) {
        groupHeads.set(course.groupId, course)
        continue
      }
      if (!sameCourseGroup(head, course)) {
        errors.push(`课程组「${course.name}」的共同信息不一致`)
        break
      }
    }
  }

  // 备份内部不得存在冲突课程（星期 + 节次 + 周次三者都重叠）。
  if (!errors.length) {
    const conflict = firstCourseConflict(backupCourses)
    if (conflict) errors.push(`备份内部存在冲突：${conflict[0].name} 与 ${conflict[1].name}`)
  }

  if (errors.length) return { ok: false, errors }

  return { ok: true, errors: [], courses: backupCourses, term, periodSettings, needsTerm }
}
