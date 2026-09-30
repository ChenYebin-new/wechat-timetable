import assert from 'node:assert/strict'
import { beforeEach } from 'node:test'
import './helpers/register-typescript.mjs'
import { sessionTest } from './helpers/isolated-test.mjs'
const test = sessionTest(import.meta.url)

const KEY = 'timetable_courses'
const RECENT = 'timetable_recent_backup'
const TODO = 'timetable_todos'
const constants = await import('../miniprogram/constants/timetable.ts')
const clone = structuredClone
const current = () => ({ schemaVersion: 5, term: { startDate: '2026-09-07', totalWeeks: 18 }, courses: [], periodSettings: clone(constants.DEFAULT_PERIOD_SETTINGS) })
const backup = (data = current()) => ({ app: 'qige-timetable', backupVersion: 1, exportedAt: '2026-09-29T00:00:00.000Z', data })
const course = () => ({ id: 'one', groupId: 'one', name: '数学', day: 1, startPeriod: 1, endPeriod: 1, color: '#123456', weekMode: 'all', weeks: Array.from({ length: 18 }, (_, i) => i + 1), createdAt: 1, updatedAt: 1 })
let storage, writes, fault, definitions
function fresh(path) { return import(`../miniprogram/${path}.ts`) }
function instance(definition, properties = {}) {
  return { ...definition, ...definition.methods, data: clone(definition.data), properties, setData(patch) { Object.assign(this.data, patch) } }
}
beforeEach(() => {
  storage = new Map([[KEY, current()]])
  writes = []
  fault = () => {}
  definitions = []
  globalThis.Page = globalThis.Component = value => definitions.push(value)
  globalThis.wx = {
    getStorageSync(key) { fault('read', key); return storage.has(key) ? clone(storage.get(key)) : '' },
    setStorageSync(key, value) { writes.push(key); if (fault('write', key, value) !== 'ignore') storage.set(key, clone(value)) },
    removeStorageSync(key) { writes.push(key); if (fault('remove', key) !== 'ignore') storage.delete(key) },
    showShareMenu() {}, showToast() {}, showModal() {},
  }
})

for (const mode of ['throw', 'ignore', 'read-failure']) {
  test(`普通随想保存回滚 ${mode} 后锁住所有待办写入口`, async () => {
    const service = await fresh('services/todo-storage')
    storage.set(TODO, { schemaVersion: 3, items: [], dailyNotes: [{ date: '2026-09-29', content: '原随想', updatedAt: 1 }] })
    let attempts = 0
    fault = (op, key) => {
      if (key !== TODO) return
      if (op === 'write' && ++attempts === 1) {
        storage.set(key, { schemaVersion: 3, items: [], dailyNotes: [] })
        return 'ignore'
      }
      if (op === 'write' && mode === 'throw') throw new Error('rollback failed')
      if (op === 'write' && mode === 'ignore') return 'ignore'
      if (op === 'read' && attempts === 2 && mode === 'read-failure') throw new Error('rollback read failed')
    }
    assert.throws(() => service.saveDailyNote('2026-09-29', '新随想'))
    fault = () => {}
    writes.length = 0
    assert.throws(() => service.saveTodo({ title: '不能继续写', taskDate: '2026-09-29' }), /暂停写入/)
    assert.throws(() => service.saveDailyNote('2026-09-29', '不能继续写'), /暂停写入/)
    assert.throws(() => service.migrateTodosToV3('2026-09-29'), /暂停写入/)
    assert.equal(service.getTodoSnapshot().kind, 'io-error')
    assert.deepEqual(writes, [])
  })
}

test('课程删除回滚失败后，即使剩余数据格式有效也不能继续保存', async () => {
  const service = await fresh('services/course-storage')
  storage.set(KEY, { ...current(), courses: [course()] })
  fault = (op, key) => {
    if (op === 'write' && key === KEY) { storage.set(KEY, current()); throw new Error('write failed after change') }
  }
  assert.throws(() => service.remove('one'))
  fault = () => {}
  writes.length = 0
  assert.throws(() => service.save({ ...course(), id: undefined }), /暂停写入/)
  assert.equal(service.applyTerm(current().term).ok, false)
  assert.equal(service.savePeriodSettings(current().periodSettings).ok, false)
  assert.equal(service.getStorageSnapshot().kind, 'io-error')
  assert.deepEqual(writes, [])
})

test('读取最近课表备份不触发当前课表自动迁移或覆盖最近备份', async () => {
  const service = await fresh('services/backup-service')
  storage.set(KEY, { schemaVersion: 2, term: null, courses: [] })
  storage.set(RECENT, { savedAt: 1, export: backup() })
  const before = clone(storage)
  assert.ok(service.getRecentBackup())
  assert.deepEqual(storage, before)
  assert.deepEqual(writes, [])
})

test('课表覆盖、合并与恢复将读取故障转为失败结果，保留两个存储键', async () => {
  const service = await fresh('services/backup-service')
  storage.set(RECENT, { savedAt: 1, export: backup() })
  const before = clone(storage)
  fault = (op, key) => { if (op === 'read' && key === KEY) throw new Error('read failed') }
  for (const action of [() => service.overwriteFromBackup(backup()), () => service.mergeFromBackup(backup()), () => service.restoreRecentBackup()]) {
    const result = action()
    assert.equal(result.ok, false)
    assert.match(result.reason, /读取本地课表失败/)
  }
  assert.deepEqual(storage, before)
  assert.deepEqual(writes, [])
})

test('课表导出拒绝自身无法重新导入的超限 JSON', async () => {
  const service = await fresh('services/backup-service')
  storage.set(KEY, { ...current(), courses: [{ ...course(), name: '字'.repeat(360000) }] })
  assert.throws(() => service.exportBackup(), /1 MiB/)
  assert.deepEqual(writes, [])
})

test('损坏的旧课表不能丢弃异常课程后导出成貌似完整的备份', async () => {
  const service = await fresh('services/backup-service')
  const { groupId, weekMode, weeks, ...validLegacyCourse } = course()
  storage.set(KEY, { schemaVersion: 1, courses: [validLegacyCourse, { ...validLegacyCourse, id: 'bad', day: 99 }] })
  const before = clone(storage)
  assert.throws(() => service.exportBackup(), /损坏/)
  assert.deepEqual(storage, before)
  assert.deepEqual(writes, [])
})

test('长按选中后继续按住，松手 tap 不取消首格；下一次独立点击仍有效', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  await fresh('components/timetable-grid/index')
  const component = definitions[0]
  const page = instance(component, { holdEnabled: true, selectionMode: false })
  const events = []
  page.triggerEvent = (name, payload) => {
    events.push([name, payload])
    if (name === 'cellhold') page.properties.selectionMode = true
  }
  const event = { touches: [{ clientX: 10, clientY: 10 }], currentTarget: { dataset: { key: '1-1', day: 1, period: 1 } } }
  page.onCellTouchStart(event)
  t.mock.timers.tick(1200)
  t.mock.timers.tick(1800)
  page.onCellTouchEnd()
  page.onCellTap(event)
  assert.deepEqual(events.map(([name]) => name), ['cellhold'])
  page.onCellTouchStart(event)
  page.onCellTouchEnd()
  page.onCellTap(event)
  assert.deepEqual(events.map(([name]) => name), ['cellhold', 'celltap'])
  component.lifetimes.detached.call(page)
})

test('长按期间离开页面会取消计时，不向隐藏页面发送选格事件', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  await fresh('components/timetable-grid/index')
  const component = definitions[0]
  const page = instance(component, { holdEnabled: true, selectionMode: false })
  const events = []
  page.triggerEvent = name => events.push(name)
  page.onCellTouchStart({ touches: [{ clientX: 10, clientY: 10 }], currentTarget: { dataset: { key: '1-1', day: 1, period: 1 } } })
  component.pageLifetimes?.hide.call(page)
  t.mock.timers.tick(3000)
  assert.deepEqual(events, [])
  assert.equal(page.data.pressingKey, '')
  component.lifetimes.detached.call(page)
})

test('重新选择合法开始时间后，单节时长提示和新结束时间一致', async () => {
  await fresh('pages/period-time-edit/index')
  const page = instance(definitions[0])
  page.onEndChange({ detail: { value: '07:00' } })
  assert.match(page.data.durationText, /晚于/)
  page.onStartChange({ detail: { value: '09:00' } })
  assert.equal(page.data.end, '09:50')
  assert.equal(page.data.durationText, '50 分钟')
})

for (const change of ['storage', 'input', 'hidden']) {
  test(`课表导入确认期间 ${change} 变化会使旧确认失效`, async () => {
    await fresh('pages/data-manage/index')
    const page = instance(definitions[0])
    const modals = []
    wx.showModal = options => modals.push(options)
    page.onLoad({})
    page.onShow()
    page.onInput({ detail: { value: JSON.stringify(backup({ ...current(), courses: [course()] })) } })
    page.onParse()
    page.onOverwrite()
    page.onOverwrite()
    assert.equal(modals.length, 1, '重复点击不能产生第二个覆盖确认')
    const confirmation = modals[0]
    if (change === 'storage') storage.set(KEY, { ...current(), courses: [{ ...course(), name: '刚刚修改的课程' }] })
    if (change === 'input') page.onInput({ detail: { value: '{}' } })
    if (change === 'hidden') page.onHide()
    const before = clone(storage)
    confirmation.success({ confirm: true })
    confirmation.complete()
    assert.deepEqual(storage, before)
    assert.deepEqual(writes, [])
    if (change === 'storage') assert.match(page.data.previewErrors[0], /课表已变化/)
  })
}

test('课表确认取消后可重新确认，合法覆盖保留原课表备份', async () => {
  await fresh('pages/data-manage/index')
  const page = instance(definitions[0])
  const modals = []
  wx.showModal = options => modals.push(options)
  page.onLoad({})
  page.onShow()
  page.onInput({ detail: { value: JSON.stringify(backup({ ...current(), courses: [course()] })) } })
  page.onParse()
  page.onOverwrite()
  modals[0].success({ confirm: false })
  modals[0].complete()
  assert.deepEqual(writes, [])
  page.onOverwrite()
  modals[1].success({ confirm: true })
  modals[1].complete()
  assert.equal(storage.get(KEY).courses[0].id, 'one')
  assert.deepEqual(storage.get(RECENT).export.data, current())
  assert.equal(page.data.preview, null)
})

test('确认恢复期间最近课表备份变化时，不恢复未预览的新备份', async () => {
  await fresh('pages/data-manage/index')
  const page = instance(definitions[0])
  const modals = []
  wx.showModal = options => modals.push(options)
  storage.set(RECENT, { savedAt: 1, export: backup() })
  page.onShow()
  page.onRestoreRecent()
  storage.set(RECENT, { savedAt: 2, export: backup({ ...current(), courses: [course()] }) })
  const before = clone(storage)
  modals[0].success({ confirm: true })
  assert.deepEqual(storage, before)
  assert.deepEqual(writes, [])
  assert.match(modals.at(-1).content, /最近备份已变化/)
})

test('共用字节计算与真实 UTF-8 编码一致，包含孤立代理项', async () => {
  const { utf8ByteLength } = await fresh('utils/utf8')
  for (const value of ['', 'ASCII', '汉字', 'é', '😀', '\ud800字', '\ud800\ud800', '\udc00', '混合😀\ud800末尾']) {
    assert.equal(utf8ByteLength(value), Buffer.byteLength(value, 'utf8'))
  }
})

for (const action of ['term', 'periods', 'overwrite', 'merge', 'restore', 'migration']) {
  test(`课表 ${action} 回滚失败后保留会话锁，备份和普通写入均不可绕过`, async () => {
    const service = await fresh('services/course-storage')
    const backups = await fresh('services/backup-service')
    storage.set(KEY, { ...current(), courses: [course()] })
    storage.set(RECENT, { savedAt: 1, export: backup() })
    if (action === 'migration') storage.set(KEY, { schemaVersion: 2, term: null, courses: [] })
    fault = (op, key) => {
      if (op === 'write' && key === KEY) {
        storage.set(KEY, current())
        throw new Error('write failed after replacing data')
      }
    }
    if (action === 'term') assert.equal(service.applyTerm({ ...current().term, totalWeeks: 16 }).ok, false)
    if (action === 'periods') assert.equal(service.savePeriodSettings(current().periodSettings).ok, false)
    if (action === 'overwrite') assert.equal(backups.overwriteFromBackup(backup()).ok, false)
    if (action === 'merge') assert.equal(backups.mergeFromBackup(backup()).ok, false)
    if (action === 'restore') assert.equal(backups.restoreRecentBackup().ok, false)
    if (action === 'migration') service.getStorageSnapshot()
    fault = () => {}
    writes.length = 0
    const before = clone(storage)
    assert.throws(() => service.writeStorage(current()), /暂停写入/)
    assert.throws(() => service.save({ ...course(), id: undefined }), /暂停写入/)
    assert.match(backups.overwriteFromBackup(backup()).reason, /暂停写入/)
    assert.match(backups.mergeFromBackup(backup()).reason, /暂停写入/)
    assert.match(backups.restoreRecentBackup().reason, /暂停写入/)
    assert.deepEqual(storage, before)
    assert.deepEqual(writes, [])
  })
}
