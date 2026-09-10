import type { PeriodSettings, PeriodTime } from '../models/course'
import {
  DEFAULT_PERIOD_SETTINGS,
  MAX_PERIODS,
  MIN_PERIODS,
  type PeriodView,
} from '../constants/timetable'

export interface PeriodSettingsValidation {
  ok: boolean
  reason?: string
}

export function clonePeriodSettings(settings: PeriodSettings = DEFAULT_PERIOD_SETTINGS): PeriodSettings {
  return {
    durationMinutes: settings.durationMinutes,
    breakMinutes: settings.breakMinutes,
    periods: settings.periods.map((period) => ({ ...period })),
  }
}

export function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

export function minutesToTime(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) return null
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function validatePeriodSettings(settings: unknown): PeriodSettingsValidation {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, reason: '课程时间设置不是有效对象' }
  }
  const value = settings as PeriodSettings
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 1 || value.durationMinutes > 180) {
    return { ok: false, reason: '每节课时长需要在 1–180 分钟之间' }
  }
  if (!Number.isInteger(value.breakMinutes) || value.breakMinutes < 0 || value.breakMinutes > 120) {
    return { ok: false, reason: '课间休息需要在 0–120 分钟之间' }
  }
  if (!Array.isArray(value.periods) || value.periods.length < MIN_PERIODS || value.periods.length > MAX_PERIODS) {
    return { ok: false, reason: `每日课程数需要在 ${MIN_PERIODS}–${MAX_PERIODS} 节之间` }
  }
  let previousEnd = -1
  for (let index = 0; index < value.periods.length; index++) {
    const period = value.periods[index]
    if (!period || typeof period.start !== 'string' || typeof period.end !== 'string') {
      return { ok: false, reason: `第 ${index + 1} 节时间格式不正确` }
    }
    const start = timeToMinutes(period.start)
    const end = timeToMinutes(period.end)
    if (start === null || end === null) {
      return { ok: false, reason: `第 ${index + 1} 节需要使用 HH:mm 时间格式` }
    }
    if (start >= end) return { ok: false, reason: `第 ${index + 1} 节开始时间必须早于结束时间` }
    if (start < previousEnd) return { ok: false, reason: `第 ${index} 节与第 ${index + 1} 节时间重叠` }
    previousEnd = end
  }
  return { ok: true }
}

export function buildPeriodViews(settings: PeriodSettings): PeriodView[] {
  return settings.periods.map((period, index) => ({
    index: index + 1,
    label: `第${index + 1}节`,
    time: `${period.start}–${period.end}`,
    start: period.start,
    end: period.end,
  }))
}

export function generatePeriods(
  firstStart: string,
  count: number,
  durationMinutes: number,
  breakMinutes: number,
): PeriodTime[] | null {
  if (!Number.isInteger(count) || count < MIN_PERIODS || count > MAX_PERIODS) return null
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 180) return null
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 120) return null
  const seed = timeToMinutes(firstStart)
  if (seed === null) return null
  const periods: PeriodTime[] = []
  let start = seed
  for (let index = 0; index < count; index++) {
    const end = start + durationMinutes
    const startText = minutesToTime(start)
    const endText = minutesToTime(end)
    if (!startText || !endText) return null
    periods.push({ start: startText, end: endText })
    start = end + breakMinutes
  }
  return periods
}

export function resizePeriods(settings: PeriodSettings, count: number): PeriodSettings | null {
  if (!Number.isInteger(count) || count < MIN_PERIODS || count > MAX_PERIODS) return null
  const next = clonePeriodSettings(settings)
  if (count <= next.periods.length) {
    next.periods = next.periods.slice(0, count)
    return next
  }
  const last = next.periods[next.periods.length - 1]
  let start = timeToMinutes(last.end)
  if (start === null) return null
  start += next.breakMinutes
  while (next.periods.length < count) {
    const end = start + next.durationMinutes
    const startText = minutesToTime(start)
    const endText = minutesToTime(end)
    if (!startText || !endText) return null
    next.periods.push({ start: startText, end: endText })
    start = end + next.breakMinutes
  }
  return next
}

export function samePeriodSettings(a: PeriodSettings, b: PeriodSettings): boolean {
  return (
    a.durationMinutes === b.durationMinutes &&
    a.breakMinutes === b.breakMinutes &&
    a.periods.length === b.periods.length &&
    a.periods.every((period, index) => period.start === b.periods[index].start && period.end === b.periods[index].end)
  )
}
