// services/backup-service.ts
// 课表数据的导出、导入校验、预览、覆盖、合并与最近自动备份。

import { Course, TimetableStorage } from '../models/course'
import { MAX_PERIOD, SCHEMA_VERSION } from '../constants/timetable'
import {
  APP_ID,
  BACKUP_VERSION,
  ImportPreview,
  MAX_BACKUP_BYTES,
  RECENT_BACKUP_KEY,
  RecentBackup,
  TimetableBackupEnvelope,
} from '../models/backup'
import { getStorage, writeStorage } from './course-storage'

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
  return typeof s === 'string' && !Number.isNaN(Date.parse(s))
}

/** 课程节次区间是否在同一天重叠。 */
function overlaps(
  a: { day: number; startPeriod: number; endPeriod: number },
  b: { day: number; startPeriod: number; endPeriod: number },
): boolean {
  return a.day === b.day && !(a.endPeriod < b.startPeriod || a.startPeriod > b.endPeriod)
}

/** 判断两门课程是否属于重复：ID 相同，或名称相同时星期、开始、结束节次相同。 */
function isDuplicateCourse(a: Course, b: Course): boolean {
  if (a.id === b.id) return true
  return (
    a.name.trim() === b.name.trim() &&
    a.day === b.day &&
    a.startPeriod === b.startPeriod &&
    a.endPeriod === b.endPeriod
  )
}

/** 严格校验单门备份课程；非法返回 null。 */
function validateBackupCourse(raw: unknown): Course | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || !c.id) return null
  if (typeof c.name !== 'string' || !c.name.trim()) return null
  if (typeof c.day !== 'number' || c.day < 1 || c.day > 7) return null
  if (typeof c.startPeriod !== 'number' || c.startPeriod < 1 || c.startPeriod > MAX_PERIOD) return null
  if (typeof c.endPeriod !== 'number' || c.endPeriod < 1 || c.endPeriod > MAX_PERIOD) return null
  if (c.startPeriod > c.endPeriod) return null
  if (typeof c.color !== 'string' || !c.color) return null
  if (typeof c.createdAt !== 'number') return null
  if (typeof c.updatedAt !== 'number') return null
  return {
    id: c.id,
    name: c.name,
    day: c.day,
    startPeriod: c.startPeriod,
    endPeriod: c.endPeriod,
    teacher: typeof c.teacher === 'string' && c.teacher ? c.teacher : undefined,
    location: typeof c.location === 'string' && c.location ? c.location : undefined,
    color: c.color,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

// ---------- 导出 ----------

/** 导出当前课表为备份 JSON 文本。 */
export function exportBackup(): string {
  const storage = getStorage()
  const envelope: TimetableBackupEnvelope = {
    app: APP_ID,
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: storage,
  }
  return JSON.stringify(envelope)
}

// ---------- 解析与校验 ----------

export interface ParseResult {
  ok: boolean
  envelope?: TimetableBackupEnvelope
  reason?: string
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
  const envelope = obj as TimetableBackupEnvelope
  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, reason: '备份不是有效对象' }
  }
  if (envelope.app !== APP_ID) {
    return { ok: false, reason: '应用标识不正确，无法识别为本项目备份' }
  }
  if (envelope.backupVersion !== BACKUP_VERSION) {
    return { ok: false, reason: `不支持的备份版本：${String(envelope.backupVersion)}` }
  }
  if (!isValidDateString(envelope.exportedAt)) {
    return { ok: false, reason: '导出时间不是有效时间' }
  }
  if (!envelope.data || typeof envelope.data !== 'object') {
    return { ok: false, reason: '备份缺少 data 数据' }
  }
  return { ok: true, envelope }
}

export interface AnalyzeResult {
  ok: boolean
  errors: string[]
  preview?: ImportPreview
}

/** 深度校验备份并计算导入预览。出现任何错误则整体拒绝导入。 */
export function analyzeBackup(envelope: TimetableBackupEnvelope): AnalyzeResult {
  const errors: string[] = []

  if (typeof envelope.data.schemaVersion !== 'number') {
    errors.push('备份数据版本缺失')
  } else if (envelope.data.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`不支持的课表数据版本：${envelope.data.schemaVersion}`)
  }

  const backupCourses: Course[] = []
  if (Array.isArray(envelope.data.courses)) {
    for (const raw of envelope.data.courses) {
      const course = validateBackupCourse(raw)
      if (!course) {
        errors.push('备份包含非法课程（字段缺失、星期/节次越界或开始晚于结束）')
        break
      }
      backupCourses.push(course)
    }
  } else {
    errors.push('备份课程数据不是数组')
  }

  // 备份内部不得存在同一天、重叠节次的冲突课程。
  if (!errors.length) {
    for (let i = 0; i < backupCourses.length; i++) {
      for (let j = i + 1; j < backupCourses.length; j++) {
        if (overlaps(backupCourses[i], backupCourses[j])) {
          errors.push(`备份内部存在冲突：${backupCourses[i].name} 与 ${backupCourses[j].name}`)
          break
        }
      }
      if (errors.length) break
    }
  }

  if (errors.length) return { ok: false, errors }

  return { ok: true, errors: [], preview: computePreview(envelope, backupCourses) }
}

function computePreview(envelope: TimetableBackupEnvelope, backupCourses: Course[]): ImportPreview {
  const current = getStorage()
  const existing = current.courses
  let duplicateCount = 0
  let conflictCount = 0
  let addCount = 0
  for (const bc of backupCourses) {
    if (existing.some((e) => isDuplicateCourse(bc, e))) {
      duplicateCount++
      continue
    }
    if (existing.some((e) => overlaps(bc, e))) {
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
      data: current,
    },
  }
}

/** 覆盖、合并或恢复前，先把当前完整课表写入"最近自动备份"。 */
function snapshotCurrent(): boolean {
  try {
    const current = getStorage()
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
    if (!raw || typeof raw !== 'object') return null
    const rb = raw as RecentBackup
    if (typeof rb.savedAt !== 'number' || !rb.export || typeof rb.export !== 'object') return null
    if (!rb.export.data || typeof rb.export.data !== 'object') return null
    return rb
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

/** 用备份整体覆盖当前课表。覆盖前先生成最近自动备份。 */
export function overwriteFromBackup(envelope: TimetableBackupEnvelope): MutationResult {
  const analyzed = analyzeBackup(envelope)
  if (!analyzed.ok) return { ok: false, reason: analyzed.errors[0] }
  if (!snapshotCurrent()) return { ok: false, reason: '无法创建前序自动备份' }
  try {
    writeStorage({
      schemaVersion: envelope.data.schemaVersion,
      courses: envelope.data.courses,
    })
    return { ok: true }
  } catch {
    // 写入失败：恢复自动备份中的原数据。
    const rb = getRecentBackup()
    if (rb) writeStorage(rb.export.data)
    return { ok: false, reason: '写入失败，已恢复原数据' }
  }
}

/** 把备份合并进当前课表：重复与冲突课程跳过，合法课程加入。先生成最近自动备份。 */
export function mergeFromBackup(envelope: TimetableBackupEnvelope): MutationResult {
  const analyzed = analyzeBackup(envelope)
  if (!analyzed.ok) return { ok: false, reason: analyzed.errors[0] }
  const current = getStorage()
  if (!snapshotCurrent()) return { ok: false, reason: '无法创建前序自动备份' }

  const result = current.courses.map((c) => ({ ...c }))
  let added = 0
  let duplicateCount = 0
  let conflictCount = 0
  for (const bc of envelope.data.courses) {
    if (result.some((e) => isDuplicateCourse(bc, e))) {
      duplicateCount++
      continue
    }
    if (result.some((e) => overlaps(bc, e))) {
      conflictCount++
      continue
    }
    result.push(bc)
    added++
  }

  try {
    writeStorage({ schemaVersion: SCHEMA_VERSION, courses: result })
    return {
      ok: true,
      added,
      skippedDuplicate: duplicateCount,
      skippedConflict: conflictCount,
      finalCount: result.length,
    }
  } catch {
    const rb = getRecentBackup()
    if (rb) writeStorage(rb.export.data)
    return { ok: false, reason: '写入失败，已恢复原数据' }
  }
}

/** 恢复最近自动备份。恢复前先生成最近自动备份。 */
export function restoreRecentBackup(): MutationResult {
  const rb = getRecentBackup()
  if (!rb) return { ok: false, reason: '没有可用备份' }
  if (!snapshotCurrent()) return { ok: false, reason: '无法创建前序自动备份' }
  try {
    writeStorage({ schemaVersion: rb.export.data.schemaVersion, courses: rb.export.data.courses })
    return { ok: true }
  } catch {
    return { ok: false, reason: '恢复失败，原数据未受影响' }
  }
}
