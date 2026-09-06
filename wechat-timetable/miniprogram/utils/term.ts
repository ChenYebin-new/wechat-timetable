// utils/term.ts
// 学期与教学周的日期计算、周次展开/规范化/交集与展示工具。
// 注意：日期计算一律按本地自然日处理，避免 UTC 偏移。

import type { TermSettings, WeekMode } from '../models/course'
import { MAX_TOTAL_WEEKS } from '../constants/timetable'

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
}

/** 解析 YYYY-MM-DD 为本地日期；非法返回 null。 */
export function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 把本地日期格式化为 YYYY-MM-DD。 */
export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 计算指定日期处于第几教学周。
 * 返回 1..totalWeeks；早于开始日或晚于学期最后一天返回 null。
 */
export function calcCurrentWeek(term: TermSettings | null, now: Date): number | null {
  if (!term) return null
  const start = parseLocalDate(term.startDate)
  if (!start) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000)
  if (diffDays < 0) return null
  const week = Math.floor(diffDays / 7) + 1
  if (week > term.totalWeeks) return null
  return week
}

/** 第 week 周的起止本地日期；越界返回 null。 */
export function weekDateRange(term: TermSettings, week: number): { start: Date; end: Date } | null {
  const start = parseLocalDate(term.startDate)
  if (!start) return null
  if (week < 1 || week > term.totalWeeks) return null
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (week - 1) * 7)
  const e = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 - 1)
  return { start: s, end: e }
}

/** 生成 1..n 的整数数组。 */
export function rangeWeeks(totalWeeks: number): number[] {
  const out: number[] = []
  for (let w = 1; w <= totalWeeks; w++) out.push(w)
  return out
}

/** 周次数组去重、升序、只保留 1..totalWeeks。 */
export function normalizeWeeks(weeks: number[], totalWeeks: number): number[] {
  if (!Array.isArray(weeks)) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const w of weeks) {
    if (typeof w === 'number' && Number.isInteger(w) && w >= 1 && w <= totalWeeks && !seen.has(w)) {
      seen.add(w)
      out.push(w)
    }
  }
  return out.sort((a, b) => a - b)
}

/** 按周次模式展开实际周次。 */
export function expandWeeks(mode: WeekMode, totalWeeks: number, customWeeks?: number[]): number[] {
  const all = rangeWeeks(totalWeeks)
  if (mode === 'all') return all
  if (mode === 'odd') return all.filter((w) => w % 2 === 1)
  if (mode === 'even') return all.filter((w) => w % 2 === 0)
  if (mode === 'custom') return normalizeWeeks(customWeeks || [], totalWeeks)
  return []
}

/** 两个周次数组是否有交集。 */
export function weeksIntersect(a: number[], b: number[]): boolean {
  const set = new Set(b)
  for (const w of a) {
    if (set.has(w)) return true
  }
  return false
}

/** 压缩周次表示："1-4,8,16"。空数组返回"无"。 */
export function compressWeeks(weeks: number[]): string {
  const sorted = [...weeks].sort((a, b) => a - b)
  if (!sorted.length) return '无'
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    if (j - i + 1 >= 3) {
      parts.push(`${sorted[i]}-${sorted[j]}`)
    } else {
      for (let k = i; k <= j; k++) parts.push(`${sorted[k]}`)
    }
    i = j + 1
  }
  return parts.join(',')
}

/** 校验学期设置；合法返回 { ok: true }，否则返回原因。 */
export function validateTerm(term: TermSettings | null | undefined): { ok: boolean; reason?: string } {
  if (!term) return { ok: false, reason: '缺少学期设置' }
  const start = parseLocalDate(term.startDate)
  if (!start) return { ok: false, reason: '请选择有效的第一教学周星期一日期' }
  if (!Number.isInteger(term.totalWeeks) || term.totalWeeks < 1 || term.totalWeeks > MAX_TOTAL_WEEKS) {
    return { ok: false, reason: `学期总周数需要是 1–${MAX_TOTAL_WEEKS} 的整数` }
  }
  return { ok: true }
}
