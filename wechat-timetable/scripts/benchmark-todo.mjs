// Reproduce the todo list's serialized logic-to-view payload, not native rendering latency.
// Run from wechat-timetable: node --disable-warning=ExperimentalWarning scripts/benchmark-todo.mjs
// Fixture: 1,000 same-day goals, short Chinese titles/notes, 13-digit timestamps,
// every third goal completed. The second scenario includes retained V1/V2 timing fields.
// The local clock is fixed at noon on 2026-11-13 so expiry labels remain reproducible.
// Before: each displayed row spread the complete stored item and added `expired`.
// After: invoke the current page's refresh() and measure its actual visibleItems.
import '../tests/helpers/register-typescript.mjs'

const RealDate = globalThis.Date
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length) super(...args)
    else super(2026, 10, 13, 12)
  }
}
let definition
let storedData
globalThis.Page = value => { definition = value }
globalThis.wx = {
  getStorageSync(key) { return key === 'timetable_todos' ? structuredClone(storedData) : '' },
}
await import('../miniprogram/pages/todo/index.ts')
const { todosForDate } = await import('../miniprogram/utils/todo-order.ts')

const date = '2026-11-13'
const items = Array.from({ length: 1000 }, (_, index) => ({
  id: `todo-${index}`, title: '完成今日复习', note: '整理课堂笔记', taskDate: date,
  completed: index % 3 === 0, createdAt: 1794578217000, updatedAt: 1794578217000,
  completedAt: index % 3 === 0 ? 1794578217000 : null,
}))
const legacyTiming = { dueDate: date, scheduleDate: date, scheduleStartTime: '08:00', scheduleEndTime: '09:00' }
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const measurements = []
for (const migrated of [false, true]) {
  storedData = {
    schemaVersion: 3,
    items: items.map(item => ({ ...item, ...(migrated ? { legacyTiming } : {}) })),
    dailyNotes: [],
  }
  const page = {
    ...definition, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) },
  }
  page.data.selectedDate = date
  page.refresh()
  const expiredById = new Map(page.data.visibleItems.map(item => [item.id, item.expired]))
  const before = todosForDate(storedData.items, date).map(item => ({ ...item, expired: expiredById.get(item.id) }))
  const beforeBytes = bytes(before)
  const afterBytes = bytes(page.data.visibleItems)
  measurements.push({
    scenario: migrated ? 'goals with legacy timing' : 'ordinary goals',
    beforeBytes, afterBytes, reduction: `${(100 * (1 - afterBytes / beforeBytes)).toFixed(1)}%`,
  })
}
console.log(JSON.stringify({
  fixture: { goals: items.length, date, completed: items.filter(item => item.completed).length, title: items[0].title, note: items[0].note },
  measurements,
  limitation: 'UTF-8 JSON bytes for visibleItems under Node.js; excludes other page fields and is not a real-device frame-rate or latency measurement.',
}, null, 2))
