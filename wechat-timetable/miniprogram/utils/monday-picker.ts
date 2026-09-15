import { formatLocalDate, parseLocalDate } from './local-date'
import { currentMonday } from './term'

export interface MondayPickerState {
  years: number[]
  dates: string[]
  range: string[][]
  indices: [number, number, number]
}

/** 列出指定年月的所有星期一，按本地自然日计算。 */
export function mondaysInMonth(year: number, month: number): string[] {
  if (!Number.isInteger(year) || year < 1000 || year > 9999
    || !Number.isInteger(month) || month < 1 || month > 12) return []
  const first = new Date(year, month - 1, 1)
  const firstMonday = 1 + (8 - first.getDay()) % 7
  const lastDay = new Date(year, month, 0).getDate()
  const dates: string[] = []
  for (let day = firstMonday; day <= lastDay; day += 7) {
    dates.push(formatLocalDate(new Date(year, month - 1, day)))
  }
  return dates
}

function dateLabels(dates: string[]): string[] {
  return dates.map((date) => `${Number(date.slice(8))} 日（周一）`)
}

/** 默认覆盖 1900–2100 年，并覆盖当前年份和已有学期日期。 */
export function buildMondayPickerState(value: string, now: Date = new Date()): MondayPickerState {
  const parsed = parseLocalDate(value)
  const selected = parsed && parsed.getDay() === 1 ? parsed : parseLocalDate(currentMonday(now))!
  const year = selected.getFullYear()
  const month = selected.getMonth() + 1
  const years: number[] = []
  for (let item = Math.min(1900, now.getFullYear(), year); item <= Math.max(2100, now.getFullYear(), year); item++) {
    years.push(item)
  }
  const dates = mondaysInMonth(year, month)
  return {
    years,
    dates,
    range: [years.map((item) => `${item} 年`), Array.from({ length: 12 }, (_, index) => `${index + 1} 月`), dateLabels(dates)],
    indices: [years.indexOf(year), month - 1, dates.indexOf(formatLocalDate(selected))],
  }
}

/** 年月联动只改变选择器草稿；切换年月后定位第一个星期一。 */
export function changeMondayPickerColumn(state: MondayPickerState, column: number, value: number): MondayPickerState {
  if (!Number.isInteger(column) || column < 0 || column > 2
    || !Number.isInteger(value) || value < 0 || value >= state.range[column].length) return state
  const indices: [number, number, number] = [...state.indices]
  indices[column] = value
  if (column === 2) return { ...state, indices }
  const dates = mondaysInMonth(state.years[indices[0]], indices[1] + 1)
  indices[2] = 0
  return { ...state, dates, range: [state.range[0], state.range[1], dateLabels(dates)], indices }
}

/** 只接受当前候选列表中、与确认年月一致的有效星期一。 */
export function resolveMondayPickerDate(state: MondayPickerState, value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((index, column) => !Number.isInteger(index) || index < 0 || index >= state.range[column].length)) return null
  const date = state.dates[value[2]]
  const parsed = parseLocalDate(date)
  if (!parsed || parsed.getDay() !== 1 || parsed.getFullYear() !== state.years[value[0]]
    || parsed.getMonth() !== value[1]) return null
  return date
}
