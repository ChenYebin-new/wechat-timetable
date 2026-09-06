// services/course-storage.ts
// 统一管理本地 Storage 里的课程：读取、查询、新增、更新、删除，以及数据版本识别。
// 页面不要直接调用 wx.getStorageSync / setStorageSync 操作课程。

import type { Course, TimetableStorage } from '../models/course'
import { DAYS, MAX_PERIOD, SCHEMA_VERSION, STORAGE_KEY } from '../constants/timetable'

function defaultStorage(): TimetableStorage {
  return { schemaVersion: SCHEMA_VERSION, courses: [] }
}

// 校验并补齐单项课程；非法课程返回 null（由调用方过滤）。
function sanitizeCourse(raw: unknown): Course | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || !c.id) return null
  if (typeof c.name !== 'string' || !c.name.trim()) return null
  if (typeof c.day !== 'number' || c.day < 1 || c.day > DAYS.length) return null
  if (typeof c.startPeriod !== 'number' || c.startPeriod < 1 || c.startPeriod > MAX_PERIOD) return null
  if (typeof c.endPeriod !== 'number' || c.endPeriod < 1 || c.endPeriod > MAX_PERIOD) return null
  if (c.startPeriod > c.endPeriod) return null
  if (typeof c.color !== 'string' || !c.color) return null
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
  }
}

function sanitizeCourses(list: unknown[]): Course[] {
  const out: Course[] = []
  for (const raw of list) {
    const course = sanitizeCourse(raw)
    if (course) out.push(course)
  }
  return out
}

function persist(data: TimetableStorage): void {
  wx.setStorageSync(STORAGE_KEY, data)
}

function assertWritableStorage(data: TimetableStorage): void {
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `当前课表数据版本为 V${data.schemaVersion}，此版本小程序仅支持修改 V${SCHEMA_VERSION}。请使用更新版本处理课表。`,
    )
  }
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
    const rawCourses = Array.isArray(data.courses) ? (data.courses as unknown[]) : []
    const courses = sanitizeCourses(rawCourses)

    if (schemaVersion === SCHEMA_VERSION) {
      // 当前支持 V1：仅当过滤掉无效数据时才回写清理后的结果，避免静默覆盖其余字段。
      if (rawCourses.length !== courses.length) {
        persist({ schemaVersion, courses })
      }
      return { schemaVersion, courses }
    }

    // 未知更高版本：不做降级写回，仅尽力暴露可识别的课程，保留原数据。
    return { schemaVersion, courses }
  } catch {
    return defaultStorage()
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 读取当前课表根数据（已做版本识别与基础容错）。 */
export function getStorage(): TimetableStorage {
  return load()
}

/** 一次性写入课表根数据。调用方须自行完成校验。 */
export function writeStorage(data: TimetableStorage): void {
  assertWritableStorage(data)
  persist(data)
}

/** 当前课表数据版本。 */
export function getSchemaVersion(): number {
  return load().schemaVersion
}

/** 读取全部课程。首次启动、无数据或数据异常时返回空数组，不会因为坏数据崩溃。 */
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
  const now = Date.now()
  if (course.id) {
    data.courses = data.courses.map((c) =>
      c.id === course.id
        ? { ...c, ...course, id: c.id, createdAt: c.createdAt, updatedAt: now }
        : c,
    )
  } else {
    data.courses = [
      ...data.courses,
      { ...course, id: generateId(), createdAt: now, updatedAt: now },
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
