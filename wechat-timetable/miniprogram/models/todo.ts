export interface TodoItem {
  id: string
  title: string
  note: string
  dueDate: string
  scheduleDate: string
  scheduleStartTime: string
  scheduleEndTime: string
  completed: boolean
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export interface TodoDraft {
  id?: string
  title: string
  note?: string
  dueDate?: string
  scheduleDate?: string
  scheduleStartTime?: string
  scheduleEndTime?: string
}

export interface TodoStorage {
  schemaVersion: 2
  items: TodoItem[]
}
