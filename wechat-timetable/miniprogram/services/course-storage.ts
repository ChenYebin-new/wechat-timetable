// services/course-storage.ts
// 统一管理本地 Storage 里的课程：读取、查询、新增、更新、删除。
// 页面不要直接调用 wx.getStorageSync / setStorageSync 操作课程。

import { Course, TimetableStorage } from '../models/course'
import { SCHEMA_VERSION, STORAGE_KEY } from '../constants/timetable'

function defaultStorage(): TimetableStorage {
  return { schemaVersion: SCHEMA_VERSION, courses: [] }
}

function load(): TimetableStorage {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return defaultStorage()
    const data = raw as TimetableStorage
    if (!Array.isArray(data.courses)) return defaultStorage()
    if (typeof data.schemaVersion !== 'number') {
      data.schemaVersion = SCHEMA_VERSION
    }
    return data
  } catch {
    return defaultStorage()
  }
}

function persist(data: TimetableStorage): void {
  wx.setStorageSync(STORAGE_KEY, data)
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 读取全部课程。首次启动、无数据或数据异常时返回空数组。 */
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
  data.courses = data.courses.filter((c) => c.id !== id)
  persist(data)
}
