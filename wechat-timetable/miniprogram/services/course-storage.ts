// services/course-storage.ts
// 统一管理本地 Storage 里的课表数据：V2 读写、V1→V2 迁移、学期读写与版本识别。
// 页面不要直接调用 wx.getStorageSync / setStorageSync 操作课表。

import type { Course, TermSettings, TimetableStorage, WeekMode } from '../models/course'
import { DAYS, MAX_PERIOD, SCHEMA_VERSION, STORAGE_KEY } from '../constants/timetable'
import { expandWeeks, normalizeWeeks, validateTerm } from '../utils/term'
import { isOverlapping } from '../utils/course-validator'
import { APP_ID, BACKUP_VERSION, RECENT_BACKUP_KEY } from '../models/backup'

function defaultStorage(): TimetableStorage {
  return { schemaVersion: SCHEMA_VERSION, term: null, courses: [] }
}

function toWeekMode(v: unknown): WeekMode {
  return v === 'odd' || v === 'even' || v === 'custom' ? v : 'all'
}

function sanitizeTerm(raw: unknown): TermSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const startDate = typeof t.startDate === 'string' ? t.startDate : ''
  const totalWeeks = typeof t.totalWeeks === 'number' ? t.totalWeeks : 0
  const result = validateTerm({ startDate, totalWeeks })
  return result.ok ? { startDate, totalWeeks } : null
}

function sanitizeCourse(raw: unknown, totalWeeks: number): Course | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || !c.id) return null
  if (typeof c.name !== 'string' || !c.name.trim()) return null
  if (typeof c.day !== 'number' || c.day < 1 || c.day > DAYS.length) return null
  if (typeof c.startPeriod !== 'number' || c.startPeriod < 1 || c.startPeriod > MAX_PERIOD) return null
  if (typeof c.endPeriod !== 'number' || c.endPeriod < 1 || c.endPeriod > MAX_PERIOD) return null
  if (c.startPeriod > c.endPeriod) return null
  if (typeof c.color !== 'string' || !c.color) return null
  const weekMode = toWeekMode(c.weekMode)
  const weeks =
    totalWeeks > 0
      ? weekMode === 'custom'
        ? normalizeWeeks(c.weeks as number[], totalWeeks)
        : expandWeeks(weekMode, totalWeeks)
      : []
  return {
    id: c.id,
    name: c.name,
    day: c.day,
    startPeriod: c.startPeriod,
    endPeriod: c.endPeriod,
    teacher: typeof c.teacher === 'string' && c.teacher ? c.teacher : undefined,
    location: typeof c.location === 'string' && c.location ? c.location : undefined,
    color: c.color,
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
    weekMode,
    weeks,
  }
}

function persist(data: TimetableStorage): void {
  wx.setStorageSync(STORAGE_KEY, data)
}

function load(): TimetableStorage {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') {
      const def = defaultStorage()
      persist(def)
      return def
    }
    const data = raw as Record<string, unknown>
    const schemaVersion =
      typeof data.schemaVersion === 'number' ? data.schemaVersion : SCHEMA_VERSION
    const term = sanitizeTerm(data.term)
    const totalWeeks = term ? term.totalWeeks : 0
    const rawCourses = Array.isArray(data.courses) ? (data.courses as unknown[]) : []
    const courses: Course[] = []
    for (const r of rawCourses) {
      const course = sanitizeCourse(r, totalWeeks)
      if (course) courses.push(course)
    }
    const storage: TimetableStorage = { schemaVersion, term, courses }

    if (schemaVersion === SCHEMA_VERSION) {
      // V2：仅当过滤掉无效数据时回写清理结果。
      if (rawCourses.length !== courses.length) {
        persist(storage)
      }
      return storage
    }

    // V1（待迁移）或未知更高版本：不做降级写回，仅尽力暴露课程，保留原数据。
    return storage
  } catch {
    return defaultStorage()
  }
}

function assertWritableStorage(data: TimetableStorage): void {
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `当前课表数据版本为 V${data.schemaVersion}，此版本小程序仅支持修改 V${SCHEMA_VERSION}。请先完成学期设置。`,
    )
  }
}

function snapshotCurrentRaw(): boolean {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return false
    const recent = {
      savedAt: Date.now(),
      export: {
        app: APP_ID,
        backupVersion: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data: raw,
      },
    }
    wx.setStorageSync(RECENT_BACKUP_KEY, recent)
    return true
  } catch {
    return false
  }
}

function restoreFromRecentRaw(): void {
  try {
    const raw = wx.getStorageSync(RECENT_BACKUP_KEY)
    if (raw && typeof raw === 'object') {
      const rb = raw as { export?: { data?: unknown } }
      if (rb.export && rb.export.data) {
        wx.setStorageSync(STORAGE_KEY, rb.export.data)
      }
    }
  } catch {
    // 忽略恢复失败
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 读取当前课表根数据（已做版本识别、周次展开与基础容错）。 */
export function getStorage(): TimetableStorage {
  return load()
}

/** 一次性写入课表根数据。调用方须自行完成校验；仅支持写 V2。 */
export function writeStorage(data: TimetableStorage): void {
  assertWritableStorage(data)
  persist(data)
}

/** 当前课表数据版本。 */
export function getSchemaVersion(): number {
  return load().schemaVersion
}

/** 当前学期设置；未设置返回 null。 */
export function getTerm(): TermSettings | null {
  return load().term
}

/** 是否仍为 V1 旧数据、需要迁移（提示设置学期）。 */
export function needsMigration(): boolean {
  return load().schemaVersion === 1
}

/** 读取全部课程（周次已展开）。 */
export function getCourses(): Course[] {
  return load().courses
}

/** 按 id 查询课程。 */
export function getCourseById(id: string): Course | undefined {
  return load().courses.find((c) => c.id === id)
}

/** 新增或更新课程。无 id 视为新增；有 id 视为更新。 */
export function save(course: Course): void {
  const data = load()
  assertWritableStorage(data)
  const totalWeeks = data.term ? data.term.totalWeeks : 0
  const weekMode = toWeekMode(course.weekMode)
  const weeks =
    weekMode === 'custom'
      ? normalizeWeeks(course.weeks || [], totalWeeks)
      : totalWeeks > 0
        ? expandWeeks(weekMode, totalWeeks)
        : []
  const now = Date.now()
  if (course.id) {
    data.courses = data.courses.map((c) =>
      c.id === course.id
        ? { ...c, ...course, weekMode, weeks, id: c.id, createdAt: c.createdAt, updatedAt: now }
        : c,
    )
  } else {
    data.courses = [
      ...data.courses,
      { ...course, weekMode, weeks, id: generateId(), createdAt: now, updatedAt: now },
    ]
  }
  persist(data)
}

/** 删除课程。 */
export function remove(id: string): void {
  const data = load()
  assertWritableStorage(data)
  data.courses = data.courses.filter((c) => c.id !== id)
  persist(data)
}

/**
 * 设置/修改学期。
 * - V1 数据：按迁移流程把旧课程迁移为 V2（weekMode 'all' + weeks 展开 1..totalWeeks）。
 * - V2 数据：重新计算全部课程周次（全部/单周/双周按新总周数展开，指定周次只保留范围内周次）。
 * 操作前先生成最近自动备份；任一校验失败或写入失败时不修改原数据。
 */
export function applyTerm(term: TermSettings): { ok: boolean; reason?: string; migrated?: boolean } {
  const vt = validateTerm(term)
  if (!vt.ok) return { ok: false, reason: vt.reason }

  const current = load()
  if (!snapshotCurrentRaw()) return { ok: false, reason: '无法创建前序自动备份' }

  const migrated = current.schemaVersion !== SCHEMA_VERSION

  const newCourses: Course[] = []
  for (const c of current.courses) {
    const weekMode = toWeekMode(c.weekMode)
    const weeks =
      weekMode === 'custom'
        ? normalizeWeeks(c.weeks, term.totalWeeks)
        : expandWeeks(weekMode, term.totalWeeks)
    if (weekMode === 'custom' && !weeks.length) {
      return {
        ok: false,
        reason: `「${c.name}」的指定周次在缩短后的学期内已为空，请先调整该课程`,
      }
    }
    newCourses.push({ ...c, weekMode, weeks })
  }

  // 校验调整后的全部课程没有冲突。
  for (let i = 0; i < newCourses.length; i++) {
    for (let j = i + 1; j < newCourses.length; j++) {
      if (isOverlapping(newCourses[i], newCourses[j])) {
        return {
          ok: false,
          reason: `调整后「${newCourses[i].name}」与「${newCourses[j].name}」存在时间冲突，未保存`,
        }
      }
    }
  }

  const storage: TimetableStorage = {
    schemaVersion: SCHEMA_VERSION,
    term: { startDate: term.startDate, totalWeeks: term.totalWeeks },
    courses: newCourses,
  }

  try {
    persist(storage)
    const reread = load()
    if (reread.schemaVersion !== SCHEMA_VERSION || !reread.term) {
      restoreFromRecentRaw()
      return { ok: false, reason: '写入后校验失败，已恢复原数据' }
    }
    return { ok: true, migrated }
  } catch {
    restoreFromRecentRaw()
    return { ok: false, reason: '写入失败，已恢复原数据' }
  }
}
