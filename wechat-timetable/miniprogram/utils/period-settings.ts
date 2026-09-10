import type { PeriodOverride, PeriodSettings, PeriodTime } from '../models/course'
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

export interface PeriodSettingsResult extends PeriodSettingsValidation {
  settings?: PeriodSettings
  conflictPeriod?: number
}

export interface PeriodEditInput {
  period: number
  start: string
  end: string
  startChanged: boolean
  endChanged: boolean
}

function cloneOverride(override: PeriodOverride): PeriodOverride {
  return {
    period: override.period,
    ...(override.start !== undefined ? { start: override.start } : {}),
    ...(override.durationMinutes !== undefined ? { durationMinutes: override.durationMinutes } : {}),
  }
}

function canonicalOverrides(overrides: PeriodOverride[]): PeriodOverride[] {
  return overrides
    .filter((override) => override.start !== undefined || override.durationMinutes !== undefined)
    .map(cloneOverride)
    .sort((a, b) => a.period - b.period)
}

export function clonePeriodSettings(settings: PeriodSettings = DEFAULT_PERIOD_SETTINGS): PeriodSettings {
  return {
    durationMinutes: settings.durationMinutes,
    breakMinutes: settings.breakMinutes,
    firstStart: settings.firstStart,
    overrides: settings.overrides.map(cloneOverride),
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

function validateRuleValues(durationMinutes: number, breakMinutes: number): string | null {
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 180) {
    return '每节课时长需要在 1–180 分钟之间'
  }
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 120) {
    return '课间休息需要在 0–120 分钟之间'
  }
  return null
}

function validatePeriodCount(periods: unknown): string | null {
  if (!Array.isArray(periods) || periods.length < MIN_PERIODS || periods.length > MAX_PERIODS) {
    return `每日课程数需要在 ${MIN_PERIODS}–${MAX_PERIODS} 节之间`
  }
  return null
}

function validateMaterializedPeriods(periods: unknown): PeriodSettingsValidation {
  const countReason = validatePeriodCount(periods)
  if (countReason) return { ok: false, reason: countReason }
  let previousEnd = -1
  for (let index = 0; index < (periods as PeriodTime[]).length; index++) {
    const period = (periods as PeriodTime[])[index]
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

export function reflowPeriodSettings(settings: PeriodSettings): PeriodSettingsResult {
  const ruleReason = validateRuleValues(settings.durationMinutes, settings.breakMinutes)
  if (ruleReason) return { ok: false, reason: ruleReason }
  const countReason = validatePeriodCount(settings.periods)
  if (countReason) return { ok: false, reason: countReason }
  const firstStart = timeToMinutes(settings.firstStart)
  if (firstStart === null) return { ok: false, reason: '第一节开始时间需要使用 HH:mm 格式' }
  if (!Array.isArray(settings.overrides)) return { ok: false, reason: '自定义课程时间不是有效数组' }

  const byPeriod = new Map<number, PeriodOverride>()
  for (const override of settings.overrides) {
    if (!override || typeof override !== 'object') return { ok: false, reason: '自定义课程时间格式不正确' }
    if (!Number.isInteger(override.period) || override.period < 1 || override.period > settings.periods.length) {
      return { ok: false, reason: `自定义节次需要在 1–${settings.periods.length} 之间` }
    }
    if (byPeriod.has(override.period)) return { ok: false, reason: `第 ${override.period} 节存在重复自定义设置` }
    if (override.start !== undefined) {
      if (override.period === 1) return { ok: false, reason: '第一节开始时间应通过 firstStart 设置' }
      if (typeof override.start !== 'string' || timeToMinutes(override.start) === null) {
        return { ok: false, reason: `第 ${override.period} 节自定义开始时间格式不正确` }
      }
    }
    if (
      override.durationMinutes !== undefined &&
      (!Number.isInteger(override.durationMinutes) || override.durationMinutes < 1 || override.durationMinutes > 180)
    ) {
      return { ok: false, reason: `第 ${override.period} 节自定义时长需要在 1–180 分钟之间` }
    }
    if (override.start === undefined && override.durationMinutes === undefined) {
      return { ok: false, reason: `第 ${override.period} 节自定义设置为空` }
    }
    byPeriod.set(override.period, override)
  }

  const periods: PeriodTime[] = []
  let previousEnd = -1
  for (let index = 0; index < settings.periods.length; index++) {
    const periodNumber = index + 1
    const override = byPeriod.get(periodNumber)
    const computedStart = index === 0 ? firstStart : previousEnd + settings.breakMinutes
    const start = override?.start !== undefined ? timeToMinutes(override.start) : computedStart
    if (start === null) return { ok: false, reason: `第 ${periodNumber} 节自定义开始时间格式不正确` }
    if (index > 0 && start < previousEnd) {
      return {
        ok: false,
        conflictPeriod: periodNumber,
        reason: `第 ${periodNumber} 节的手动开始时间早于第 ${periodNumber - 1} 节结束时间，请调整该锚点或缩短前面的课程`,
      }
    }
    const duration = override?.durationMinutes ?? settings.durationMinutes
    const end = start + duration
    const startText = minutesToTime(start)
    const endText = minutesToTime(end)
    if (!startText || !endText) {
      return {
        ok: false,
        conflictPeriod: periodNumber,
        reason: `按当前规则计算后第 ${periodNumber} 节会跨越当天 24:00，请缩短时长、课间或课程数`,
      }
    }
    periods.push({ start: startText, end: endText })
    previousEnd = end
  }

  return {
    ok: true,
    settings: {
      durationMinutes: settings.durationMinutes,
      breakMinutes: settings.breakMinutes,
      firstStart: settings.firstStart,
      overrides: canonicalOverrides(settings.overrides),
      periods,
    },
  }
}

export function validatePeriodSettings(settings: unknown): PeriodSettingsValidation {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, reason: '课程时间设置不是有效对象' }
  }
  const value = settings as PeriodSettings
  const materializedCheck = validateMaterializedPeriods(value.periods)
  if (!materializedCheck.ok) return materializedCheck
  const result = reflowPeriodSettings(value)
  if (!result.ok || !result.settings) return { ok: false, reason: result.reason }
  if (
    result.settings.periods.some(
      (period, index) => period.start !== value.periods[index].start || period.end !== value.periods[index].end,
    )
  ) {
    return { ok: false, reason: '课程时间与当前规则或自定义设置不一致' }
  }
  if (JSON.stringify(result.settings.overrides) !== JSON.stringify(value.overrides)) {
    return { ok: false, reason: '自定义课程时间需要按节次升序保存且不能包含空项' }
  }
  return { ok: true }
}

/** 将 V4 的完整时间数组转换为 V5 规则、锚点和自定义时长。 */
export function migrateV4PeriodSettings(settings: unknown): PeriodSettings | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const value = settings as { durationMinutes?: unknown; breakMinutes?: unknown; periods?: unknown }
  if (typeof value.durationMinutes !== 'number' || typeof value.breakMinutes !== 'number') return null
  const ruleReason = validateRuleValues(value.durationMinutes, value.breakMinutes)
  if (ruleReason) return null
  const materializedCheck = validateMaterializedPeriods(value.periods)
  if (!materializedCheck.ok) return null

  const legacyPeriods = value.periods as PeriodTime[]
  const overrides: PeriodOverride[] = []
  for (let index = 0; index < legacyPeriods.length; index++) {
    const periodNumber = index + 1
    const start = timeToMinutes(legacyPeriods[index].start) as number
    const end = timeToMinutes(legacyPeriods[index].end) as number
    const override: PeriodOverride = { period: periodNumber }
    if (index > 0) {
      const previousEnd = timeToMinutes(legacyPeriods[index - 1].end) as number
      if (start !== previousEnd + value.breakMinutes) override.start = legacyPeriods[index].start
    }
    if (end - start !== value.durationMinutes) override.durationMinutes = end - start
    if (override.start !== undefined || override.durationMinutes !== undefined) overrides.push(override)
  }

  const migrated: PeriodSettings = {
    durationMinutes: value.durationMinutes,
    breakMinutes: value.breakMinutes,
    firstStart: legacyPeriods[0].start,
    overrides,
    periods: legacyPeriods.map((period) => ({ ...period })),
  }
  return validatePeriodSettings(migrated).ok ? migrated : null
}

export function buildPeriodViews(settings: PeriodSettings): PeriodView[] {
  const byPeriod = new Map(settings.overrides.map((override) => [override.period, override]))
  return settings.periods.map((period, index) => {
    const override = byPeriod.get(index + 1)
    const labels: string[] = []
    if (override?.start !== undefined) labels.push('开始')
    if (override?.durationMinutes !== undefined) labels.push('时长')
    return {
      index: index + 1,
      label: `第${index + 1}节`,
      time: `${period.start}–${period.end}`,
      start: period.start,
      end: period.end,
      isCustom: labels.length > 0,
      customLabel: labels.length > 0 ? `自定义${labels.join('、')}` : '',
    }
  })
}

export function generatePeriods(
  firstStart: string,
  count: number,
  durationMinutes: number,
  breakMinutes: number,
): PeriodTime[] | null {
  if (!Number.isInteger(count) || count < MIN_PERIODS || count > MAX_PERIODS) return null
  const seed: PeriodSettings = {
    durationMinutes,
    breakMinutes,
    firstStart,
    overrides: [],
    periods: Array.from({ length: count }, () => ({ start: firstStart, end: firstStart })),
  }
  return reflowPeriodSettings(seed).settings?.periods ?? null
}

export function resizePeriods(settings: PeriodSettings, count: number): PeriodSettings | null {
  if (!Number.isInteger(count) || count < MIN_PERIODS || count > MAX_PERIODS) return null
  const next = clonePeriodSettings(settings)
  next.periods = Array.from({ length: count }, (_, index) => next.periods[index] || { start: next.firstStart, end: next.firstStart })
  next.overrides = next.overrides.filter((override) => override.period <= count)
  return reflowPeriodSettings(next).settings ?? null
}

function upsertOverride(settings: PeriodSettings, period: number, changes: Partial<PeriodOverride>): void {
  const existing = settings.overrides.find((override) => override.period === period)
  const next: PeriodOverride = { period, ...(existing ? cloneOverride(existing) : {}), ...changes }
  if (next.start === undefined) delete next.start
  if (next.durationMinutes === undefined) delete next.durationMinutes
  settings.overrides = settings.overrides.filter((override) => override.period !== period)
  if (next.start !== undefined || next.durationMinutes !== undefined) settings.overrides.push(next)
  settings.overrides = canonicalOverrides(settings.overrides)
}

export function updatePeriodTime(settings: PeriodSettings, input: PeriodEditInput): PeriodSettingsResult {
  if (!Number.isInteger(input.period) || input.period < 1 || input.period > settings.periods.length) {
    return { ok: false, reason: '要编辑的节次超出范围' }
  }
  const start = timeToMinutes(input.start)
  const end = timeToMinutes(input.end)
  if (start === null || end === null) return { ok: false, reason: '开始和结束时间需要使用 HH:mm 格式' }
  if (start >= end) return { ok: false, reason: '开始时间必须早于结束时间' }
  const duration = end - start
  if (duration > 180) return { ok: false, reason: '单节自定义时长不能超过 180 分钟' }

  const next = clonePeriodSettings(settings)
  const index = input.period - 1
  if (input.startChanged) {
    if (input.period === 1) {
      next.firstStart = input.start
    } else {
      const previousEnd = timeToMinutes(next.periods[index - 1].end) as number
      const ruleStart = minutesToTime(previousEnd + next.breakMinutes)
      upsertOverride(next, input.period, { start: input.start === ruleStart ? undefined : input.start })
    }
  }
  if (input.endChanged) {
    upsertOverride(next, input.period, {
      durationMinutes: duration === next.durationMinutes ? undefined : duration,
    })
  }
  return reflowPeriodSettings(next)
}

export function clearPeriodOverrides(settings: PeriodSettings): PeriodSettingsResult {
  const next = clonePeriodSettings(settings)
  next.overrides = []
  return reflowPeriodSettings(next)
}

export function samePeriodSettings(a: PeriodSettings, b: PeriodSettings): boolean {
  return (
    a.durationMinutes === b.durationMinutes &&
    a.breakMinutes === b.breakMinutes &&
    a.firstStart === b.firstStart &&
    JSON.stringify(a.overrides) === JSON.stringify(b.overrides) &&
    a.periods.length === b.periods.length &&
    a.periods.every((period, index) => period.start === b.periods[index].start && period.end === b.periods[index].end)
  )
}
