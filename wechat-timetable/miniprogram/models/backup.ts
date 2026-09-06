// models/backup.ts
// 课表数据备份相关类型与常量。

import { TimetableStorage } from './course'

/** 本项目备份的应用标识，用于识别是否为本项目生成的备份。 */
export const APP_ID = 'qige-timetable'
/** 外层备份格式版本。当前为 1。 */
export const BACKUP_VERSION = 1
/** 单次粘贴内容上限：1 MiB。 */
export const MAX_BACKUP_BYTES = 1024 * 1024
/** 最近自动备份的 Storage key（只保留最近一份）。 */
export const RECENT_BACKUP_KEY = 'timetable_recent_backup'

/** 备份外层封装。内部 data.schemaVersion 表示课表数据版本。 */
export interface TimetableBackupEnvelope {
  app: string
  backupVersion: number
  exportedAt: string // ISO 8601 字符串
  data: TimetableStorage
}

/** 最近自动备份：在覆盖、合并或迁移前保存的一份当前课表快照。 */
export interface RecentBackup {
  savedAt: number
  export: TimetableBackupEnvelope
}

/** 导入解析后的预览统计。 */
export interface ImportPreview {
  exportedAt: string
  schemaVersion: number
  backupCount: number
  currentCount: number
  duplicateCount: number
  conflictCount: number
  overwriteCount: number
  mergeAddCount: number
  mergeSkipDuplicateCount: number
  mergeSkipConflictCount: number
  mergeFinalCount: number
}
