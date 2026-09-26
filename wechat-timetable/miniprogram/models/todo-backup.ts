import type { TodoStorage } from './todo'

export const TODO_RECENT_BACKUP_KEY = 'timetable_todos_recent_backup'

export interface TodoBackupEnvelope {
  app: string
  kind: 'todo-journal'
  backupVersion: 1
  exportedAt: string
  data: TodoStorage
}

export interface TodoBackupSummary {
  exportedAt: string
  itemCount: number
  completedCount: number
  noteCount: number
  dateRange: string
}

/** currentToken/recentToken 绑定用户确认时看到的数据，防止陈旧预览写入。 */
export interface TodoRestorePreview {
  backupText: string
  currentToken: string
  recentToken?: string
  summary: TodoBackupSummary
  currentItemCount: number
  currentNoteCount: number
}
