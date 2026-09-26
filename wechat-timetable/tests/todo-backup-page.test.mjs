import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import './helpers/register-typescript.mjs'

const definitions = []
globalThis.Page = value => definitions.push(value)
await import('../miniprogram/pages/todo-backup/index.ts')
const service = await import('../miniprogram/services/todo-backup-service.ts')
const session = await import('../miniprogram/services/todo-session.ts')
const { TODO_STORAGE_KEY: KEY } = await import('../miniprogram/services/todo-storage.ts')
const { TODO_RECENT_BACKUP_KEY: RECENT } = await import('../miniprogram/models/todo-backup.ts')
let storage, dialogs, clipboard, toasts, navigation, writes
const input = value => ({ detail: { value } })
const empty = () => ({ schemaVersion: 3, items: [], dailyNotes: [] })
function page() {
  const value = { ...definitions[0], data: structuredClone(definitions[0].data), setData(changes) { Object.assign(this.data, changes) } }
  value.onLoad({})
  value.onShow()
  return value
}
function respond(confirm = true) {
  const dialog = dialogs.at(-1)
  dialog.success({ confirm })
  dialog.complete()
}
beforeEach(() => {
  storage = new Map()
  dialogs = []; clipboard = []; toasts = []; navigation = []; writes = 0
  session.unsavedDailyNotes.clear()
  globalThis.wx = {
    getStorageSync: key => structuredClone(storage.get(key) ?? ''),
    setStorageSync(key, value) { writes++; storage.set(key, structuredClone(value)) },
    removeStorageSync: key => storage.delete(key),
    showModal: options => dialogs.push(options),
    setClipboardData: options => clipboard.push(options),
    showToast: options => toasts.push(options),
    switchTab: options => navigation.push(options.url),
    showShareMenu() {}, getEnterOptionsSync: () => ({ scene: 1001 }),
  }
})

test('导出仅复制已保存内容，剪贴板失败可重试且不报成功', () => {
  const p = page()
  session.unsavedDailyNotes.set('2026-09-20', '私人草稿')
  p.onExport()
  assert.equal(p.data.draftDate, '2026-09-20')
  assert.deepEqual(service.parseTodoBackup(clipboard[0].data).data, empty())
  clipboard[0].fail()
  assert.match(p.data.problem, /复制失败/)
  assert.equal(toasts.length, 0)
  p.onExport()
  clipboard[1].success()
  assert.equal(toasts.length, 1)
  assert.equal(writes, 0)
})

test('修改输入作废预览，空备份明确警示，取消确认不写入', () => {
  const p = page()
  const text = service.exportTodoBackup()
  p.onInput(input(text)); p.onParse()
  assert.equal(p.data.preview.dateRange, '无记录')
  p.onInput(input(text + ' '))
  assert.equal(p.data.preview, null)
  p.onRestore()
  assert.equal(dialogs.length, 0)
  p.onParse(); p.onRestore()
  assert.match(dialogs[0].content, /清空全部/)
  assert.equal(p.data.busy, true)
  respond(false)
  assert.equal(p.data.busy, false)
  assert.equal(writes, 0)
  assert.ok(p.data.preview)
})

test('覆盖成功清理输入并更新最近备份，撤回需要独立预览确认', () => {
  const text = service.exportTodoBackup()
  storage.set(KEY, { ...empty(), dailyNotes: [{ date: '2026-09-20', content: '本机记录', updatedAt: 1 }] })
  const p = page()
  p.onInput(input(text)); p.onParse()
  assert.equal(p.data.currentNoteCount, 1)
  p.onRestore(); respond()
  assert.equal(p.data.inputText, '')
  assert.equal(p.data.preview, null)
  assert.equal(p.data.recent.noteCount, 1)
  assert.deepEqual(storage.get(KEY), empty())
  p.onPreviewRecent()
  assert.equal(p.data.previewSource, 'recent')
  assert.equal(p.data.preview.noteCount, 1)
  p.onRestore(); respond()
  assert.equal(storage.get(KEY).dailyNotes[0].content, '本机记录')
  assert.equal(p.data.recent.noteCount, 0)
})

test('确认前数据变化或新增草稿会在执行时拦截，保留输入供重试', () => {
  const p = page()
  const text = service.exportTodoBackup()
  p.onInput(input(text)); p.onParse(); p.onRestore()
  storage.set(KEY, empty()) // 从 missing 变成 current。
  respond()
  assert.match(p.data.problem, /重新预览/)
  assert.equal(p.data.preview, null)
  assert.equal(p.data.inputText, text)
  assert.equal(writes, 0)
  p.onParse(); p.onRestore()
  session.unsavedDailyNotes.set('2026-09-21', '草稿')
  respond()
  assert.match(p.data.problem, /未保存/)
  assert.equal(writes, 0)
  p.onReturnToTodo()
  assert.deepEqual(navigation, ['/pages/todo/index'])
  assert.equal(session.takeRequestedDraftDate(), '2026-09-21')
})

test('已存在草稿时不弹恢复确认，页面隐藏使旧确认失效', () => {
  const p = page()
  p.onInput(input(service.exportTodoBackup())); p.onParse()
  session.unsavedDailyNotes.set('2026-09-20', '草稿')
  p.onRestore()
  assert.equal(dialogs.length, 0)
  session.unsavedDailyNotes.clear()
  p.onRestore()
  p.onHide()
  respond()
  assert.equal(writes, 0)
})

test('损坏最近备份显示错误，错误输入不留下旧预览', () => {
  storage.set(RECENT, { bad: true })
  const p = page()
  assert.ok(p.data.recentProblem)
  p.onPreviewRecent()
  assert.ok(p.data.problem)
  p.onInput(input('bad')); p.onParse()
  assert.match(p.data.problem, /JSON/)
  assert.equal(p.data.preview, null)
  assert.equal(writes, 0)
})
