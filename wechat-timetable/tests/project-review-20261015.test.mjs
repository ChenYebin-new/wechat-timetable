import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import './helpers/register-typescript.mjs'

const KEY = 'timetable_courses'
let storage, writes, navigations
const definitions = []
globalThis.Page = globalThis.Component = definition => definitions.push(definition)
globalThis.wx = { getStorageSync() { return '' } }
const constants = await import('../miniprogram/constants/timetable.ts')
const backup = await import('../miniprogram/services/backup-service.ts')
const courseStorage = await import('../miniprogram/services/course-storage.ts')
const { reflowPeriodSettings } = await import('../miniprogram/utils/period-settings.ts')
await import('../miniprogram/pages/period-settings/index.ts')
await import('../miniprogram/components/timetable-grid/index.ts')
const [periodPage, grid] = definitions

function instance(definition, properties = {}) {
  return {
    ...definition, ...definition.methods, properties,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) },
  }
}

beforeEach(() => {
  storage = new Map()
  writes = []
  navigations = []
  globalThis.wx = {
    getStorageSync(key) { return storage.has(key) ? structuredClone(storage.get(key)) : '' },
    setStorageSync(key, value) { writes.push(key); storage.set(key, structuredClone(value)) },
    removeStorageSync(key) { writes.push(key); storage.delete(key) },
    showToast() {},
    showModal(options) { assert.fail(`unexpected modal: ${options.content}`) },
    navigateBack(options) { navigations.push(options) },
  }
})

test('未设置学期的全新空课表可以无写入导出，再覆盖恢复', () => {
  const text = backup.exportBackup()
  assert.deepEqual(writes, [])
  assert.equal(storage.has(KEY), false)
  const parsed = backup.parseBackup(text)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.envelope.data.term, null)
  assert.deepEqual(parsed.envelope.data.courses, [])
  assert.equal(backup.analyzeBackup(parsed.envelope).ok, true)
  assert.equal(backup.overwriteFromBackup(parsed.envelope).ok, true)
  assert.equal(courseStorage.getStorageSnapshot().kind, 'current')
})

test('先调整作息再设置学期的空课表可完整备份恢复作息', () => {
  const settings = reflowPeriodSettings({ ...structuredClone(constants.DEFAULT_PERIOD_SETTINGS), durationMinutes: 45 }).settings
  assert.equal(courseStorage.savePeriodSettings(settings).ok, true)
  const original = structuredClone(storage.get(KEY))
  const parsed = backup.parseBackup(backup.exportBackup())
  assert.equal(parsed.ok, true)
  assert.equal(backup.overwriteFromBackup(parsed.envelope).ok, true)
  assert.deepEqual(storage.get(KEY), original)
})

for (const lifecycle of ['onHide', 'onUnload']) {
  test(`作息保存后立即 ${lifecycle}，迟到的返回不能关闭其他页面`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const page = instance(periodPage)
    page.updateDraft(constants.DEFAULT_PERIOD_SETTINGS)
    page.onSave()
    assert.equal(page.data.saving, true)
    page[lifecycle]?.()
    t.mock.timers.tick(500)
    assert.deepEqual(navigations, [])
    assert.equal(page.data.saving, false)
    assert.equal(courseStorage.getStorageSnapshot().kind, 'current')
  })
}

function touch(touches) {
  return { touches, currentTarget: { dataset: { key: '1-1', day: 1, period: 1 } } }
}
const finger = { identifier: 1, clientX: 10, clientY: 10 }
const secondFinger = { identifier: 2, clientX: 11, clientY: 11 }

test('课表多指按下不能启动长按选格，恢复单指后仍可正常长按', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = instance(grid, { holdEnabled: true, selectionMode: false })
  const events = []
  page.triggerEvent = (name, detail) => events.push({ name, detail })
  page.onCellTouchStart(touch([finger, secondFinger]))
  t.mock.timers.tick(1300)
  assert.deepEqual(events, [])
  assert.equal(page.data.pressingKey, '')
  page.onCellTouchStart(touch([finger]))
  t.mock.timers.tick(1200)
  assert.deepEqual(events.map(event => event.name), ['cellhold'])
  grid.lifetimes.detached.call(page)
})

test('课表长按计时中加入第二指会取消计时，不误选格', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = instance(grid, { holdEnabled: true, selectionMode: false })
  const events = []
  page.triggerEvent = (name, detail) => events.push({ name, detail })
  page.onCellTouchStart(touch([finger]))
  t.mock.timers.tick(600)
  page.onCellTouchMove(touch([finger, secondFinger]))
  t.mock.timers.tick(700)
  assert.deepEqual(events, [])
  assert.equal(page.data.pressingKey, '')
  grid.lifetimes.detached.call(page)
})
