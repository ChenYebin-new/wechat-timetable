import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, test } from 'node:test'
import './helpers/register-typescript.mjs'

const RealDate = globalThis.Date
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
const definitions = []
const contexts = new Set()
let now = new RealDate(2026, 8, 16, 12).getTime()
let timers = new Map()
let timerId = 0
let storage = new Map()
let failWrites = 0
let failReads = false
let reads = 0
let writes = 0
let modals = []
let actionSheets = []
let toasts = []
let navigation = []
let scene = 1001

class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(now)
    else super(...args)
  }

  static now() { return now }
}

function installClock() {
  globalThis.Date = FixedDate
  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const id = ++timerId
    timers.set(id, { callback, args, at: now + Math.max(1, Number(delay) || 0), interval: 0 })
    return id
  }
  globalThis.clearTimeout = (id) => timers.delete(id)
  globalThis.setInterval = (callback, delay = 0, ...args) => {
    const id = ++timerId
    const interval = Math.max(1, Number(delay) || 0)
    timers.set(id, { callback, args, at: now + interval, interval })
    return id
  }
  globalThis.clearInterval = (id) => timers.delete(id)
}

function setClock(year, month, day, hour = 12, minute = 0, second = 0) {
  now = new RealDate(year, month - 1, day, hour, minute, second).getTime()
}

function advance(milliseconds) {
  const end = now + milliseconds
  let iterations = 0
  while (true) {
    const next = [...timers.entries()]
      .filter(([, timer]) => timer.at <= end)
      .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
    if (!next) break
    assert.ok(++iterations < 10000, 'fake timers must not loop indefinitely')
    const [id, timer] = next
    now = Math.max(now, timer.at)
    if (timer.interval) timers.set(id, { ...timer, at: now + timer.interval })
    else timers.delete(id)
    timer.callback(...timer.args)
  }
  now = end
}

function installWx() {
  globalThis.wx = {
    getStorageSync(key) {
      reads += 1
      if (failReads) throw new Error('simulated read failure')
      return storage.has(key) ? structuredClone(storage.get(key)) : ''
    },
    setStorageSync(key, value) {
      writes += 1
      if (failWrites > 0) {
        failWrites -= 1
        throw new Error('simulated write failure')
      }
      storage.set(key, structuredClone(value))
    },
    removeStorageSync(key) { storage.delete(key) },
    showModal(options) { modals.push(options) },
    showActionSheet(options) { actionSheets.push(options) },
    showToast(options) { toasts.push(options) },
    getEnterOptionsSync() { return { scene } },
    showShareMenu() {},
    navigateTo(options) { navigation.push(options.url) },
    switchTab(options) { navigation.push(options.url) },
    reLaunch(options) { navigation.push(options.url) },
  }
}

globalThis.Page = (definition) => definitions.push(definition)
installClock()
installWx()
const todoStorage = await import('../miniprogram/services/todo-storage.ts')
await import('../miniprogram/pages/todo/index.ts')
const todoPage = definitions[0]
globalThis.Date = RealDate
globalThis.setTimeout = realSetTimeout
globalThis.clearTimeout = realClearTimeout
globalThis.setInterval = realSetInterval
globalThis.clearInterval = realClearInterval

beforeEach(() => {
  setClock(2026, 9, 16)
  timers = new Map()
  timerId = 0
  storage = new Map()
  failWrites = 0
  failReads = false
  reads = 0
  writes = 0
  modals = []
  actionSheets = []
  toasts = []
  navigation = []
  scene = 1001
  contexts.clear()
  installClock()
  installWx()
})

afterEach(() => {
  try {
    failWrites = 0
    failReads = false
    for (const context of contexts) context.onHide()
    assert.equal(timers.size, 0, 'all page and autosave timers must be cleared on hide')
  } finally {
    contexts.clear()
    timers.clear()
    globalThis.Date = RealDate
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
  }
})

function todoItem(overrides = {}) {
  return {
    id: 'todo-1',
    title: '完成作业',
    note: '',
    taskDate: '2026-09-16',
    completed: false,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    ...overrides,
  }
}

function seed(items = [], dailyNotes = []) {
  storage.set(todoStorage.TODO_STORAGE_KEY, { schemaVersion: 3, items, dailyNotes })
}

function stored() { return structuredClone(storage.get(todoStorage.TODO_STORAGE_KEY)) }
function input(value) { return { detail: { value } } }
function touch(id) { return { currentTarget: { dataset: { id } } } }
function calendarTouch(date) { return { currentTarget: { dataset: { date } } } }
function choose(context, date) { context.onChooseDate(input(date)) }

function pageContext(show = true) {
  const context = {}
  for (const [key, value] of Object.entries(todoPage)) {
    context[key] = typeof value === 'function' ? value : structuredClone(value)
  }
  context.setData = function setData(changes) { Object.assign(this.data, changes) }
  contexts.add(context)
  context.onLoad({})
  if (show) context.onShow()
  return context
}

function confirmLast(confirm) {
  assert.ok(modals.length, 'an explicit confirmation modal is required')
  modals.at(-1).success({ confirm, cancel: !confirm })
}

test('待办沿用原生课表入口并在单页提供日期、目标和随想，不再注册旧编辑页', () => {
  const config = JSON.parse(readFileSync(new URL('../miniprogram/app.json', import.meta.url), 'utf8'))
  const markup = readFileSync(new URL('../miniprogram/pages/todo/index.wxml', import.meta.url), 'utf8')
  const script = readFileSync(new URL('../miniprogram/pages/todo/index.ts', import.meta.url), 'utf8')
  assert.equal(definitions.length, 1)
  assert.deepEqual(config.tabBar.list.map((item) => [item.pagePath, item.text]), [
    ['pages/timetable/index', '课表'], ['pages/todo/index', '待办'],
  ])
  assert.ok(config.pages.includes('pages/todo/index'))
  assert.ok(!config.pages.includes('pages/todo-edit/index'))
  assert.match(markup, /mode="date"/)
  assert.match(markup, /bindchange="onChooseDate"/)
  assert.match(markup, /bindtap="onPreviousDate"/)
  assert.match(markup, /bindtap="onNextDate"/)
  assert.match(`${markup}\n${script}`, /今日目标/)
  assert.match(markup, /随想记录/)
  assert.match(markup, /onSaveGoal/)
  assert.match(markup, /onDailyNoteInput/)
  assert.match(markup, /maxlength="60"/)
  assert.match(markup, /maxlength="200"/)
  assert.match(markup, /maxlength="2000"/)
  assert.doesNotMatch(markup, /mode="time"|截止日期|执行时间|自律养成|todo-edit/)
  assert.doesNotMatch(script, /getTodoDraftWarning|todo-edit/)
})

test('日期和目标文字由普通view插槽承担伸缩，原生控件显式定宽且星期不竖排', () => {
  const markup = readFileSync(new URL('../miniprogram/pages/todo/index.wxml', import.meta.url), 'utf8')
  const stylesheet = readFileSync(new URL('../miniprogram/pages/todo/index.wxss', import.meta.url), 'utf8')
  assert.match(markup, /<view\b[^>]*class="[^"]*\bdate-picker-slot\b[^"]*"[^>]*>\s*<picker\b/)
  assert.match(markup, /<view\b[^>]*class="[^"]*\btodo-content-slot\b[^"]*"[^>]*>\s*<button\b/)
  const rules = [...stylesheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const cssFor = (className) => {
    const declarations = rules
      .filter((rule) => rule[1].split(',').some((selector) => selector.trim() === `.${className}`))
      .map((rule) => rule[2]).join('\n')
    assert.ok(declarations, `${className} must have explicit layout rules`)
    return declarations
  }
  for (const className of ['date-picker-slot', 'todo-content-slot']) {
    assert.match(cssFor(className), /\bflex:\s*1\s*;/)
    assert.match(cssFor(className), /\bmin-width:\s*0\s*;/)
  }
  assert.doesNotMatch(cssFor('date-picker'), /\bflex:\s*1\b/)
  assert.doesNotMatch(cssFor('todo-content'), /\bflex:\s*1\b/)
  const nativeTags = [...markup.matchAll(/<(button|picker)\b([^>]*?)>/g)]
  for (const [className, expectedCount, width] of [
    ['date-arrow', 2, '88rpx'],
    ['check-control', 1, '88rpx'],
    ['more-control', 1, '72rpx'],
    ['date-picker', 1, '100%'],
    ['todo-content', 1, '100%'],
  ]) {
    const controls = nativeTags.filter((tag) => {
      const classes = tag[2].match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) || []
      return classes.includes(className)
    })
    assert.equal(controls.length, expectedCount, `${className} native controls must remain present`)
    for (const control of controls) {
      const style = control[2].match(/\bstyle="([^"]*)"/)?.[1] || ''
      assert.match(style, new RegExp(`(?:^|;)\\s*width:\\s*${width}(?:\\s*;|\\s*$)`), `${className} must not use native default width`)
    }
  }
  const weekday = cssFor('weekday-label')
  assert.match(weekday, /\bdisplay:\s*block\s*;/)
  assert.match(weekday, /\bwidth:\s*100%\s*;/)
  assert.match(weekday, /\bwhite-space:\s*nowrap\s*;/)
  assert.match(weekday, /\btext-align:\s*center\s*;/)
})

test('多条目标含长中文和备注时refresh保留标题绑定，勾选只更新对应ID且不制造空任务', () => {
  const items = [
    todoItem({ id: 'long-goal', title: '复习概率论与数理统计并整理今天课程的关键知识点和容易出错的例题步骤', note: '先复习条件概率，再检查每道例题的推导。\n保留完整中文备注和换行。', createdAt: 1 }),
    todoItem({ id: 'plain-goal', title: '整理本周课程笔记', note: '', createdAt: 2 }),
    todoItem({ id: 'completed-goal', title: '完成英语听力练习', note: '已核对答案', completed: true, completedAt: 4, createdAt: 3 }),
  ]
  seed(items)
  const previous = stored()
  const course = { schemaVersion: 5, courses: [{ id: 'preserve-course' }] }
  storage.set('timetable_courses', structuredClone(course))
  const context = pageContext()
  context.refresh()
  const content = (entries) => entries.map(({ id, title, note }) => ({ id, title, note }))
  assert.deepEqual(content(context.data.visibleItems), content(items))
  assert.equal(context.data.totalCount, 3)
  assert.equal(context.data.completedCount, 1)
  assert.equal(writes, 0)
  assert.deepEqual(stored(), previous)
  const markup = readFileSync(new URL('../miniprogram/pages/todo/index.wxml', import.meta.url), 'utf8')
  assert.match(markup, /<text\b[^>]*class="todo-title"[^>]*>\s*{{item\.title}}\s*<\/text>/)
  assert.match(markup, /<text\b[^>]*class="todo-note"[^>]*>\s*{{item\.note}}\s*<\/text>/)
  const checkbox = [...markup.matchAll(/<button\b([^>]*?)>/g)]
    .find((tag) => /class="[^"]*\bcheck-control\b[^"]*"/.test(tag[1]))
  assert.ok(checkbox, 'the goal checkbox must remain in the row')
  assert.match(checkbox[1], /data-id="{{item\.id}}"/)
  assert.match(checkbox[1], /bindtap="onToggle"/)
  context.onToggle(touch('long-goal'))
  assert.equal(stored().items.length, 3)
  assert.deepEqual(content(stored().items), content(items))
  assert.equal(stored().items.find((item) => item.id === 'long-goal').completed, true)
  assert.equal(stored().items.find((item) => item.id === 'plain-goal').completed, false)
  assert.equal(stored().items.find((item) => item.id === 'completed-goal').completed, true)
  assert.ok(stored().items.every((item) => item.title.trim()))
  assert.equal(context.data.totalCount, 3)
  assert.equal(context.data.completedCount, 2)
  assert.deepEqual(storage.get('timetable_courses'), course)
})

test('首次显示以实际本地今天为选中日期，并显示星期和当天完成数', () => {
  seed([todoItem(), todoItem({ id: 'done', completed: true, completedAt: 2 })])
  const context = pageContext()
  assert.equal(context.data.selectedDate, '2026-09-16')
  assert.equal(context.data.dateLabel, '2026年9月16日')
  assert.equal(context.data.weekdayLabel, '星期三')
  assert.equal(context.data.isToday, true)
  assert.equal(context.data.sectionTitle, '今日目标')
  assert.equal(context.data.completedCount, 1)
  assert.equal(context.data.totalCount, 2)
})

test('直接选日和前后箭头正确跨越月末、年末与闰日，回到今天使用当前实际日期', () => {
  seed()
  const context = pageContext()
  for (const [date, next] of [
    ['2026-01-31', '2026-02-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-02-28', '2028-02-29'],
    ['2028-02-29', '2028-03-01'],
  ]) {
    choose(context, date)
    context.onNextDate()
    assert.equal(context.data.selectedDate, next)
    context.onPreviousDate()
    assert.equal(context.data.selectedDate, date)
    assert.equal(context.data.isToday, false)
  }
  setClock(2026, 9, 17)
  context.onToday()
  assert.equal(context.data.selectedDate, '2026-09-17')
  assert.equal(context.data.isToday, true)
})

test('目标仅显示选定日期，未完成在前、已完成在后，组内按创建顺序', () => {
  seed([
    todoItem({ id: 'done-new', completed: true, completedAt: 50, createdAt: 4 }),
    todoItem({ id: 'pending-new', createdAt: 3 }),
    todoItem({ id: 'other-day', taskDate: '2026-09-17', createdAt: 0 }),
    todoItem({ id: 'done-old', completed: true, completedAt: 100, createdAt: 2 }),
    todoItem({ id: 'pending-old', createdAt: 1 }),
  ])
  const context = pageContext()
  assert.deepEqual(context.data.visibleItems.map((item) => item.id), [
    'pending-old', 'pending-new', 'done-old', 'done-new',
  ])
  assert.equal(context.data.completedCount, 2)
  assert.equal(context.data.totalCount, 4)
  choose(context, '2026-09-17')
  assert.deepEqual(context.data.visibleItems.map((item) => item.id), ['other-day'])
  assert.equal(context.data.completedCount, 0)
  assert.equal(context.data.totalCount, 1)
})

test('过期按实际今天派生，刷新不删、不顺延、不写盘，历史目标仍可补完成', () => {
  seed([
    todoItem({ id: 'expired', taskDate: '2026-09-15' }),
    todoItem({ id: 'completed', taskDate: '2026-09-15', completed: true, completedAt: 2 }),
    todoItem({ id: 'today' }),
  ])
  const previous = stored()
  const context = pageContext()
  choose(context, '2026-09-15')
  assert.equal(context.data.visibleItems.find((item) => item.id === 'expired').expired, true)
  assert.equal(context.data.visibleItems.find((item) => item.id === 'completed').expired, false)
  assert.equal(writes, 0)
  assert.deepEqual(stored(), previous)
  context.onToggle(touch('expired'))
  assert.equal(stored().items.find((item) => item.id === 'expired').completed, true)
  assert.equal(context.data.visibleItems.find((item) => item.id === 'expired').expired, false)
  assert.equal(context.data.completedCount, 2)
  assert.equal(stored().items.find((item) => item.id === 'expired').taskDate, '2026-09-15')
  choose(context, '2026-09-16')
  assert.equal(context.data.visibleItems[0].expired, false)
})

test('新建目标在单页打开，日期绑定打开时选日，标题必填而备注按需展开', () => {
  seed()
  const course = { schemaVersion: 5, courses: [{ id: 'preserve-course' }] }
  storage.set('timetable_courses', structuredClone(course))
  const context = pageContext()
  choose(context, '2026-09-15')
  context.onAdd()
  assert.equal(context.data.editorOpen, true)
  assert.equal(context.data.editorDate, '2026-09-15')
  assert.equal(context.data.noteExpanded, false)
  context.onTitle(input('  整理复习计划  '))
  context.onExpandNote()
  assert.equal(context.data.noteExpanded, true)
  context.onNote(input('  列出三个重点  '))
  context.onSaveGoal()
  assert.equal(context.data.editorOpen, false)
  assert.equal(stored().items.length, 1)
  assert.equal(stored().items[0].title, '整理复习计划')
  assert.equal(stored().items[0].note, '列出三个重点')
  assert.equal(stored().items[0].taskDate, '2026-09-15')
  assert.equal(stored().items[0].completed, false)
  assert.deepEqual(storage.get('timetable_courses'), course)
  assert.deepEqual(navigation, [])
})

test('编辑特殊字符ID无需跳页，回显既有备注且保持目标日期和完成状态', () => {
  const id = 'todo&id=?#一'
  seed([todoItem({ id, note: '已有备注', taskDate: '2026-09-15', completed: true, completedAt: 2 })])
  const context = pageContext()
  choose(context, '2026-09-15')
  context.onEdit(touch(id))
  assert.equal(context.data.editorId, id)
  assert.equal(context.data.title, '完成作业')
  assert.equal(context.data.note, '已有备注')
  assert.equal(context.data.noteExpanded, true)
  context.onTitle(input('修改后的目标'))
  context.onSaveGoal()
  assert.equal(stored().items[0].id, id)
  assert.equal(stored().items[0].title, '修改后的目标')
  assert.equal(stored().items[0].note, '已有备注')
  assert.equal(stored().items[0].taskDate, '2026-09-15')
  assert.equal(stored().items[0].completed, true)
  assert.deepEqual(navigation, [])
})

test('空标题、超长标题和备注不写入，错误保留编辑草稿', () => {
  seed()
  const context = pageContext()
  context.onAdd()
  for (const [title, note] of [['   ', ''], ['字'.repeat(61), ''], ['有效目标', '字'.repeat(201)]]) {
    context.onTitle(input(title))
    context.onNote(input(note))
    context.onSaveGoal()
    assert.equal(context.data.editorOpen, true)
    assert.equal(context.data.savingGoal, false)
    assert.ok(context.data.goalProblem)
    assert.equal(stored().items.length, 0)
  }
  assert.equal(writes, 0)
})

test('有目标草稿时切日期须确认放弃，取消保留草稿，确认后才切日', () => {
  seed()
  const context = pageContext()
  context.onAdd()
  context.onTitle(input('未保存的目标'))
  choose(context, '2026-09-17')
  assert.equal(context.data.selectedDate, '2026-09-16')
  confirmLast(false)
  assert.equal(context.data.editorOpen, true)
  assert.equal(context.data.title, '未保存的目标')
  assert.equal(context.data.editorDate, '2026-09-16')
  choose(context, '2026-09-17')
  confirmLast(true)
  assert.equal(context.data.selectedDate, '2026-09-17')
  assert.equal(context.data.editorOpen, false)
  assert.equal(stored().items.length, 0)
})

test('取消空编辑器关闭面板但不创建任务', () => {
  seed()
  const context = pageContext()
  context.onAdd()
  context.onCancelEditor()
  assert.equal(context.data.editorOpen, false)
  assert.equal(stored().items.length, 0)
})

test('更多菜单支持原位编辑，删除在确认前不写盘', () => {
  seed([todoItem()])
  const context = pageContext()
  context.onMore(touch('todo-1'))
  assert.deepEqual(actionSheets.at(-1).itemList, ['编辑', '删除'])
  actionSheets.at(-1).success({ tapIndex: 0 })
  assert.equal(context.data.editorOpen, true)
  context.onCancelEditor()
  context.onMore(touch('todo-1'))
  actionSheets.at(-1).success({ tapIndex: 1 })
  assert.equal(stored().items.length, 1)
  confirmLast(false)
  assert.equal(stored().items.length, 1)
  context.onMore(touch('todo-1'))
  actionSheets.at(-1).success({ tapIndex: 1 })
  confirmLast(true)
  assert.equal(stored().items.length, 0)
  assert.equal(context.data.totalCount, 0)
})

test('目标写入失败保留原数据和草稿，不误报保存成功', () => {
  seed([todoItem()])
  const previous = stored()
  const context = pageContext()
  context.onEdit(touch('todo-1'))
  context.onTitle(input('需要重试的目标'))
  failWrites = 1
  context.onSaveGoal()
  assert.deepEqual(stored(), previous)
  assert.equal(context.data.editorOpen, true)
  assert.equal(context.data.title, '需要重试的目标')
  assert.equal(context.data.savingGoal, false)
  assert.ok(context.data.goalProblem)
  assert.equal(toasts.length, 0)
})

for (const [label, unsafeRaw] of [
  ['V9未知版本', { schemaVersion: 9, items: [], dailyNotes: [] }],
  ['损坏数据', { schemaVersion: 3, items: [{ id: 'bad' }], dailyNotes: [] }],
]) {
  test(`显示后外部改为${label}时目标保存失败立即禁写，保留编辑字段且恢复后可重试`, () => {
    seed([todoItem({ note: '原备注' })], [{ date: '2026-09-16', content: '原随想', updatedAt: 1 }])
    const valid = stored()
    const course = { schemaVersion: 5, courses: [{ id: 'preserve-course' }] }
    storage.set('timetable_courses', structuredClone(course))
    const context = pageContext()
    assert.equal(context.data.storageProblem, '')
    context.onEdit(touch('todo-1'))
    context.onTitle(input('保留失败目标标题'))
    context.onNote(input('保留失败目标备注'))
    context.onDailyNoteInput(input('原日尚未保存的随想'))
    const editor = {
      id: context.data.editorId,
      date: context.data.editorDate,
      title: context.data.title,
      note: context.data.note,
    }
    storage.set(todoStorage.TODO_STORAGE_KEY, structuredClone(unsafeRaw))
    const before = writes
    context.onSaveGoal()
    assert.ok(context.data.storageProblem)
    assert.ok(context.data.goalProblem)
    assert.equal(context.data.savingGoal, false)
    assert.equal(context.data.editorOpen, true)
    assert.deepEqual({
      id: context.data.editorId,
      date: context.data.editorDate,
      title: context.data.title,
      note: context.data.note,
    }, editor)
    assert.equal(context.data.dailyNote, '原日尚未保存的随想')
    assert.equal(context.data.dailyNoteDirty, true)
    context.onAdd()
    context.onTitle(input('不应覆盖目标标题'))
    context.onNote(input('不应覆盖目标备注'))
    context.onDailyNoteInput(input('不应覆盖原日随想'))
    context.onSaveGoal()
    assert.equal(context.flushDailyNote(), false)
    assert.equal(context.data.title, editor.title)
    assert.equal(context.data.note, editor.note)
    assert.equal(context.data.dailyNote, '原日尚未保存的随想')
    assert.equal(writes, before)
    assert.deepEqual(stored(), unsafeRaw)
    assert.deepEqual(storage.get('timetable_courses'), course)

    storage.set(todoStorage.TODO_STORAGE_KEY, structuredClone(valid))
    context.onRetry()
    assert.equal(context.data.storageProblem, '')
    assert.equal(context.data.editorOpen, true)
    assert.equal(context.data.title, editor.title)
    assert.equal(context.data.note, editor.note)
    assert.equal(stored().dailyNotes[0].content, '原日尚未保存的随想')
    context.onTitle(input('恢复后保存的目标'))
    context.onSaveGoal()
    assert.equal(context.data.editorOpen, false)
    assert.equal(stored().items[0].title, '恢复后保存的目标')
    assert.equal(stored().items[0].note, editor.note)
    assert.equal(stored().items[0].taskDate, editor.date)
    assert.deepEqual(storage.get('timetable_courses'), course)
  })

  test(`显示后外部改为${label}时随想flush失败立即禁写，保留原日草稿且恢复后可保存`, () => {
    seed([todoItem({ taskDate: '2026-09-15' })], [{ date: '2026-09-15', content: '历史原随想', updatedAt: 1 }])
    const valid = stored()
    const course = { schemaVersion: 5, courses: [{ id: 'preserve-course' }] }
    storage.set('timetable_courses', structuredClone(course))
    const context = pageContext()
    choose(context, '2026-09-15')
    assert.equal(context.data.storageProblem, '')
    context.onDailyNoteInput(input('历史原日失败草稿'))
    storage.set(todoStorage.TODO_STORAGE_KEY, structuredClone(unsafeRaw))
    const before = writes
    assert.equal(context.flushDailyNote(), false)
    assert.ok(context.data.storageProblem)
    assert.equal(context.data.noteSaveState, 'error')
    assert.equal(context.data.dailyNoteDirty, true)
    assert.equal(context.data.selectedDate, '2026-09-15')
    assert.equal(context.data.dailyNote, '历史原日失败草稿')
    context.onAdd()
    context.onTitle(input('禁写期间不应打开目标'))
    context.onDailyNoteInput(input('禁写期间不应覆盖草稿'))
    context.onSaveGoal()
    context.onDailyNoteBlur()
    assert.equal(context.data.editorOpen, false)
    assert.equal(context.data.title, '')
    assert.equal(context.data.dailyNote, '历史原日失败草稿')
    assert.equal(writes, before)
    assert.deepEqual(stored(), unsafeRaw)
    assert.deepEqual(storage.get('timetable_courses'), course)

    storage.set(todoStorage.TODO_STORAGE_KEY, structuredClone(valid))
    context.onRetry()
    assert.equal(context.data.storageProblem, '')
    assert.equal(context.data.selectedDate, '2026-09-15')
    assert.equal(context.data.dailyNoteDirty, false)
    assert.equal(context.data.noteSaveState, 'saved')
    assert.equal(stored().dailyNotes[0].date, '2026-09-15')
    assert.equal(stored().dailyNotes[0].content, '历史原日失败草稿')
    context.onAdd()
    assert.equal(context.data.editorOpen, true)
    context.onTitle(input('恢复后可新增目标'))
    context.onSaveGoal()
    assert.equal(stored().items.length, 2)
    assert.equal(stored().items[1].taskDate, '2026-09-15')
    assert.deepEqual(storage.get('timetable_courses'), course)
  })
}

test('损坏或未知版本禁用目标和随想变更，不覆盖原值', () => {
  for (const raw of [{ schemaVersion: 3, items: [{ id: 'bad' }], dailyNotes: [] }, { schemaVersion: 9, items: [] }]) {
    storage.set(todoStorage.TODO_STORAGE_KEY, structuredClone(raw))
    const context = pageContext()
    assert.ok(context.data.storageProblem)
    assert.deepEqual(context.data.visibleItems, [])
    assert.equal(context.data.totalCount, 0)
    assert.equal(context.data.completedCount, 0)
    const before = writes
    context.onAdd()
    context.onToggle(touch('bad'))
    context.onMore(touch('bad'))
    context.onDailyNoteInput(input('不能覆盖原数据'))
    context.onDailyNoteBlur()
    assert.equal(context.data.editorOpen, false)
    assert.equal(writes, before)
    assert.deepEqual(stored(), raw)
    context.onHide()
  }
})

test('重新读取失败会清空陈旧目标计数并呈现读取错误', () => {
  seed([todoItem()])
  const context = pageContext()
  failReads = true
  context.refresh()
  assert.deepEqual(context.data.visibleItems, [])
  assert.equal(context.data.totalCount, 0)
  assert.equal(context.data.completedCount, 0)
  assert.match(context.data.storageProblem, /读取.*失败/)
})

test('Todo页首次显示安全升级旧数据，未完成统一当天且再次显示不重复迁移', () => {
  storage.set(todoStorage.TODO_STORAGE_KEY, {
    schemaVersion: 1,
    items: [{ id: 'legacy', title: '旧未完成', note: '保留备注', dueDate: '2026-01-01', completed: false, createdAt: 1, updatedAt: 1, completedAt: null }],
  })
  const context = pageContext(false)
  assert.equal(stored().schemaVersion, 1)
  context.onShow()
  assert.equal(stored().schemaVersion, 3)
  assert.equal(stored().items[0].taskDate, '2026-09-16')
  assert.equal(stored().items[0].note, '保留备注')
  const afterMigration = writes
  context.onHide()
  setClock(2026, 9, 17)
  context.onShow()
  assert.equal(stored().items[0].taskDate, '2026-09-16')
  assert.equal(writes, afterMigration)
})

test('旧数据升级失败原样回滚且禁写，重新读取成功后恢复正常操作', () => {
  const legacy = {
    schemaVersion: 1,
    items: [{ id: 'legacy', title: '保留旧任务', note: '', dueDate: '', completed: false, createdAt: 1, updatedAt: 1, completedAt: null }],
  }
  storage.set(todoStorage.TODO_STORAGE_KEY, structuredClone(legacy))
  failWrites = 1
  const context = pageContext()
  assert.deepEqual(stored(), legacy)
  assert.ok(context.data.storageProblem)
  const failedWrites = writes
  context.onAdd()
  assert.equal(context.data.editorOpen, false)
  assert.equal(writes, failedWrites)
  context.onRetry()
  assert.equal(stored().schemaVersion, 3)
  assert.equal(context.data.storageProblem, '')
  assert.equal(context.data.visibleItems[0].id, 'legacy')
})

test('随想输入500毫秒后自动保存原文，保存前不显示已保存', () => {
  seed()
  const context = pageContext()
  const content = '今天的想法\n  保留空格和换行  '
  context.onDailyNoteInput(input(content))
  assert.equal(context.data.dailyNote, content)
  assert.equal(context.data.dailyNoteDirty, true)
  assert.notEqual(context.data.noteSaveState, 'saved')
  advance(499)
  assert.deepEqual(stored().dailyNotes, [])
  advance(1)
  assert.equal(stored().dailyNotes[0].date, '2026-09-16')
  assert.equal(stored().dailyNotes[0].content, content)
  assert.equal(context.data.dailyNoteDirty, false)
  assert.equal(context.data.noteSaveState, 'saved')
  assert.equal(context.data.noteSaveProblem, '')
})

test('连续随想输入重新开始debounce，只保存最新文字', () => {
  seed()
  const context = pageContext()
  context.onDailyNoteInput(input('第一段'))
  advance(300)
  context.onDailyNoteInput(input('最新一段'))
  advance(499)
  assert.deepEqual(stored().dailyNotes, [])
  advance(1)
  assert.equal(stored().dailyNotes[0].content, '最新一段')
  assert.equal(writes, 1)
})

test('切换日期立即保存原日随想，加载目标日记录且不会跨日期串写', () => {
  seed([], [{ date: '2026-09-17', content: '明天的已有记录', updatedAt: 1 }])
  const context = pageContext()
  context.onDailyNoteInput(input('今天的新记录'))
  choose(context, '2026-09-17')
  assert.equal(context.data.selectedDate, '2026-09-17')
  assert.equal(context.data.dailyNote, '明天的已有记录')
  assert.equal(context.data.dailyNoteDirty, false)
  assert.equal(stored().dailyNotes.find((note) => note.date === '2026-09-16').content, '今天的新记录')
  advance(1000)
  assert.equal(stored().dailyNotes.find((note) => note.date === '2026-09-17').content, '明天的已有记录')
})

test('随想保存失败保留原日草稿并阻止切日，显式重试成功后可切换', () => {
  seed([], [{ date: '2026-09-16', content: '原记录', updatedAt: 1 }])
  const previous = stored()
  const context = pageContext()
  context.onDailyNoteInput(input('尚未保存的新记录'))
  failWrites = 1
  choose(context, '2026-09-17')
  assert.deepEqual(stored(), previous)
  assert.equal(context.data.selectedDate, '2026-09-16')
  assert.equal(context.data.dailyNote, '尚未保存的新记录')
  assert.equal(context.data.dailyNoteDirty, true)
  assert.equal(context.data.noteSaveState, 'error')
  assert.ok(context.data.noteSaveProblem)
  context.onRetryDailyNote()
  assert.equal(context.data.noteSaveState, 'saved')
  assert.equal(context.data.dailyNoteDirty, false)
  assert.equal(stored().dailyNotes[0].content, '尚未保存的新记录')
  choose(context, '2026-09-17')
  assert.equal(context.data.selectedDate, '2026-09-17')
  assert.equal(context.data.dailyNote, '')
})

test('失焦、隐藏和卸载均立即flush随想并取消待执行保存', () => {
  seed()
  for (const [index, method] of ['onDailyNoteBlur', 'onHide', 'onUnload'].entries()) {
    const context = pageContext()
    const content = `记录-${method}`
    context.onDailyNoteInput(input(content))
    context[method]()
    assert.equal(stored().dailyNotes[0].content, content)
    assert.equal(context.data.dailyNoteDirty, false)
    assert.equal(context.data.noteSaveState, 'saved')
    context.onHide()
    assert.equal(timers.size, 0)
    advance(1000)
    assert.equal(stored().dailyNotes.length, 1, `flush-${index} must not create duplicate records`)
  }
})

test('清空随想删除当天记录，不影响其它日期', () => {
  seed([], [
    { date: '2026-09-16', content: '要清空的文字', updatedAt: 1 },
    { date: '2026-09-17', content: '保留另一日', updatedAt: 1 },
  ])
  const context = pageContext()
  context.onDailyNoteInput(input(''))
  context.onDailyNoteBlur()
  assert.deepEqual(stored().dailyNotes.map((note) => note.date), ['2026-09-17'])
  assert.equal(context.data.dailyNote, '')
  assert.equal(context.data.noteSaveState, 'saved')
})

test('返回页面和重新刷新不会以落盘旧记录覆盖保存失败的随想草稿', () => {
  seed([], [{ date: '2026-09-16', content: '旧记录', updatedAt: 1 }])
  const context = pageContext()
  context.onDailyNoteInput(input('未落盘的草稿'))
  failWrites = 5
  context.onHide()
  assert.equal(context.data.noteSaveState, 'error')
  context.onShow()
  context.refresh()
  assert.equal(context.data.dailyNote, '未落盘的草稿')
  assert.equal(context.data.dailyNoteDirty, true)
  assert.equal(context.data.noteSaveState, 'error')
  assert.equal(stored().dailyNotes[0].content, '旧记录')
})

test('卸载时保存失败的随想在本次会话重新创建页面后仍可找回和重试', () => {
  seed([], [{ date: '2026-09-16', content: '原记录', updatedAt: 1 }])
  const first = pageContext()
  first.onDailyNoteInput(input('页面重建后仍应保留的草稿'))
  failWrites = 1
  first.onUnload()
  contexts.delete(first)
  assert.equal(timers.size, 0)
  assert.equal(stored().dailyNotes[0].content, '原记录')
  const recreated = pageContext()
  assert.equal(recreated.data.dailyNote, '页面重建后仍应保留的草稿')
  assert.equal(recreated.data.dailyNoteDirty, true)
  assert.notEqual(recreated.data.noteSaveState, 'saved')
  recreated.onRetryDailyNote()
  assert.equal(recreated.data.noteSaveState, 'saved')
  assert.equal(stored().dailyNotes[0].content, '页面重建后仍应保留的草稿')
})

test('日期切换后迟到的旧日输入事件被忽略，不污染新日随想', () => {
  seed([], [{ date: '2026-09-17', content: '新日已有记录', updatedAt: 1 }])
  const context = pageContext()
  choose(context, '2026-09-17')
  context.onDailyNoteInput({
    detail: { value: '来自旧日的迟到事件' },
    currentTarget: { dataset: { date: '2026-09-16' } },
  })
  assert.equal(context.data.dailyNote, '新日已有记录')
  assert.equal(context.data.dailyNoteDirty, false)
  advance(1000)
  assert.equal(writes, 0)
  assert.equal(stored().dailyNotes[0].content, '新日已有记录')
})

test('读取错误不清除随想草稿，恢复读取后可安全保存而不是覆盖为空', () => {
  seed([], [{ date: '2026-09-16', content: '原记录', updatedAt: 1 }])
  const context = pageContext()
  context.onDailyNoteInput(input('读取错误期间的草稿'))
  failReads = true
  context.refresh()
  assert.ok(context.data.storageProblem)
  assert.equal(context.data.dailyNote, '读取错误期间的草稿')
  assert.equal(context.data.dailyNoteDirty, true)
  assert.equal(context.flushDailyNote(), false)
  assert.equal(stored().dailyNotes[0].content, '原记录')
  failReads = false
  context.onRetry()
  assert.equal(context.data.storageProblem, '')
  assert.equal(context.data.dailyNoteDirty, false)
  assert.equal(stored().dailyNotes[0].content, '读取错误期间的草稿')
})

test('取消完成和删除的存储失败均保持原任务并显示失败信息', () => {
  seed([todoItem({ completed: true, completedAt: 2 })])
  const previous = stored()
  const context = pageContext()
  failWrites = 1
  context.onToggle(touch('todo-1'))
  assert.deepEqual(stored(), previous)
  assert.match(modals.at(-1).title, /无法.*目标/)
  failWrites = 1
  context.onMore(touch('todo-1'))
  actionSheets.at(-1).success({ tapIndex: 1 })
  confirmLast(true)
  assert.deepEqual(stored(), previous)
  assert.match(modals.at(-1).title, /无法删除/)
  assert.equal(toasts.length, 0)
})

test('随想草稿与目标状态交错变更都保留，目标刷新不会抹掉草稿', () => {
  seed([todoItem()])
  const context = pageContext()
  context.onDailyNoteInput(input('写随想时完成目标'))
  context.onToggle(touch('todo-1'))
  assert.equal(context.data.dailyNote, '写随想时完成目标')
  advance(500)
  assert.equal(stored().items[0].completed, true)
  assert.equal(stored().dailyNotes[0].content, '写随想时完成目标')
})

test('跨午夜时今日视图跟随实际今天，而手动选择历史日期保持原日', () => {
  setClock(2026, 12, 31, 23, 59, 59)
  seed([todoItem({ taskDate: '2026-12-31' })])
  const context = pageContext()
  assert.equal(context.data.selectedDate, '2026-12-31')
  setClock(2027, 1, 1, 0, 0, 1)
  context.checkDayRollover()
  assert.equal(context.data.selectedDate, '2027-01-01')
  assert.equal(context.data.isToday, true)
  choose(context, '2026-12-30')
  setClock(2027, 1, 2)
  context.checkDayRollover()
  assert.equal(context.data.selectedDate, '2026-12-30')
  assert.equal(context.data.isToday, false)
})

test('跨午夜时打开的目标编辑器保持原日期，保存不会把草稿挪到新今天', () => {
  setClock(2026, 9, 16, 23, 59, 59)
  seed()
  const context = pageContext()
  context.onAdd()
  context.onTitle(input('午夜前开始写的目标'))
  setClock(2026, 9, 17, 0, 0, 1)
  context.checkDayRollover()
  assert.equal(context.data.selectedDate, '2026-09-16')
  assert.equal(context.data.editorDate, '2026-09-16')
  assert.equal(context.data.title, '午夜前开始写的目标')
  context.onSaveGoal()
  assert.equal(stored().items[0].taskDate, '2026-09-16')
})

test('跨午夜时未保存随想保留原日，flush仍保存到原日', () => {
  setClock(2026, 9, 16, 23, 59, 59)
  seed()
  const context = pageContext()
  context.onDailyNoteInput(input('午夜前的随想'))
  setClock(2026, 9, 17, 0, 0, 1)
  context.checkDayRollover()
  assert.equal(context.data.selectedDate, '2026-09-16')
  assert.equal(context.data.dailyNote, '午夜前的随想')
  context.flushDailyNote()
  assert.equal(stored().dailyNotes[0].date, '2026-09-16')
  assert.equal(stored().dailyNotes[0].content, '午夜前的随想')
})

test('随想仍聚焦时即使自动保存成功也保持原日，失焦保存后再检查才跟随今天', () => {
  setClock(2026, 9, 16, 23, 59, 59)
  seed()
  const context = pageContext()
  context.onDailyNoteFocus()
  context.onDailyNoteInput(input('午夜前已自动保存的前半句'))
  advance(500)
  assert.equal(context.data.dailyNoteDirty, false)
  setClock(2026, 9, 17, 0, 0, 1)
  context.checkDayRollover()
  assert.equal(context.data.selectedDate, '2026-09-16')
  assert.equal(context.data.dailyNote, '午夜前已自动保存的前半句')
  context.onDailyNoteInput(input('午夜前已自动保存的前半句，午夜后仍在原日继续输入'))
  context.onDailyNoteBlur()
  assert.equal(stored().dailyNotes[0].date, '2026-09-16')
  assert.equal(stored().dailyNotes[0].content, '午夜前已自动保存的前半句，午夜后仍在原日继续输入')
  assert.equal(context.data.selectedDate, '2026-09-16')
  context.checkDayRollover()
  assert.equal(context.data.selectedDate, '2026-09-17')
  assert.equal(context.data.dailyNote, '')
})

test('多个Page实例的日期、编辑器和计时器相互隔离', () => {
  seed([todoItem()])
  const first = pageContext()
  choose(first, '2026-09-15')
  first.onAdd()
  first.onExpandNote()
  const second = pageContext()
  assert.equal(first.data.selectedDate, '2026-09-15')
  assert.equal(second.data.selectedDate, '2026-09-16')
  assert.equal(first.data.editorOpen, true)
  assert.equal(second.data.editorOpen, false)
  assert.equal(second.data.noteExpanded, false)
  assert.equal(second.data.visibleItems[0].id, 'todo-1')
  assert.equal(timers.size, 2)
  first.onHide()
  assert.equal(timers.size, 1)
  second.onHide()
  assert.equal(timers.size, 0)
})

test('午夜点击日期箭头时先发生的随想失焦不会改变箭头所基于的日期', () => {
  setClock(2026, 9, 16, 23, 59, 59)
  seed()
  const context = pageContext()
  context.onDailyNoteFocus()
  context.onDailyNoteInput(input('正在原日输入'))
  setClock(2026, 9, 17, 0, 0, 1)
  context.checkDayRollover()
  context.onDailyNoteBlur()
  context.onPreviousDate()
  assert.equal(context.data.selectedDate, '2026-09-15')
  assert.equal(stored().dailyNotes[0].date, '2026-09-16')
  assert.equal(stored().dailyNotes[0].content, '正在原日输入')
})

test('正常前台日期刷新计时器更新跨日视图，隐藏后不再运行', () => {
  setClock(2026, 9, 16, 23, 59, 59)
  seed()
  const context = pageContext()
  assert.ok(timers.size > 0)
  advance(65000)
  assert.equal(context.data.selectedDate, '2026-09-17')
  context.onHide()
  assert.equal(timers.size, 0)
  const previous = structuredClone(context.data)
  advance(65000)
  assert.deepEqual(context.data, previous)
})

test('朋友圈安全预览不读私密Storage、不升级旧数据，也不启动任何页面计时器', () => {
  const legacy = { schemaVersion: 1, items: [] }
  storage.set(todoStorage.TODO_STORAGE_KEY, structuredClone(legacy))
  scene = 1154
  const context = pageContext(false)
  context.onLoad({ qige_share: 'home' })
  const previousReads = reads
  const previousWrites = writes
  context.onShow()
  assert.equal(context.data.showShareHomePreview, true)
  assert.equal(reads, previousReads)
  assert.equal(writes, previousWrites)
  assert.equal(timers.size, 0)
  assert.deepEqual(stored(), legacy)
  const preview = structuredClone(context.data)
  context.onToggleCalendar()
  context.onPreviousMonth()
  context.onNextMonth()
  context.browseCalendarMonth(1)
  context.onCalendarDate(calendarTouch('2026-09-18'))
  context.refreshCalendar()
  context.switchDate('2026-09-18')
  assert.deepEqual(context.data, preview)
  context.onHide()
  context.onUnload()
  assert.equal(reads, previousReads)
  assert.equal(writes, previousWrites)
})

test('月历默认收起，首次展开定位所选日且只复用已校验快照，不额外读写Storage', () => {
  seed([todoItem()])
  const context = pageContext()
  assert.equal(context.data.calendarExpanded, false)
  assert.deepEqual(context.data.calendarDays, [])
  const beforeReads = reads
  const beforeWrites = writes
  context.onToggleCalendar()
  assert.equal(context.data.calendarExpanded, true)
  assert.equal(context.data.calendarMonth, '2026-09')
  assert.equal(context.data.calendarMonthLabel, '2026年9月')
  assert.equal(context.data.calendarDays.length, 42)
  const today = context.data.calendarDays.find((day) => day.date === '2026-09-16')
  assert.equal(today.isToday, true)
  assert.equal(today.isSelected, true)
  assert.equal(today.hasGoals, true)
  context.onNextMonth()
  assert.equal(context.data.calendarMonth, '2026-10')
  context.onToggleCalendar()
  context.onToggleCalendar()
  assert.equal(context.data.calendarMonth, '2026-09')
  assert.equal(reads, beforeReads)
  assert.equal(writes, beforeWrites)
})

test('月历翻月不切日、不保存或放弃草稿，普通刷新也不跳回所选日月份', () => {
  seed([todoItem()])
  const context = pageContext()
  context.onToggleCalendar()
  context.onAdd()
  context.onTitle(input('仍在编辑原日目标'))
  context.onDailyNoteInput(input('原日未保存随想'))
  const beforeReads = reads
  const beforeWrites = writes
  context.onNextMonth()
  assert.equal(context.data.calendarMonth, '2026-10')
  assert.equal(context.data.selectedDate, '2026-09-16')
  assert.equal(context.data.editorDate, '2026-09-16')
  assert.equal(context.data.title, '仍在编辑原日目标')
  assert.equal(context.data.dailyNoteDirty, true)
  assert.equal(reads, beforeReads)
  assert.equal(writes, beforeWrites)
  assert.equal(modals.length, 0)
  advance(500)
  context.refresh()
  context.onToggle(touch('todo-1'))
  assert.equal(context.data.calendarMonth, '2026-10')
  assert.equal(context.data.dailyNote, '原日未保存随想')
  assert.equal(context.data.title, '仍在编辑原日目标')
  context.onPreviousMonth()
  assert.equal(context.data.calendarMonth, '2026-09')
})

test('月历圆点覆盖非选日、完成与过期目标，同日多条仅一格标记，仅随想不标记', () => {
  seed([
    todoItem(),
    todoItem({ id: 'same-day', createdAt: 2 }),
    todoItem({ id: 'expired', taskDate: '2026-09-15' }),
    todoItem({ id: 'done', taskDate: '2026-09-18', completed: true, completedAt: 2 }),
    todoItem({ id: 'neighbor', taskDate: '2026-08-31' }),
  ], [{ date: '2026-09-20', content: '仅有随想', updatedAt: 3 }])
  const context = pageContext()
  context.onToggleCalendar()
  assert.deepEqual(context.data.calendarDays.filter((day) => day.hasGoals).map((day) => day.date), [
    '2026-08-31', '2026-09-15', '2026-09-16', '2026-09-18',
  ])
  assert.equal(context.data.calendarDays.find((day) => day.date === '2026-08-31').inMonth, false)
  assert.equal(context.data.calendarDays.find((day) => day.date === '2026-09-20').hasGoals, false)
})

test('新增及删除最后一个目标实时更新圆点，且不改变正在浏览的月份', () => {
  seed()
  const context = pageContext()
  context.onToggleCalendar()
  context.onAdd()
  context.onTitle(input('新增带点目标'))
  context.onSaveGoal()
  assert.equal(context.data.calendarDays.find((day) => day.date === '2026-09-16').hasGoals, true)
  const id = stored().items[0].id
  context.onNextMonth()
  context.confirmDelete(id)
  confirmLast(true)
  assert.equal(context.data.calendarMonth, '2026-10')
  context.onPreviousMonth()
  assert.equal(context.data.calendarDays.find((day) => day.date === '2026-09-16').hasGoals, false)
})

test('读取失败或未知版本清除月历旧圆点，恢复读取后重建，不覆盖原数据', () => {
  seed([todoItem()])
  const context = pageContext()
  context.onToggleCalendar()
  const previous = stored()
  failReads = true
  context.refresh()
  assert.ok(context.data.storageProblem)
  assert.ok(context.data.calendarDays.every((day) => !day.hasGoals))
  assert.deepEqual(stored(), previous)
  failReads = false
  context.onRetry()
  assert.equal(context.data.calendarDays.find((day) => day.date === '2026-09-16').hasGoals, true)
  const unknown = { schemaVersion: 999, items: previous.items, dailyNotes: [] }
  storage.set(todoStorage.TODO_STORAGE_KEY, structuredClone(unknown))
  context.refresh()
  assert.ok(context.data.calendarDays.every((day) => !day.hasGoals))
  assert.deepEqual(stored(), unknown)
  assert.equal(writes, 0)
})

test('点月历日期先保存原日随想，再展示选日目标与随想，并保持展开', () => {
  seed([todoItem(), todoItem({ id: 'tomorrow', taskDate: '2026-09-17' })], [
    { date: '2026-09-17', content: '明日随想', updatedAt: 2 },
  ])
  const context = pageContext()
  context.onToggleCalendar()
  context.onDailyNoteInput(input('原日草稿'))
  context.onCalendarDate(calendarTouch('2026-09-17'))
  assert.equal(stored().dailyNotes.find((note) => note.date === '2026-09-16').content, '原日草稿')
  assert.equal(context.data.selectedDate, '2026-09-17')
  assert.equal(context.data.calendarMonth, '2026-09')
  assert.equal(context.data.dailyNote, '明日随想')
  assert.deepEqual(context.data.visibleItems.map((item) => item.id), ['tomorrow'])
  assert.deepEqual(context.data.calendarDays.filter((day) => day.isSelected).map((day) => day.date), ['2026-09-17'])
  assert.equal(context.data.calendarExpanded, true)
})

test('点日保存失败时保留原日期、展示月份、高亮和随想草稿，重试后才切换', () => {
  seed([todoItem({ taskDate: '2026-09-30' })])
  const context = pageContext()
  choose(context, '2026-09-30')
  context.onToggleCalendar()
  context.onNextMonth()
  context.onDailyNoteInput(input('切日前不可丢失的草稿'))
  failWrites = 1
  context.onCalendarDate(calendarTouch('2026-10-01'))
  assert.equal(context.data.selectedDate, '2026-09-30')
  assert.equal(context.data.calendarMonth, '2026-10')
  assert.deepEqual(context.data.calendarDays.filter((day) => day.isSelected).map((day) => day.date), ['2026-09-30'])
  assert.equal(context.data.dailyNote, '切日前不可丢失的草稿')
  assert.equal(context.data.dailyNoteDirty, true)
  assert.equal(context.data.noteSaveState, 'error')
  context.onRetryDailyNote()
  context.onCalendarDate(calendarTouch('2026-10-01'))
  assert.equal(context.data.selectedDate, '2026-10-01')
  assert.equal(context.data.calendarMonth, '2026-10')
  assert.equal(stored().dailyNotes[0].date, '2026-09-30')
})

test('目标放弃确认异步完成前不移动月历，取消保留全部状态，确认后才选邻月日', () => {
  seed()
  const context = pageContext()
  choose(context, '2026-09-30')
  context.onToggleCalendar()
  context.onAdd()
  context.onTitle(input('尚未保存的目标'))
  context.onCalendarDate(calendarTouch('2026-10-01'))
  const previousDays = structuredClone(context.data.calendarDays)
  assert.equal(context.data.selectedDate, '2026-09-30')
  assert.equal(context.data.calendarMonth, '2026-09')
  confirmLast(false)
  assert.equal(context.data.selectedDate, '2026-09-30')
  assert.equal(context.data.calendarMonth, '2026-09')
  assert.deepEqual(context.data.calendarDays, previousDays)
  assert.equal(context.data.title, '尚未保存的目标')
  context.onCalendarDate(calendarTouch('2026-10-01'))
  confirmLast(true)
  assert.equal(context.data.selectedDate, '2026-10-01')
  assert.equal(context.data.calendarMonth, '2026-10')
  assert.equal(context.data.editorOpen, false)
  assert.equal(context.data.calendarExpanded, true)
})

test('点击已选邻月日期只定位其月份，不触发保存或放弃提示', () => {
  seed()
  const context = pageContext()
  choose(context, '2026-09-30')
  context.onToggleCalendar()
  context.onNextMonth()
  context.onAdd()
  context.onTitle(input('不放弃的目标'))
  context.onDailyNoteInput(input('不强制保存的随想'))
  const beforeWrites = writes
  context.onCalendarDate(calendarTouch('2026-09-30'))
  assert.equal(context.data.selectedDate, '2026-09-30')
  assert.equal(context.data.calendarMonth, '2026-09')
  assert.equal(context.data.title, '不放弃的目标')
  assert.equal(context.data.dailyNoteDirty, true)
  assert.equal(writes, beforeWrites)
  assert.equal(modals.length, 0)
})

test('picker、前后日与返回今天同步月历，已在今天时返回只定位月份', () => {
  seed()
  const context = pageContext()
  context.onToggleCalendar()
  choose(context, '2026-09-30')
  context.onNextDate()
  assert.equal(context.data.calendarMonth, '2026-10')
  assert.equal(context.data.selectedDate, '2026-10-01')
  context.onPreviousDate()
  assert.equal(context.data.calendarMonth, '2026-09')
  choose(context, '2026-12-31')
  assert.equal(context.data.calendarMonthLabel, '2026年12月')
  context.onToday()
  assert.equal(context.data.selectedDate, '2026-09-16')
  assert.equal(context.data.calendarMonth, '2026-09')
  context.onNextMonth()
  context.onToday()
  assert.equal(context.data.calendarMonth, '2026-09')
  assert.equal(context.data.calendarExpanded, true)
  assert.equal(writes, 0)
})

test('年末午夜自动跟随今天同步月历；编辑器、聚焦和未保存随想继续保护原日', () => {
  for (const protectedBy of ['', 'editor', 'focus', 'dirty']) {
    setClock(2026, 12, 31, 23, 59, 59)
    seed()
    const context = pageContext()
    context.onToggleCalendar()
    if (protectedBy === 'editor') context.onAdd()
    if (protectedBy === 'focus') context.onDailyNoteFocus()
    if (protectedBy === 'dirty') context.onDailyNoteInput(input('跨年草稿'))
    setClock(2027, 1, 1, 0, 0, 1)
    context.checkDayRollover()
    assert.equal(context.data.selectedDate, protectedBy ? '2026-12-31' : '2027-01-01')
    assert.equal(context.data.calendarMonth, protectedBy ? '2026-12' : '2027-01')
    assert.deepEqual(context.data.calendarDays.filter((day) => day.isToday).map((day) => day.date), ['2027-01-01'])
    context.onHide()
  }
})

test('月历保留历史目标过期显示，非法点击和收起时的翻月不改变日期或数据', () => {
  seed([todoItem({ taskDate: '2026-09-15' })])
  const context = pageContext()
  context.onNextMonth()
  assert.equal(context.data.calendarMonth, '2026-09')
  context.onToggleCalendar()
  context.onCalendarDate(calendarTouch('2026-09-15'))
  assert.equal(context.data.visibleItems[0].expired, true)
  const previous = structuredClone(context.data)
  context.onCalendarDate(calendarTouch('2026-02-30'))
  context.onCalendarDate(calendarTouch(''))
  assert.deepEqual(context.data, previous)
  assert.equal(writes, 0)
})

test('月历使用七列原生按钮与44px高度，保留日期picker及分享预览分支', () => {
  const markup = readFileSync(new URL('../miniprogram/pages/todo/index.wxml', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../miniprogram/pages/todo/index.wxss', import.meta.url), 'utf8')
  assert.match(markup, /<block wx:else>[\s\S]*class="calendar-panel"/)
  assert.match(markup, /wx:if="{{calendarExpanded}}"/)
  assert.match(markup, /!isToday \|\| calendarExpanded/)
  assert.match(markup, /wx:for="{{calendarDays}}"[^>]*wx:key="date"/)
  assert.match(markup, /style="width: 14\.285714%;"[^>]*data-date="{{item\.date}}"/)
  assert.match(markup, /bindtap="onCalendarDate"[^>]*aria-label="{{item\.label}}"/)
  assert.match(css, /\.plain-button\.calendar-day\s*{[^}]*min-height:\s*44px;/)
  assert.match(css, /\.calendar-selected \.calendar-day-number\s*{[^}]*color:\s*#ffffff;/)
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length)
})
