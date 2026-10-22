import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import './helpers/register-typescript.mjs'

const definitions = []
globalThis.Page = definition => definitions.push(definition)
globalThis.wx = { getStorageSync() { return '' } }
const { DEFAULT_PERIOD_SETTINGS } = await import('../miniprogram/constants/timetable.ts')
const todoBackup = await import('../miniprogram/services/todo-backup-service.ts')
await import('../miniprogram/pages/term-settings/index.ts')
await import('../miniprogram/pages/course-edit/index.ts')
await import('../miniprogram/pages/todo-backup/index.ts')
const [termPage, coursePage, backupPage] = definitions
const KEY = 'timetable_courses'
const TODO = 'timetable_todos'
const course = { id: 'math', groupId: 'math', name: '数学', day: 1, startPeriod: 1, endPeriod: 2,
  weekMode: 'all', weeks: [1, 2, 3, 4, 5, 6], color: '#123456', createdAt: 1, updatedAt: 1 }
const initial = () => ({ schemaVersion: 5, term: { startDate: '2026-09-07', totalWeeks: 6 },
  courses: [structuredClone(course)], periodSettings: structuredClone(DEFAULT_PERIOD_SETTINGS) })
let storage, dialogs, writes, navigation
function page(definition, options = {}) {
  const value = { ...definition, data: structuredClone(definition.data), setData(changes) { Object.assign(this.data, changes) } }
  value.onLoad(options)
  value.onShow()
  return value
}
beforeEach(() => {
  storage = new Map([[KEY, initial()]])
  dialogs = []; writes = []; navigation = []
  globalThis.wx = {
    getStorageSync(key) { return structuredClone(storage.get(key) ?? '') },
    setStorageSync(key, value) { writes.push(key); storage.set(key, structuredClone(value)) },
    removeStorageSync(key) { writes.push(key); storage.delete(key) },
    showModal(options) { dialogs.push(options) }, showToast() {}, showShareMenu() {},
    navigateBack() { navigation.push('back') }, setNavigationBarTitle() {},
  }
})

for (const lifecycle of ['onHide', 'onUnload']) {
  test(`学期保存确认在 ${lifecycle} 后失效，不写入或跳走其他页面`, () => {
    const p = page(termPage)
    p.setData({ totalWeeks: 4 })
    p.onSave()
    assert.equal(dialogs.length, 1)
    const dialog = dialogs[0]
    p[lifecycle]?.()
    dialog.success({ confirm: true })
    assert.deepEqual(storage.get(KEY), initial())
    assert.deepEqual(writes, [])
    assert.deepEqual(navigation, [])
  })

  test(`课程删除确认在 ${lifecycle} 后失效，不删除记录或跳走其他页面`, () => {
    const p = page(coursePage, { id: course.id, mode: 'segment-edit', sourceWeek: '1' })
    p.onDelete()
    assert.equal(dialogs.length, 1)
    const dialog = dialogs[0]
    p[lifecycle]?.()
    dialog.success({ confirm: true })
    assert.deepEqual(storage.get(KEY), initial())
    assert.deepEqual(writes, [])
    assert.deepEqual(navigation, [])
  })
}

test('待办备份页卸载后，迟到的恢复确认不覆盖待办与随想', () => {
  const text = todoBackup.exportTodoBackup()
  const original = { schemaVersion: 3, items: [], dailyNotes: [{ date: '2026-10-16', content: '当前随想', updatedAt: 1 }] }
  storage.set(TODO, original)
  const p = page(backupPage)
  p.onInput({ detail: { value: text } })
  p.onParse(); p.onRestore()
  assert.equal(dialogs.length, 1)
  p.onUnload?.()
  dialogs[0].success({ confirm: true })
  dialogs[0].complete()
  assert.deepEqual(storage.get(TODO), original)
  assert.deepEqual(writes, [])
})

test('学期确认取消后可重新保存，正常确认仍更新周次并返回', () => {
  const p = page(termPage)
  p.setData({ totalWeeks: 4 })
  p.onSave(); p.onSave()
  assert.equal(dialogs.length, 1)
  dialogs[0].success({ confirm: false })
  dialogs[0].complete()
  assert.deepEqual(writes, [])
  p.onSave()
  dialogs[1].success({ confirm: true })
  dialogs[1].complete()
  assert.equal(storage.get(KEY).term.totalWeeks, 4)
  assert.deepEqual(storage.get(KEY).courses[0].weeks, [1, 2, 3, 4])
  assert.deepEqual(navigation, ['back'])
})

test('课程页离开再返回后可重新确认删除，旧确认及完成回调不会影响新确认', () => {
  const p = page(coursePage, { id: course.id, mode: 'segment-edit', sourceWeek: '1' })
  p.onDelete()
  const old = dialogs[0]
  p.onHide(); p.onShow(); p.onDelete(); p.onDelete()
  assert.equal(dialogs.length, 2)
  old.success({ confirm: true }); old.complete()
  assert.deepEqual(writes, [])
  dialogs[1].success({ confirm: true }); dialogs[1].complete()
  assert.deepEqual(storage.get(KEY).courses[0].weeks, [2, 3, 4, 5, 6])
  assert.deepEqual(navigation, ['back'])
})
