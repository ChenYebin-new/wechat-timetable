import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import './helpers/register-typescript.mjs'

const TIMETABLE_KEY = 'timetable_courses'
const RECENT_BACKUP_KEY = 'timetable_recent_backup'
const TERM = { startDate: '2026-09-07', totalWeeks: 18 }
const ALL_WEEKS = Array.from({ length: TERM.totalWeeks }, (_, index) => index + 1)
const DEFAULT_PERIOD_SETTINGS = {
  durationMinutes: 50,
  breakMinutes: 10,
  firstStart: '08:00',
  overrides: [{ period: 5, start: '14:00' }],
  periods: ['08:00-08:50', '09:00-09:50', '10:00-10:50', '11:00-11:50', '14:00-14:50', '15:00-15:50', '16:00-16:50', '17:00-17:50', '18:00-18:50']
    .map((value) => { const [start, end] = value.split('-'); return { start, end } }),
}
let storage = new Map()
let timetableWrites = 0
let timetableWriteFailures = 0
let timetablePage

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

globalThis.Page = (definition) => {
  timetablePage = definition
}

const selection = await import('../miniprogram/utils/grid-selection.ts')
const courseStorage = await import('../miniprogram/services/course-storage.ts')
const timetableConstants = await import('../miniprogram/constants/timetable.ts')
const timetableLayout = await import('../miniprogram/utils/timetable-layout.ts')
await import('../miniprogram/pages/timetable/index.ts')
const timetablePageMarkup = readFileSync(
  new URL('../miniprogram/pages/timetable/index.wxml', import.meta.url),
  'utf8',
)

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
    weeks: [...ALL_WEEKS],
    ...overrides,
  }
}

function reset(courses = []) {
  storage = new Map([[TIMETABLE_KEY, { schemaVersion: 5, term: clone(TERM), courses: clone(courses), periodSettings: clone(DEFAULT_PERIOD_SETTINGS) }]])
  timetableWrites = 0
  timetableWriteFailures = 0
}

test('课表空白格长按阈值为 1.2 秒', () => {
  assert.equal(timetableConstants.GRID_HOLD_DURATION_MS, 1200)
})

test('多选模式使用静态课表，避免 swiper 继续响应横向拖动', () => {
  assert.match(timetablePageMarkup, /<swiper\s+wx:if="{{!selectionMode}}"/)
  assert.match(timetablePageMarkup, /<view wx:else class="week-static"/)
  assert.match(timetablePageMarkup, /wx:if="{{item\.week === currentWeek}}"/)
})

test('页面定义直接处理长按进入多选、点击增选和取消选择', () => {
  let vibrated = 0
  globalThis.wx.vibrateShort = () => { vibrated++ }
  const context = {
    data: { termReady: true, selectionMode: false, selectedKeys: [] },
    setData(changes) { Object.assign(this.data, changes) },
    updateSelection(keys) { timetablePage.updateSelection.call(this, keys) },
  }

  timetablePage.onCellHold.call(context, { detail: { key: '1-1' } })
  assert.equal(vibrated, 1)
  assert.equal(context.data.selectionMode, true)
  assert.deepEqual(context.data.selectedKeys, ['1-1'])

  timetablePage.onCellTap.call(context, { detail: { key: '1-2' } })
  assert.deepEqual(context.data.selectedKeys, ['1-1', '1-2'])
  assert.equal(context.data.selectedRangeCount, 1)

  timetablePage.onCancelSelection.call(context)
  assert.equal(context.data.selectionMode, false)
  assert.deepEqual(context.data.selectedKeys, [])
})

test('每次点击课程都重新询问编辑范围，不沿用上一次选择', () => {
  reset()
  courseStorage.createCourseGroup(draft(), [
    { day: 1, startPeriod: 1, endPeriod: 1 },
    { day: 3, startPeriod: 5, endPeriod: 5 },
  ])
  const target = storage.get(TIMETABLE_KEY).courses[0]
  courseStorage.detachCourseSegment({ ...target, name: '高数习题课' })
  const openedUrls = []
  const choices = [0, 1]
  let promptCount = 0
  globalThis.wx.showActionSheet = (options) => {
    options.success({ tapIndex: choices[promptCount++] })
  }
  const page = {
    data: { currentWeek: 2 },
    openCourseEditor(url) {
      openedUrls.push(url)
    },
  }

  timetablePage.onCourseTap.call(page, { detail: { id: target.id } })
  timetablePage.onCourseTap.call(page, { detail: { id: target.id } })

  assert.equal(promptCount, 2)
  assert.deepEqual(openedUrls, [
    `/pages/course-edit/index?id=${target.id}&mode=segment-edit&sourceWeek=2`,
    `/pages/course-edit/index?id=${target.id}&mode=group-edit&sourceWeek=2`,
  ])
})

test('非当前周概览按课程组计数且不误称今天', () => {
  const context = {
    data: {},
    setData(changes) { Object.assign(this.data, changes) },
  }
  const courses = [
    draft({ id: 'math-1', groupId: 'math', day: 1 }),
    draft({ id: 'math-2', groupId: 'math', day: 3 }),
    draft({ id: 'english-1', groupId: 'english', name: '英语', day: 5 }),
  ]
  timetablePage.renderWeek.call(context, 2, TERM, courses)
  assert.match(context.data.overviewText, /本周共 2 门课程、3 个时段/)
  assert.doesNotMatch(context.data.overviewText, /今天/)
})

test('课程卡片按星期分组并复用统一布局信息', () => {
  const courses = [
    draft({ id: 'monday', groupId: 'monday', day: 1, startPeriod: 2, endPeriod: 3 }),
    draft({ id: 'sunday', groupId: 'sunday', day: 7, startPeriod: 9, endPeriod: 9 }),
  ]
  const slots = timetableLayout.buildDaySlots(courses)

  assert.equal(slots.length, 7)
  assert.deepEqual(slots[0].map((item) => item.id), ['monday'])
  assert.deepEqual(slots[6].map((item) => item.id), ['sunday'])
  assert.match(slots[0][0].style, /^top: \d+rpx; height: \d+rpx;$/)
  assert.match(slots[0][0].textColor, /^#[0-9a-f]{6}$/i)
})

test('周面板只为当前周与相邻周构建课表，并按课程周次过滤', () => {
  const courses = [
    draft({ id: 'all', groupId: 'all', day: 1, weekMode: 'all', weeks: [] }),
    draft({ id: 'odd', groupId: 'odd', day: 2, weekMode: 'odd', weeks: [1, 3] }),
    draft({ id: 'even', groupId: 'even', day: 3, weekMode: 'even', weeks: [2, 4] }),
    draft({ id: 'custom', groupId: 'custom', day: 4, weekMode: 'custom', weeks: [2] }),
  ]
  const panels = timetableLayout.buildWeekPanels(courses, 2, 4)
  const idsForWeek = (week) => panels[week - 1].daySlots.flat().map((item) => item.id).sort()

  assert.deepEqual(panels.map((panel) => panel.active), [true, true, true, false])
  assert.deepEqual(idsForWeek(1), ['all', 'odd'])
  assert.deepEqual(idsForWeek(2), ['all', 'custom', 'even'])
  assert.deepEqual(idsForWeek(3), ['all', 'odd'])
  assert.deepEqual(panels[1].disabledKeys.sort(), ['1-1', '3-1', '4-1'])
  assert.deepEqual(panels[3].daySlots, [])
  assert.deepEqual(panels[3].disabledKeys, [])
})

test('周面板在学期边界和未设置学期时不生成越界内容', () => {
  const course = draft({ id: 'week-two', groupId: 'week-two', day: 5, weeks: [2] })
  const oneWeek = timetableLayout.buildWeekPanels([course], 1, 1)
  const twoWeeks = timetableLayout.buildWeekPanels([course], 2, 2)
  const withoutTerm = timetableLayout.buildWeekPanels([course], 1)

  assert.deepEqual(oneWeek.map((panel) => panel.week), [1])
  assert.deepEqual(twoWeeks.map((panel) => panel.week), [1, 2])
  assert.ok(twoWeeks.every((panel) => panel.active))
  assert.equal(twoWeeks[1].daySlots[4][0].id, 'week-two')
  assert.deepEqual(withoutTerm.map((panel) => panel.week), [1])
  assert.equal(withoutTerm[0].daySlots[4][0].id, 'week-two')
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

test('V2 数据自动升级为 V5，并保留一份升级前备份', () => {
  const legacy = draft({ id: 'legacy-1' })
  delete legacy.groupId
  storage = new Map([[TIMETABLE_KEY, { schemaVersion: 2, term: clone(TERM), courses: [legacy] }]])
  timetableWrites = 0
  timetableWriteFailures = 0

  const migrated = courseStorage.getStorage()
  assert.equal(migrated.schemaVersion, 5)
  assert.deepEqual(migrated.periodSettings, DEFAULT_PERIOD_SETTINGS)
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
