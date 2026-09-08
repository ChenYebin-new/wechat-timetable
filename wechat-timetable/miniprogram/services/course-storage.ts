// services/course-storage.ts
// 统一管理本地 Storage 里的课表数据：V3 读写、旧数据迁移、学期读写与版本识别。
// 页面不要直接调用 wx.getStorageSync / setStorageSync 操作课表。

import type { Course, CourseRange, TermSettings, TimetableStorage, WeekMode } from '../models/course'
import { DAYS, MAX_PERIOD, SCHEMA_VERSION, STORAGE_KEY } from '../constants/timetable'
import { expandWeeks, normalizeWeeks, validateTerm } from '../utils/term'
import { isOverlapping, validate } from '../utils/course-validator'
import { APP_ID, BACKUP_VERSION, RECENT_BACKUP_KEY } from '../models/backup'
import { cellsToRanges, rangesToCells } from '../utils/grid-selection'

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

function sanitizeCourse(raw: unknown, totalWeeks: number, schemaVersion: number): Course | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || !c.id) return null
  if (typeof c.name !== 'string' || !c.name.trim()) return null
  if (typeof c.day !== 'number' || !Number.isInteger(c.day) || c.day < 1 || c.day > DAYS.length) return null
  if (typeof c.startPeriod !== 'number' || !Number.isInteger(c.startPeriod) || c.startPeriod < 1 || c.startPeriod > MAX_PERIOD) return null
  if (typeof c.endPeriod !== 'number' || !Number.isInteger(c.endPeriod) || c.endPeriod < 1 || c.endPeriod > MAX_PERIOD) return null
  if (c.startPeriod > c.endPeriod) return null
  if (typeof c.color !== 'string' || !c.color) return null
  const weekMode = toWeekMode(c.weekMode)
  const groupId =
    schemaVersion >= SCHEMA_VERSION
      ? typeof c.groupId === 'string' && c.groupId.trim()
        ? c.groupId.trim()
        : ''
      : c.id
  if (!groupId) return null
  const weeks =
    totalWeeks > 0
      ? weekMode === 'custom'
        ? normalizeWeeks(c.weeks as number[], totalWeeks)
        : expandWeeks(weekMode, totalWeeks)
      : []
  return {
    id: c.id,
    groupId,
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
      const course = sanitizeCourse(r, totalWeeks, schemaVersion)
      if (course) courses.push(course)
    }
    const storage: TimetableStorage = { schemaVersion, term, courses }

    if (schemaVersion === SCHEMA_VERSION) {
      // V3：仅当过滤掉无效数据时回写清理结果。
      if (rawCourses.length !== courses.length) {
        persist(storage)
      }
      return storage
    }

    if (schemaVersion === 2 && term && rawCourses.length === courses.length) {
      if (!snapshotCurrentRaw()) return storage
      const migrated: TimetableStorage = {
        schemaVersion: SCHEMA_VERSION,
        term,
        courses: courses.map((course) => ({ ...course, groupId: course.id })),
      }
      try {
        persist(migrated)
        const written = wx.getStorageSync(STORAGE_KEY) as Record<string, unknown>
        const writtenCourses = written && Array.isArray(written.courses) ? written.courses : []
        if (
          written &&
          written.schemaVersion === SCHEMA_VERSION &&
          writtenCourses.length === migrated.courses.length &&
          writtenCourses.every(
            (course) =>
              !!course &&
              typeof course === 'object' &&
              typeof (course as Record<string, unknown>).groupId === 'string',
          )
        ) {
          return migrated
        }
      } catch {
        // 下方统一恢复 V2 原数据。
      }
      try {
        wx.setStorageSync(STORAGE_KEY, raw)
      } catch {
        // 保持只读返回，让后续写操作因版本不匹配而停止。
      }
      return storage
    }

    // V1（待设置学期）、无法迁移的 V2 或未知更高版本：不降级写回。
    return storage
  } catch {
    return defaultStorage()
  }
}

function assertWritableStorage(data: TimetableStorage): void {
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `当前课表数据版本为 V${data.schemaVersion}，此版本小程序仅支持修改 V${SCHEMA_VERSION}。请先完成数据升级或使用更新版本。`,
    )
  }
}

function assertTermReady(data: TimetableStorage): asserts data is TimetableStorage & { term: TermSettings } {
  const termCheck = validateTerm(data.term)
  if (!termCheck.ok) {
    throw new Error(termCheck.reason || '请先设置有效学期')
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

function restoreFromRecentRaw(): boolean {
  try {
    const raw = wx.getStorageSync(RECENT_BACKUP_KEY)
    if (raw && typeof raw === 'object') {
      const rb = raw as { export?: { data?: unknown } }
      if (rb.export && rb.export.data) {
        wx.setStorageSync(STORAGE_KEY, rb.export.data)
        return true
      }
    }
  } catch {
    return false
  }
  return false
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 读取当前课表根数据（已做版本识别、周次展开与基础容错）。 */
export function getStorage(): TimetableStorage {
  return load()
}

/** 一次性写入课表根数据。调用方须自行完成校验；仅支持写 V3。 */
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

/** 是否仍为旧数据、需要迁移。 */
export function needsMigration(): boolean {
  return load().schemaVersion !== SCHEMA_VERSION
}

/** 读取全部课程（周次已展开）。 */
export function getCourses(): Course[] {
  return load().courses
}

/** 按 id 查询课程。 */
export function getCourseById(id: string): Course | undefined {
  return load().courses.find((c) => c.id === id)
}

/** 读取指定课程所在的完整课程组。 */
export function getCourseGroupByCourseId(id: string): Course[] {
  const courses = load().courses
  const selected = courses.find((course) => course.id === id)
  return selected ? courses.filter((course) => course.groupId === selected.groupId) : []
}

function normalizeForWrite(course: Course, totalWeeks: number): Course {
  const weekMode = toWeekMode(course.weekMode)
  const weeks =
    weekMode === 'custom'
      ? normalizeWeeks(course.weeks || [], totalWeeks)
      : expandWeeks(weekMode, totalWeeks)
  return { ...course, weekMode, weeks }
}

function validateCandidates(
  candidates: Course[],
  all: Course[],
  excludedIds: string[],
  totalWeeks: number,
): void {
  const excluded = new Set(excludedIds)
  const comparison = all.filter((course) => !excluded.has(course.id))
  for (const candidate of candidates) {
    const result = validate(candidate, comparison, undefined, totalWeeks)
    if (!result.ok) throw new Error(result.errors[0])
    comparison.push(candidate)
  }
}

function canonicalRanges(ranges: CourseRange[]): CourseRange[] {
  for (const range of ranges) {
    if (
      !Number.isInteger(range.day) ||
      range.day < 1 ||
      range.day > DAYS.length ||
      !Number.isInteger(range.startPeriod) ||
      !Number.isInteger(range.endPeriod) ||
      range.startPeriod < 1 ||
      range.endPeriod > MAX_PERIOD ||
      range.startPeriod > range.endPeriod
    ) {
      throw new Error('上课时段超出课表范围')
    }
  }
  const normalized = cellsToRanges(rangesToCells(ranges))
  if (!normalized.length) throw new Error('请至少选择一个上课时段')
  return normalized
}

/** 新增或更新课程。无 id 视为新增；有 id 视为更新。 */
export function save(course: Course): void {
  const data = load()
  assertWritableStorage(data)
  assertTermReady(data)
  const totalWeeks = data.term.totalWeeks
  const normalized = normalizeForWrite(course, totalWeeks)
  const now = Date.now()
  if (course.id) {
    const existing = data.courses.find((item) => item.id === course.id)
    if (!existing) throw new Error('没有找到要编辑的课程')
    if (data.courses.filter((item) => item.groupId === existing.groupId).length > 1) {
      throw new Error('这门课程包含多个时段，请选择编辑本时段或整门课程')
    }
    const candidate: Course = {
      ...existing,
      ...normalized,
      id: existing.id,
      groupId: normalized.groupId || existing.groupId,
      createdAt: existing.createdAt,
      updatedAt: now,
    }
    validateCandidates([candidate], data.courses, [existing.id], totalWeeks)
    data.courses = data.courses.map((item) => (item.id === existing.id ? candidate : item))
  } else {
    const candidate: Course = {
      ...normalized,
      id: generateId(),
      groupId: normalized.groupId || generateId(),
      createdAt: now,
      updatedAt: now,
    }
    validateCandidates([candidate], data.courses, [], totalWeeks)
    data.courses = [...data.courses, candidate]
  }
  persist(data)
}

/** 一次性创建包含多个连续时段的课程组。 */
export function createCourseGroup(course: Course, ranges: CourseRange[]): string {
  const data = load()
  assertWritableStorage(data)
  assertTermReady(data)
  const normalized = normalizeForWrite(course, data.term.totalWeeks)
  const groupId = generateId()
  const now = Date.now()
  const candidates = canonicalRanges(ranges).map((range) => ({
    ...normalized,
    ...range,
    id: generateId(),
    groupId,
    createdAt: now,
    updatedAt: now,
  }))
  validateCandidates(candidates, data.courses, [], data.term.totalWeeks)
  data.courses = [...data.courses, ...candidates]
  persist(data)
  return groupId
}

/** 整体更新课程组的共同信息和全部时段。 */
export function updateCourseGroup(groupId: string, course: Course, ranges: CourseRange[]): void {
  const data = load()
  assertWritableStorage(data)
  assertTermReady(data)
  const existing = data.courses.filter((item) => item.groupId === groupId)
  if (!existing.length) throw new Error('没有找到要编辑的课程')
  const existingByRange = new Map(
    existing.map((item) => [`${item.day}-${item.startPeriod}-${item.endPeriod}`, item]),
  )
  const normalized = normalizeForWrite(course, data.term.totalWeeks)
  const now = Date.now()
  const candidates = canonicalRanges(ranges).map((range) => {
    const previous = existingByRange.get(`${range.day}-${range.startPeriod}-${range.endPeriod}`)
    return {
      ...normalized,
      ...range,
      id: previous ? previous.id : generateId(),
      groupId,
      createdAt: previous ? previous.createdAt : now,
      updatedAt: now,
    }
  })
  validateCandidates(candidates, data.courses, existing.map((item) => item.id), data.term.totalWeeks)
  data.courses = [
    ...data.courses.filter((item) => item.groupId !== groupId),
    ...candidates,
  ]
  persist(data)
}

/** 只编辑课程组中的一个时段；多时段课程会自动拆分为独立课程。 */
export function detachCourseSegment(course: Course): void {
  const data = load()
  assertWritableStorage(data)
  assertTermReady(data)
  const existing = data.courses.find((item) => item.id === course.id)
  if (!existing) throw new Error('没有找到要编辑的课程')
  const groupSize = data.courses.filter((item) => item.groupId === existing.groupId).length
  const normalized = normalizeForWrite(course, data.term.totalWeeks)
  const candidate: Course = {
    ...existing,
    ...normalized,
    id: existing.id,
    groupId: groupSize > 1 ? generateId() : existing.groupId,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  }
  validateCandidates([candidate], data.courses, [existing.id], data.term.totalWeeks)
  data.courses = data.courses.map((item) => (item.id === existing.id ? candidate : item))
  persist(data)
}

/** 删除课程。 */
export function remove(id: string): void {
  const data = load()
  assertWritableStorage(data)
  data.courses = data.courses.filter((c) => c.id !== id)
  persist(data)
}

/** 删除同一 groupId 下的整门课程。 */
export function removeCourseGroup(groupId: string): void {
  const data = load()
  assertWritableStorage(data)
  data.courses = data.courses.filter((course) => course.groupId !== groupId)
  persist(data)
}

/**
 * 设置/修改学期。
 * - V1 数据：补齐周次与 groupId 后直接迁移为 V3。
 * - V2/V3 数据：重新计算全部课程周次，V2 同时补齐 groupId。
 * 操作前先生成最近自动备份；任一校验失败或写入失败时不修改原数据。
 */
export function applyTerm(term: TermSettings): { ok: boolean; reason?: string; migrated?: boolean } {
  const vt = validateTerm(term)
  if (!vt.ok) return { ok: false, reason: vt.reason }

  const current = load()
  if (current.schemaVersion !== 1 && current.schemaVersion !== 2 && current.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `当前课表数据版本为 V${current.schemaVersion}，不能按 V1、V2 或 V3 猜测迁移。请使用更新版本处理课表。`,
    }
  }

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
    newCourses.push({ ...c, groupId: c.groupId || c.id, weekMode, weeks })
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

  if (!snapshotCurrentRaw()) return { ok: false, reason: '无法创建操作前自动备份' }

  try {
    persist(storage)
    const reread = load()
    if (
      reread.schemaVersion !== SCHEMA_VERSION ||
      !reread.term ||
      reread.term.startDate !== storage.term!.startDate ||
      reread.term.totalWeeks !== storage.term!.totalWeeks ||
      reread.courses.length !== storage.courses.length
    ) {
      const restored = restoreFromRecentRaw()
      return {
        ok: false,
        reason: restored
          ? '写入后校验失败，原数据已恢复'
          : '写入后校验失败，无法确认原数据状态；请暂时不要继续操作',
      }
    }
    return { ok: true, migrated }
  } catch {
    const restored = restoreFromRecentRaw()
    return {
      ok: false,
      reason: restored
        ? '写入失败，原数据已恢复'
        : '写入失败，无法确认原数据状态；请使用最近自动备份恢复',
    }
  }
}
