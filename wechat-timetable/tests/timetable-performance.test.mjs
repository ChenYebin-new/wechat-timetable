import assert from 'node:assert/strict'
import test from 'node:test'
import './helpers/register-typescript.mjs'
import { applyDataPatch } from './helpers/set-data.mjs'

globalThis.wx = { getStorageSync() { return '' } }
let grid, timetable
globalThis.Component = definition => { grid = definition }
globalThis.Page = definition => { timetable = definition }
await import('../miniprogram/components/timetable-grid/index.ts')
await import('../miniprogram/pages/timetable/index.ts')
const { buildDaySlots } = await import('../miniprogram/utils/timetable-layout.ts')
const { buildWeekDates } = await import('../miniprogram/utils/timetable-dates.ts')

const term = { startDate: '2026-09-07', totalWeeks: 30 }
const course = { id: 'course', groupId: 'group', name: '数学', location: '教学楼101', day: 1, startPeriod: 1, endPeriod: 2, weeks: Array.from({ length: 30 }, (_, index) => index + 1), weekMode: 'all', color: '#abcdef', createdAt: 1, updatedAt: 1 }

function instance(definition, properties = {}) {
  const patches = []
  return {
    ...definition, ...definition.methods,
    data: structuredClone(definition.data), properties, patches,
    setData(patch) { patches.push(structuredClone(patch)); applyDataPatch(this.data, patch) },
  }
}

function gridInstance() {
  const context = instance(grid, {
    themeId: 'aqua', periods: Array.from({ length: 14 }, (_, index) => ({ index: index + 1 })),
    daySlots: buildDaySlots([course]), selectedKeys: [], disabledKeys: ['1-1', '1-2'],
    selectionMode: false, holdEnabled: true,
  })
  context.rebuildColumns()
  context.patches.length = 0
  return context
}

test('selecting or deselecting a grid cell updates only its flag and preserves course cards', () => {
  const context = gridInstance()
  const slot = context.data.columns[0].slots[0]
  context.properties.selectedKeys = ['7-14']
  grid.observers.selectedKeys.call(context)
  assert.deepEqual(context.patches, [{ 'columns[6].cells[13].selected': true }])
  assert.equal(context.data.columns[6].cells[13].selected, true)
  assert.equal(context.data.columns[0].slots[0], slot)
  grid.observers.selectedKeys.call(context)
  assert.equal(context.patches.length, 1, 'unchanged selections do not cross the bridge again')
  context.properties.selectedKeys = ['2-3', '2-4']
  grid.observers.selectedKeys.call(context)
  assert.deepEqual(context.patches.at(-1), {
    'columns[1].cells[2].selected': true,
    'columns[1].cells[3].selected': true,
    'columns[6].cells[13].selected': false,
  })
  context.properties.themeId = 'paper'
  context.rebuildColumns()
  assert.equal(context.data.columns[1].cells[2].selected, true)
  assert.equal(context.data.columns[0].cells[0].disabled, true)
})

test('selection observer before attachment is harmless and first render retains the selection', () => {
  const context = gridInstance()
  context.data.columns = []
  context.properties.selectedKeys = ['7-14']
  context.updateSelectedCells()
  assert.deepEqual(context.patches, [])
  grid.lifetimes.attached.call(context)
  assert.equal(context.data.columns[6].cells[13].selected, true)
})

test('neighboring week changes only replace entering and leaving panels, retaining dates and courses', () => {
  const context = instance(timetable)
  context.renderWeek(15, term, [course])
  assert.equal(context.data.weekPanels.length, 30)
  assert.equal(context.data.weekPanels.reduce((count, panel) => count + panel.calendar.days.length, 0), 21)
  const retained = context.data.weekPanels[14]
  context.renderWeek(16, term, [course])
  const patch = context.patches.at(-1)
  assert.deepEqual(Object.keys(patch).filter(key => key.startsWith('weekPanels')), ['weekPanels[13]', 'weekPanels[16]'])
  assert.equal(context.data.weekPanels[14], retained)
  assert.deepEqual(context.data.weekPanels.filter(panel => panel.active).map(panel => panel.week), [15, 16, 17])
  assert.deepEqual(context.data.weekPanels[15].calendar, buildWeekDates(term, 16))
  assert.equal(context.data.weekPanels[16].daySlots[0][0].course.id, course.id)
  context.renderWeek(16, term, [course])
  assert.ok(Object.keys(context.patches.at(-1)).every(key => !key.startsWith('weekPanels')))
})

test('week patches refresh edited courses, term dates, boundaries and resized terms without stale panels', () => {
  const context = instance(timetable)
  context.renderWeek(15, term, [course])
  context.renderWeek(15, term, [{ ...course, name: '高等数学', weeks: [15] }])
  assert.equal(context.data.weekPanels[14].daySlots[0][0].course.name, '高等数学')
  assert.equal(context.data.weekPanels[15].daySlots[0].length, 0)
  const shifted = { ...term, startDate: '2026-09-14' }
  context.renderWeek(15, shifted, [course])
  assert.deepEqual(context.data.weekPanels[14].calendar, buildWeekDates(shifted, 15))
  context.renderWeek(1, shifted, [course])
  assert.deepEqual(context.data.weekPanels.filter(panel => panel.active).map(panel => panel.week), [1, 2])
  context.renderWeek(30, shifted, [course])
  assert.deepEqual(context.data.weekPanels.filter(panel => panel.active).map(panel => panel.week), [29, 30])
  context.renderWeek(2, { ...shifted, totalWeeks: 2 }, [course])
  assert.equal(context.data.weekPanels.length, 2)
  assert.ok(context.patches.at(-1).weekPanels)
  context.renderWeek(1, null, [course])
  assert.equal(context.data.weekPanels.length, 1)
  assert.deepEqual(context.data.weekPanels[0].calendar.days, [])
  assert.equal(context.data.weekPanels[0].daySlots[0][0].course.id, course.id)
})

for (const change of ['disabledKeys', 'holdEnabled', 'selectionMode']) {
  test(`pending long press cannot select a stale cell after ${change} changes`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const context = gridInstance()
    const events = []
    context.triggerEvent = (...args) => events.push(args)
    context.onCellTouchStart({ touches: [{ clientX: 10, clientY: 10 }], currentTarget: { dataset: { key: '7-14', day: 7, period: 14 } } })
    t.mock.timers.tick(600)
    context.properties[change] = change === 'disabledKeys' ? ['7-14'] : change === 'selectionMode'
    if (change !== 'disabledKeys') grid.observers['holdEnabled, selectionMode'].call(context)
    t.mock.timers.tick(700)
    assert.deepEqual(events, [])
    assert.equal(context.data.pressingKey, '')
    grid.lifetimes.detached.call(context)
  })
}
