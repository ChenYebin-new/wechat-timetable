// Reproduce the logic-to-view payload cost, not native rendering latency.
// Run from wechat-timetable: node --disable-warning=ExperimentalWarning scripts/benchmark-timetable.mjs
// Before optimization this fixture measured: selection 16,200 B; initial/switch week 38,539 B;
// 210 date objects, although only the current and adjacent weeks are mounted.
import '../tests/helpers/register-typescript.mjs'
import { applyDataPatch } from '../tests/helpers/set-data.mjs'

globalThis.wx = { getStorageSync() { return '' } }
let grid, timetable
globalThis.Component = definition => { grid = definition }
globalThis.Page = definition => { timetable = definition }
await import('../miniprogram/components/timetable-grid/index.ts')
await import('../miniprogram/pages/timetable/index.ts')
const { buildDaySlots, buildWeekPanels } = await import('../miniprogram/utils/timetable-layout.ts')
const { buildWeekDates } = await import('../miniprogram/utils/timetable-dates.ts')

const term = { startDate: '2026-09-07', totalWeeks: 30 }
const courses = Array.from({ length: 20 }, (_, index) => ({
  id: `course-${index}`, groupId: `group-${index}`, name: '测试课程', location: '教学楼101',
  day: index % 7 + 1, startPeriod: Math.floor(index / 7) * 2 + 1, endPeriod: Math.floor(index / 7) * 2 + 2,
  weeks: Array.from({ length: 30 }, (_, week) => week + 1), weekMode: 'all', color: '#abcdef', createdAt: 1, updatedAt: 1,
}))
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const results = []
function record(action, before, after) {
  results.push({ action, beforeBytes: bytes(before), afterBytes: bytes(after), reduction: `${(100 * (1 - bytes(after) / bytes(before))).toFixed(1)}%` })
}
function instance(definition, properties = {}) {
  return {
    ...definition, ...definition.methods, properties, data: structuredClone(definition.data), patches: [],
    setData(patch) { this.patches.push(structuredClone(patch)); applyDataPatch(this.data, patch) },
  }
}
const context = instance(grid, {
  themeId: 'aqua', periods: Array.from({ length: 14 }, (_, index) => ({ index: index + 1 })),
  daySlots: buildDaySlots(courses), selectedKeys: [], disabledKeys: [],
})
context.rebuildColumns()
context.properties.selectedKeys = ['7-14']
context.updateSelectedCells()
record('select one cell', { columns: context.data.columns, metrics: context.data.metrics }, context.patches.at(-1))

const page = instance(timetable)
for (const week of [15, 16]) {
  page.renderWeek(week, term, courses)
  const before = {
    currentWeek: week, weekIndex: week - 1,
    weekPanels: buildWeekPanels(courses, week, term.totalWeeks).map(panel => ({ ...panel, calendar: buildWeekDates(term, panel.week) })),
    isEmpty: page.data.isEmpty, overviewText: page.data.overviewText,
  }
  record(week === 15 ? 'initial week' : 'next week', before, page.patches.at(-1))
}
console.log(JSON.stringify({
  fixture: { courses: courses.length, periods: 14, weeks: term.totalWeeks, switch: '15 -> 16' },
  measurements: results,
  calendarDays: { before: term.totalWeeks * 7, after: page.data.weekPanels.reduce((count, panel) => count + panel.calendar.days.length, 0) },
  limitation: 'Serialized setData payload bytes under Node.js; not a real-device frame-rate or latency measurement.',
}, null, 2))
