import { formatLocalDate, parseLocalDate } from './local-date'

export interface TodoCalendarDay {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
  isSelected: boolean
  hasGoals: boolean
  label: string
}

const weekdays = ['日', '一', '二', '三', '四', '五', '六']

function parseMonth(month: string): Date | null {
  return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)
    ? parseLocalDate(`${month}-01`)
    : null
}

/** 月份浏览不改变所选日期；超出本地日期工具支持范围时保持原月份。 */
export function offsetTodoCalendarMonth(month: string, offset: number): string {
  const date = parseMonth(month)
  if (!date || !Number.isInteger(offset)) return month
  date.setMonth(date.getMonth() + offset)
  const value = formatLocalDate(date).slice(0, -3)
  return parseMonth(value) ? value : month
}

/** 周日起始的固定六周月历；仅由调用者提供的日期集合生成目标圆点。 */
export function buildTodoCalendar(
  month: string,
  selectedDate: string,
  today: string,
  goalDates: ReadonlySet<string>,
): { label: string; days: TodoCalendarDay[] } {
  const first = parseMonth(month)
  if (!first) return { label: '', days: [] }

  const start = new Date(first.getTime())
  start.setDate(start.getDate() - start.getDay())
  const end = new Date(start.getTime())
  end.setDate(end.getDate() + 41)
  if (!parseLocalDate(formatLocalDate(start)) || !parseLocalDate(formatLocalDate(end))) {
    return { label: '', days: [] }
  }

  const days = Array.from({ length: 42 }, (_, index): TodoCalendarDay => {
    const date = new Date(start.getTime())
    date.setDate(date.getDate() + index)
    const value = formatLocalDate(date)
    const isToday = value === today
    const isSelected = value === selectedDate
    const hasGoals = goalDates.has(value)
    const labels = [`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`, `星期${weekdays[date.getDay()]}`]
    if (isToday) labels.push('今天')
    if (isSelected) labels.push('已选择')
    if (hasGoals) labels.push('有目标')
    return {
      date: value,
      day: date.getDate(),
      inMonth: value.slice(0, 7) === month,
      isToday,
      isSelected,
      hasGoals,
      label: labels.join('，'),
    }
  })

  return { label: `${first.getFullYear()}年${first.getMonth() + 1}月`, days }
}
