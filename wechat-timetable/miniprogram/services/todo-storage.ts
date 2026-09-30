import { TODO_SCHEMA_VERSION } from '../constants/data-versions'
import type { TodoDailyNote, TodoDraft, TodoItem, TodoLegacyTiming, TodoStorage } from '../models/todo'
import { restoreStorageKey } from './storage-safety'
import { formatLocalDate, parseLocalDate } from '../utils/local-date'
import { assertTodoWritable, lockTodoWrites, todoWriteProblem } from './todo-session'

export const TODO_STORAGE_KEY = 'timetable_todos'
export { TODO_SCHEMA_VERSION } from '../constants/data-versions'

export type TodoStorageSnapshot =
  | { kind: 'missing' | 'current'; data: TodoStorage }
  | { kind: 'legacy' | 'corrupt' | 'unsupported' | 'io-error'; reason: string }

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

type TodoItemV2 = TodoItemV1 & TodoLegacyTiming
type LegacyStorage = { schemaVersion: 1; items: TodoItemV1[] } | { schemaVersion: 2; items: TodoItemV2[] }
type DecodedTodoStorage =
  | { kind: 'missing' | 'current'; data: TodoStorage }
  | { kind: 'legacy'; legacy: LegacyStorage; reason: string }
  | { kind: 'corrupt' | 'unsupported'; reason: string }

const LEGACY_STORAGE_KEYS = ['schemaVersion', 'items']
const STORAGE_KEYS = [...LEGACY_STORAGE_KEYS, 'dailyNotes']
const BASE_ITEM_KEYS = ['id', 'title', 'note', 'completed', 'createdAt', 'updatedAt', 'completedAt']
const V1_ITEM_KEYS = [...BASE_ITEM_KEYS, 'dueDate']
const TIMING_KEYS = ['dueDate', 'scheduleDate', 'scheduleStartTime', 'scheduleEndTime']
const V2_ITEM_KEYS = [...BASE_ITEM_KEYS, ...TIMING_KEYS]
const ITEM_KEYS = [...BASE_ITEM_KEYS, 'taskDate', 'legacyTiming']
const DAILY_NOTE_KEYS = ['date', 'content', 'updatedAt']

function emptyStorage(): TodoStorage {
  return { schemaVersion: TODO_SCHEMA_VERSION, items: [], dailyNotes: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function isValidTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

function isValidTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    && !Number.isNaN(new Date(value as number).getTime())
}

function validateBaseItem(value: Record<string, unknown>): boolean {
  if (typeof value.id !== 'string' || !value.id) return false
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 60) return false
  if (typeof value.note !== 'string' || value.note.length > 200) return false
  if (typeof value.completed !== 'boolean') return false
  if (!isValidTimestamp(value.createdAt) || !isValidTimestamp(value.updatedAt)) return false
  return value.completed ? isValidTimestamp(value.completedAt) : value.completedAt === null
}

function validateV1Item(value: unknown): value is TodoItemV1 {
  return isRecord(value) && hasOnlyKeys(value, V1_ITEM_KEYS) && validateBaseItem(value)
    && typeof value.dueDate === 'string' && (value.dueDate === '' || !!parseLocalDate(value.dueDate))
}

function validateTiming(value: Record<string, unknown>): boolean {
  if (typeof value.dueDate !== 'string' || (value.dueDate !== '' && !parseLocalDate(value.dueDate))) return false
  if (typeof value.scheduleDate !== 'string') return false
  if (typeof value.scheduleStartTime !== 'string') return false
  if (typeof value.scheduleEndTime !== 'string') return false
  const scheduleFields = [value.scheduleDate, value.scheduleStartTime, value.scheduleEndTime]
  if (scheduleFields.every((field) => field === '')) return true
  if (scheduleFields.some((field) => field === '')) return false
  return !!parseLocalDate(value.scheduleDate)
    && isValidTime(value.scheduleStartTime)
    && isValidTime(value.scheduleEndTime)
    && value.scheduleEndTime > value.scheduleStartTime
}

function validateV2Item(value: unknown): value is TodoItemV2 {
  return isRecord(value) && hasOnlyKeys(value, V2_ITEM_KEYS) && validateBaseItem(value) && validateTiming(value)
}

function validateItem(value: unknown): value is TodoItem {
  if (!isRecord(value) || !hasOnlyKeys(value, ITEM_KEYS) || !validateBaseItem(value)) return false
  if (typeof value.taskDate !== 'string' || !parseLocalDate(value.taskDate)) return false
  if (!('legacyTiming' in value)) return true
  return isRecord(value.legacyTiming) && hasOnlyKeys(value.legacyTiming, TIMING_KEYS)
    && validateTiming(value.legacyTiming)
}

function validateDailyNote(value: unknown): value is TodoDailyNote {
  return isRecord(value) && hasOnlyKeys(value, DAILY_NOTE_KEYS)
    && typeof value.date === 'string' && !!parseLocalDate(value.date)
    && typeof value.content === 'string' && value.content.length > 0 && value.content.length <= 2000
    && isValidTimestamp(value.updatedAt)
}

function cloneItem(item: TodoItem): TodoItem {
  return item.legacyTiming ? { ...item, legacyTiming: { ...item.legacyTiming } } : { ...item }
}

function cloneStorage(storage: TodoStorage): TodoStorage {
  return {
    schemaVersion: TODO_SCHEMA_VERSION,
    items: storage.items.map(cloneItem),
    dailyNotes: storage.dailyNotes.map((note) => ({ ...note })),
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
  if (raw === '' || raw === undefined || raw === null) return { kind: 'missing', data: emptyStorage() }
  if (!isRecord(raw)) return { kind: 'corrupt', reason: '待办数据格式异常，为保护原数据已停止写入' }
  if (raw.schemaVersion === 1 || raw.schemaVersion === 2) {
    if (!hasOnlyKeys(raw, LEGACY_STORAGE_KEYS) || !Array.isArray(raw.items)) {
      return { kind: 'corrupt', reason: '待办数据字段异常，为保护原数据已停止写入' }
    }
    const checked = decodeItems(raw.items, raw.schemaVersion === 1 ? validateV1Item : validateV2Item)
    if (!checked.ok) return { kind: 'corrupt', reason: checked.reason }
    return {
      kind: 'legacy',
      legacy: raw as unknown as LegacyStorage,
      reason: '旧版待办需要安全升级后才能使用，为保护原数据已停止写入，请重试',
    }
  }
  if (raw.schemaVersion !== TODO_SCHEMA_VERSION) {
    return {
      kind: 'unsupported',
      reason: typeof raw.schemaVersion === 'number'
        ? `当前待办数据版本为 V${raw.schemaVersion}，此版本小程序无法安全修改`
        : '待办数据缺少版本信息，为保护原数据已停止写入',
    }
  }
  if (!hasOnlyKeys(raw, STORAGE_KEYS) || !Array.isArray(raw.items) || !Array.isArray(raw.dailyNotes)) {
    return { kind: 'corrupt', reason: '待办数据字段异常，为保护原数据已停止写入' }
  }
  const checked = decodeItems(raw.items, validateItem)
  if (!checked.ok) return { kind: 'corrupt', reason: checked.reason }
  const dates = new Set<string>()
  for (const note of raw.dailyNotes) {
    if (!validateDailyNote(note)) return { kind: 'corrupt', reason: '随想记录内容异常，为保护原数据已停止写入' }
    if (dates.has(note.date)) return { kind: 'corrupt', reason: '随想记录包含重复日期，为保护原数据已停止写入' }
    dates.add(note.date)
  }
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

/** 严格校验备份中的 V3 数据；不迁移、不规范化、不写盘。 */
export function validateTodoStorage(raw: unknown): TodoStorage {
  const decoded = decode(raw)
  if (decoded.kind !== 'current') {
    throw new Error('reason' in decoded ? decoded.reason : '备份缺少待办 V3 数据')
  }
  return decoded.data
}

function loadWritable(): { data: TodoStorage; raw: unknown; wasMissing: boolean } {
  assertTodoWritable()
  const result = readRaw()
  if (!result.ok) throw new Error(result.reason)
  const decoded = decode(result.value)
  if (!('data' in decoded)) throw new Error(decoded.reason)
  return { data: decoded.data, raw: result.value, wasMissing: decoded.kind === 'missing' }
}

function persist(next: TodoStorage, previousRaw: unknown, wasMissing: boolean): void {
  assertTodoWritable()
  const validated = decode(next)
  if (validated.kind !== 'current') throw new Error('reason' in validated ? validated.reason : '待办数据格式异常')
  try {
    wx.setStorageSync(TODO_STORAGE_KEY, next)
    const reread = readRaw()
    if (!reread.ok) throw new Error(reread.reason)
    const checked = decode(reread.value)
    if (checked.kind !== 'current' || JSON.stringify(checked.data) !== JSON.stringify(next)) {
      throw new Error('写入后校验失败')
    }
  } catch {
    const restored = restoreStorageKey(TODO_STORAGE_KEY, wasMissing ? undefined : previousRaw)
    if (!restored) lockTodoWrites()
    throw new Error(restored ? '待办保存失败，原数据已恢复' : '待办保存失败，无法确认原数据状态')
  }
}

function normalizedDraft(draft: TodoDraft): Pick<TodoItem, 'title' | 'note' | 'taskDate'> {
  if (typeof draft.title !== 'string') throw new Error('请填写目标标题')
  if (draft.note !== undefined && typeof draft.note !== 'string') throw new Error('备注格式无效')
  const title = draft.title.trim()
  const note = (draft.note || '').trim()
  if (!title) throw new Error('请填写目标标题')
  if (title.length > 60) throw new Error('目标标题不能超过 60 个字')
  if (note.length > 200) throw new Error('备注不能超过 200 个字')
  if (typeof draft.taskDate !== 'string' || !parseLocalDate(draft.taskDate)) throw new Error('目标日期格式无效')
  return { title, note, taskDate: draft.taskDate }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getTodoSnapshot(): TodoStorageSnapshot {
  if (todoWriteProblem()) return { kind: 'io-error', reason: todoWriteProblem() }
  const result = readRaw()
  if (!result.ok) return { kind: 'io-error', reason: result.reason }
  const decoded = decode(result.value)
  return decoded.kind === 'legacy' ? { kind: 'legacy', reason: decoded.reason } : decoded
}

/** 仅显式迁移写入日期，读取旧版数据不会随当天变化。 */
export function migrateTodosToV3(date: string): boolean {
  assertTodoWritable()
  if (!parseLocalDate(date)) throw new Error('迁移日期格式无效')
  const result = readRaw()
  if (!result.ok) throw new Error(result.reason)
  const decoded = decode(result.value)
  if ('data' in decoded) return false
  if (decoded.kind !== 'legacy') throw new Error(decoded.reason)
  const next: TodoStorage = {
    schemaVersion: TODO_SCHEMA_VERSION,
    items: decoded.legacy.items.map((item) => {
      const timing: TodoLegacyTiming = {
        dueDate: item.dueDate,
        scheduleDate: 'scheduleDate' in item ? item.scheduleDate : '',
        scheduleStartTime: 'scheduleStartTime' in item ? item.scheduleStartTime : '',
        scheduleEndTime: 'scheduleEndTime' in item ? item.scheduleEndTime : '',
      }
      return {
        id: item.id,
        title: item.title,
        note: item.note,
        taskDate: item.completed
          ? timing.scheduleDate || timing.dueDate || formatLocalDate(new Date(item.completedAt as number))
          : date,
        completed: item.completed,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        completedAt: item.completedAt,
        legacyTiming: timing,
      }
    }),
    dailyNotes: [],
  }
  persist(next, result.value, false)
  return true
}

export function getTodoById(id: string): TodoItem | undefined {
  const loaded = loadWritable()
  const item = loaded.data.items.find((todo) => todo.id === id)
  return item ? cloneItem(item) : undefined
}

export function saveTodo(draft: TodoDraft): string {
  const normalized = normalizedDraft(draft)
  const loaded = loadWritable()
  const now = Date.now()
  let id = draft.id || ''
  if (id) {
    if (!loaded.data.items.some((item) => item.id === id)) throw new Error('没有找到要编辑的目标')
    loaded.data.items = loaded.data.items.map((item) => item.id === id
      ? { ...item, ...normalized, updatedAt: now }
      : item)
  } else {
    id = generateId()
    loaded.data.items = [
      ...loaded.data.items,
      { id, ...normalized, completed: false, createdAt: now, updatedAt: now, completedAt: null },
    ]
  }
  persist(loaded.data, loaded.raw, loaded.wasMissing)
  return id
}

export function toggleTodo(id: string): void {
  const loaded = loadWritable()
  const existing = loaded.data.items.find((item) => item.id === id)
  if (!existing) throw new Error('没有找到要更新的目标')
  const now = Date.now()
  loaded.data.items = loaded.data.items.map((item) => item.id === id
    ? { ...item, completed: !item.completed, completedAt: item.completed ? null : now, updatedAt: now }
    : item)
  persist(loaded.data, loaded.raw, loaded.wasMissing)
}

export function removeTodo(id: string): void {
  const loaded = loadWritable()
  if (!loaded.data.items.some((item) => item.id === id)) throw new Error('没有找到要删除的目标')
  loaded.data.items = loaded.data.items.filter((item) => item.id !== id)
  persist(loaded.data, loaded.raw, loaded.wasMissing)
}

export function saveDailyNote(date: string, content: string): void {
  if (!parseLocalDate(date)) throw new Error('随想日期格式无效')
  if (typeof content !== 'string') throw new Error('随想内容格式无效')
  if (content.length > 2000) throw new Error('随想不能超过 2,000 个字')
  const loaded = loadWritable()
  const existingIndex = loaded.data.dailyNotes.findIndex((note) => note.date === date)
  if (content === '') loaded.data.dailyNotes = loaded.data.dailyNotes.filter((note) => note.date !== date)
  else {
    const next: TodoDailyNote = { date, content, updatedAt: Date.now() }
    if (existingIndex < 0) loaded.data.dailyNotes = [...loaded.data.dailyNotes, next]
    else loaded.data.dailyNotes[existingIndex] = next
  }
  persist(loaded.data, loaded.raw, loaded.wasMissing)
}
