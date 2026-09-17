import assert from 'node:assert/strict'
import test from 'node:test'
import './helpers/register-typescript.mjs'

let storage
let operations
let readModes
let writeModes
let removeModes

globalThis.wx = {
  getStorageSync(key) {
    operations.push({ operation: 'get', key })
    const mode = readModes.shift()
    if (mode === 'throw') throw new Error('simulated read failure')
    if (mode === 'plain-throw') throw 'read failure'
    if (mode === 'missing') return ''
    return storage.has(key) ? structuredClone(storage.get(key)) : ''
  },
  setStorageSync(key, value) {
    operations.push({ operation: 'set', key })
    const mode = writeModes.shift()
    if (mode === 'throw') throw new Error('simulated write failure')
    if (mode === 'ignore') return
    if (mode === 'truncate' || mode === 'throw-after-write') {
      storage.set(key, { schemaVersion: 3, items: [], dailyNotes: [] })
      if (mode === 'throw-after-write') throw new Error('write changed storage before failing')
      return
    }
    if (mode === 'corrupt') {
      storage.set(key, { schemaVersion: 3, items: [{ id: 'broken' }], dailyNotes: [] })
      return
    }
    storage.set(key, structuredClone(value))
  },
  removeStorageSync(key) {
    operations.push({ operation: 'remove', key })
    const mode = removeModes.shift()
    if (mode === 'throw') throw new Error('simulated remove failure')
    if (mode !== 'ignore') storage.delete(key)
  },
}

const todoStorage = await import('../miniprogram/services/todo-storage.ts')
const KEY = todoStorage.TODO_STORAGE_KEY
const unrelated = [
  ['timetable_courses', { schemaVersion: 5, courses: [{ id: 'course-keep', title: '保持课表' }] }],
  ['timetable_recent_backup', { content: '保留课表备份', updatedAt: 1 }],
]

test.beforeEach(() => {
  storage = new Map(structuredClone(unrelated))
  operations = []
  readModes = []
  writeModes = []
  removeModes = []
})

test.afterEach(() => {
  for (const [key, value] of unrelated) assert.deepEqual(storage.get(key), value)
  assert.ok(operations.every(({ key }) => key === KEY), '目标与随想只能访问 timetable_todos')
})

function v1Item(overrides = {}) {
  return {
    id: 'old-1',
    title: '  保留原始标题  ',
    note: '  保留原始备注\n第二行  ',
    dueDate: '',
    completed: false,
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
    ...overrides,
  }
}

function v2Item(overrides = {}) {
  return {
    ...v1Item(),
    scheduleDate: '',
    scheduleStartTime: '',
    scheduleEndTime: '',
    ...overrides,
  }
}

function v3Item(overrides = {}) {
  return {
    id: 'todo-1',
    title: '今日复习',
    note: '三个重点',
    taskDate: '2026-09-16',
    completed: false,
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
    ...overrides,
  }
}

function current(items = [v3Item()], dailyNotes = []) {
  return { schemaVersion: 3, items, dailyNotes }
}

function seed(raw) {
  storage.set(KEY, structuredClone(raw))
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function assertNoWrites() {
  assert.ok(operations.every(({ operation }) => operation === 'get'))
}

function assertProtected(raw, expectedKind = 'corrupt') {
  seed(raw)
  assert.equal(todoStorage.getTodoSnapshot().kind, expectedKind)
  assert.throws(() => todoStorage.saveTodo({ title: '不能覆盖', taskDate: '2026-09-16' }))
  assert.throws(() => todoStorage.saveDailyNote('2026-09-16', '不能覆盖'))
  assert.throws(() => todoStorage.toggleTodo('todo-1'))
  assert.throws(() => todoStorage.removeTodo('todo-1'))
  assert.throws(() => todoStorage.getTodoById('todo-1'))
  assert.throws(() => todoStorage.migrateTodosToV3('2026-09-16'))
  assert.deepEqual(storage.get(KEY), raw)
  assertNoWrites()
}

test('读取缺失或合法 V3 数据只返回副本，未迁移旧数据也不会动态分配日期或写盘', () => {
  assert.deepEqual(todoStorage.getTodoSnapshot(), { kind: 'missing', data: current([]) })
  for (const missing of ['', undefined, null]) {
    seed(missing)
    assert.equal(todoStorage.getTodoSnapshot().kind, 'missing')
  }
  const raw = current([v3Item({ legacyTiming: {
    dueDate: '2026-09-20', scheduleDate: '', scheduleStartTime: '', scheduleEndTime: '',
  } })], [{ date: '2026-09-16', content: '随想\n第二行', updatedAt: 3 }])
  seed(raw)
  const snapshot = todoStorage.getTodoSnapshot()
  snapshot.data.items[0].legacyTiming.dueDate = ''
  snapshot.data.dailyNotes[0].content = '外部修改'
  const item = todoStorage.getTodoById('todo-1')
  item.legacyTiming.dueDate = ''
  assert.deepEqual(storage.get(KEY), raw)
  assert.equal(todoStorage.getTodoById('missing'), undefined)
  for (const version of [1, 2]) {
    const legacy = { schemaVersion: version, items: [version === 1 ? v1Item() : v2Item()] }
    seed(legacy)
    const oldSnapshot = todoStorage.getTodoSnapshot()
    assert.equal(oldSnapshot.kind, 'legacy')
    assert.equal('data' in oldSnapshot, false)
    assert.match(oldSnapshot.reason, /升级/)
    assert.deepEqual(storage.get(KEY), legacy)
  }
  assertNoWrites()
})

test('合法 V1/V2 在显式迁移前，目标和随想 CRUD 均阻止直接覆盖', () => {
  for (const version of [1, 2]) {
    const legacy = { schemaVersion: version, items: [version === 1 ? v1Item() : v2Item()] }
    seed(legacy)
    assert.throws(() => todoStorage.saveTodo({ title: '新目标', taskDate: '2026-09-16' }), /升级/)
    assert.throws(() => todoStorage.saveDailyNote('2026-09-16', '随想'), /升级/)
    assert.throws(() => todoStorage.toggleTodo('old-1'), /升级/)
    assert.throws(() => todoStorage.removeTodo('old-1'), /升级/)
    assert.throws(() => todoStorage.getTodoById('old-1'), /升级/)
    assert.deepEqual(storage.get(KEY), legacy)
  }
  assertNoWrites()
})

test('V1 迁移固定未完成目标日期，已完成优先截止日期再使用完成时间本地日，旧内容和时间戳逐项保留', () => {
  const completedAt = new Date(2026, 8, 12, 0, 30).getTime()
  const items = [
    v1Item({ id: 'pending-past', dueDate: '2026-09-10' }),
    v1Item({ id: 'pending-future', dueDate: '2026-09-25' }),
    v1Item({ id: 'done-due', dueDate: '2026-09-11', completed: true, completedAt }),
    v1Item({ id: 'done-local', completed: true, completedAt }),
    v1Item({ id: 'done-epoch', completed: true, completedAt: 0 }),
  ]
  seed({ schemaVersion: 1, items })
  assert.equal(todoStorage.migrateTodosToV3('2026-09-16'), true)
  const upgraded = todoStorage.getTodoSnapshot().data
  assert.equal(upgraded.schemaVersion, 3)
  assert.deepEqual(upgraded.dailyNotes, [])
  assert.deepEqual(upgraded.items.map((item) => item.taskDate), [
    '2026-09-16', '2026-09-16', '2026-09-11', '2026-09-12', dateKey(new Date(0)),
  ])
  for (let index = 0; index < items.length; index += 1) {
    const { dueDate, ...preserved } = items[index]
    const { taskDate, legacyTiming, ...actual } = upgraded.items[index]
    assert.deepEqual(actual, preserved)
    assert.deepEqual(legacyTiming, { dueDate, scheduleDate: '', scheduleStartTime: '', scheduleEndTime: '' })
  }
  const before = structuredClone(storage.get(KEY))
  const writes = operations.filter(({ operation }) => operation === 'set').length
  assert.equal(todoStorage.migrateTodosToV3('2026-09-17'), false)
  assert.deepEqual(storage.get(KEY), before)
  assert.equal(operations.filter(({ operation }) => operation === 'set').length, writes)
})

test('V2 迁移已完成日期优先执行日，再截止日，再本地完成日；未完成均使用一次迁移日', () => {
  const completedAt = new Date(2026, 8, 13, 23, 45).getTime()
  const scheduled = {
    scheduleDate: '2026-09-11', scheduleStartTime: '13:00', scheduleEndTime: '14:00', dueDate: '2026-09-20',
  }
  const items = [
    v2Item({ id: 'scheduled-pending', ...scheduled }),
    v2Item({ id: 'scheduled-done', ...scheduled, completed: true, completedAt }),
    v2Item({ id: 'due-done', dueDate: '2026-09-12', completed: true, completedAt }),
    v2Item({ id: 'local-done', completed: true, completedAt }),
  ]
  seed({ schemaVersion: 2, items })
  assert.equal(todoStorage.migrateTodosToV3('2026-09-16'), true)
  const upgraded = todoStorage.getTodoSnapshot().data
  assert.deepEqual(upgraded.items.map((item) => item.taskDate), [
    '2026-09-16', '2026-09-11', '2026-09-12', '2026-09-13',
  ])
  for (let index = 0; index < items.length; index += 1) {
    const { dueDate, scheduleDate, scheduleStartTime, scheduleEndTime, ...preserved } = items[index]
    const { taskDate, legacyTiming, ...actual } = upgraded.items[index]
    assert.deepEqual(actual, preserved)
    assert.deepEqual(legacyTiming, { dueDate, scheduleDate, scheduleStartTime, scheduleEndTime })
  }
})

test('迁移读取最新值，无数据和已升级的数据均为无写入 no-op，非法迁移日期不写盘', () => {
  assert.equal(todoStorage.migrateTodosToV3('2026-09-16'), false)
  seed({ schemaVersion: 1, items: [] })
  assert.equal(todoStorage.getTodoSnapshot().kind, 'legacy')
  seed({ schemaVersion: 2, items: [v2Item({ id: 'latest' })] })
  assert.equal(todoStorage.migrateTodosToV3('2026-09-16'), true)
  assert.equal(todoStorage.getTodoSnapshot().data.items[0].id, 'latest')
  const before = structuredClone(storage.get(KEY))
  const writes = operations.filter(({ operation }) => operation === 'set').length
  assert.equal(todoStorage.migrateTodosToV3('2026-09-18'), false)
  assert.throws(() => todoStorage.migrateTodosToV3('2026-02-30'), /迁移日期格式无效/)
  assert.deepEqual(storage.get(KEY), before)
  assert.equal(operations.filter(({ operation }) => operation === 'set').length, writes)
})

test('V1/V2 迁移写失败、部分写入、回读损坏或回读异常时精确回滚原始版本', () => {
  for (const version of [1, 2]) {
    for (const mode of ['throw', 'throw-after-write', 'truncate', 'corrupt']) {
      const legacy = { schemaVersion: version, items: [version === 1 ? v1Item() : v2Item()] }
      seed(legacy)
      writeModes = [mode]
      assert.throws(() => todoStorage.migrateTodosToV3('2026-09-16'), /原数据已恢复/)
      assert.deepEqual(storage.get(KEY), legacy)
      assert.equal(todoStorage.getTodoSnapshot().kind, 'legacy')
    }
  }
  const legacy = { schemaVersion: 2, items: [v2Item()] }
  seed(legacy)
  readModes = ['ok', 'throw', 'ok']
  assert.throws(() => todoStorage.migrateTodosToV3('2026-09-16'), /原数据已恢复/)
  assert.deepEqual(storage.get(KEY), legacy)
})

test('迁移失败后的重试仅使用成功那次迁移日，不会在读操作中漂移', () => {
  seed({ schemaVersion: 1, items: [v1Item()] })
  writeModes = ['throw']
  assert.throws(() => todoStorage.migrateTodosToV3('2026-09-16'), /原数据已恢复/)
  assert.equal(todoStorage.getTodoSnapshot().kind, 'legacy')
  assert.equal(todoStorage.migrateTodosToV3('2026-09-17'), true)
  assert.equal(todoStorage.getTodoById('old-1').taskDate, '2026-09-17')
  assert.equal(todoStorage.migrateTodosToV3('2026-09-18'), false)
  assert.equal(todoStorage.getTodoById('old-1').taskDate, '2026-09-17')
})

test('V3 按日目标新增、编辑、完成和删除闭环，备注仍可选、标题与备注沿用 trim', () => {
  const id = todoStorage.saveTodo({ title: '  整理复习计划  ', note: '  三个重点  ', taskDate: '2026-09-16' })
  const first = todoStorage.getTodoById(id)
  assert.equal(first.title, '整理复习计划')
  assert.equal(first.note, '三个重点')
  assert.equal(first.taskDate, '2026-09-16')
  assert.equal('dueDate' in first, false)
  assert.equal('scheduleDate' in first, false)
  assert.equal('legacyTiming' in first, false)
  todoStorage.saveTodo({ id, title: '本周复习', taskDate: '2026-09-15' })
  let updated = todoStorage.getTodoById(id)
  assert.equal(updated.note, '')
  assert.equal(updated.taskDate, '2026-09-15')
  assert.equal(updated.createdAt, first.createdAt)
  todoStorage.toggleTodo(id)
  updated = todoStorage.getTodoById(id)
  assert.equal(updated.completed, true)
  assert.ok(Number.isSafeInteger(updated.completedAt))
  assert.equal(updated.taskDate, '2026-09-15', '历史补完成不移动日期')
  todoStorage.toggleTodo(id)
  assert.equal(todoStorage.getTodoById(id).completed, false)
  assert.equal(todoStorage.getTodoById(id).completedAt, null)
  todoStorage.removeTodo(id)
  assert.deepEqual(todoStorage.getTodoSnapshot().data, current([]))
})

test('迁移后的目标编辑、完成切换及交错随想保存保留 legacyTiming', () => {
  const legacy = { schemaVersion: 2, items: [v2Item({
    dueDate: '2026-09-20', scheduleDate: '2026-09-15', scheduleStartTime: '09:00', scheduleEndTime: '10:00',
  })] }
  seed(legacy)
  todoStorage.migrateTodosToV3('2026-09-16')
  const timing = structuredClone(todoStorage.getTodoById('old-1').legacyTiming)
  todoStorage.saveTodo({ id: 'old-1', title: '新版标题', note: '新版备注', taskDate: '2026-09-16' })
  todoStorage.toggleTodo('old-1')
  todoStorage.saveDailyNote('2026-09-16', '随想原文\n保留换行')
  assert.deepEqual(todoStorage.getTodoById('old-1').legacyTiming, timing)
})

test('目标验证必填真实日期、60 字标题和 200 字备注，不会落盘无效输入', () => {
  const invalid = [
    [{ title: '', taskDate: '2026-09-16' }, /填写目标标题/],
    [{ title: '  ', taskDate: '2026-09-16' }, /填写目标标题/],
    [{ title: 123, taskDate: '2026-09-16' }, /填写目标标题/],
    [{ title: '字'.repeat(61), taskDate: '2026-09-16' }, /60/],
    [{ title: '目标', note: '字'.repeat(201), taskDate: '2026-09-16' }, /200/],
    [{ title: '目标', note: 123, taskDate: '2026-09-16' }, /备注格式/],
    [{ title: '目标' }, /目标日期/],
    [{ title: '目标', taskDate: '' }, /目标日期/],
    [{ title: '目标', taskDate: '2026-02-29' }, /目标日期/],
    [{ title: '目标', taskDate: '2026-02-30' }, /目标日期/],
    [{ title: '目标', taskDate: '2026-9-16' }, /目标日期/],
  ]
  for (const [draft, message] of invalid) assert.throws(() => todoStorage.saveTodo(draft), message)
  assert.equal(storage.has(KEY), false)
  assertNoWrites()
  const id = todoStorage.saveTodo({ title: '字'.repeat(60), note: '字'.repeat(200), taskDate: '2028-02-29' })
  assert.equal(todoStorage.getTodoById(id).title.length, 60)
})

test('新增或已有 V3 目标的 ID 不存在时不写盘，损坏的新写入 ID 也不覆盖原始数据', () => {
  seed(current())
  const before = structuredClone(storage.get(KEY))
  assert.throws(() => todoStorage.saveTodo({ id: 'missing', title: '编辑', taskDate: '2026-09-16' }), /没有找到/)
  assert.throws(() => todoStorage.toggleTodo('missing'), /没有找到/)
  assert.throws(() => todoStorage.removeTodo('missing'), /没有找到/)
  assert.deepEqual(storage.get(KEY), before)
  assertNoWrites()
  assert.throws(() => todoStorage.saveTodo({ id: 123, title: '编辑', taskDate: '2026-09-16' }), /没有找到/)
})

test('每日一篇随想，保存保留正文、空白与换行，更新不重复，清空只删除该日', () => {
  const text = '  今天想到一个办法\n\n第二段  '
  todoStorage.saveDailyNote('2026-09-16', text)
  let snapshot = todoStorage.getTodoSnapshot().data
  assert.deepEqual(snapshot.items, [])
  assert.equal(snapshot.dailyNotes[0].content, text)
  assert.ok(Number.isSafeInteger(snapshot.dailyNotes[0].updatedAt))
  todoStorage.saveDailyNote('2026-09-15', '补写昨天')
  todoStorage.saveDailyNote('2026-09-16', '  \n  ')
  snapshot = todoStorage.getTodoSnapshot().data
  assert.equal(snapshot.dailyNotes.length, 2)
  assert.equal(snapshot.dailyNotes.find((note) => note.date === '2026-09-16').content, '  \n  ')
  todoStorage.saveDailyNote('2026-09-16', '')
  assert.deepEqual(todoStorage.getTodoSnapshot().data.dailyNotes.map((note) => note.date), ['2026-09-15'])
  todoStorage.saveDailyNote('2026-09-14', '')
  assert.equal(todoStorage.getTodoSnapshot().data.dailyNotes.length, 1)
})

test('随想验证真实日期与 2,000 字上限，非法输入不写；边界正文完整保留', () => {
  for (const date of ['', '2026-02-29', '2026-9-16', '2026-02-30']) {
    assert.throws(() => todoStorage.saveDailyNote(date, '随想'), /随想日期/)
  }
  assert.throws(() => todoStorage.saveDailyNote('2026-09-16', 123), /随想内容格式/)
  assert.throws(() => todoStorage.saveDailyNote('2026-09-16', '字'.repeat(2001)), /2,000/)
  assertNoWrites()
  const text = ` ${'字'.repeat(1998)}\n`
  assert.equal(text.length, 2000)
  todoStorage.saveDailyNote('2028-02-29', text)
  assert.equal(todoStorage.getTodoSnapshot().data.dailyNotes[0].content, text)
})

test('目标和随想的交错修改每次重读最新值，切换日期不会互相覆盖', () => {
  const id = todoStorage.saveTodo({ title: '第一版', taskDate: '2026-09-16' })
  const stale = todoStorage.getTodoSnapshot().data
  todoStorage.saveDailyNote('2026-09-16', '当日草稿')
  todoStorage.saveTodo({ id, title: '第二版', note: '新增备注', taskDate: '2026-09-16' })
  todoStorage.saveDailyNote('2026-09-15', '历史补写')
  todoStorage.toggleTodo(id)
  todoStorage.saveDailyNote('2026-09-16', '当日更新\n完成了目标')
  const latest = todoStorage.getTodoSnapshot().data
  assert.equal(stale.dailyNotes.length, 0)
  assert.equal(latest.items[0].title, '第二版')
  assert.equal(latest.items[0].note, '新增备注')
  assert.equal(latest.items[0].completed, true)
  assert.equal(latest.dailyNotes.length, 2)
  assert.equal(latest.dailyNotes.find((note) => note.date === '2026-09-15').content, '历史补写')
  todoStorage.removeTodo(id)
  assert.deepEqual(todoStorage.getTodoSnapshot().data.dailyNotes, latest.dailyNotes)
})

test('V3 目标和随想写失败或回读不完整时恢复完整原始结构（含另一子系统）', () => {
  const raw = current([v3Item()], [{ date: '2026-09-16', content: '原文\n第二行', updatedAt: 3 }])
  for (const mode of ['throw', 'throw-after-write', 'truncate', 'corrupt', 'ignore']) {
    for (const change of [() => todoStorage.toggleTodo('todo-1'), () => todoStorage.saveDailyNote('2026-09-16', '新随想')]) {
      seed(raw)
      writeModes = [mode]
      assert.throws(change, /原数据已恢复/)
      assert.deepEqual(storage.get(KEY), raw)
    }
  }
  seed(raw)
  readModes = ['ok', 'throw', 'ok']
  assert.throws(() => todoStorage.saveDailyNote('2026-09-17', '未来随想'), /原数据已恢复/)
  assert.deepEqual(storage.get(KEY), raw)
})

test('首次目标或随想写失败恢复为 key 缺失，不留下空的 V3 数据', () => {
  for (const change of [
    () => todoStorage.saveTodo({ title: '首次目标', taskDate: '2026-09-16' }),
    () => todoStorage.saveDailyNote('2026-09-16', '首次随想'),
  ]) {
    storage.delete(KEY)
    writeModes = ['throw']
    assert.throws(change, /原数据已恢复/)
    assert.equal(storage.has(KEY), false)
  }
  storage.delete(KEY)
  writeModes = ['ignore']
  assert.throws(() => todoStorage.saveDailyNote('2026-09-16', '首次随想'), /原数据已恢复/)
  assert.equal(storage.has(KEY), false)
})

test('回滚本身失败、被忽略或回读失败时不误报恢复成功', () => {
  const original = current()
  for (const rollbackMode of ['ignore', 'throw']) {
    seed(original)
    writeModes = ['truncate', rollbackMode]
    assert.throws(() => todoStorage.toggleTodo('todo-1'), /无法确认原数据状态/)
    assert.deepEqual(storage.get(KEY), current([]))
  }
  seed(original)
  writeModes = ['truncate', 'ok']
  readModes = ['ok', 'ok', 'throw']
  assert.throws(() => todoStorage.toggleTodo('todo-1'), /无法确认原数据状态/)
  assert.deepEqual(storage.get(KEY), original)
  storage.delete(KEY)
  writeModes = ['ok']
  readModes = ['ok', 'missing', 'ok']
  removeModes = ['ignore']
  assert.throws(() => todoStorage.saveDailyNote('2026-09-16', '首次随想'), /无法确认原数据状态/)
  assert.equal(storage.has(KEY), true)
  storage.delete(KEY)
  writeModes = ['throw']
  removeModes = ['throw']
  assert.throws(() => todoStorage.saveDailyNote('2026-09-16', '首次随想'), /无法确认原数据状态/)
})

test('读取 I/O 失败时 snapshot 与所有接口只读失败，不覆盖已存在数据', () => {
  const raw = current()
  seed(raw)
  for (const mode of ['throw', 'plain-throw']) {
    readModes = [mode]
    const snapshot = todoStorage.getTodoSnapshot()
    assert.equal(snapshot.kind, 'io-error')
    assert.match(snapshot.reason, /读取本地待办失败/)
  }
  for (const change of [
    () => todoStorage.saveTodo({ title: '不能覆盖', taskDate: '2026-09-16' }),
    () => todoStorage.saveDailyNote('2026-09-16', '不能覆盖'),
    () => todoStorage.toggleTodo('todo-1'),
    () => todoStorage.removeTodo('todo-1'),
    () => todoStorage.getTodoById('todo-1'),
    () => todoStorage.migrateTodosToV3('2026-09-16'),
  ]) {
    readModes = ['throw']
    assert.throws(change, /读取本地待办失败/)
  }
  assert.deepEqual(storage.get(KEY), raw)
  assertNoWrites()
})

test('损坏结构、未知顶层/条目字段和不支持版本保持只读，绝不顺带清洗', () => {
  for (const raw of [123, [], 'json不是对象', { schemaVersion: 1, items: [] , extra: true },
    { schemaVersion: 2, items: 'invalid' }, { schemaVersion: 3, items: [] },
    { schemaVersion: 3, items: [], dailyNotes: 'invalid' }, { ...current(), extra: true },
    current([v3Item({ extra: true })]), { schemaVersion: 1, items: [v1Item({ extra: true })] },
    { schemaVersion: 2, items: [v2Item({ extra: true })] }]) {
    assertProtected(raw)
  }
  for (const raw of [{ items: [] }, { schemaVersion: 0, items: [] }, { schemaVersion: 9, items: [] }]) {
    assertProtected(raw, 'unsupported')
  }
})

test('V1/V2/V3 条目严格拒绝重复 ID、非法标题备注、时间戳及完成状态矛盾', () => {
  const invalidBase = [
    { id: '' }, { id: 123 }, { title: '' }, { title: '  ' }, { title: 123 },
    { title: '字'.repeat(61) }, { note: 123 }, { note: '字'.repeat(201) },
    { completed: 'false' }, { createdAt: -1 }, { createdAt: 1.5 },
    { updatedAt: NaN }, { updatedAt: Number.MAX_SAFE_INTEGER },
    { completed: true, completedAt: null }, { completed: true, completedAt: -1 },
    { completed: false, completedAt: 10 },
  ]
  for (const version of [1, 2, 3]) {
    const create = version === 1 ? v1Item : version === 2 ? v2Item : v3Item
    for (const changes of invalidBase) {
      const items = [create(changes)]
      assertProtected(version === 3 ? current(items) : { schemaVersion: version, items })
    }
    const duplicated = [create(), create()]
    assertProtected(version === 3 ? current(duplicated) : { schemaVersion: version, items: duplicated })
  }
})

test('V1/V2 的截止日与完整执行区间仍按旧协议严格验证，坏数据不能迁移', () => {
  for (const dueDate of [123, '2026-02-30', '2026-9-16']) {
    assertProtected({ schemaVersion: 1, items: [v1Item({ dueDate })] })
    assertProtected({ schemaVersion: 2, items: [v2Item({ dueDate })] })
  }
  for (const timing of [
    { scheduleDate: '2026-09-16' }, { scheduleDate: 123 }, { scheduleStartTime: 123 }, { scheduleEndTime: 123 },
    { scheduleDate: '2026-02-30', scheduleStartTime: '13:00', scheduleEndTime: '14:00' },
    { scheduleDate: '2026-09-16', scheduleStartTime: '25:00', scheduleEndTime: '26:00' },
    { scheduleDate: '2026-09-16', scheduleStartTime: '9:00', scheduleEndTime: '10:00' },
    { scheduleDate: '2026-09-16', scheduleStartTime: '13:70', scheduleEndTime: '14:00' },
    { scheduleDate: '2026-09-16', scheduleStartTime: '13:00', scheduleEndTime: '13:00' },
    { scheduleDate: '2026-09-16', scheduleStartTime: '23:00', scheduleEndTime: '01:00' },
  ]) assertProtected({ schemaVersion: 2, items: [v2Item(timing)] })
})

test('V3 必填真实 taskDate，内部 legacyTiming 也保持完整严格校验', () => {
  for (const taskDate of [undefined, 123, '', '2026-02-29', '2026-9-16']) {
    assertProtected(current([v3Item({ taskDate })]))
  }
  for (const legacyTiming of [null, undefined, {}, [], {
    dueDate: '', scheduleDate: '', scheduleStartTime: '', scheduleEndTime: '', extra: true,
  }, { dueDate: '', scheduleDate: '2026-09-16', scheduleStartTime: '', scheduleEndTime: '' }]) {
    assertProtected(current([v3Item({ legacyTiming })]))
  }
})

test('V3 每日随想拒绝重复日期、空记录、超长正文和异常日期/时间戳，保留整个原始 key', () => {
  const note = { date: '2026-09-16', content: '原文', updatedAt: 1 }
  for (const invalid of [null, [], { ...note, extra: true }, { ...note, date: '2026-02-30' },
    { ...note, date: 123 }, { ...note, content: '' }, { ...note, content: 123 },
    { ...note, content: '字'.repeat(2001) }, { ...note, updatedAt: -1 }, { ...note, updatedAt: 1.5 }]) {
    assertProtected(current([v3Item()], [invalid]))
  }
  assertProtected(current([v3Item()], [note, { ...note, content: '同日第二篇' }]))
})
