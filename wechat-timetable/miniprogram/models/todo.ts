export interface TodoItem {
  id: string
  title: string
  note: string
  dueDate: string
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
}

export interface TodoStorage {
  schemaVersion: 1
  items: TodoItem[]
}
