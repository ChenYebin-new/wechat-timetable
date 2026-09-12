// services/course-storage.ts
// 统一管理本地 Storage 里的课表数据：V5 读写、旧数据迁移、学期与课程作息读写。
// 页面不要直接调用 wx.getStorageSync / setStorageSync 操作课表。

import type { Course, CourseDraft, CourseRange, PeriodSettings, TermSettings, TimetableStorage, WeekMode } from '../models/course'
import { DEFAULT_PERIOD_SETTINGS, DAYS, MAX_PERIODS, SCHEMA_VERSION } from '../constants/timetable'
import { expandWeeks, normalizeWeeks, validateTerm } from '../utils/term'
import { isOverlapping, validate } from '../utils/course-validator'
import { APP_ID, BACKUP_VERSION, RECENT_BACKUP_KEY } from '../models/backup'
import { cellsToRanges, rangesToCells } from '../utils/grid-selection'
import { clonePeriodSettings, migrateV4PeriodSettings, validatePeriodSettings } from '../utils/period-settings'
import {
  type StorageReadKind,
  type StorageReadResult,
  type TimetableStorageView,
  classifyStorageValue,
  isLegacySchemaVersion,
  isSupportedSchemaVersion,
  isValidCourseColor,
  validateCurrentStorage,
} from './storage-codec'
import { clearTimetableRaw, readTimetableRaw, writeTimetableRaw } from './storage-repository'

interface LoadedStorage extends TimetableStorageView {
  /** 仅存在于内存中，不会写入 Storage。 */
  storageProblem?: string
  readKind?: Exclude<StorageReadKind, 'io-error'>
}

function defaultStorage(): TimetableStorage {
  return {
    schemaVersion: SCHEMA_VERSION,
    term: null,
    courses: [],
    periodSettings: clonePeriodSettings(DEFAULT_PERIOD_SETTINGS),
  }
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

function sanitizeCourse(raw: unknown, totalWeeks: number, schemaVersion: number, maxPeriod: number): Course | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || !c.id) return null
  if (typeof c.name !== 'string' || !c.name.trim()) return null
  if (typeof c.day !== 'number' || !Number.isInteger(c.day) || c.day < 1 || c.day > DAYS.length) return null
  if (typeof c.startPeriod !== 'number' || !Number.isInteger(c.startPeriod) || c.startPeriod < 1 || c.startPeriod > maxPeriod) return null
  if (typeof c.endPeriod !== 'number' || !Number.isInteger(c.endPeriod) || c.endPeriod < 1 || c.endPeriod > maxPeriod) return null
  if (c.startPeriod > c.endPeriod) return null
  if (!isValidCourseColor(c.color)) return null
  const weekMode = toWeekMode(c.weekMode)
  const groupId =
    schemaVersion >= 3
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
  writeTimetableRaw(data)
}

function cloneStorage(data: TimetableStorage): TimetableStorage {
  return {
    schemaVersion: SCHEMA_VERSION,
    term: data.term ? { ...data.term } : null,
    courses: data.courses.map((course) => ({ ...course, weeks: [...course.weeks] })),
    periodSettings: clonePeriodSettings(data.periodSettings),
  }
}

function commitMutation(previous: TimetableStorage, next: TimetableStorage): void {
  try {
    writeStorage(next)
  } catch (error) {
    try {
      persist(previous)
    } catch {
      throw new Error('课表写入失败且无法确认原数据状态，请暂时不要继续操作')
    }
    throw error
  }
}

function markLoaded(storage: LoadedStorage, kind: Exclude<StorageReadKind, 'io-error'>, problem?: string): LoadedStorage {
  Object.defineProperty(storage, 'readKind', { value: kind, enumerable: false })
  if (problem) Object.defineProperty(storage, 'storageProblem', { value: problem, enumerable: false })
  return storage
}

function load(): TimetableStorageView {
    const readResult = readTimetableRaw()
    if (!readResult.ok) throw new Error(readResult.reason)
    const raw = readResult.value
    const classification = classifyStorageValue(raw)
    if (classification.kind === 'missing') {
      return markLoaded(defaultStorage(), 'missing')
    }
    if (classification.kind === 'current') return markLoaded(classification.data, 'current')
    if (classification.kind === 'corrupt' && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
      return markLoaded(defaultStorage(), 'corrupt', `${classification.reason}，为保护原数据已停止写入`)
    }
    const data = raw as Record<string, unknown>
    const schemaVersion =
      typeof data.schemaVersion === 'number' ? data.schemaVersion : SCHEMA_VERSION
    const term = sanitizeTerm(data.term)
    const totalWeeks = term ? term.totalWeeks : 0
    const rawCourses = Array.isArray(data.courses) ? (data.courses as unknown[]) : []
    const periodCheck = validatePeriodSettings(data.periodSettings)
    const migratedV4Settings = schemaVersion === 4 ? migrateV4PeriodSettings(data.periodSettings) : null
    const periodSettings = schemaVersion === SCHEMA_VERSION && periodCheck.ok
      ? clonePeriodSettings(data.periodSettings as PeriodSettings)
      : migratedV4Settings || clonePeriodSettings(DEFAULT_PERIOD_SETTINGS)
    const periodSettingsInvalid =
      (schemaVersion === SCHEMA_VERSION && !periodCheck.ok) || (schemaVersion === 4 && !migratedV4Settings)
    const maxPeriod = periodSettingsInvalid ? MAX_PERIODS : periodSettings.periods.length
    const courses: Course[] = []
    for (const r of rawCourses) {
      const course = sanitizeCourse(r, totalWeeks, schemaVersion, maxPeriod)
      if (course) courses.push(course)
    }
    const storage: LoadedStorage = { schemaVersion, term, courses, periodSettings }

    if (schemaVersion === SCHEMA_VERSION) {
      const reason = classification.kind === 'corrupt' ? classification.reason : '字段无效'
      return markLoaded(storage, 'corrupt', `当前 V5 课表数据缺失或损坏：${reason}，为保护原数据已停止写入`)
    }

    if (
      (schemaVersion === 2 || schemaVersion === 3 || schemaVersion === 4) &&
      term &&
      rawCourses.length === courses.length &&
      !periodSettingsInvalid
    ) {
      if (!snapshotCurrentRaw()) return storage
      const migrated: TimetableStorage = {
        schemaVersion: SCHEMA_VERSION,
        term,
        courses: courses.map((course) => ({ ...course, groupId: schemaVersion === 2 ? course.id : course.groupId })),
        periodSettings: clonePeriodSettings(periodSettings),
      }
      try {
        persist(migrated)
        const writtenResult = readTimetableRaw()
        if (!writtenResult.ok) throw new Error(writtenResult.reason)
        const written = writtenResult.value
        const checked = validateCurrentStorage(written)
        if (checked.ok && checked.data && JSON.stringify(checked.data) === JSON.stringify(migrated)) {
          return markLoaded(migrated, 'current')
        }
      } catch {
        // 下方统一恢复旧版原数据。
      }
      try {
        writeTimetableRaw(raw)
      } catch {
        // 保持只读返回，让后续写操作因版本不匹配而停止。
      }
      return markLoaded(storage, 'legacy', '旧版课表自动升级未完成，为保护原数据已停止写入')
    }

    // V1（待设置学期）、无法迁移的旧版或未知更高版本：不降级写回。
    if (isLegacySchemaVersion(schemaVersion)) return markLoaded(storage, 'legacy')
    return markLoaded(storage, 'unsupported', `当前课表数据版本为 V${schemaVersion}，此版本小程序无法安全修改`)
}

function assertWritableStorage(data: TimetableStorageView): asserts data is TimetableStorage {
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `当前课表数据版本为 V${data.schemaVersion}，此版本小程序仅支持修改 V${SCHEMA_VERSION}。请先完成数据升级或使用更新版本。`,
    )
  }
  if ((data as LoadedStorage).storageProblem) throw new Error((data as LoadedStorage).storageProblem)
}

function assertTermReady(data: TimetableStorage): asserts data is TimetableStorage & { term: TermSettings } {
  const termCheck = validateTerm(data.term)
  if (!termCheck.ok) {
    throw new Error(termCheck.reason || '请先设置有效学期')
  }
}

function snapshotCurrentRaw(): boolean {
  try {
    const readResult = readTimetableRaw()
    if (!readResult.ok) return false
    const raw = readResult.value
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
        writeTimetableRaw(rb.export.data)
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
export function getStorage(): TimetableStorageView {
  return load()
}

function prepareRecoveryPoint(data: TimetableStorageView): boolean {
  return (data as LoadedStorage).readKind === 'missing' || snapshotCurrentRaw()
}

function restoreOriginal(data: TimetableStorageView): boolean {
  if ((data as LoadedStorage).readKind !== 'missing') return restoreFromRecentRaw()
  try {
    clearTimetableRaw()
    const reread = readTimetableRaw()
    return reread.ok && classifyStorageValue(reread.value).kind === 'missing'
  } catch {
    return false
  }
}

/** 返回显式读取状态，供页面在一次刷新中使用同一个快照。 */
export function getStorageSnapshot(): StorageReadResult<TimetableStorageView> {
  try {
    const data = load()
    const loaded = data as LoadedStorage
    const kind: Exclude<StorageReadKind, 'io-error'> = loaded.readKind || (data.schemaVersion === SCHEMA_VERSION ? 'current' : 'legacy')
    if (kind === 'unsupported') {
      return { kind, data, raw: data, reason: loaded.storageProblem || '当前数据版本不受支持' }
    }
    if (kind === 'corrupt') {
      return { kind, data, raw: data, reason: loaded.storageProblem || '当前课表数据损坏' }
    }
    if (kind === 'missing') return { kind, data, raw: null }
    if (kind === 'current') return { kind, data, raw: data }
    return { kind: 'legacy', data, raw: data }
  } catch (error) {
    return {
      kind: 'io-error',
      reason: error instanceof Error && error.message ? error.message : '读取本地课表失败',
    }
  }
}

/** 当前根数据无法安全修改或导出时返回原因。 */
export function getStorageProblem(data: TimetableStorageView = load()): string | null {
  try {
    assertWritableStorage(data)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : '当前课表数据不可安全写入'
  }
}

/** 一次性写入课表根数据。调用方须自行完成校验；仅支持写 V5。 */
export function writeStorage(data: TimetableStorage): void {
  assertWritableStorage(data)
  const checked = validateCurrentStorage(data)
  if (!checked.ok || !checked.data) throw new Error(checked.reason || '当前课表数据无效')
  persist(checked.data)
  let written: unknown
  try {
    const readResult = readTimetableRaw()
    if (!readResult.ok) throw new Error(readResult.reason)
    written = readResult.value
  } catch {
    throw new Error('写入后无法重新读取课表进行校验')
  }
  const verified = validateCurrentStorage(written)
  if (!verified.ok || !verified.data || JSON.stringify(verified.data) !== JSON.stringify(checked.data)) {
    throw new Error('写入后校验失败')
  }
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

/** 读取全局课程作息草稿副本。 */
export function getPeriodSettings(): PeriodSettings {
  return clonePeriodSettings(load().periodSettings)
}

/** 当前课程实际占用的最高节次；没有课程时为 0。 */
export function getMaxUsedPeriod(): number {
  return load().courses.reduce((highest, course) => Math.max(highest, course.endPeriod), 0)
}

/**
 * 保存全局课程作息。写入前创建最近自动备份，写入后重读校验；失败则恢复原数据。
 */
export function savePeriodSettings(settings: PeriodSettings): { ok: boolean; reason?: string } {
  const check = validatePeriodSettings(settings)
  if (!check.ok) return { ok: false, reason: check.reason }
  const current = load()
  try {
    assertWritableStorage(current)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '当前数据不可写入' }
  }
  const maxUsed = current.courses.reduce((highest, course) => Math.max(highest, course.endPeriod), 0)
  if (settings.periods.length < maxUsed) {
    return { ok: false, reason: `已有课程使用到第 ${maxUsed} 节，不能减少到 ${settings.periods.length} 节` }
  }
  if (!prepareRecoveryPoint(current)) return { ok: false, reason: '无法创建操作前自动备份，已停止保存' }
  const next: TimetableStorage = {
    ...current,
    periodSettings: clonePeriodSettings(settings),
  }
  try {
    writeStorage(next)
    const reread = load()
    const rereadCheck = validatePeriodSettings(reread.periodSettings)
    const expected = JSON.stringify(next.periodSettings)
    if (!rereadCheck.ok || JSON.stringify(reread.periodSettings) !== expected) {
      const restored = restoreOriginal(current)
      return { ok: false, reason: restored ? '写入后校验失败，原数据已恢复' : '写入后校验失败，无法确认原数据状态' }
    }
    return { ok: true }
  } catch {
    const restored = restoreOriginal(current)
    return { ok: false, reason: restored ? '写入失败，原数据已恢复' : '写入失败，无法确认原数据状态' }
  }
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

function normalizeForWrite(course: CourseDraft, totalWeeks: number): CourseDraft {
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
  maxPeriod: number,
): void {
  const excluded = new Set(excludedIds)
  const comparison = all.filter((course) => !excluded.has(course.id))
  for (const candidate of candidates) {
    const result = validate(candidate, comparison, undefined, totalWeeks, maxPeriod)
    if (!result.ok) throw new Error(result.errors[0])
    comparison.push(candidate)
  }
}

function canonicalRanges(ranges: CourseRange[], maxPeriod: number): CourseRange[] {
  for (const range of ranges) {
    if (
      !Number.isInteger(range.day) ||
      range.day < 1 ||
      range.day > DAYS.length ||
      !Number.isInteger(range.startPeriod) ||
      !Number.isInteger(range.endPeriod) ||
      range.startPeriod < 1 ||
      range.endPeriod > maxPeriod ||
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
export function save(course: CourseDraft): void {
  const data = load()
  assertWritableStorage(data)
  assertTermReady(data)
  const previous = cloneStorage(data)
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
    validateCandidates([candidate], data.courses, [existing.id], totalWeeks, data.periodSettings.periods.length)
    data.courses = data.courses.map((item) => (item.id === existing.id ? candidate : item))
  } else {
    const candidate: Course = {
      ...normalized,
      id: generateId(),
      groupId: normalized.groupId || generateId(),
      createdAt: now,
      updatedAt: now,
    }
    validateCandidates([candidate], data.courses, [], totalWeeks, data.periodSettings.periods.length)
    data.courses = [...data.courses, candidate]
  }
  commitMutation(previous, data)
}

/** 一次性创建包含多个连续时段的课程组。 */
export function createCourseGroup(course: CourseDraft, ranges: CourseRange[]): string {
  const data = load()
  assertWritableStorage(data)
  assertTermReady(data)
  const previous = cloneStorage(data)
  const normalized = normalizeForWrite(course, data.term.totalWeeks)
  const groupId = generateId()
  const now = Date.now()
  const candidates = canonicalRanges(ranges, data.periodSettings.periods.length).map((range) => ({
    ...normalized,
    ...range,
    id: generateId(),
    groupId,
    createdAt: now,
    updatedAt: now,
  }))
  validateCandidates(candidates, data.courses, [], data.term.totalWeeks, data.periodSettings.periods.length)
  data.courses = [...data.courses, ...candidates]
  commitMutation(previous, data)
  return groupId
}

/** 整体更新课程组的共同信息和全部时段。 */
export function updateCourseGroup(groupId: string, course: CourseDraft, ranges: CourseRange[]): void {
  const data = load()
  assertWritableStorage(data)
  assertTermReady(data)
  const previous = cloneStorage(data)
  const existing = data.courses.filter((item) => item.groupId === groupId)
  if (!existing.length) throw new Error('没有找到要编辑的课程')
  const existingByRange = new Map(
    existing.map((item) => [`${item.day}-${item.startPeriod}-${item.endPeriod}`, item]),
  )
  const normalized = normalizeForWrite(course, data.term.totalWeeks)
  const now = Date.now()
  const candidates = canonicalRanges(ranges, data.periodSettings.periods.length).map((range) => {
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
  validateCandidates(candidates, data.courses, existing.map((item) => item.id), data.term.totalWeeks, data.periodSettings.periods.length)
  data.courses = [
    ...data.courses.filter((item) => item.groupId !== groupId),
    ...candidates,
  ]
  commitMutation(previous, data)
}

/** 只编辑课程组中的一个时段；多时段课程会自动拆分为独立课程。 */
export function detachCourseSegment(course: CourseDraft): void {
  const data = load()
  assertWritableStorage(data)
  assertTermReady(data)
  const previous = cloneStorage(data)
  if (!course.id) throw new Error('缺少要编辑的课程 ID')
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
  validateCandidates([candidate], data.courses, [existing.id], data.term.totalWeeks, data.periodSettings.periods.length)
  data.courses = data.courses.map((item) => (item.id === existing.id ? candidate : item))
  commitMutation(previous, data)
}

/** 删除课程。 */
export function remove(id: string): void {
  const data = load()
  assertWritableStorage(data)
  const previous = cloneStorage(data)
  data.courses = data.courses.filter((c) => c.id !== id)
  commitMutation(previous, data)
}

/** 删除同一 groupId 下的整门课程。 */
export function removeCourseGroup(groupId: string): void {
  const data = load()
  assertWritableStorage(data)
  const previous = cloneStorage(data)
  data.courses = data.courses.filter((course) => course.groupId !== groupId)
  commitMutation(previous, data)
}

/**
 * 设置/修改学期。
 * - V1 数据：补齐周次、groupId 与默认作息后直接迁移为 V5。
 * - V2/V3/V4/V5 数据：重新计算全部课程周次，旧版同时补齐或迁移作息。
 * 操作前先生成最近自动备份；任一校验失败或写入失败时不修改原数据。
 */
export function applyTerm(term: TermSettings): { ok: boolean; reason?: string; migrated?: boolean } {
  const vt = validateTerm(term)
  if (!vt.ok) return { ok: false, reason: vt.reason }

  const current = load()
  const currentProblem = current.schemaVersion === SCHEMA_VERSION ? getStorageProblem(current) : null
  if (currentProblem) return { ok: false, reason: currentProblem }
  if (current.schemaVersion === 4) {
    return { ok: false, reason: '当前 V4 课程时间设置无法安全迁移，请从有效备份恢复后再修改学期' }
  }
  if (!isSupportedSchemaVersion(current.schemaVersion)) {
    return {
      ok: false,
      reason: `当前课表数据版本为 V${current.schemaVersion}，不能按 V1–V5 猜测迁移。请使用更新版本处理课表。`,
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
    periodSettings: current.schemaVersion === SCHEMA_VERSION
      ? clonePeriodSettings(current.periodSettings)
      : current.schemaVersion === 4
        ? migrateV4PeriodSettings(current.periodSettings) || clonePeriodSettings(DEFAULT_PERIOD_SETTINGS)
        : clonePeriodSettings(DEFAULT_PERIOD_SETTINGS),
  }

  if (!prepareRecoveryPoint(current)) return { ok: false, reason: '无法创建操作前自动备份' }

  try {
    writeStorage(storage)
    return { ok: true, migrated }
  } catch {
    const restored = restoreOriginal(current)
    return {
      ok: false,
      reason: restored
        ? '写入失败，原数据已恢复'
        : '写入失败，无法确认原数据状态；请使用最近自动备份恢复',
    }
  }
}
