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

function reset() {
  storage = new Map()
  failWrites = 0
}

test('待办可完成新增、编辑、完成状态切换和删除闭环', () => {
  reset()
  const courseStorage = { schemaVersion: 5, courses: [{ id: 'course-keep' }] }
  storage.set('timetable_courses', structuredClone(courseStorage))
  const id = todoStorage.saveTodo({
    title: '  整理复习计划  ',
    note: '  列出三个重点  ',
    dueDate: '2026-09-14',
  })
  let snapshot = todoStorage.getTodoSnapshot()
  assert.equal(snapshot.kind, 'current')
  assert.equal(snapshot.data.items.length, 1)
  assert.deepEqual(
    { title: snapshot.data.items[0].title, note: snapshot.data.items[0].note, dueDate: snapshot.data.items[0].dueDate },
    { title: '整理复习计划', note: '列出三个重点', dueDate: '2026-09-14' },
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
  assert.match(editorMarkup, /备注/)
})
