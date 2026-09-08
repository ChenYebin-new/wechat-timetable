import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('.') || specifier.startsWith('/')) && !/[.]\w+$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }),
      }
    }
    return nextLoad(url, context)
  },
})

const TIMETABLE_KEY = 'timetable_courses'
const RECENT_BACKUP_KEY = 'timetable_recent_backup'
const TERM = { startDate: '2026-09-07', totalWeeks: 18 }
const ALL_WEEKS = Array.from({ length: TERM.totalWeeks }, (_, index) => index + 1)
let storage = new Map()
let timetableWrites = 0
let timetableWriteFailures = 0

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

globalThis.wx = {
  getStorageSync(key) {
    return storage.has(key) ? clone(storage.get(key)) : ''
  },
  setStorageSync(key, value) {
    if (key === TIMETABLE_KEY) {
      timetableWrites++
      if (timetableWriteFailures > 0) {
        timetableWriteFailures--
        throw new Error('simulated write failure')
      }
    }
    storage.set(key, clone(value))
  },
}

const selection = await import('../miniprogram/utils/grid-selection.ts')
const courseStorage = await import('../miniprogram/services/course-storage.ts')
const timetableConstants = await import('../miniprogram/constants/timetable.ts')

function draft(overrides = {}) {
  return {
    id: '',
    groupId: '',
    name: '高等数学',
    day: 1,
    startPeriod: 1,
    endPeriod: 1,
    teacher: '刘老师',
    location: 'A101',
    color: '#0ea5a4',
    createdAt: 0,
    updatedAt: 0,
    weekMode: 'all',
    weeks: [],
    ...overrides,
  }
}

function reset(courses = []) {
  storage = new Map([[TIMETABLE_KEY, { schemaVersion: 3, term: clone(TERM), courses: clone(courses) }]])
  timetableWrites = 0
  timetableWriteFailures = 0
}

test('课表空白格长按阈值为 1.2 秒', () => {
  assert.equal(timetableConstants.GRID_HOLD_DURATION_MS, 1200)
})

test('任意格子去重排序并仅合并同一天连续节次', () => {
  const ranges = selection.cellsToRanges([
    { day: 3, period: 4 },
    { day: 1, period: 2 },
    { day: 1, period: 1 },
    { day: 1, period: 4 },
    { day: 1, period: 2 },
    { day: 8, period: 1 },
  ])
  assert.deepEqual(ranges, [
    { day: 1, startPeriod: 1, endPeriod: 2 },
    { day: 1, startPeriod: 4, endPeriod: 4 },
    { day: 3, startPeriod: 4, endPeriod: 4 },
  ])
  assert.deepEqual(selection.keysToRanges(selection.rangesToKeys(ranges)), ranges)
})

test('V2 数据自动升级为 V3，并保留一份升级前备份', () => {
  const legacy = draft({ id: 'legacy-1' })
  delete legacy.groupId
  storage = new Map([[TIMETABLE_KEY, { schemaVersion: 2, term: clone(TERM), courses: [legacy] }]])
  timetableWrites = 0
  timetableWriteFailures = 0

  const migrated = courseStorage.getStorage()
  assert.equal(migrated.schemaVersion, 3)
  assert.equal(migrated.courses[0].groupId, 'legacy-1')
  assert.equal(storage.get(RECENT_BACKUP_KEY).export.data.schemaVersion, 2)
  assert.equal(timetableWrites, 1)
})

test('V2 自动升级写入失败时恢复原数据并保持只读版本', () => {
  const legacy = draft({ id: 'legacy-1' })
  delete legacy.groupId
  const raw = { schemaVersion: 2, term: clone(TERM), courses: [legacy] }
  storage = new Map([[TIMETABLE_KEY, clone(raw)]])
  timetableWrites = 0
  timetableWriteFailures = 1

  const result = courseStorage.getStorage()
  assert.equal(result.schemaVersion, 2)
  assert.deepEqual(storage.get(TIMETABLE_KEY), raw)
  assert.equal(storage.get(RECENT_BACKUP_KEY).export.data.schemaVersion, 2)
})

test('多选课程组一次写入，并为各时段生成独立 ID', () => {
  reset()
  const ranges = [
    { day: 1, startPeriod: 1, endPeriod: 2 },
    { day: 1, startPeriod: 4, endPeriod: 4 },
    { day: 3, startPeriod: 5, endPeriod: 5 },
  ]
  const groupId = courseStorage.createCourseGroup(draft(), ranges)
  const saved = storage.get(TIMETABLE_KEY).courses
  assert.equal(timetableWrites, 1)
  assert.equal(saved.length, 3)
  assert.equal(new Set(saved.map((course) => course.id)).size, 3)
  assert.deepEqual(new Set(saved.map((course) => course.groupId)), new Set([groupId]))
  assert.ok(saved.every((course) => course.weeks.length === ALL_WEEKS.length))
})

test('整组更新会替换时段并保持课程组关联', () => {
  reset()
  const groupId = courseStorage.createCourseGroup(draft(), [
    { day: 1, startPeriod: 1, endPeriod: 2 },
    { day: 3, startPeriod: 5, endPeriod: 5 },
  ])
  timetableWrites = 0
  courseStorage.updateCourseGroup(groupId, draft({ name: '线性代数' }), [
    { day: 2, startPeriod: 2, endPeriod: 3 },
    { day: 5, startPeriod: 6, endPeriod: 6 },
  ])
  const saved = storage.get(TIMETABLE_KEY).courses
  assert.equal(timetableWrites, 1)
  assert.equal(saved.length, 2)
  assert.ok(saved.every((course) => course.groupId === groupId && course.name === '线性代数'))
  assert.deepEqual(saved.map((course) => [course.day, course.startPeriod, course.endPeriod]), [
    [2, 2, 3],
    [5, 6, 6],
  ])
})

test('仅编辑一个时段会从多时段课程组中拆分', () => {
  reset()
  const groupId = courseStorage.createCourseGroup(draft(), [
    { day: 1, startPeriod: 1, endPeriod: 1 },
    { day: 3, startPeriod: 5, endPeriod: 5 },
  ])
  const target = storage.get(TIMETABLE_KEY).courses[0]
  courseStorage.detachCourseSegment({ ...target, name: '高数习题课' })
  const saved = storage.get(TIMETABLE_KEY).courses
  const detached = saved.find((course) => course.id === target.id)
  const remaining = saved.find((course) => course.id !== target.id)
  assert.notEqual(detached.groupId, groupId)
  assert.equal(detached.name, '高数习题课')
  assert.equal(remaining.groupId, groupId)
  assert.equal(remaining.name, '高等数学')
})

test('整组删除只移除目标课程组', () => {
  reset([draft({ id: 'other', groupId: 'other-group', name: '英语', day: 7 })])
  const groupId = courseStorage.createCourseGroup(draft(), [
    { day: 1, startPeriod: 1, endPeriod: 1 },
    { day: 3, startPeriod: 5, endPeriod: 5 },
  ])
  courseStorage.removeCourseGroup(groupId)
  assert.deepEqual(storage.get(TIMETABLE_KEY).courses.map((course) => course.id), ['other'])
})

test('课程组任一候选时段冲突时整体拒绝且不写入', () => {
  reset([draft({ id: 'existing', groupId: 'existing-group', weekMode: 'even', weeks: ALL_WEEKS.filter((w) => w % 2 === 0) })])
  assert.throws(
    () => courseStorage.createCourseGroup(draft(), [
      { day: 2, startPeriod: 2, endPeriod: 2 },
      { day: 1, startPeriod: 1, endPeriod: 1 },
    ]),
    /冲突/,
  )
  assert.equal(storage.get(TIMETABLE_KEY).courses.length, 1)
  assert.equal(timetableWrites, 0)
})
