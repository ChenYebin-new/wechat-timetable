import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import './helpers/register-typescript.mjs'

const { buildMondayPickerState, changeMondayPickerColumn, mondaysInMonth, resolveMondayPickerDate } =
  await import('../miniprogram/utils/monday-picker.ts')
const { formatLocalDate, parseLocalDate } = await import('../miniprogram/utils/local-date.ts')
const { currentMonday } = await import('../miniprogram/utils/term.ts')
const constants = await import('../miniprogram/constants/timetable.ts')
const NOW = new Date(2026, 8, 15)
const definitions = []
let component
let storage = new Map()
let writes = 0

globalThis.Component = (definition) => { component = definition }
globalThis.Page = (definition) => definitions.push(definition)
globalThis.wx = {
  getStorageSync(key) { return storage.has(key) ? structuredClone(storage.get(key)) : '' },
  setStorageSync(key, value) { writes++; storage.set(key, structuredClone(value)) },
  showShareMenu() {},
}
await import('../miniprogram/components/monday-picker/index.ts')
await import('../miniprogram/pages/term-settings/index.ts')
await import('../miniprogram/pages/data-manage/index.ts')
const [termPage, importPage] = definitions

function pickerContext(value, onChange = () => {}) {
  const context = {
    properties: { value },
    data: structuredClone(component.data),
    events: [],
    setData(changes) { Object.assign(this.data, changes) },
    triggerEvent(name, detail) {
      this.events.push({ name, detail })
      onChange({ detail })
      this.properties.value = detail.value
      this.resetSelection()
    },
  }
  for (const [name, method] of Object.entries(component.methods)) context[name] = method.bind(context)
  component.lifetimes.attached.call(context)
  return context
}

function pageContext(definition) {
  const context = {
    data: structuredClone(definition.data),
    setData(changes) { Object.assign(this.data, changes) },
  }
  for (const [name, method] of Object.entries(definition)) {
    if (typeof method === 'function') context[name] = method.bind(context)
  }
  return context
}

test('日期列包含普通月份、五个周一和闰年二月的正确候选', () => {
  assert.deepEqual(mondaysInMonth(2026, 9), ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'])
  assert.deepEqual(mondaysInMonth(2026, 8), ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'])
  assert.deepEqual(mondaysInMonth(2024, 2), ['2024-02-05', '2024-02-12', '2024-02-19', '2024-02-26'])
  assert.deepEqual(mondaysInMonth(2016, 2), ['2016-02-01', '2016-02-08', '2016-02-15', '2016-02-22', '2016-02-29'])
})

test('默认年份范围内每个月的星期一都完整且真实有效', () => {
  for (let year = 1900; year <= 2100; year++) {
    for (let month = 1; month <= 12; month++) {
      const expected = []
      for (let day = 1; day <= 31; day++) {
        const date = new Date(year, month - 1, day)
        if (date.getMonth() === month - 1 && date.getDay() === 1) expected.push(formatLocalDate(date))
      }
      const dates = mondaysInMonth(year, month)
      assert.deepEqual(dates, expected, `${year}-${month}`)
      for (const value of dates) assert.equal(parseLocalDate(value).getDay(), 1)
    }
  }
})

test('年份范围覆盖当前年份与范围外的已有日期，并原样回显', () => {
  const regular = buildMondayPickerState('2026-09-14', NOW)
  assert.equal(regular.years[0], 1900)
  assert.equal(regular.years.at(-1), 2100)
  assert.equal(resolveMondayPickerDate(regular, regular.indices), '2026-09-14')
  assert.deepEqual(regular.range[2], ['7 日（周一）', '14 日（周一）', '21 日（周一）', '28 日（周一）'])
  for (const year of [1800, 2200]) {
    const value = mondaysInMonth(year, 1)[2]
    const state = buildMondayPickerState(value, NOW)
    assert.ok(state.years.includes(year))
    assert.equal(resolveMondayPickerDate(state, state.indices), value)
  }
  const future = buildMondayPickerState('2026-09-14', new Date(2201, 0, 1))
  assert.equal(future.years.at(-1), 2201)
})

test('未设置或无效值只让滚轮默认定位本周一，不触发页面更新', () => {
  for (const value of ['', '2026-09-15', '2026-02-30', 'invalid']) {
    const state = buildMondayPickerState(value, NOW)
    assert.equal(resolveMondayPickerDate(state, state.indices), '2026-09-14')
    const context = pickerContext(value)
    assert.equal(resolveMondayPickerDate(context.data.picker, context.data.picker.indices), currentMonday())
    assert.equal(context.properties.value, value)
    assert.deepEqual(context.events, [])
  }
})

test('切换年月重建候选并定位第一个周一，包含跨年和闰年切换', () => {
  const initial = buildMondayPickerState('2026-12-28', NOW)
  const before = structuredClone(initial)
  const nextYear = changeMondayPickerColumn(initial, 0, initial.years.indexOf(2027))
  assert.equal(resolveMondayPickerDate(nextYear, nextYear.indices), mondaysInMonth(2027, 12)[0])
  const january = changeMondayPickerColumn(nextYear, 1, 0)
  assert.equal(resolveMondayPickerDate(january, january.indices), '2027-01-04')
  const leap = changeMondayPickerColumn(buildMondayPickerState('2016-02-29', NOW), 0, initial.years.indexOf(2017))
  assert.deepEqual(leap.dates, ['2017-02-06', '2017-02-13', '2017-02-20', '2017-02-27'])
  assert.equal(leap.indices[2], 0)
  assert.deepEqual(initial, before)
})

test('取消恢复已确认日期和候选列表，重开时保留原位置', () => {
  const context = pickerContext('2026-09-14')
  const original = structuredClone(context.data.picker)
  context.onColumnChange({ detail: { column: 0, value: original.years.indexOf(2027) } })
  context.onColumnChange({ detail: { column: 1, value: 7 } })
  context.onColumnChange({ detail: { column: 2, value: 3 } })
  assert.equal(context.properties.value, '2026-09-14')
  assert.deepEqual(context.events, [])
  context.resetSelection()
  assert.deepEqual(context.data.picker, original)
  assert.equal(resolveMondayPickerDate(context.data.picker, context.data.picker.indices), '2026-09-14')
})

test('确认仅发出日期字符串，后续取消回到最近确认值', () => {
  const context = pickerContext('2026-09-14')
  context.onColumnChange({ detail: { column: 2, value: 2 } })
  assert.deepEqual(context.events, [])
  context.onConfirm({ detail: { value: [...context.data.picker.indices] } })
  assert.deepEqual(context.events, [{ name: 'change', detail: { value: '2026-09-21' } }])
  context.onColumnChange({ detail: { column: 1, value: 10 } })
  context.resetSelection()
  assert.equal(resolveMondayPickerDate(context.data.picker, context.data.picker.indices), '2026-09-21')
  context.properties.value = '2024-02-26'
  component.methods[component.properties.value.observer].call(context)
  assert.equal(resolveMondayPickerDate(context.data.picker, context.data.picker.indices), '2024-02-26')
})

test('非法索引、候选列表不匹配或非周一事件不会更新日期', () => {
  const state = buildMondayPickerState('2026-09-14', NOW)
  for (const value of [null, '2026-09-15', [], [0, 1], [0, 1, 2, 3], [-1, 8, 0], [9999, 8, 0],
    [state.indices[0], 12, 0], [state.indices[0], 8, 4], [state.indices[0], 8, 0.5], ['126', 8, 1],
    [state.years.indexOf(2027), 8, 1], [state.indices[0], 7, 1]]) {
    assert.equal(resolveMondayPickerDate(state, value), null)
    const context = pickerContext('2026-09-14')
    context.onConfirm({ detail: { value } })
    assert.deepEqual(context.events, [])
    assert.equal(context.properties.value, '2026-09-14')
  }
  assert.equal(resolveMondayPickerDate({ ...state, dates: ['2026-09-15'] }, [state.indices[0], 8, 0]), null)
  for (const [column, value] of [[-1, 0], [3, 0], [0.5, 0], [0, -1], [1, 12], [2, 4], [2, 0.5]]) {
    assert.equal(changeMondayPickerColumn(state, column, value), state)
  }
  for (const [year, month] of [[2026, 0], [2026, 13], [2026, 1.5], [999, 1], [10000, 1], [2026.5, 1]]) {
    assert.deepEqual(mondaysInMonth(year, month), [])
  }
})

test('两个入口共用组件，确认只更新页面，原保存与导入流程仍可使用日期', () => {
  writes = 0
  storage = new Map([['timetable_courses', {
    schemaVersion: constants.SCHEMA_VERSION,
    term: { startDate: '2026-09-14', totalWeeks: 18 },
    courses: [],
    periodSettings: structuredClone(constants.DEFAULT_PERIOD_SETTINGS),
  }]])
  const original = structuredClone(storage.get('timetable_courses'))
  const term = pageContext(termPage)
  term.onLoad({})
  const imported = pageContext(importPage)
  imported.onInput({ detail: { value: JSON.stringify({
    app: 'qige-timetable', backupVersion: 1, exportedAt: '2026-09-06T08:00:00.000Z',
    data: { schemaVersion: 1, courses: [] },
  }) } })
  imported.onParse()
  assert.equal(imported.data.needsTerm, true)
  assert.equal(imported.data.termStartDate, '2026-09-14')
  for (const [page, field, handler] of [[term, 'startDate', 'onDateChange'], [imported, 'termStartDate', 'onTermDate']]) {
    const context = pickerContext(page.data[field], page[handler])
    context.onColumnChange({ detail: { column: 1, value: 7 } })
    context.resetSelection()
    assert.equal(page.data[field], '2026-09-14')
    context.onColumnChange({ detail: { column: 2, value: 2 } })
    context.onConfirm({ detail: { value: [...context.data.picker.indices] } })
    assert.equal(page.data[field], '2026-09-21')
  }
  assert.deepEqual(imported.buildImportTerm(), { startDate: '2026-09-21', totalWeeks: 18 })
  assert.equal(writes, 0)
  assert.deepEqual(storage.get('timetable_courses'), original)
  for (const page of ['term-settings', 'data-manage']) {
    const config = JSON.parse(readFileSync(new URL(`../miniprogram/pages/${page}/index.json`, import.meta.url), 'utf8'))
    const markup = readFileSync(new URL(`../miniprogram/pages/${page}/index.wxml`, import.meta.url), 'utf8')
    assert.equal(config.usingComponents['monday-picker'], '/components/monday-picker/index')
    assert.match(markup, /<monday-picker/)
    assert.match(markup, /（周一）/)
    assert.match(markup, /日期列表仅显示星期一/)
    assert.doesNotMatch(markup, /mode="date"/)
  }
  const markup = readFileSync(new URL('../miniprogram/components/monday-picker/index.wxml', import.meta.url), 'utf8')
  assert.match(markup, /mode="multiSelector"/)
  assert.match(markup, /bindcancel="resetSelection"/)
})

test('本地日期在夏令时与正负时区下保持正确', () => {
  const registerUrl = new URL('./helpers/register-typescript.mjs', import.meta.url).href
  const helperUrl = new URL('../miniprogram/utils/monday-picker.ts', import.meta.url).href
  const source = `import ${JSON.stringify(registerUrl)}; const { buildMondayPickerState, resolveMondayPickerDate, mondaysInMonth } = await import(${JSON.stringify(helperUrl)}); const state = buildMondayPickerState('2026-09-14', new Date(2026, 8, 15)); process.stdout.write(JSON.stringify([resolveMondayPickerDate(state, state.indices), mondaysInMonth(2026, 3)]));`
  for (const timezone of ['Asia/Shanghai', 'America/New_York', 'Pacific/Kiritimati']) {
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', source], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), ['2026-09-14', ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']])
  }
})
