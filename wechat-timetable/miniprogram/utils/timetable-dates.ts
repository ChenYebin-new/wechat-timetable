import type { TermSettings } from '../models/course'
import { formatLocalDate, parseLocalDate, validateTerm, weekDateRange } from './term'

export interface TimetableDate {
  weekday: string
  date: number
  dateKey: string
  isToday: boolean
}

/** Dates follow the displayed teaching week, including month/year boundaries. */
export function buildWeekDates(term: TermSettings | null, week: number, now = new Date()) {
  const range = term && validateTerm(term).ok ? weekDateRange(term, week) : null
  if (!range) return { monthLabel: '', days: [] as TimetableDate[] }
  const todayKey = formatLocalDate(now)
  const weekdays = ['一', '二', '三', '四', '五', '六', '日']
  const days = weekdays.map((weekday, index) => {
    const day = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + index)
    const dateKey = formatLocalDate(day)
    return { weekday, date: day.getDate(), dateKey, isToday: dateKey === todayKey }
  })
  const firstMonth = range.start.getMonth() + 1
  const lastMonth = range.end.getMonth() + 1
  return { monthLabel: firstMonth === lastMonth ? String(firstMonth) : `${firstMonth}/${lastMonth}`, days }
}

/** Keep the existing spring/autumn boundary while spelling out the academic year. */
export function formatAcademicTerm(term: TermSettings | null): string {
  const start = term ? parseLocalDate(term.startDate) : null
  if (!start) return '设置学期'
  const year = start.getFullYear()
  return start.getMonth() >= 6 ? `${year}–${year + 1}第一学期` : `${year - 1}–${year}第二学期`
}
