import assert from 'node:assert/strict'
import test from 'node:test'
import './helpers/register-typescript.mjs'

const { buildWeekDates, formatAcademicTerm } = await import('../miniprogram/utils/timetable-dates.ts')
const { buildDaySlots, computeCardStyle, timetableGridHeightRpx, timetableGridHeightStyle, timetableMetrics } = await import('../miniprogram/utils/timetable-layout.ts')
let grid
globalThis.Component = definition => { grid = definition }
await import('../miniprogram/components/timetable-grid/index.ts')

const autumn = { startDate: '2026-08-31', totalWeeks: 18 }
const localDate = (year, month, date, hour = 12) => new Date(year, month - 1, date, hour)

test('aqua dates follow the viewed teaching week and mark today only inside that week', () => {
  const now = localDate(2026, 10, 25, 23)
  const current = buildWeekDates(autumn, 8, now)
  assert.equal(current.monthLabel, '10')
  assert.deepEqual(current.days.map(day => day.weekday), ['一', '二', '三', '四', '五', '六', '日'])
  assert.deepEqual(current.days.map(day => day.date), [19, 20, 21, 22, 23, 24, 25])
  assert.deepEqual(current.days.filter(day => day.isToday).map(day => day.dateKey), ['2026-10-25'])
  const earlier = buildWeekDates(autumn, 7, now)
  assert.equal(earlier.days[0].dateKey, '2026-10-12')
  assert.equal(earlier.days[6].dateKey, '2026-10-18')
  assert.ok(earlier.days.every(day => !day.isToday))
  assert.equal(buildWeekDates(autumn, 8, localDate(2026, 10, 25, 0)).days[6].isToday, true)
})

test('aqua month headings remain accurate across month, year and leap-day boundaries', () => {
  const crossMonth = buildWeekDates(autumn, 9, localDate(2026, 11, 1))
  assert.equal(crossMonth.monthLabel, '10/11')
  assert.deepEqual(crossMonth.days.map(day => day.date), [26, 27, 28, 29, 30, 31, 1])
  assert.equal(crossMonth.days[6].dateKey, '2026-11-01')
  const crossYear = buildWeekDates({ startDate: '2026-12-28', totalWeeks: 2 }, 1, localDate(2027, 1, 1))
  assert.equal(crossYear.monthLabel, '12/1')
  assert.equal(crossYear.days[0].dateKey, '2026-12-28')
  assert.equal(crossYear.days[6].dateKey, '2027-01-03')
  assert.equal(crossYear.days.find(day => day.isToday).dateKey, '2027-01-01')
  const leap = buildWeekDates({ startDate: '2028-02-28', totalWeeks: 2 }, 1, localDate(2028, 2, 29))
  assert.equal(leap.monthLabel, '2/3')
  assert.deepEqual(leap.days.map(day => day.date), [28, 29, 1, 2, 3, 4, 5])
  assert.equal(leap.days[1].isToday, true)
})

test('missing or invalid terms and out-of-range weeks do not invent calendar dates', () => {
  const empty = { monthLabel: '', days: [] }
  for (const term of [null, { startDate: 'bad', totalWeeks: 18 }, { startDate: '2026-02-30', totalWeeks: 18 }, { startDate: '2026-09-01', totalWeeks: 18 }, { ...autumn, totalWeeks: 0 }, { ...autumn, totalWeeks: 31 }]) {
    assert.deepEqual(buildWeekDates(term, 1), empty)
  }
  for (const week of [0, -1, 1.5, NaN, Infinity, 19]) assert.deepEqual(buildWeekDates(autumn, week), empty)
})

test('academic-year text preserves the existing July autumn boundary', () => {
  assert.equal(formatAcademicTerm(autumn), '2026–2027第一学期')
  assert.equal(formatAcademicTerm({ startDate: '2026-07-06', totalWeeks: 18 }), '2026–2027第一学期')
  assert.equal(formatAcademicTerm({ startDate: '2026-06-29', totalWeeks: 18 }), '2025–2026第二学期')
  assert.equal(formatAcademicTerm({ startDate: '2026-01-05', totalWeeks: 18 }), '2025–2026第二学期')
  assert.equal(formatAcademicTerm(null), '设置学期')
  assert.equal(formatAcademicTerm({ startDate: 'invalid', totalWeeks: 18 }), '设置学期')
})

function course(overrides = {}) {
  return { id: 'aqua-course', groupId: 'shared-group', name: '概率论与数理统计II', location: '巡天楼T1 409', day: 1, startPeriod: 5, endPeriod: 6, color: '#abcdef', weekMode: 'all', weeks: [1, 2, 3], createdAt: 1, updatedAt: 1, ...overrides }
}

test('aqua course spans align with their rows at the first and last periods', () => {
  assert.deepEqual(timetableMetrics('aqua'), { cellHeight: 140, headHeight: 120, padding: 0, cardInset: 0 })
  assert.equal(computeCardStyle(course({ startPeriod: 1, endPeriod: 1 }), 'aqua'), 'top: calc(var(--cell-height) * 0); height: calc(var(--cell-height) * 1);')
  assert.equal(computeCardStyle(course(), 'aqua'), 'top: calc(var(--cell-height) * 4); height: calc(var(--cell-height) * 2);')
  assert.equal(computeCardStyle(course({ startPeriod: 13, endPeriod: 14 }), 'aqua'), 'top: calc(var(--cell-height) * 12); height: calc(var(--cell-height) * 2);')
  assert.equal(timetableGridHeightRpx(1, 'aqua'), 260)
  assert.equal(timetableGridHeightRpx(14, 'aqua'), 2080)
  for (const theme of [undefined, 'cream', 'campus', 'paper', 'swiss', 'pixel', 'unknown']) {
    assert.deepEqual(timetableMetrics(theme), { cellHeight: 124, headHeight: 80, padding: 16, cardInset: 4 })
    assert.equal(computeCardStyle(course(), theme), 'top: 500rpx; height: 240rpx;')
    assert.equal(timetableGridHeightRpx(14, theme), 1832)
    assert.equal(timetableGridHeightStyle(14, theme), '1832rpx')
  }
})

// WeChat converts each rpx declaration to whole pixels before CSS calc runs.
// Keep this small evaluator limited to lengths, variables, sums and products.
function nativeLength(expression, width, variables = {}) {
  const source = expression.trim().replace(/^calc\((.*)\)$/, '$1')
  return source.split('+').reduce((sum, term) => sum + term.split('*').reduce((product, factor) => {
    const value = factor.trim()
    const variable = value.match(/^var\((--[a-z-]+)\)$/)
    if (variable) {
      assert.ok(variable[1] in variables, `Unknown CSS variable: ${value}`)
      return product * nativeLength(variables[variable[1]], width, variables)
    }
    const literal = value.match(/^(\d+(?:\.\d+)?)(rpx|px)?$/)
    assert.ok(literal, `Unsupported length in geometry test: ${value}`)
    const number = Number(literal[1])
    return product * (literal[2] === 'rpx' ? Math.floor(number * width / 750) : number)
  }, 1), 0)
}

test('aqua positions and container height follow rounded native rows at every supported width', () => {
  for (const width of [320, 360, 375, 390, 393, 430, 768]) {
    const row = Math.floor(140 * width / 750)
    const header = Math.floor(120 * width / 750)
    const variables = { '--cell-height': '140rpx' }
    for (const [start, end] of [[1, 1], [1, 2], [3, 4], [5, 6], [7, 8], [13, 14], [14, 14], [1, 14]]) {
      const style = computeCardStyle(course({ startPeriod: start, endPeriod: end }), 'aqua')
      const declarations = Object.fromEntries(style.split(';').filter(Boolean).map(declaration => declaration.split(':').map(part => part.trim())))
      const top = nativeLength(declarations.top, width, variables)
      const height = nativeLength(declarations.height, width, variables)
      assert.equal(top, (start - 1) * row, `${width}px: period ${start} top`)
      assert.equal(height, (end - start + 1) * row, `${width}px: periods ${start}–${end} height`)
      assert.equal(top + height, end * row, `${width}px: period ${end} bottom`)
    }
    for (const count of [1, 9, 14]) assert.equal(nativeLength(timetableGridHeightStyle(count, 'aqua'), width), header + count * row, `${width}px: ${count} rows fit the swiper`)
  }
  // At the reproduced 390px width the old pre-multiplied rpx drifted by 3px.
  assert.notEqual(nativeLength('560rpx', 390), 4 * nativeLength('140rpx', 390))
})

test('switching aqua grid geometry retains the source schedule, group colors and selection identities', () => {
  const courses = [course(), course({ id: 'second-slot', day: 4, startPeriod: 13, endPeriod: 14 })]
  const source = buildDaySlots(courses)
  const before = structuredClone(source)
  const context = {
    properties: { themeId: 'paper', periods: Array.from({ length: 14 }, (_, index) => ({ index: index + 1 })), daySlots: source, selectedKeys: ['2-3', '2-4'], disabledKeys: ['1-5', '1-6'] },
    data: {}, ...grid.methods,
    setData(patch) { Object.assign(this.data, patch) },
  }
  context.rebuildColumns()
  const originalCells = context.data.columns.map(column => structuredClone(column.cells))
  const originalStyles = context.data.columns.map(column => column.slots.map(slot => slot.style))
  context.properties.themeId = 'aqua'
  context.rebuildColumns()
  assert.deepEqual(context.data.columns.map(column => column.cells), originalCells)
  assert.equal(context.data.columns[0].slots[0].style, 'top: calc(var(--cell-height) * 4); height: calc(var(--cell-height) * 2);')
  assert.equal(context.data.columns[3].slots[0].style, 'top: calc(var(--cell-height) * 12); height: calc(var(--cell-height) * 2);')
  assert.equal(context.data.columns[0].slots[0].backgroundColor, context.data.columns[3].slots[0].backgroundColor)
  assert.deepEqual(source, before)
  context.properties.themeId = 'paper'
  context.rebuildColumns()
  assert.deepEqual(context.data.columns.map(column => column.slots.map(slot => slot.style)), originalStyles)
  assert.deepEqual(context.data.columns.map(column => column.cells), originalCells)
  assert.deepEqual(source, before)
})
