import assert from 'node:assert/strict'
import { test } from 'node:test'
import './helpers/register-typescript.mjs'
const { formatLocalDate, parseLocalDate } = await import('../miniprogram/utils/local-date.ts')
const { buildTodoCalendar, offsetTodoCalendarMonth } = await import('../miniprogram/utils/todo-calendar.ts')

function calendar(month, selectedDate = '', today = '', goalDates = new Set()) {
  return buildTodoCalendar(month, selectedDate, today, goalDates)
}

function assertSixConsecutiveWeeks(days) {
  assert.equal(days.length, 42)
  assert.equal(new Set(days.map((day) => day.date)).size, 42)
  assert.equal(parseLocalDate(days[0].date).getDay(), 0)
  assert.equal(parseLocalDate(days[41].date).getDay(), 6)
  for (let index = 0; index < days.length; index += 1) {
    const expected = parseLocalDate(days[0].date)
    expected.setDate(expected.getDate() + index)
    assert.equal(days[index].date, formatLocalDate(expected))
    assert.equal(days[index].day, expected.getDate())
    assert.ok(parseLocalDate(days[index].date))
  }
}

test('September 2026 matches the Sunday-first fixed six-row calendar', () => {
  const { label, days } = calendar('2026-09')
  assert.equal(label, '2026年9月')
  assert.deepEqual(days.slice(0, 7).map((day) => day.date), [
    '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
  ])
  assert.equal(days.at(-1).date, '2026-10-10')
  assert.equal(days.filter((day) => day.inMonth).length, 30)
  assertSixConsecutiveWeeks(days)
})

test('a Sunday-starting month does not insert a preceding week', () => {
  const { days } = calendar('2026-02')
  assert.equal(days[0].date, '2026-02-01')
  assert.equal(days.at(-1).date, '2026-03-14')
  assertSixConsecutiveWeeks(days)
})

test('a genuine six-week month keeps its final day in the sixth row', () => {
  const { days } = calendar('2026-05')
  assert.equal(days[0].date, '2026-04-26')
  assert.equal(days[35].date, '2026-05-31')
  assert.equal(days[35].inMonth, true)
  assertSixConsecutiveWeeks(days)
})

test('leap-year February includes February 29 without UTC conversion', () => {
  const { days } = calendar('2024-02')
  assert.equal(days.filter((day) => day.inMonth).length, 29)
  assert.equal(days.find((day) => day.date === '2024-02-29').day, 29)
  assertSixConsecutiveWeeks(days)
})

test('month grids cross year boundaries with local date strings', () => {
  const { days } = calendar('2026-01')
  assert.equal(days[0].date, '2025-12-28')
  assert.equal(days.at(-1).date, '2026-02-07')
  assertSixConsecutiveWeeks(days)
})

test('today and selection remain independent and have readable labels', () => {
  const { days } = calendar('2026-09', '2026-09-18', '2026-09-17')
  const today = days.find((day) => day.date === '2026-09-17')
  const selected = days.find((day) => day.date === '2026-09-18')
  assert.equal(today.isToday, true)
  assert.equal(today.isSelected, false)
  assert.equal(selected.isToday, false)
  assert.equal(selected.isSelected, true)
  assert.equal(today.label, '2026年9月17日，星期四，今天')
  assert.equal(selected.label, '2026年9月18日，星期五，已选择')
})

test('today can also be the selected day', () => {
  const day = calendar('2026-09', '2026-09-17', '2026-09-17').days.find((cell) => cell.isToday)
  assert.equal(day.isSelected, true)
  assert.equal(day.label, '2026年9月17日，星期四，今天，已选择')
})

test('one boolean dot represents a goal-date set, including neighboring dates', () => {
  const dates = new Set(['2026-08-31', '2026-09-18', '2026-09-18', '2026-10-01'])
  const { days } = calendar('2026-09', '2026-09-18', '2026-09-17', dates)
  assert.equal(days.filter((day) => day.hasGoals).length, 3)
  assert.equal(days.find((day) => day.date === '2026-08-31').inMonth, false)
  assert.equal(days.find((day) => day.date === '2026-08-31').hasGoals, true)
  assert.equal(days.find((day) => day.date === '2026-10-01').hasGoals, true)
  assert.equal(days.find((day) => day.date === '2026-09-18').label, '2026年9月18日，星期五，已选择，有目标')
  assert.equal(dates.size, 3, 'calendar generation does not mutate the supplied set')
})

test('rebuilding with an empty date set clears all previous dots', () => {
  assert.equal(calendar('2026-09', '', '', new Set(['2026-09-18'])).days.some((day) => day.hasGoals), true)
  assert.equal(calendar('2026-09').days.some((day) => day.hasGoals), false)
})

test('invalid month values return an empty calendar instead of throwing', () => {
  for (const month of ['', '2026-9', '2026-00', '2026-13', '2026-09-01', 'not-a-month', '0999-12']) {
    assert.deepEqual(calendar(month), { label: '', days: [] })
    assert.equal(offsetTodoCalendarMonth(month, 1), month)
  }
})

test('invalid selection and today strings do not produce false markers', () => {
  const { days } = calendar('2026-09', '2026-09-99', 'bad-date')
  assert.equal(days.some((day) => day.isToday || day.isSelected), false)
})

test('month offsets wrap years without inheriting a day-of-month overflow', () => {
  assert.equal(offsetTodoCalendarMonth('2026-12', 1), '2027-01')
  assert.equal(offsetTodoCalendarMonth('2026-01', -1), '2025-12')
  assert.equal(offsetTodoCalendarMonth('2026-09', 12), '2027-09')
  assert.equal(offsetTodoCalendarMonth('2026-09', -18), '2025-03')
  assert.equal(offsetTodoCalendarMonth('2026-09', 0), '2026-09')
})

test('invalid offsets and offsets beyond supported years preserve the month', () => {
  for (const offset of [NaN, Infinity, -Infinity, 1.5, 120000]) {
    assert.equal(offsetTodoCalendarMonth('2026-09', offset), '2026-09')
  }
  assert.equal(offsetTodoCalendarMonth('1000-01', -1), '1000-01')
  assert.equal(offsetTodoCalendarMonth('9999-12', 1), '9999-12')
})

test('boundary months with unsupported neighbors do not return malformed cells', () => {
  assert.deepEqual(calendar('1000-01'), { label: '', days: [] })
  assert.deepEqual(calendar('9999-12'), { label: '', days: [] })
})
