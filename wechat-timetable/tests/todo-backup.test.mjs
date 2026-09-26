import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import './helpers/register-typescript.mjs'

const service = await import('../miniprogram/services/todo-backup-service.ts')
const session = await import('../miniprogram/services/todo-session.ts')
const todos = await import('../miniprogram/services/todo-storage.ts')
const { TODO_RECENT_BACKUP_KEY: RECENT } = await import('../miniprogram/models/todo-backup.ts')
const { APP_ID, MAX_BACKUP_BYTES } = await import('../miniprogram/models/backup.ts')
const KEY = todos.TODO_STORAGE_KEY
let storage, writes, fault
const empty = () => ({ schemaVersion: 3, items: [], dailyNotes: [] })
const item = (overrides = {}) => ({
  id: 'a', title: '今日目标😀', note: '  原备注\n', taskDate: '2026-09-20',
  completed: false, createdAt: 1, updatedAt: 2, completedAt: null, ...overrides,
})
const full = () => ({
  schemaVersion: 3,
  items: [item({ legacyTiming: { dueDate: '', scheduleDate: '', scheduleStartTime: '', scheduleEndTime: '' } }),
    item({ id: 'b', taskDate: '2026-09-23', completed: true, completedAt: 3 })],
  dailyNotes: [{ date: '2026-09-21', content: '  日记\n\n😀\n', updatedAt: 4 },
    { date: '2026-09-22', content: '字'.repeat(2000), updatedAt: 5 },
    { date: '2026-09-24', content: ' \n ', updatedAt: 6 }],
})
const text = (data = full(), override = {}) => JSON.stringify({ app: APP_ID, kind: 'todo-journal', backupVersion: 1, exportedAt: '2026-09-26T00:00:00.000Z', data, ...override })

beforeEach(() => {
  storage = new Map([['timetable_courses', { sentinel: '课程不应被读写' }]])
  writes = []
  fault = null
  session.unsavedDailyNotes.clear()
  globalThis.wx = {
    getStorageSync(key) {
      assert.notEqual(key, 'timetable_courses')
      if (fault?.('read', key)) throw new Error('读取失败')
      return storage.has(key) ? structuredClone(storage.get(key)) : ''
    },
    setStorageSync(key, value) {
      assert.ok([KEY, RECENT].includes(key))
      writes.push(key)
      const mode = fault?.('write', key, value)
      if (mode === 'throw') throw new Error('写入失败')
      if (mode !== 'silent') storage.set(key, structuredClone(value))
    },
    removeStorageSync(key) {
      writes.push(key)
      if (fault?.('remove', key) === 'throw') throw new Error('删除失败')
      storage.delete(key)
    },
  }
})

test('空数据和完整 V3 数据导出、预览、恢复无损，读操作不写盘', () => {
  for (const data of [empty(), full()]) {
    storage.set(KEY, data)
    const exported = service.exportTodoBackup()
    assert.deepEqual(service.parseTodoBackup(exported).data, data)
    storage.delete(KEY)
    const preview = service.previewTodoBackup(exported)
    assert.equal(preview.summary.itemCount, data.items.length)
    assert.equal(preview.summary.completedCount, data.items.filter(x => x.completed).length)
    assert.equal(preview.summary.noteCount, data.dailyNotes.length)
    assert.equal(preview.summary.dateRange, data.items.length ? '2026-09-20 至 2026-09-24' : '无记录')
    writes.length = 0
    service.previewTodoBackup(exported)
    assert.deepEqual(writes, [])
    service.restoreTodoBackup(preview)
    assert.deepEqual(storage.get(KEY), data)
    assert.deepEqual(writes, [RECENT, KEY])
  }
  assert.deepEqual(storage.get('timetable_courses'), { sentinel: '课程不应被读写' })
})

test('整体覆盖保留旧数据，连续恢复可撤回，空数据也可撤回', () => {
  storage.set(KEY, full())
  const revision = session.todoRevision()
  service.restoreTodoBackup(service.previewTodoBackup(text(empty())))
  assert.deepEqual(storage.get(KEY), empty())
  assert.equal(session.todoRevision(), revision + 1)
  assert.equal(service.getRecentTodoBackup().noteCount, 3)
  service.restoreTodoBackup(service.previewRecentTodoBackup())
  assert.deepEqual(storage.get(KEY), full())
  service.restoreTodoBackup(service.previewRecentTodoBackup())
  assert.deepEqual(storage.get(KEY), empty())
})

test('严格拒绝错误 JSON、错误类型、未知版本、字段与日期异常、重复记录', () => {
  const invalid = [
    '', '{', 'null', '[]', text(full(), { app: 'other' }), text(full(), { kind: undefined }),
    text(full(), { kind: 'course' }), text(full(), { backupVersion: 2 }),
    text(full(), { extra: true }), text(full(), { exportedAt: '2026-02-30T00:00:00.000Z' }),
    text(full(), { exportedAt: '2026-09-26' }), text(null), text({ schemaVersion: 4, items: [], dailyNotes: [] }),
    text({ schemaVersion: 1, items: [] }),
    text({ ...empty(), items: [item(), item()] }),
    text({ ...empty(), dailyNotes: [full().dailyNotes[0], full().dailyNotes[0]] }),
    text({ ...empty(), items: [item({ taskDate: '2026-02-30' })] }),
    text({ ...empty(), items: [item({ title: '' })] }),
    text({ ...empty(), items: [item({ extra: true })] }),
    text({ ...empty(), dailyNotes: [{ date: '2026-09-26', content: '字'.repeat(2001), updatedAt: 1 }] }),
  ]
  for (const input of invalid) assert.throws(() => service.parseTodoBackup(input), undefined, input.slice(0, 80))
  assert.deepEqual(writes, [])
})

test('UTF-8 导出和输入执行 1 MiB 上限，不截断已保存数据', () => {
  assert.throws(() => service.parseTodoBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), /1 MiB/)
  const data = { ...empty(), items: Array.from({ length: 6000 }, (_, i) => item({ id: String(i), title: '😀'.repeat(30), note: '字'.repeat(200) })) }
  storage.set(KEY, data)
  assert.throws(() => service.exportTodoBackup(), /1 MiB/)
  assert.throws(() => service.restoreTodoBackup(service.previewTodoBackup(text(empty()))), /1 MiB/)
  assert.deepEqual(storage.get(KEY), data)
  assert.deepEqual(writes, [])
})

test('异常本机数据和旧数据禁止导出、覆盖，不触发隐式迁移', () => {
  for (const data of [{ schemaVersion: 1, items: [] }, { schemaVersion: 2, items: [] }, { schemaVersion: 9 }, {}, 'bad']) {
    storage.set(KEY, data)
    assert.throws(() => service.exportTodoBackup())
    assert.throws(() => service.previewTodoBackup(text()))
    assert.deepEqual(storage.get(KEY), data)
  }
  fault = (op) => op === 'read'
  assert.throws(() => service.exportTodoBackup(), /读取失败/)
  assert.throws(() => service.previewTodoBackup(text()), /读取失败/)
  assert.deepEqual(writes, [])
})

test('预览后本机或最近备份变化时阻止写入，执行前重新校验目标', () => {
  const preview = service.previewTodoBackup(text())
  storage.set(KEY, empty())
  assert.throws(() => service.restoreTodoBackup(preview), /重新预览/)
  service.restoreTodoBackup(service.previewTodoBackup(text()))
  const recent = service.previewRecentTodoBackup()
  storage.get(RECENT).savedAt += 1
  writes.length = 0
  assert.throws(() => service.restoreTodoBackup(recent), /重新预览/)
  assert.throws(() => service.restoreTodoBackup({ ...preview, backupText: '{}' }))
  assert.deepEqual(writes, [])
})

test('未保存随想或目标阻止恢复，但允许导出已保存记录', () => {
  const preview = service.previewTodoBackup(text())
  session.unsavedDailyNotes.set('2026-09-25', '尚未保存')
  assert.throws(() => service.restoreTodoBackup(preview), /未保存/)
  assert.deepEqual(service.parseTodoBackup(service.exportTodoBackup()).data, empty())
  session.unsavedDailyNotes.clear()
  const owner = {}
  session.setGoalDraft(owner, '2026-09-26')
  assert.throws(() => service.restoreTodoBackup(preview), /未保存/)
  session.requestTodoDraft()
  assert.equal(session.takeRequestedDraftDate(), '2026-09-26')
  assert.equal(session.takeRequestedDraftDate(), '')
  session.setGoalDraft(owner, null)
  service.restoreTodoBackup(preview)
})

test('读取最近备份支持空状态，拒绝损坏和未知版本', () => {
  assert.equal(service.getRecentTodoBackup(), null)
  assert.throws(() => service.previewRecentTodoBackup(), /没有可用/)
  for (const raw of ['bad', [], {}, { savedAt: -1, export: JSON.parse(text()) },
    { savedAt: 1, export: JSON.parse(text(empty(), { backupVersion: 9 })) }]) {
    storage.set(RECENT, raw)
    assert.throws(() => service.getRecentTodoBackup())
    assert.throws(() => service.previewRecentTodoBackup())
  }
  assert.deepEqual(writes, [])
})

for (const key of [KEY, RECENT]) {
  for (const mode of ['throw', 'silent', 'read']) {
    test(`${key} ${mode} 故障回滚两个键且不报成功`, () => {
      storage.set(KEY, empty())
      const oldRecent = { savedAt: 1, export: JSON.parse(text(empty())) }
      storage.set(RECENT, oldRecent)
      const preview = service.previewTodoBackup(text())
      const revision = session.todoRevision()
      let fired = false
      fault = (op, target) => {
        if (fired || target !== key) return
        if (mode === 'read' ? op === 'read' && writes.includes(key) : op === 'write') {
          fired = true
          return mode === 'read' ? true : mode
        }
      }
      assert.throws(() => service.restoreTodoBackup(preview), /恢复失败/)
      assert.deepEqual(storage.get(KEY), empty())
      assert.deepEqual(storage.get(RECENT), oldRecent)
      if (key === RECENT) assert.ok(!writes.includes(KEY))
      assert.equal(session.todoRevision(), revision)
      assert.equal(session.todoWriteProblem(), '')
    })
  }
}

test('首次恢复失败会移除新建的键，保留原始缺失状态', () => {
  const preview = service.previewTodoBackup(text())
  let failed = false
  fault = (op, key) => {
    if (!failed && op === 'read' && key === KEY && writes.includes(KEY)) { failed = true; return true }
  }
  assert.throws(() => service.restoreTodoBackup(preview), /恢复失败/)
  assert.equal(storage.has(KEY), false)
  assert.equal(storage.has(RECENT), false)
})

test('读取最近备份失败时不开始任何写入', () => {
  const preview = service.previewTodoBackup(text())
  fault = (op, key) => op === 'read' && key === RECENT
  assert.throws(() => service.restoreTodoBackup(preview), /读取失败/)
  assert.deepEqual(writes, [])
})

// 会话锁刻意不可解除，放在本文件最后验证所有写入口均被保护。
test('无法确认回滚时锁定整个会话，普通保存、迁移和再次恢复均停止', () => {
  const preview = service.previewTodoBackup(text())
  fault = (op, key) => key === KEY && (op === 'write' || op === 'remove') ? 'throw' : undefined
  assert.throws(() => service.restoreTodoBackup(preview), /暂停写入/)
  fault = null
  writes.length = 0
  assert.throws(() => todos.saveTodo({ title: '不能写', taskDate: '2026-09-26' }), /暂停写入/)
  assert.throws(() => todos.saveDailyNote('2026-09-26', '不能写'), /暂停写入/)
  assert.throws(() => todos.migrateTodosToV3('2026-09-26'), /暂停写入/)
  assert.throws(() => service.restoreTodoBackup(preview), /暂停写入/)
  assert.equal(todos.getTodoSnapshot().kind, 'io-error')
  assert.deepEqual(writes, [])
})
