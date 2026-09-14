import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import './helpers/register-typescript.mjs'

let storage = new Map()
let failWrites = 0
const definitions = []

globalThis.Page = (definition) => definitions.push(definition)
globalThis.wx = {
  getStorageSync(key) {
    return storage.has(key) ? structuredClone(storage.get(key)) : ''
  },
  setStorageSync(key, value) {
    if (failWrites > 0) {
      failWrites -= 1
      throw new Error('simulated write failure')
    }
    storage.set(key, structuredClone(value))
  },
  removeStorageSync(key) {
    storage.delete(key)
  },
}

const todoStorage = await import('../miniprogram/services/todo-storage.ts')
await import('../miniprogram/pages/todo/index.ts')
await import('../miniprogram/pages/todo-edit/index.ts')
const todoPage = definitions[0]
const todoEditPage = definitions[1]

function reset() {
  storage = new Map()
  failWrites = 0
}

function dateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function offsetDateKey(date, days) {
  return dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}

function todoItem(overrides = {}) {
  return {
    id: 'todo-1',
    title: '完成作业',
    note: '',
    dueDate: '',
    scheduleDate: '',
    scheduleStartTime: '',
    scheduleEndTime: '',
    completed: false,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    ...overrides,
  }
}

test('待办可完成新增、编辑、完成状态切换和删除闭环', () => {
  reset()
  const courseStorage = { schemaVersion: 5, courses: [{ id: 'course-keep' }] }
  storage.set('timetable_courses', structuredClone(courseStorage))
  const id = todoStorage.saveTodo({
    title: '  整理复习计划  ',
    note: '  列出三个重点  ',
    dueDate: '2026-09-14',
    scheduleDate: '2026-09-13',
    scheduleStartTime: '13:00',
    scheduleEndTime: '14:00',
  })
  let snapshot = todoStorage.getTodoSnapshot()
  assert.equal(snapshot.kind, 'current')
  assert.equal(snapshot.data.items.length, 1)
  assert.deepEqual(
    {
      title: snapshot.data.items[0].title,
      note: snapshot.data.items[0].note,
      dueDate: snapshot.data.items[0].dueDate,
      scheduleDate: snapshot.data.items[0].scheduleDate,
      scheduleStartTime: snapshot.data.items[0].scheduleStartTime,
      scheduleEndTime: snapshot.data.items[0].scheduleEndTime,
    },
    {
      title: '整理复习计划',
      note: '列出三个重点',
      dueDate: '2026-09-14',
      scheduleDate: '2026-09-13',
      scheduleStartTime: '13:00',
      scheduleEndTime: '14:00',
    },
  )

  todoStorage.saveTodo({ id, title: '整理本周复习计划', note: '', dueDate: '' })
  todoStorage.toggleTodo(id)
  snapshot = todoStorage.getTodoSnapshot()
  assert.equal(snapshot.kind, 'current')
  assert.equal(snapshot.data.items[0].completed, true)
  assert.ok(snapshot.data.items[0].completedAt)

  todoStorage.toggleTodo(id)
  assert.equal(todoStorage.getTodoSnapshot().data.items[0].completed, false)
  todoStorage.removeTodo(id)
  assert.deepEqual(todoStorage.getTodoSnapshot().data.items, [])
  assert.deepEqual(storage.get('timetable_courses'), courseStorage)
})

test('V1 待办只在内存补齐执行时间，并在下一次写入时安全升级为 V2', () => {
  const legacy = {
    schemaVersion: 1,
    items: [{
      id: 'legacy-1',
      title: '旧待办',
      note: '保持原内容',
      dueDate: '2026-09-20',
      completed: false,
      createdAt: 10,
      updatedAt: 10,
      completedAt: null,
    }],
  }
  storage = new Map([[todoStorage.TODO_STORAGE_KEY, structuredClone(legacy)]])

  const snapshot = todoStorage.getTodoSnapshot()
  assert.equal(snapshot.kind, 'current')
  assert.equal(snapshot.data.schemaVersion, 2)
  assert.deepEqual(
    {
      scheduleDate: snapshot.data.items[0].scheduleDate,
      scheduleStartTime: snapshot.data.items[0].scheduleStartTime,
      scheduleEndTime: snapshot.data.items[0].scheduleEndTime,
    },
    { scheduleDate: '', scheduleStartTime: '', scheduleEndTime: '' },
  )
  assert.deepEqual(storage.get(todoStorage.TODO_STORAGE_KEY), legacy)

  todoStorage.toggleTodo('legacy-1')
  const upgraded = storage.get(todoStorage.TODO_STORAGE_KEY)
  assert.equal(upgraded.schemaVersion, 2)
  assert.equal(upgraded.items[0].completed, true)
  assert.equal(upgraded.items[0].title, '旧待办')
})

test('V1 升级写入失败时恢复完全一致的原始数据', () => {
  const legacy = {
    schemaVersion: 1,
    items: [{
      id: 'legacy-rollback',
      title: '保留旧数据',
      note: '',
      dueDate: '',
      completed: false,
      createdAt: 1,
      updatedAt: 1,
      completedAt: null,
    }],
  }
  storage = new Map([[todoStorage.TODO_STORAGE_KEY, structuredClone(legacy)]])
  failWrites = 1

  assert.throws(() => todoStorage.toggleTodo('legacy-rollback'), /原数据已恢复/)
  assert.deepEqual(storage.get(todoStorage.TODO_STORAGE_KEY), legacy)
})

test('执行时间必须完整、合法且在同一天内递增', () => {
  reset()
  assert.throws(
    () => todoStorage.saveTodo({ title: '字段不完整', scheduleDate: '2026-09-14' }),
    /完整选择/,
  )
  assert.throws(
    () => todoStorage.saveTodo({
      title: '非法日期',
      scheduleDate: '2026-02-30',
      scheduleStartTime: '13:00',
      scheduleEndTime: '14:00',
    }),
    /执行日期格式无效/,
  )
  assert.throws(
    () => todoStorage.saveTodo({
      title: '非法时间',
      scheduleDate: '2026-09-14',
      scheduleStartTime: '25:00',
      scheduleEndTime: '26:00',
    }),
    /执行时间格式无效/,
  )
  assert.throws(
    () => todoStorage.saveTodo({
      title: '相同时间',
      scheduleDate: '2026-09-14',
      scheduleStartTime: '13:00',
      scheduleEndTime: '13:00',
    }),
    /结束时间必须晚于开始时间/,
  )
  assert.throws(
    () => todoStorage.saveTodo({
      title: '跨越午夜',
      scheduleDate: '2026-09-14',
      scheduleStartTime: '23:00',
      scheduleEndTime: '01:00',
    }),
    /结束时间必须晚于开始时间/,
  )
})

test('执行日晚于截止日时产生警告，但确认后仍允许存储', () => {
  reset()
  const draft = {
    title: '完成作业',
    dueDate: '2026-09-14',
    scheduleDate: '2026-09-15',
    scheduleStartTime: '13:00',
    scheduleEndTime: '14:00',
  }
  assert.match(todoStorage.getTodoDraftWarning(draft), /晚于截止日期/)
  const id = todoStorage.saveTodo(draft)
  assert.equal(todoStorage.getTodoById(id).scheduleDate, '2026-09-15')
})

test('损坏或更高版本的待办数据保持只读且不会被清洗', () => {
  const corrupt = { schemaVersion: 1, items: [{ id: 'bad' }] }
  storage = new Map([[todoStorage.TODO_STORAGE_KEY, structuredClone(corrupt)]])
  assert.equal(todoStorage.getTodoSnapshot().kind, 'corrupt')
  assert.throws(() => todoStorage.saveTodo({ title: '不能覆盖' }), /停止写入/)
  assert.deepEqual(storage.get(todoStorage.TODO_STORAGE_KEY), corrupt)

  const future = { schemaVersion: 9, items: [] }
  storage = new Map([[todoStorage.TODO_STORAGE_KEY, structuredClone(future)]])
  assert.equal(todoStorage.getTodoSnapshot().kind, 'unsupported')
  assert.throws(() => todoStorage.removeTodo('anything'), /V9/)
  assert.deepEqual(storage.get(todoStorage.TODO_STORAGE_KEY), future)

  const partialSchedule = {
    schemaVersion: 2,
    items: [todoItem({ scheduleDate: '2026-09-14' })],
  }
  storage = new Map([[todoStorage.TODO_STORAGE_KEY, structuredClone(partialSchedule)]])
  assert.equal(todoStorage.getTodoSnapshot().kind, 'corrupt')
  assert.throws(() => todoStorage.toggleTodo('todo-1'), /停止写入/)
  assert.deepEqual(storage.get(todoStorage.TODO_STORAGE_KEY), partialSchedule)
})

test('首次写入失败时恢复为无待办状态', () => {
  reset()
  failWrites = 1
  assert.throws(() => todoStorage.saveTodo({ title: '写入失败' }), /原数据已恢复/)
  assert.equal(storage.has(todoStorage.TODO_STORAGE_KEY), false)
})

test('待办页面与原课表通过原生底部入口切换', () => {
  const appConfig = JSON.parse(readFileSync(new URL('../miniprogram/app.json', import.meta.url), 'utf8'))
  const todoMarkup = readFileSync(new URL('../miniprogram/pages/todo/index.wxml', import.meta.url), 'utf8')
  const editorMarkup = readFileSync(new URL('../miniprogram/pages/todo-edit/index.wxml', import.meta.url), 'utf8')
  const editorScript = readFileSync(new URL('../miniprogram/pages/todo-edit/index.ts', import.meta.url), 'utf8')

  assert.equal(definitions.length, 2)
  assert.deepEqual(
    appConfig.tabBar.list.map((item) => [item.pagePath, item.text]),
    [['pages/timetable/index', '课表'], ['pages/todo/index', '待办']],
  )
  assert.ok(appConfig.pages.includes('pages/todo/index'))
  assert.ok(appConfig.pages.includes('pages/todo-edit/index'))
  assert.match(todoMarkup, /待完成/)
  assert.match(todoMarkup, /已完成/)
  assert.match(todoMarkup, /bindtap="onToggle"/)
  assert.match(todoMarkup, /bindtap="onMore"/)
  assert.match(editorMarkup, /待办标题/)
  assert.match(editorMarkup, /截止日期/)
  assert.match(editorMarkup, /选择日期/)
  assert.doesNotMatch(editorMarkup, /dueDate \|\| '不设置'/)
  assert.match(editorMarkup, /计划执行时间/)
  assert.match(editorMarkup, /mode="time"/)
  assert.match(editorMarkup, /bindtap="onClearSchedule"/)
  assert.match(editorScript, /cancelText: '返回修改'/)
  assert.match(editorScript, /confirmText: '仍然保存'/)
  assert.match(editorMarkup, /备注/)
})

test('待完成列表按执行时间优先排序并展示日期、错过状态和今日概览', () => {
  const now = new Date()
  const today = dateKey(now)
  const yesterday = offsetDateKey(now, -1)
  const tomorrow = offsetDateKey(now, 1)
  const nextYear = now.getFullYear() + 1
  const crossYear = `${nextYear}-06-15`
  storage = new Map([[todoStorage.TODO_STORAGE_KEY, {
    schemaVersion: 2,
    items: [
      todoItem({ id: 'no-date', title: '没有日期', createdAt: 6 }),
      todoItem({ id: 'due-only', title: '今天截止', dueDate: today, createdAt: 5 }),
      todoItem({ id: 'cross-year', title: '跨年计划', scheduleDate: crossYear, scheduleStartTime: '10:00', scheduleEndTime: '11:00', createdAt: 4 }),
      todoItem({ id: 'tomorrow', title: '明天计划', scheduleDate: tomorrow, scheduleStartTime: '13:00', scheduleEndTime: '14:00', createdAt: 3 }),
      todoItem({ id: 'today', title: '今天计划', scheduleDate: today, scheduleStartTime: '13:00', scheduleEndTime: '14:00', createdAt: 2 }),
      todoItem({ id: 'missed', title: '错过计划', scheduleDate: yesterday, scheduleStartTime: '13:00', scheduleEndTime: '14:00', createdAt: 1 }),
    ],
  }]])
  const context = {
    data: { filter: 'pending' },
    setData(changes) { Object.assign(this.data, changes) },
  }

  todoPage.refresh.call(context)

  assert.deepEqual(
    context.data.visibleItems.map((item) => item.id),
    ['missed', 'today', 'tomorrow', 'cross-year', 'due-only', 'no-date'],
  )
  assert.match(context.data.visibleItems.find((item) => item.id === 'missed').scheduleText, /^计划时间已过/)
  assert.match(context.data.visibleItems.find((item) => item.id === 'today').scheduleText, /今天 13:00–14:00/)
  assert.match(context.data.visibleItems.find((item) => item.id === 'tomorrow').scheduleText, /明天 13:00–14:00/)
  assert.match(context.data.visibleItems.find((item) => item.id === 'cross-year').scheduleText, new RegExp(`${nextYear}年6月15日`))
  assert.match(context.data.overviewText, /今天计划 1 项/)
  assert.match(context.data.overviewText, /今天截止 1 项/)
})

test('已完成待办保持完成时间排序且执行时间不再标记为错过', () => {
  const yesterday = offsetDateKey(new Date(), -1)
  storage = new Map([[todoStorage.TODO_STORAGE_KEY, {
    schemaVersion: 2,
    items: [
      todoItem({ id: 'completed-old', completed: true, completedAt: 10, scheduleDate: yesterday, scheduleStartTime: '09:00', scheduleEndTime: '10:00' }),
      todoItem({ id: 'completed-new', completed: true, completedAt: 20, scheduleDate: yesterday, scheduleStartTime: '11:00', scheduleEndTime: '12:00' }),
    ],
  }]])
  const context = {
    data: { filter: 'completed' },
    setData(changes) { Object.assign(this.data, changes) },
  }

  todoPage.refresh.call(context)

  assert.deepEqual(context.data.visibleItems.map((item) => item.id), ['completed-new', 'completed-old'])
  assert.ok(context.data.visibleItems.every((item) => item.scheduleTone === 'normal'))
  assert.ok(context.data.visibleItems.every((item) => !item.scheduleText.includes('计划时间已过')))
})

test('编辑页可清除执行时间，并在日期矛盾时等待用户确认后再保存', () => {
  reset()
  let modalOptions
  let toastTitle = ''
  let navigatedBack = false
  globalThis.wx.showModal = (options) => { modalOptions = options }
  globalThis.wx.showToast = (options) => { toastTitle = options.title }
  globalThis.wx.navigateBack = () => { navigatedBack = true }
  const context = {
    data: {
      id: '',
      isEdit: false,
      title: '完成作业',
      note: '',
      dueDate: '2026-09-14',
      scheduleExpanded: true,
      scheduleDate: '2026-09-15',
      scheduleStartTime: '13:00',
      scheduleEndTime: '14:00',
      saving: false,
    },
    setData(changes) { Object.assign(this.data, changes) },
    showSaveError: todoEditPage.showSaveError,
    persistTodo: todoEditPage.persistTodo,
  }

  todoEditPage.onSave.call(context)
  assert.equal(modalOptions.title, '确认执行时间')
  assert.equal(context.data.saving, true)
  assert.equal(storage.has(todoStorage.TODO_STORAGE_KEY), false)
  modalOptions.success({ confirm: false })
  assert.equal(context.data.saving, false)

  todoEditPage.onSave.call(context)
  modalOptions.success({ confirm: true })
  assert.equal(storage.get(todoStorage.TODO_STORAGE_KEY).items[0].scheduleDate, '2026-09-15')
  assert.equal(toastTitle, '待办已创建')
  assert.equal(navigatedBack, true)

  todoEditPage.onClearSchedule.call(context)
  assert.deepEqual(
    {
      scheduleExpanded: context.data.scheduleExpanded,
      scheduleDate: context.data.scheduleDate,
      scheduleStartTime: context.data.scheduleStartTime,
      scheduleEndTime: context.data.scheduleEndTime,
      scheduleStartPickerValue: context.data.scheduleStartPickerValue,
      scheduleEndPickerValue: context.data.scheduleEndPickerValue,
    },
    {
      scheduleExpanded: false,
      scheduleDate: '',
      scheduleStartTime: '',
      scheduleEndTime: '',
      scheduleStartPickerValue: '09:00',
      scheduleEndPickerValue: '10:00',
    },
  )
})
