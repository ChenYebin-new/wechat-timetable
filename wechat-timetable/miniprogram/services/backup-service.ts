// services/backup-service.ts
// 课表数据的导出、导入校验、预览、覆盖、合并与最近自动备份（V3，兼容 V1/V2）。

import type { Course, TermSettings, TimetableStorage, WeekMode } from '../models/course'
import { COLOR_PALETTE, MAX_PERIOD, SCHEMA_VERSION } from '../constants/timetable'
import {
  APP_ID,
  BACKUP_VERSION,
  MAX_BACKUP_BYTES,
  RECENT_BACKUP_KEY,
} from '../models/backup'
import type { ImportPreview, RecentBackup, TimetableBackupEnvelope } from '../models/backup'
import { getStorage, writeStorage } from './course-storage'
import { isOverlapping } from '../utils/course-validator'
import { expandWeeks, normalizeWeeks, validateTerm } from '../utils/term'

// ---------- 基础工具 ----------

function utf8ByteLength(s: string): number {
  let bytes = 0
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i++ // 代理对，占两个 UTF-16 单元
    } else bytes += 3
  }
  return bytes
}

function isValidDateString(s: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(s)
  if (!match) return false
  const [, year, month, day, hour, minute, second, millisecond] = match
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond),
    ),
  )
  return date.toISOString() === s
}

function toWeekMode(v: unknown): WeekMode {
  return v === 'odd' || v === 'even' || v === 'custom' ? v : 'all'
}

function sameWeeks(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((week, index) => week === b[index])
}

function sameTerm(a: TermSettings, b: TermSettings): boolean {
  return a.startDate === b.startDate && a.totalWeeks === b.totalWeeks
}

/** 判断两门课程是否属于重复：ID 相同，或名称、时间与实际周次都相同。 */
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

interface CourseValidationResult {
  course?: Course
  reason?: string
}

function unsupportedStorageReason(schemaVersion: number): string {
  return `当前课表数据版本为 V${schemaVersion}，此版本小程序仅支持 V${SCHEMA_VERSION}。请使用更新版本处理课表。`
}

/** 严格校验单门备份课程的基础字段，返回规范化结果（周次在 analyzeBackup 中按学期处理）。 */
function validateBackupCourse(raw: unknown, schemaVersion: number): CourseValidationResult {
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
    c.startPeriod > MAX_PERIOD
  ) {
    return { reason: '开始节次必须是 1–9 的整数' }
  }
  if (
    typeof c.endPeriod !== 'number' ||
    !Number.isInteger(c.endPeriod) ||
    c.endPeriod < 1 ||
    c.endPeriod > MAX_PERIOD
  ) {
    return { reason: '结束节次必须是 1–9 的整数' }
  }
  if (c.startPeriod > c.endPeriod) {
    return { reason: '开始节次不能晚于结束节次' }
  }
  if (typeof c.color !== 'string' || !COLOR_PALETTE.includes(c.color)) {
    return { reason: '课程颜色不在支持的色板中' }
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
    name: c.name.trim(),
    day: c.day,
    startPeriod: c.startPeriod,
    endPeriod: c.endPeriod,
    color: c.color,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    weekMode,
    weeks: Array.isArray(c.weeks) ? (c.weeks as number[]) : [],
  }
  if (typeof c.teacher === 'string' && c.teacher.trim()) course.teacher = c.teacher.trim()
  if (typeof c.location === 'string' && c.location.trim()) course.location = c.location.trim()
  return { course }
}

// ---------- 导出 ----------

/** 导出当前课表为备份 JSON 文本。 */
export function exportBackup(): string {
  const storage = getStorage()
  if (storage.schemaVersion !== 1 && storage.schemaVersion !== 2 && storage.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(unsupportedStorageReason(storage.schemaVersion))
  }
  if (storage.schemaVersion >= 2 && storage.schemaVersion <= SCHEMA_VERSION) {
    const termCheck = validateTerm(storage.term)
    if (!termCheck.ok) {
      throw new Error(termCheck.reason || '请先设置有效学期再导出')
    }
  }
  const envelope: TimetableBackupEnvelope = {
    app: APP_ID,
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      schemaVersion: storage.schemaVersion,
      term: storage.term,
      courses: storage.courses.map((c) => ({ ...c })),
    },
  }
  return JSON.stringify(envelope)
}

// ---------- 解析与校验 ----------

export interface ParseResult {
  ok: boolean
  envelope?: TimetableBackupEnvelope
  reason?: string
}

function validateEnvelopeObject(obj: unknown): ParseResult {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, reason: '备份不是有效对象' }
  }
  const envelope = obj as TimetableBackupEnvelope
  if (envelope.app !== APP_ID) {
    return { ok: false, reason: '应用标识不正确，无法识别为本项目备份' }
  }
  if (envelope.backupVersion !== BACKUP_VERSION) {
    return { ok: false, reason: `不支持的备份版本：${String(envelope.backupVersion)}` }
  }
  if (typeof envelope.exportedAt !== 'string' || !isValidDateString(envelope.exportedAt)) {
    return { ok: false, reason: '导出时间必须是有效的 UTC ISO 8601 时间' }
  }
  if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
    return { ok: false, reason: '备份缺少有效的 data 数据' }
  }
  return { ok: true, envelope }
}

/** 解析粘贴的 JSON 文本，仅做 JSON 语法、大小和浅层结构检查。 */
export function parseBackup(text: string): ParseResult {
  if (!text || !text.trim()) return { ok: false, reason: '请先粘贴备份 JSON' }
  if (utf8ByteLength(text) > MAX_BACKUP_BYTES) {
    return { ok: false, reason: '粘贴内容超过 1 MiB，已停止解析' }
  }
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return { ok: false, reason: '不是有效的 JSON 文本' }
  }
  return validateEnvelopeObject(obj)
}

export interface AnalyzeResult {
  ok: boolean
  errors: string[]
  preview?: ImportPreview
  courses?: Course[]
  term?: TermSettings | null
  /** 备份为 V1 旧数据，导入前需要设置学期。 */
  needsTerm?: boolean
}

/** 深度校验备份并计算导入预览。出现任何错误则整体拒绝导入。 */
export function analyzeBackup(envelope: TimetableBackupEnvelope): AnalyzeResult {
  const parsed = validateEnvelopeObject(envelope)
  if (!parsed.ok || !parsed.envelope) {
    return { ok: false, errors: [parsed.reason || '备份外层结构不正确'] }
  }
  envelope = parsed.envelope
  const errors: string[] = []

  const schemaVersion = envelope.data.schemaVersion
  if (!Number.isInteger(schemaVersion)) {
    errors.push('备份数据版本缺失或格式不正确')
  } else if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== SCHEMA_VERSION) {
    errors.push(`不支持的课表数据版本：${schemaVersion}`)
  }

  // V2/V3 备份必须带有效学期；V1 备份无学期。
  let term: TermSettings | null = null
  const needsTerm = schemaVersion === 1
  if (schemaVersion === 2 || schemaVersion === SCHEMA_VERSION) {
    const termCheck = validateTerm(envelope.data.term as TermSettings | null)
    if (!termCheck.ok) {
      errors.push(`备份学期设置无效：${termCheck.reason || '缺少学期设置'}`)
    } else {
      term = envelope.data.term as TermSettings
    }
  }

  const totalWeeks = term ? term.totalWeeks : 0

  const backupCourses: Course[] = []
  const courseIds = new Set<string>()
  if (Array.isArray(envelope.data.courses)) {
    for (let index = 0; index < envelope.data.courses.length; index++) {
      const rawCourse = envelope.data.courses[index]
      if (
        (schemaVersion === 2 || schemaVersion === SCHEMA_VERSION) &&
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
        schemaVersion === SCHEMA_VERSION &&
        (!rawCourse || typeof rawCourse !== 'object' || Array.isArray(rawCourse) || !('groupId' in rawCourse))
      ) {
        errors.push(`第 ${index + 1} 门课程缺少 V3 课程组字段`)
        break
      }
      const validated = validateBackupCourse(rawCourse, schemaVersion)
      if (!validated.course) {
        errors.push(`第 ${index + 1} 门课程无效：${validated.reason || '字段不完整'}`)
        break
      }
      if (courseIds.has(validated.course.id)) {
        errors.push(`备份包含重复课程 ID：${validated.course.id}`)
        break
      }
      courseIds.add(validated.course.id)

      // 按学期规范化周次；V1 备份的课程先以"全部周"处理（导入时按所选学期展开）。
      let course = validated.course
      if (totalWeeks > 0) {
        if (course.weekMode === 'custom') {
          const weeks = normalizeWeeks(course.weeks, totalWeeks)
          if (!weeks.length || weeks.length !== course.weeks.length) {
            errors.push(`课程「${course.name}」的指定周次无效或超出学期范围`)
            break
          }
          course = { ...course, weeks }
        } else {
          const expectedWeeks = expandWeeks(course.weekMode, totalWeeks)
          if (!sameWeeks(course.weeks, expectedWeeks)) {
            errors.push(`课程「${course.name}」的周次模式与实际上课周次不一致`)
            break
          }
          course = { ...course, weeks: expectedWeeks }
        }
      } else if (needsTerm) {
        course = { ...course, weekMode: 'all', weeks: [] }
      }
      backupCourses.push(course)
    }
  } else {
    errors.push('备份课程数据不是数组')
  }

  // 同一课程组的共同字段必须一致，避免导入后出现无法整体编辑的脏数据。
  if (!errors.length && schemaVersion === SCHEMA_VERSION) {
    const groupHeads = new Map<string, Course>()
    for (const course of backupCourses) {
      const head = groupHeads.get(course.groupId)
      if (!head) {
        groupHeads.set(course.groupId, course)
        continue
      }
      if (
        head.name !== course.name ||
        head.teacher !== course.teacher ||
        head.location !== course.location ||
        head.color !== course.color ||
        head.weekMode !== course.weekMode ||
        !sameWeeks(head.weeks, course.weeks)
      ) {
        errors.push(`课程组「${course.name}」的共同信息不一致`)
        break
      }
    }
  }

  // 备份内部不得存在冲突课程（星期 + 节次 + 周次三者都重叠）。
  if (!errors.length) {
    for (let i = 0; i < backupCourses.length; i++) {
      for (let j = i + 1; j < backupCourses.length; j++) {
        if (isOverlapping(backupCourses[i], backupCourses[j])) {
          errors.push(`备份内部存在冲突：${backupCourses[i].name} 与 ${backupCourses[j].name}`)
          break
        }
      }
      if (errors.length) break
    }
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    errors: [],
    preview: computePreview(envelope, backupCourses, term, needsTerm),
    courses: backupCourses,
    term,
    needsTerm,
  }
}

function computePreview(
  envelope: TimetableBackupEnvelope,
  backupCourses: Course[],
  backupTerm: TermSettings | null,
  needsTerm: boolean,
): ImportPreview {
  const current = getStorage()
  const existing = current.courses
  let candidates = backupCourses
  let mergeAllowed = current.schemaVersion === SCHEMA_VERSION
  let mergeReason = mergeAllowed ? '' : unsupportedStorageReason(current.schemaVersion)

  if (mergeAllowed && needsTerm && current.term) {
    candidates = expandV1CoursesWithTerm(backupCourses, current.term)
  } else if (mergeAllowed && needsTerm && current.courses.length > 0) {
    mergeAllowed = false
    mergeReason = '当前课表已有课程但缺少有效学期，不能合并旧版备份；请先设置学期。'
  } else if (mergeAllowed && !needsTerm && backupTerm) {
    if (current.term && !sameTerm(current.term, backupTerm)) {
      mergeAllowed = false
      mergeReason = '备份与当前课表的学期开始日期或总周数不同，不能直接合并；可改用覆盖导入。'
    } else if (!current.term && current.courses.length > 0) {
      mergeAllowed = false
      mergeReason = '当前课表缺少有效学期，不能直接合并新版备份；请先设置学期。'
    }
  }

  let duplicateCount = 0
  let conflictCount = 0
  let addCount = 0
  for (const bc of candidates) {
    if (existing.some((e) => isDuplicateCourse(bc, e))) {
      duplicateCount++
      continue
    }
    if (existing.some((e) => isOverlapping(bc, e))) {
      conflictCount++
      continue
    }
    addCount++
  }
  return {
    exportedAt: envelope.exportedAt,
    schemaVersion: envelope.data.schemaVersion,
    backupCount: backupCourses.length,
    currentCount: existing.length,
    duplicateCount,
    conflictCount,
    overwriteCount: backupCourses.length,
    mergeAddCount: addCount,
    mergeSkipDuplicateCount: duplicateCount,
    mergeSkipConflictCount: conflictCount,
    mergeFinalCount: existing.length + addCount,
    mergeAllowed,
    mergeReason: mergeReason || undefined,
  }
}

// ---------- 最近自动备份 ----------

function buildRecentBackup(current: TimetableStorage): RecentBackup {
  return {
    savedAt: Date.now(),
    export: {
      app: APP_ID,
      backupVersion: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        schemaVersion: current.schemaVersion,
        term: current.term,
        courses: current.courses.map((course) => ({ ...course })),
      },
    },
  }
}

/** 覆盖、合并或恢复前，先把当前完整课表写入"最近自动备份"。 */
function snapshotCurrent(current: TimetableStorage): boolean {
  try {
    wx.setStorageSync(RECENT_BACKUP_KEY, buildRecentBackup(current))
    return true
  } catch {
    return false
  }
}

/** 读取最近自动备份；没有则返回 null。 */
export function getRecentBackup(): RecentBackup | null {
  try {
    const raw = wx.getStorageSync(RECENT_BACKUP_KEY)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const rb = raw as RecentBackup
    if (!Number.isSafeInteger(rb.savedAt) || rb.savedAt < 0) return null
    const parsed = validateEnvelopeObject(rb.export)
    if (!parsed.ok || !parsed.envelope) return null
    const analyzed = analyzeBackup(parsed.envelope)
    if (!analyzed.ok || !analyzed.courses) return null
    return {
      savedAt: rb.savedAt,
      export: {
        ...parsed.envelope,
        data: {
          schemaVersion: parsed.envelope.data.schemaVersion,
          term: analyzed.term ?? null,
          courses: analyzed.courses,
        },
      },
    }
  } catch {
    return null
  }
}

// ---------- 覆盖 / 合并 / 恢复 ----------

export interface MutationResult {
  ok: boolean
  reason?: string
  added?: number
  skippedDuplicate?: number
  skippedConflict?: number
  finalCount?: number
}

function getCurrentForMutation(): { current?: TimetableStorage; reason?: string } {
  const current = getStorage()
  if (current.schemaVersion !== SCHEMA_VERSION) {
    return { reason: unsupportedStorageReason(current.schemaVersion) }
  }
  return { current }
}

function tryWriteStorage(data: TimetableStorage): boolean {
  try {
    writeStorage(data)
    return true
  } catch {
    return false
  }
}

function tryWriteRecentBackup(backup: RecentBackup): boolean {
  try {
    wx.setStorageSync(RECENT_BACKUP_KEY, backup)
    return true
  } catch {
    return false
  }
}

function recoverAfterMutationFailure(current: TimetableStorage): MutationResult {
  if (tryWriteStorage(current)) {
    return { ok: false, reason: '写入失败，原课表已恢复，自动备份已保留' }
  }
  return { ok: false, reason: '写入失败，无法确认原课表状态；请使用最近自动备份恢复' }
}

/** V1 备份导入时，把课程按所选学期展开为"全部周"。 */
function expandV1CoursesWithTerm(courses: Course[], term: TermSettings): Course[] {
  return courses.map((c) => ({
    ...c,
    groupId: c.groupId || c.id,
    weekMode: 'all' as WeekMode,
    weeks: expandWeeks('all', term.totalWeeks),
  }))
}

function generateImportId(): string {
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 用备份整体覆盖当前课表。覆盖前先生成最近自动备份。V1 备份需提供 term。 */
export function overwriteFromBackup(envelope: TimetableBackupEnvelope, term?: TermSettings): MutationResult {
  const currentResult = getCurrentForMutation()
  if (!currentResult.current) return { ok: false, reason: currentResult.reason }
  const analyzed = analyzeBackup(envelope)
  if (!analyzed.ok || !analyzed.courses) return { ok: false, reason: analyzed.errors[0] }

  let targetTerm: TermSettings | null
  let targetCourses: Course[]
  if (analyzed.needsTerm) {
    const vt = validateTerm(term)
    if (!vt.ok) return { ok: false, reason: `导入旧版备份需要先设置学期：${vt.reason || '学期设置无效'}` }
    targetTerm = term as TermSettings
    targetCourses = expandV1CoursesWithTerm(analyzed.courses, targetTerm)
  } else {
    targetTerm = analyzed.term ?? null
    targetCourses = analyzed.courses
  }

  if (!snapshotCurrent(currentResult.current)) {
    return { ok: false, reason: '无法创建操作前自动备份，已停止覆盖' }
  }
  try {
    writeStorage({
      schemaVersion: SCHEMA_VERSION,
      term: targetTerm,
      courses: targetCourses,
    })
    return { ok: true }
  } catch {
    return recoverAfterMutationFailure(currentResult.current)
  }
}

/** 把备份合并进当前课表：重复与冲突课程跳过，合法课程加入。先生成最近自动备份。V1 备份按当前学期展开。 */
export function mergeFromBackup(envelope: TimetableBackupEnvelope, term?: TermSettings): MutationResult {
  const currentResult = getCurrentForMutation()
  if (!currentResult.current) return { ok: false, reason: currentResult.reason }
  const analyzed = analyzeBackup(envelope)
  if (!analyzed.ok || !analyzed.courses) return { ok: false, reason: analyzed.errors[0] }
  const current = currentResult.current

  let incoming: Course[]
  let targetTerm: TermSettings
  if (analyzed.needsTerm) {
    if (!current.term && current.courses.length > 0) {
      return { ok: false, reason: '当前课表已有课程但缺少有效学期，不能合并旧版备份；请先设置学期。' }
    }
    const selectedTerm = current.term || term
    const vt = validateTerm(selectedTerm)
    if (!vt.ok) return { ok: false, reason: `导入旧版备份需要先设置学期：${vt.reason || '学期设置无效'}` }
    targetTerm = selectedTerm as TermSettings
    incoming = expandV1CoursesWithTerm(analyzed.courses, targetTerm)
  } else {
    if (!analyzed.term) return { ok: false, reason: '备份缺少有效学期设置' }
    if (current.term && !sameTerm(current.term, analyzed.term)) {
      return {
        ok: false,
        reason: '备份与当前课表的学期开始日期或总周数不同，不能直接合并；可改用覆盖导入。',
      }
    }
    if (!current.term && current.courses.length > 0) {
      return { ok: false, reason: '当前课表缺少有效学期，不能直接合并新版备份；请先设置学期。' }
    }
    targetTerm = current.term || analyzed.term
    incoming = analyzed.courses
  }

  if (!snapshotCurrent(current)) {
    return { ok: false, reason: '无法创建操作前自动备份，已停止合并' }
  }

  const result = current.courses.map((c) => ({ ...c }))
  const remappedGroups = new Map<string, string>()
  let added = 0
  let duplicateCount = 0
  let conflictCount = 0
  for (const bc of incoming) {
    if (result.some((e) => isDuplicateCourse(bc, e))) {
      duplicateCount++
      continue
    }
    if (result.some((e) => isOverlapping(bc, e))) {
      conflictCount++
      continue
    }
    let groupId = remappedGroups.get(bc.groupId)
    if (!groupId) {
      groupId = generateImportId()
      remappedGroups.set(bc.groupId, groupId)
    }
    result.push({ ...bc, id: generateImportId(), groupId })
    added++
  }

  try {
    writeStorage({ schemaVersion: SCHEMA_VERSION, term: targetTerm, courses: result })
    return {
      ok: true,
      added,
      skippedDuplicate: duplicateCount,
      skippedConflict: conflictCount,
      finalCount: result.length,
    }
  } catch {
    return recoverAfterMutationFailure(current)
  }
}

/** 恢复最近自动备份。恢复前先生成最近自动备份。 */
export function restoreRecentBackup(): MutationResult {
  const rb = getRecentBackup()
  if (!rb) return { ok: false, reason: '没有可用且通过校验的最近备份' }
  const currentResult = getCurrentForMutation()
  if (!currentResult.current) return { ok: false, reason: currentResult.reason }
  const current = currentResult.current
  let targetTerm: TermSettings
  let targetCourses: Course[]
  if (rb.export.data.schemaVersion === 1) {
    const termCheck = validateTerm(current.term)
    if (!termCheck.ok || !current.term) {
      return { ok: false, reason: '最近备份为旧版数据，请先设置学期后再恢复' }
    }
    targetTerm = current.term
    targetCourses = expandV1CoursesWithTerm(rb.export.data.courses, targetTerm)
  } else if (
    (rb.export.data.schemaVersion === 2 || rb.export.data.schemaVersion === SCHEMA_VERSION) &&
    rb.export.data.term
  ) {
    targetTerm = rb.export.data.term
    targetCourses = rb.export.data.courses
  } else {
    return { ok: false, reason: '最近备份的数据版本或学期设置不受支持' }
  }
  if (!snapshotCurrent(current)) {
    return { ok: false, reason: '无法创建操作前自动备份，已停止恢复' }
  }
  try {
    writeStorage({
      schemaVersion: SCHEMA_VERSION,
      term: targetTerm,
      courses: targetCourses,
    })
    return { ok: true }
  } catch {
    const currentRestored = tryWriteStorage(current)
    const backupRestored = tryWriteRecentBackup(rb)
    if (currentRestored && backupRestored) {
      return { ok: false, reason: '恢复失败，原课表和最近备份均已保留' }
    }
    if (currentRestored) {
      return { ok: false, reason: '恢复失败，原课表已保留，但最近备份无法还原' }
    }
    return { ok: false, reason: '恢复失败，无法确认原课表状态；请暂时不要继续操作' }
  }
}
