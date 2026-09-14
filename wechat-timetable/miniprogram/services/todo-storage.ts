import type { TodoDraft, TodoItem, TodoStorage } from '../models/todo'

export const TODO_STORAGE_KEY = 'timetable_todos'
export const TODO_SCHEMA_VERSION = 2

export type TodoStorageSnapshot =
  | { kind: 'missing' | 'current'; data: TodoStorage }
  | { kind: 'corrupt' | 'unsupported' | 'io-error'; reason: string }

type DecodedTodoStorage =
  | { kind: 'missing' | 'current'; data: TodoStorage }
  | { kind: 'corrupt' | 'unsupported'; reason: string }

const STORAGE_KEYS = ['schemaVersion', 'items']
const V1_ITEM_KEYS = ['id', 'title', 'note', 'dueDate', 'completed', 'createdAt', 'updatedAt', 'completedAt']
const ITEM_KEYS = [
  ...V1_ITEM_KEYS,
  'scheduleDate',
  'scheduleStartTime',
  'scheduleEndTime',
]

interface TodoItemV1 {
  id: string
  title: string
  note: string
  dueDate: string
  completed: boolean
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

function emptyStorage(): TodoStorage {
  return { schemaVersion: TODO_SCHEMA_VERSION, items: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function isValidTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

function validateBaseItem(value: Record<string, unknown>): boolean {
  if (typeof value.id !== 'string' || !value.id) return false
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 60) return false
  if (typeof value.note !== 'string' || value.note.length > 200) return false
  if (typeof value.dueDate !== 'string' || (value.dueDate !== '' && !isValidDate(value.dueDate))) return false
  if (typeof value.completed !== 'boolean') return false
  if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) return false
  if (value.completedAt !== null && !Number.isFinite(value.completedAt)) return false
  return true
}

function validateV1Item(value: unknown): value is TodoItemV1 {
  return isRecord(value) && hasOnlyKeys(value, V1_ITEM_KEYS) && validateBaseItem(value)
}

function validateItem(value: unknown): value is TodoItem {
  if (!isRecord(value) || !hasOnlyKeys(value, ITEM_KEYS) || !validateBaseItem(value)) return false
  if (typeof value.scheduleDate !== 'string') return false
  if (typeof value.scheduleStartTime !== 'string') return false
  if (typeof value.scheduleEndTime !== 'string') return false
  const scheduleFields = [value.scheduleDate, value.scheduleStartTime, value.scheduleEndTime]
  if (scheduleFields.every((field) => field === '')) return true
  if (scheduleFields.some((field) => field === '')) return false
  return isValidDate(value.scheduleDate)
    && isValidTime(value.scheduleStartTime)
    && isValidTime(value.scheduleEndTime)
    && value.scheduleEndTime > value.scheduleStartTime
}

function cloneStorage(storage: TodoStorage): TodoStorage {
  return {
    schemaVersion: TODO_SCHEMA_VERSION,
    items: storage.items.map((item) => ({ ...item })),
  }
}

function migrateV1(items: TodoItemV1[]): TodoStorage {
  return {
    schemaVersion: TODO_SCHEMA_VERSION,
    items: items.map((item) => ({
      ...item,
      scheduleDate: '',
      scheduleStartTime: '',
      scheduleEndTime: '',
    })),
  }
}

function decodeItems(
  items: unknown[],
  validate: (value: unknown) => boolean,
): { ok: true } | { ok: false; reason: string } {
  const ids = new Set<string>()
  for (const item of items) {
    if (!validate(item)) return { ok: false, reason: '待办条目内容异常，为保护原数据已停止写入' }
    const id = (item as { id: string }).id
    if (ids.has(id)) return { ok: false, reason: '待办数据包含重复条目，为保护原数据已停止写入' }
    ids.add(id)
  }
  return { ok: true }
}

function decode(raw: unknown): DecodedTodoStorage {
  if (raw === '' || raw === undefined || raw === null) {
    return { kind: 'missing', data: emptyStorage() }
  }
  if (!isRecord(raw)) return { kind: 'corrupt', reason: '待办数据格式异常，为保护原数据已停止写入' }
  if (raw.schemaVersion === 1) {
    if (!hasOnlyKeys(raw, STORAGE_KEYS) || !Array.isArray(raw.items)) {
      return { kind: 'corrupt', reason: '待办数据字段异常，为保护原数据已停止写入' }
    }
    const checked = decodeItems(raw.items, validateV1Item)
    if (!checked.ok) return { kind: 'corrupt', reason: checked.reason }
    return { kind: 'current', data: migrateV1(raw.items as TodoItemV1[]) }
  }
  if (raw.schemaVersion !== TODO_SCHEMA_VERSION) {
    return {
      kind: 'unsupported',
      reason: typeof raw.schemaVersion === 'number'
        ? `当前待办数据版本为 V${raw.schemaVersion}，此版本小程序无法安全修改`
        : '待办数据缺少版本信息，为保护原数据已停止写入',
    }
  }
  if (!hasOnlyKeys(raw, STORAGE_KEYS) || !Array.isArray(raw.items)) {
    return { kind: 'corrupt', reason: '待办数据字段异常，为保护原数据已停止写入' }
  }
  const checked = decodeItems(raw.items, validateItem)
  if (!checked.ok) return { kind: 'corrupt', reason: checked.reason }
  return { kind: 'current', data: cloneStorage(raw as unknown as TodoStorage) }
}

function readRaw(): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: wx.getStorageSync(TODO_STORAGE_KEY) }
  } catch (error) {
    const detail = error instanceof Error && error.message ? `：${error.message}` : ''
    return { ok: false, reason: `读取本地待办失败${detail}` }
  }
}

function loadWritable(): { data: TodoStorage; raw: unknown; wasMissing: boolean } {
  const result = readRaw()
  if (!result.ok) throw new Error(result.reason)
  const decoded = decode(result.value)
  if (!('data' in decoded)) throw new Error(decoded.reason)
  return { data: decoded.data, raw: result.value, wasMissing: decoded.kind === 'missing' }
}

function restoreRaw(raw: unknown, wasMissing: boolean): boolean {
  try {
    if (wasMissing) wx.removeStorageSync(TODO_STORAGE_KEY)
    else wx.setStorageSync(TODO_STORAGE_KEY, raw)
    return true
  } catch {
    return false
  }
}

function persist(next: TodoStorage, previousRaw: unknown, wasMissing: boolean): void {
  try {
    wx.setStorageSync(TODO_STORAGE_KEY, next)
    const reread = readRaw()
    if (!reread.ok) throw new Error(reread.reason)
    const checked = decode(reread.value)
    if (checked.kind !== 'current' || JSON.stringify(checked.data) !== JSON.stringify(next)) {
      throw new Error('写入后校验失败')
    }
  } catch {
    const restored = restoreRaw(previousRaw, wasMissing)
    throw new Error(restored ? '待办保存失败，原数据已恢复' : '待办保存失败，无法确认原数据状态')
  }
}

function normalizedDraft(draft: TodoDraft): Omit<TodoItem, 'id' | 'completed' | 'createdAt' | 'updatedAt' | 'completedAt'> {
  const title = draft.title.trim()
  const note = (draft.note || '').trim()
  const dueDate = draft.dueDate || ''
  const scheduleDate = draft.scheduleDate || ''
  const scheduleStartTime = draft.scheduleStartTime || ''
  const scheduleEndTime = draft.scheduleEndTime || ''
  if (!title) throw new Error('请填写待办标题')
  if (title.length > 60) throw new Error('待办标题不能超过 60 个字')
  if (note.length > 200) throw new Error('备注不能超过 200 个字')
  if (dueDate && !isValidDate(dueDate)) throw new Error('截止日期格式无效')
  const scheduleFields = [scheduleDate, scheduleStartTime, scheduleEndTime]
  if (scheduleFields.some(Boolean) && !scheduleFields.every(Boolean)) {
    throw new Error('请完整选择执行日期、开始时间和结束时间')
  }
  if (scheduleDate && !isValidDate(scheduleDate)) throw new Error('执行日期格式无效')
  if (scheduleStartTime && (!isValidTime(scheduleStartTime) || !isValidTime(scheduleEndTime))) {
    throw new Error('执行时间格式无效')
  }
  if (scheduleStartTime && scheduleEndTime <= scheduleStartTime) {
    throw new Error('结束时间必须晚于开始时间')
  }
  return { title, note, dueDate, scheduleDate, scheduleStartTime, scheduleEndTime }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getTodoSnapshot(): TodoStorageSnapshot {
  const result = readRaw()
  if (!result.ok) return { kind: 'io-error', reason: result.reason }
  return decode(result.value)
}

export function getTodoById(id: string): TodoItem | undefined {
  const loaded = loadWritable()
  const item = loaded.data.items.find((todo) => todo.id === id)
  return item ? { ...item } : undefined
}

export function getTodoDraftWarning(draft: TodoDraft): string {
  const normalized = normalizedDraft(draft)
  return normalized.dueDate && normalized.scheduleDate > normalized.dueDate
    ? '计划执行日期晚于截止日期，请确认日期设置是否符合你的安排。'
    : ''
}

export function saveTodo(draft: TodoDraft): string {
  const normalized = normalizedDraft(draft)
  const loaded = loadWritable()
  const now = Date.now()
  let id = draft.id || ''
  if (id) {
    const existing = loaded.data.items.find((item) => item.id === id)
    if (!existing) throw new Error('没有找到要编辑的待办')
    loaded.data.items = loaded.data.items.map((item) => item.id === id
      ? { ...item, ...normalized, updatedAt: now }
      : item)
  } else {
    id = generateId()
    loaded.data.items = [
      ...loaded.data.items,
      {
        id,
        ...normalized,
        completed: false,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
    ]
  }
  persist(loaded.data, loaded.raw, loaded.wasMissing)
  return id
}

export function toggleTodo(id: string): void {
  const loaded = loadWritable()
  const existing = loaded.data.items.find((item) => item.id === id)
  if (!existing) throw new Error('没有找到要更新的待办')
  const now = Date.now()
  loaded.data.items = loaded.data.items.map((item) => item.id === id
    ? {
      ...item,
      completed: !item.completed,
      completedAt: item.completed ? null : now,
      updatedAt: now,
    }
    : item)
  persist(loaded.data, loaded.raw, loaded.wasMissing)
}

export function removeTodo(id: string): void {
  const loaded = loadWritable()
  if (!loaded.data.items.some((item) => item.id === id)) throw new Error('没有找到要删除的待办')
  loaded.data.items = loaded.data.items.filter((item) => item.id !== id)
  persist(loaded.data, loaded.raw, loaded.wasMissing)
}
