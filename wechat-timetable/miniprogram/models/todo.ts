/** 旧版时间字段仅供无损迁移保留，不参与按日目标的业务逻辑。 */
export interface TodoLegacyTiming {
  dueDate: string
  scheduleDate: string
  scheduleStartTime: string
  scheduleEndTime: string
}

export interface TodoItem {
  id: string
  title: string
  note: string
  taskDate: string
  completed: boolean
  createdAt: number
  updatedAt: number
  completedAt: number | null
  legacyTiming?: TodoLegacyTiming
}

export interface TodoDraft {
  id?: string
  title: string
  note?: string
  taskDate: string
}

export interface TodoDailyNote {
  date: string
  content: string
  updatedAt: number
}

export interface TodoStorage {
  schemaVersion: 3
  items: TodoItem[]
  dailyNotes: TodoDailyNote[]
}
