import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import './helpers/register-typescript.mjs'

const KEY = 'timetable_courses'
let storage, writes, modals, sheets, navigations, backCount, failNextWrite
const pages = []
globalThis.Page = definition => pages.push(definition)
globalThis.wx = {
  getStorageSync(key) { return storage?.has(key) ? structuredClone(storage.get(key)) : '' },
  setStorageSync(key, value) {
    writes.push(key)
    if (key === KEY && failNextWrite) { failNextWrite = false; throw Error('模拟写入失败') }
    storage.set(key, structuredClone(value))
  },
  showShareMenu() {}, setNavigationBarTitle() {}, showToast() {},
  showModal(options) { modals.push(options) },
  showActionSheet(options) { sheets.push(options) },
  navigateTo(options) { navigations.push(options) },
  navigateBack() { backCount++ },
}
const { DEFAULT_PERIOD_SETTINGS } = await import('../miniprogram/constants/timetable.ts')
const { removeCourseOccurrence, getStorageSnapshot } = await import('../miniprogram/services/course-storage.ts')
await import('../miniprogram/pages/timetable/index.ts')
await import('../miniprogram/pages/course-edit/index.ts')
const [timetable, editor] = pages

function instance(definition) {
  return { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch) } }
}
function course(id, groupId, day) {
  return { id, groupId, name: groupId === 'math' ? '高等数学' : '英语', day, startPeriod: 1, endPeriod: 2,
    color: '#0ea5a4', weekMode: 'all', weeks: [1, 2, 3, 4, 5, 6], createdAt: 1, updatedAt: 1 }
}
beforeEach(() => {
  storage = new Map([[KEY, { schemaVersion: 5, term: { startDate: '2026-09-07', totalWeeks: 6 },
    periodSettings: structuredClone(DEFAULT_PERIOD_SETTINGS),
    courses: [course('math-mon', 'math', 1), course('math-wed', 'math', 3), course('math-fri', 'math', 5), course('english', 'english', 2)],
  }]])
  writes = []; modals = []; sheets = []; navigations = []; backCount = 0; failNextWrite = false
})
function openFromTimetable(tapIndex) {
  const home = instance(timetable)
  home.data.currentWeek = 3
  home.onCourseTap({ detail: { id: 'math-wed' } })
  sheets.shift().success({ tapIndex })
  const options = Object.fromEntries(new URLSearchParams(navigations[0].url.split('?')[1]))
  const page = instance(editor)
  page.onLoad(options)
  return page
}

test('仅编辑本时段入口只删除当前周这一次课，其他周、同组时段和其他课程保留', () => {
  const before = structuredClone(storage.get(KEY))
  const page = openFromTimetable(0)
  page.onDelete()
  assert.equal(sheets.length, 0, '不能重新提供扩大到整门课程的删除范围')
  assert.equal(modals[0]?.title, '删除第3周本次课')
  modals[0].success({ confirm: true })
  const after = storage.get(KEY)
  const changed = after.courses.find(item => item.id === 'math-wed')
  const original = before.courses.find(item => item.id === 'math-wed')
  assert.deepEqual(changed.weeks, [1, 2, 4, 5, 6])
  assert.equal(changed.weekMode, 'custom')
  assert.notEqual(changed.groupId, original.groupId, '不同周次的时段必须拆分，以保持 V5 组内共同字段一致')
  assert.deepEqual(changed, { ...original, weeks: [1, 2, 4, 5, 6], weekMode: 'custom', groupId: changed.groupId, updatedAt: changed.updatedAt })
  assert.deepEqual(after, { ...before, courses: before.courses.map(item => item.id === changed.id ? changed : item) })
  assert.equal(getStorageSnapshot().kind, 'current')
  assert.equal(backCount, 1)
})

test('编辑整门课程入口明确确认后删除整组，保留其他课程', () => {
  const before = structuredClone(storage.get(KEY))
  const page = openFromTimetable(1)
  page.onDelete()
  assert.equal(sheets.length, 0)
  assert.equal(modals[0]?.title, '删除整门课程')
  assert.match(modals[0].content, /3 个时段/)
  modals[0].success({ confirm: true })
  assert.deepEqual(storage.get(KEY), { ...before, courses: before.courses.filter(item => item.groupId !== 'math') })
})

test('未带 mode 的编辑链接仍按传入教学周只删除本次课', () => {
  const page = instance(editor)
  page.onLoad({ id: 'math-wed', sourceWeek: '4' })
  page.onDelete()
  assert.equal(modals[0]?.title, '删除第4周本次课')
  modals[0].success({ confirm: true })
  assert.deepEqual(storage.get(KEY).courses.find(item => item.id === 'math-wed').weeks, [1, 2, 3, 5, 6])
})

test('取消删除不写入、不返回，单时段课程也只减少一次课', () => {
  const page = instance(editor)
  page.onLoad({ id: 'english', mode: 'segment-edit' })
  const before = structuredClone(storage.get(KEY))
  page.onDelete()
  modals[0].success({ confirm: false })
  assert.deepEqual(storage.get(KEY), before)
  assert.deepEqual(writes, [])
  assert.equal(backCount, 0)
  page.onDelete()
  modals[1].success({ confirm: true })
  assert.equal(storage.get(KEY).courses.length, 4)
  assert.deepEqual(storage.get(KEY).courses.find(item => item.id === 'english').weeks, [2, 3, 4, 5, 6])
})

test('删除时仍使用打开的时段 ID，未保存的星期和节次修改不改变删除对象', () => {
  const page = openFromTimetable(0)
  Object.assign(page.data, { dayIndex: 0, startIndex: 4, endIndex: 5 })
  page.onDelete()
  assert.equal(modals[0]?.title, '删除第3周本次课')
  modals[0].success({ confirm: true })
  assert.deepEqual(storage.get(KEY).courses.find(item => item.id === 'math-wed').weeks, [1, 2, 4, 5, 6])
  assert.deepEqual(storage.get(KEY).courses.find(item => item.id === 'math-mon').weeks, [1, 2, 3, 4, 5, 6])
})

test('删除写入失败保留整份课表并留在编辑页', () => {
  const before = structuredClone(storage.get(KEY))
  const page = openFromTimetable(0)
  page.onDelete()
  assert.equal(modals[0]?.title, '删除第3周本次课')
  failNextWrite = true
  modals[0].success({ confirm: true })
  assert.deepEqual(storage.get(KEY), before)
  assert.equal(backCount, 0)
  assert.equal(modals[1].title, '无法删除')
})

for (const [weekMode, weeks, week, expected] of [
  ['all', [1, 2, 3, 4, 5, 6], 3, [1, 2, 4, 5, 6]],
  ['odd', [1, 3, 5], 3, [1, 5]],
  ['even', [2, 4, 6], 4, [2, 6]],
  ['custom', [2, 3, 6], 3, [2, 6]],
]) {
  test(`${weekMode} 模式删除一次课后以指定周次保存，重新读取不会补回被删除的周`, () => {
    const target = storage.get(KEY).courses.find(item => item.id === 'english')
    Object.assign(target, { weekMode, weeks })
    removeCourseOccurrence(target.id, week)
    const snapshot = getStorageSnapshot()
    assert.equal(snapshot.kind, 'current')
    const saved = snapshot.data.courses.find(item => item.id === target.id)
    assert.deepEqual(saved.weeks, expected)
    assert.equal(saved.weekMode, 'custom')
    assert.equal(saved.groupId, target.groupId)
    assert.equal(saved.createdAt, target.createdAt)
  })
}

test('最后一次课删除后移除空记录，仍保留同组其他时段', () => {
  const fixture = storage.get(KEY)
  for (const course of fixture.courses.filter(item => item.groupId === 'math')) {
    Object.assign(course, { weekMode: 'custom', weeks: [3] })
  }
  const before = structuredClone(fixture)
  const page = openFromTimetable(0)
  page.onDelete()
  modals[0].success({ confirm: true })
  assert.deepEqual(storage.get(KEY), { ...before, courses: before.courses.filter(item => item.id !== 'math-wed') })
  assert.equal(getStorageSnapshot().kind, 'current')
})

test('拒绝不存在、不上课或非法教学周的删除且不写入', () => {
  const target = storage.get(KEY).courses.find(item => item.id === 'english')
  Object.assign(target, { weekMode: 'custom', weeks: [2, 4] })
  const before = structuredClone(storage.get(KEY))
  for (const week of [0, -1, 7, 2.5, NaN, 3]) {
    assert.throws(() => removeCourseOccurrence('english', week), /所选教学周没有课程/)
  }
  assert.throws(() => removeCourseOccurrence('missing', 2), /没有找到/)
  assert.deepEqual(writes, [])
  assert.deepEqual(storage.get(KEY), before)
})
