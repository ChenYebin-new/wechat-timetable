// services/backup-service.ts
// 课表数据的导出、导入校验、预览、覆盖、合并与最近自动备份（V5，兼容 V1–V4）。

import type { Course, PeriodSettings, TermSettings, TimetableStorage } from '../models/course'
import type { SupportedTimetableStorage } from '../models/course-legacy'
import { DEFAULT_PERIOD_SETTINGS, TIMETABLE_SCHEMA_VERSION } from '../constants/timetable'
import {
  APP_ID,
  TIMETABLE_BACKUP_VERSION,
  MAX_BACKUP_BYTES,
  RECENT_BACKUP_KEY,
} from '../models/backup'
import type { ImportPreview, RecentBackup, TimetableBackupEnvelope } from '../models/backup'
import { getStorage, getStorageProblem, writeStorage } from './course-storage'
import type { TimetableStorageView } from './storage-codec'
import { validateTerm } from '../utils/term'
import {
  clonePeriodSettings,
  samePeriodSettings,
} from '../utils/period-settings'
import { isSupportedSchemaVersion } from './storage-codec'
import { courseGroupCount, planCourseGroupMerge } from '../utils/course-groups'
import { restoreStorageKey, sameStoredValue } from './storage-safety'
import { decodeBackupTimetable, expandV1CoursesWithTerm } from './timetable-compat'

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

function sameTerm(a: TermSettings, b: TermSettings): boolean {
  return a.startDate === b.startDate && a.totalWeeks === b.totalWeeks
}

function unsupportedStorageReason(schemaVersion: number): string {
  return `当前课表数据版本为 V${schemaVersion}，此版本小程序仅支持 V${TIMETABLE_SCHEMA_VERSION}。请使用更新版本处理课表。`
}

// ---------- 导出 ----------

/** 导出当前课表为备份 JSON 文本。 */
export function exportBackup(): string {
  const storage = getStorage()
  if (!isSupportedSchemaVersion(storage.schemaVersion)) {
    throw new Error(unsupportedStorageReason(storage.schemaVersion))
  }
  if (storage.schemaVersion === TIMETABLE_SCHEMA_VERSION) {
    const storageProblem = getStorageProblem(storage)
    if (storageProblem) throw new Error(storageProblem)
  }
  if (storage.schemaVersion >= 2 && storage.schemaVersion <= TIMETABLE_SCHEMA_VERSION) {
    const termCheck = validateTerm(storage.term)
    if (!termCheck.ok) {
      throw new Error(termCheck.reason || '请先设置有效学期再导出')
    }
  }
  const envelope: TimetableBackupEnvelope = {
    app: APP_ID,
    backupVersion: TIMETABLE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      schemaVersion: storage.schemaVersion,
      term: storage.term,
      courses: storage.courses.map((c) => ({ ...c })),
      periodSettings: clonePeriodSettings(storage.periodSettings),
    } as unknown as SupportedTimetableStorage,
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
  if (envelope.backupVersion !== TIMETABLE_BACKUP_VERSION) {
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
  periodSettings?: PeriodSettings
  /** 备份为 V1 旧数据，导入前需要设置学期。 */
  needsTerm?: boolean
}

/** 深度校验备份并计算导入预览。出现任何错误则整体拒绝导入。 */
export function analyzeBackup(envelope: TimetableBackupEnvelope, currentSnapshot?: TimetableStorageView): AnalyzeResult {
  const parsed = validateEnvelopeObject(envelope)
  if (!parsed.ok || !parsed.envelope) {
    return { ok: false, errors: [parsed.reason || '备份外层结构不正确'] }
  }
  envelope = parsed.envelope
  const decoded = decodeBackupTimetable(envelope.data)
  if (!decoded.ok) return decoded
  const { courses, term, periodSettings, needsTerm } = decoded
  return {
    ok: true,
    errors: [],
    preview: computePreview(envelope, courses, term, periodSettings, needsTerm, currentSnapshot),
    courses, term, periodSettings, needsTerm,
  }
}

function computePreview(
  envelope: TimetableBackupEnvelope,
  backupCourses: Course[],
  backupTerm: TermSettings | null,
  backupPeriodSettings: PeriodSettings,
  needsTerm: boolean,
  currentSnapshot?: TimetableStorageView,
): ImportPreview {
  const current = currentSnapshot || getStorage()
  const existing = current.courses
  let candidates = backupCourses
  const currentProblem = getStorageProblem(current)
  let mergeAllowed = !currentProblem
  let mergeReason = currentProblem || ''

  if (mergeAllowed && !samePeriodSettings(current.periodSettings, backupPeriodSettings)) {
    mergeAllowed = false
    mergeReason = '备份与当前课表的课程时间设置不同，不能直接合并；可改用覆盖导入。'
  }

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

  const decisions = mergeAllowed ? planCourseGroupMerge(candidates, existing) : []
  const duplicateGroups = decisions.filter((decision) => decision.kind === 'duplicate')
  const conflictGroups = decisions.filter((decision) => decision.kind === 'conflict')
  const addGroups = decisions.filter((decision) => decision.kind === 'add')
  const duplicateCount = duplicateGroups.reduce((count, decision) => count + decision.courses.length, 0)
  const conflictCount = conflictGroups.reduce((count, decision) => count + decision.courses.length, 0)
  const addCount = addGroups.reduce((count, decision) => count + decision.courses.length, 0)
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
    backupGroupCount: courseGroupCount(backupCourses),
    currentGroupCount: courseGroupCount(existing),
    mergeAddGroupCount: addGroups.length,
    mergeSkipDuplicateGroupCount: duplicateGroups.length,
    mergeSkipConflictGroupCount: conflictGroups.length,
    mergeFinalGroupCount: courseGroupCount(existing) + addGroups.length,
    skippedGroupReasons: decisions.flatMap((decision) => decision.reason ? [decision.reason] : []),
  }
}

// ---------- 最近自动备份 ----------

function buildRecentBackup(current: TimetableStorage): RecentBackup {
  return {
    savedAt: Date.now(),
    export: {
      app: APP_ID,
      backupVersion: TIMETABLE_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        schemaVersion: current.schemaVersion,
        term: current.term,
        courses: current.courses.map((course) => ({ ...course })),
        periodSettings: clonePeriodSettings(current.periodSettings),
      },
    },
  }
}

/** 覆盖、合并或恢复前，先把当前完整课表写入"最近自动备份"。 */
function snapshotCurrent(current: TimetableStorage): boolean {
  let previousRecent: unknown
  let previousRecentRead = false
  try {
    previousRecent = wx.getStorageSync(RECENT_BACKUP_KEY)
    previousRecentRead = true
    const backup = buildRecentBackup(current)
    wx.setStorageSync(RECENT_BACKUP_KEY, backup)
    if (sameStoredValue(wx.getStorageSync(RECENT_BACKUP_KEY), backup)) return true
  } catch {
    // 下方恢复写入前的最近备份。
  }
  if (previousRecentRead) restoreStorageKey(RECENT_BACKUP_KEY, previousRecent)
  return false
}

function normalizeRecentBackup(raw: unknown): RecentBackup | null {
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
        periodSettings: clonePeriodSettings(analyzed.periodSettings || DEFAULT_PERIOD_SETTINGS),
      } as unknown as SupportedTimetableStorage,
    },
  }
}

/** 读取最近自动备份；没有则返回 null。 */
export function getRecentBackup(): RecentBackup | null {
  try {
    return normalizeRecentBackup(wx.getStorageSync(RECENT_BACKUP_KEY))
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
  addedGroups?: number
  skippedDuplicateGroups?: number
  skippedConflictGroups?: number
  finalGroupCount?: number
  skippedGroupReasons?: string[]
}

function getCurrentForMutation(): { current?: TimetableStorage; reason?: string } {
  const current = getStorage()
  const problem = getStorageProblem(current)
  if (problem) return { reason: problem }
  if (current.schemaVersion !== TIMETABLE_SCHEMA_VERSION) return { reason: unsupportedStorageReason(current.schemaVersion) }
  return { current: current as TimetableStorage }
}

function tryWriteStorage(data: TimetableStorage): boolean {
  try {
    writeStorage(data)
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
  const targetPeriodSettings = clonePeriodSettings(analyzed.periodSettings || DEFAULT_PERIOD_SETTINGS)
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
      schemaVersion: TIMETABLE_SCHEMA_VERSION,
      term: targetTerm,
      courses: targetCourses,
      periodSettings: targetPeriodSettings,
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
  const incomingPeriodSettings = clonePeriodSettings(analyzed.periodSettings || DEFAULT_PERIOD_SETTINGS)
  if (!samePeriodSettings(current.periodSettings, incomingPeriodSettings)) {
    return { ok: false, reason: '备份与当前课表的课程时间设置不同，不能直接合并；可改用覆盖导入。' }
  }

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
    if (!analyzed.term) {
      if (analyzed.courses.length > 0) return { ok: false, reason: '备份缺少有效学期设置' }
      return {
        ok: true,
        added: 0,
        skippedDuplicate: 0,
        skippedConflict: 0,
        finalCount: current.courses.length,
        addedGroups: 0,
        skippedDuplicateGroups: 0,
        skippedConflictGroups: 0,
        finalGroupCount: courseGroupCount(current.courses),
        skippedGroupReasons: [],
      }
    }
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
  const decisions = planCourseGroupMerge(incoming, result)
  let added = 0
  let duplicateCount = 0
  let conflictCount = 0
  for (const decision of decisions) {
    if (decision.kind === 'duplicate') {
      duplicateCount += decision.courses.length
      continue
    }
    if (decision.kind === 'conflict') {
      conflictCount += decision.courses.length
      continue
    }
    const groupId = generateImportId()
    for (const course of decision.courses) {
      result.push({ ...course, id: generateImportId(), groupId })
      added++
    }
  }

  try {
    writeStorage({
      schemaVersion: TIMETABLE_SCHEMA_VERSION,
      term: targetTerm,
      courses: result,
      periodSettings: clonePeriodSettings(current.periodSettings),
    })
    return {
      ok: true,
      added,
      skippedDuplicate: duplicateCount,
      skippedConflict: conflictCount,
      finalCount: result.length,
      addedGroups: decisions.filter((decision) => decision.kind === 'add').length,
      skippedDuplicateGroups: decisions.filter((decision) => decision.kind === 'duplicate').length,
      skippedConflictGroups: decisions.filter((decision) => decision.kind === 'conflict').length,
      finalGroupCount: courseGroupCount(result),
      skippedGroupReasons: decisions.flatMap((decision) => decision.reason ? [decision.reason] : []),
    }
  } catch {
    return recoverAfterMutationFailure(current)
  }
}

/** 恢复最近自动备份。恢复前先生成最近自动备份。 */
export function restoreRecentBackup(): MutationResult {
  let rawRecent: unknown
  try {
    rawRecent = wx.getStorageSync(RECENT_BACKUP_KEY)
  } catch {
    return { ok: false, reason: '无法读取最近自动备份' }
  }
  const rb = normalizeRecentBackup(rawRecent)
  if (!rb) return { ok: false, reason: '没有可用且通过校验的最近备份' }
  const currentResult = getCurrentForMutation()
  if (!currentResult.current) return { ok: false, reason: currentResult.reason }
  const current = currentResult.current
  const backupData = rb.export.data as unknown as {
    schemaVersion: number
    term: TermSettings | null
    courses: Course[]
    periodSettings: PeriodSettings
  }
  let targetTerm: TermSettings | null
  let targetCourses: Course[]
  const targetPeriodSettings = clonePeriodSettings(backupData.periodSettings || DEFAULT_PERIOD_SETTINGS)
  if (backupData.schemaVersion === 1) {
    const termCheck = validateTerm(current.term)
    if (!termCheck.ok || !current.term) {
      return { ok: false, reason: '最近备份为旧版数据，请先设置学期后再恢复' }
    }
    targetTerm = current.term
    targetCourses = expandV1CoursesWithTerm(backupData.courses, targetTerm)
  } else if (isSupportedSchemaVersion(backupData.schemaVersion) && backupData.term) {
    targetTerm = backupData.term
    targetCourses = backupData.courses
  } else if (
    backupData.schemaVersion >= 2 &&
    backupData.schemaVersion <= TIMETABLE_SCHEMA_VERSION &&
    backupData.term === null &&
    backupData.courses.length === 0
  ) {
    targetTerm = null
    targetCourses = []
  } else {
    return { ok: false, reason: '最近备份的数据版本或学期设置不受支持' }
  }
  if (!snapshotCurrent(current)) {
    return { ok: false, reason: '无法创建操作前自动备份，已停止恢复' }
  }
  try {
    writeStorage({
      schemaVersion: TIMETABLE_SCHEMA_VERSION,
      term: targetTerm,
      courses: targetCourses,
      periodSettings: targetPeriodSettings,
    })
    return { ok: true }
  } catch {
    const currentRestored = tryWriteStorage(current)
    const backupRestored = restoreStorageKey(RECENT_BACKUP_KEY, rawRecent)
    if (currentRestored && backupRestored) {
      return { ok: false, reason: '恢复失败，原课表和最近备份均已保留' }
    }
    if (currentRestored) {
      return { ok: false, reason: '恢复失败，原课表已保留，但最近备份无法还原' }
    }
    return { ok: false, reason: '恢复失败，无法确认原课表状态；请暂时不要继续操作' }
  }
}
