import { TODO_SCHEMA_VERSION, TODO_BACKUP_VERSION } from '../constants/data-versions'
import { APP_ID, MAX_BACKUP_BYTES } from '../models/backup'
import { TODO_RECENT_BACKUP_KEY } from '../models/todo-backup'
import type { TodoBackupEnvelope, TodoBackupSummary, TodoRestorePreview } from '../models/todo-backup'
import type { TodoStorage } from '../models/todo'
import { TODO_STORAGE_KEY, validateTodoStorage } from './todo-storage'
import { restoreStorageKey, sameStoredValue } from './storage-safety'
import { assertTodoWritable, firstTodoDraftDate, lockTodoWrites, markTodosReplaced, todoWriteProblem } from './todo-session'
import { utf8ByteLength } from '../utils/utf8'

function checkSize(text: string): void {
  if (utf8ByteLength(text) > MAX_BACKUP_BYTES) throw new Error('备份超过 1 MiB，无法完整复制或导入；内容未被截断')
}

function token(raw: unknown): string { return JSON.stringify(raw) ?? 'undefined' }

function readCurrent(): { raw: unknown; data: TodoStorage } {
  assertTodoWritable()
  const raw: unknown = wx.getStorageSync(TODO_STORAGE_KEY)
  if (raw === '' || raw === undefined || raw === null) {
    return { raw, data: { schemaVersion: TODO_SCHEMA_VERSION, items: [], dailyNotes: [] } }
  }
  if (typeof raw === 'object' && raw && 'schemaVersion' in raw && (raw.schemaVersion === 1 || raw.schemaVersion === 2)) {
    throw new Error('请先进入待办页完成旧版数据升级，再使用备份恢复')
  }
  return { raw, data: validateTodoStorage(raw) }
}

function envelope(data: TodoStorage): TodoBackupEnvelope {
  return { app: APP_ID, kind: 'todo-journal', backupVersion: TODO_BACKUP_VERSION, exportedAt: new Date().toISOString(), data }
}

function serialize(value: TodoBackupEnvelope): string {
  const text = JSON.stringify(value)
  checkSize(text)
  return text
}

export function parseTodoBackup(text: string): TodoBackupEnvelope {
  checkSize(text)
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('备份不是有效的 JSON，请粘贴完整内容') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('备份格式无效')
  const value = raw as Record<string, unknown>
  if (value.app !== APP_ID || value.kind !== 'todo-journal') throw new Error('请使用待办与随想备份；课表备份不能在此恢复')
  if (value.backupVersion !== TODO_BACKUP_VERSION) throw new Error('不支持此待办备份版本')
  if (Object.keys(value).some((key) => !['app', 'kind', 'backupVersion', 'exportedAt', 'data'].includes(key))) {
    throw new Error('备份包含不支持的字段')
  }
  if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))
    || new Date(value.exportedAt).toISOString() !== value.exportedAt) throw new Error('备份导出时间无效')
  return { app: APP_ID, kind: 'todo-journal', backupVersion: TODO_BACKUP_VERSION, exportedAt: value.exportedAt, data: validateTodoStorage(value.data) }
}

function summary(value: TodoBackupEnvelope): TodoBackupSummary {
  const dates = [...value.data.items.map((item) => item.taskDate), ...value.data.dailyNotes.map((note) => note.date)].sort()
  return {
    exportedAt: value.exportedAt,
    itemCount: value.data.items.length,
    completedCount: value.data.items.filter((item) => item.completed).length,
    noteCount: value.data.dailyNotes.length,
    dateRange: dates.length ? `${dates[0]} 至 ${dates[dates.length - 1]}` : '无记录',
  }
}

export function exportTodoBackup(): string { return serialize(envelope(readCurrent().data)) }

export function previewTodoBackup(text: string): TodoRestorePreview {
  const backup = parseTodoBackup(text)
  const current = readCurrent()
  return {
    backupText: serialize(backup), currentToken: token(current.raw), summary: summary(backup),
    currentItemCount: current.data.items.length, currentNoteCount: current.data.dailyNotes.length,
  }
}

function decodeRecent(raw: unknown): TodoBackupEnvelope | null {
  if (raw === '' || raw === undefined || raw === null) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('最近备份损坏，无法恢复')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some((key) => !['savedAt', 'export'].includes(key))
    || !Number.isSafeInteger(value.savedAt) || (value.savedAt as number) < 0
    || !Number.isFinite(new Date(value.savedAt as number).getTime())) throw new Error('最近备份格式无效')
  return parseTodoBackup(JSON.stringify(value.export) || '')
}

export function getRecentTodoBackup(): TodoBackupSummary | null {
  const value = decodeRecent(wx.getStorageSync(TODO_RECENT_BACKUP_KEY))
  return value ? summary(value) : null
}

export function previewRecentTodoBackup(): TodoRestorePreview {
  const raw: unknown = wx.getStorageSync(TODO_RECENT_BACKUP_KEY)
  const value = decodeRecent(raw)
  if (!value) throw new Error('没有可用的最近备份')
  return { ...previewTodoBackup(serialize(value)), recentToken: token(raw) }
}

/** 两次写入均回读确认；任何异常都不报告成功。 */
export function restoreTodoBackup(preview: TodoRestorePreview): void {
  assertTodoWritable()
  if (firstTodoDraftDate()) throw new Error('还有未保存的目标或随想，请先返回待办保存或放弃修改')
  const target = parseTodoBackup(preview.backupText)
  const current = readCurrent()
  if (token(current.raw) !== preview.currentToken) throw new Error('本机数据已变化，请重新预览后恢复')
  const previousRecent: unknown = wx.getStorageSync(TODO_RECENT_BACKUP_KEY)
  if (preview.recentToken !== undefined && token(previousRecent) !== preview.recentToken) {
    throw new Error('最近备份已变化，请重新预览后恢复')
  }
  const before = envelope(current.data)
  serialize(before) // 必须能完整备份当前数据，才允许覆盖。
  const nextRecent = { savedAt: Date.now(), export: before }
  let targetAttempted = false
  try {
    wx.setStorageSync(TODO_RECENT_BACKUP_KEY, nextRecent)
    if (!sameStoredValue(wx.getStorageSync(TODO_RECENT_BACKUP_KEY), nextRecent)) throw new Error('备份写入校验失败')
    targetAttempted = true
    wx.setStorageSync(TODO_STORAGE_KEY, target.data)
    if (!sameStoredValue(wx.getStorageSync(TODO_STORAGE_KEY), target.data)) throw new Error('恢复写入校验失败')
  } catch {
    const currentRestored = !targetAttempted || restoreStorageKey(TODO_STORAGE_KEY, current.raw)
    const recentRestored = restoreStorageKey(TODO_RECENT_BACKUP_KEY, previousRecent)
    if (!currentRestored || !recentRestored) {
      lockTodoWrites()
      throw new Error(todoWriteProblem())
    }
    throw new Error('恢复失败，原数据和原最近备份已保留，请重试')
  }
  markTodosReplaced()
}
