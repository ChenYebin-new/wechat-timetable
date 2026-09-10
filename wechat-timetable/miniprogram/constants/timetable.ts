// constants/timetable.ts
// 课表常量：星期、课程作息边界、色板、版本、学期与周次相关常量

import type { PeriodSettings, WeekMode } from '../models/course'

export const STORAGE_KEY = 'timetable_courses'
export const SCHEMA_VERSION = 4
export const GRID_HOLD_DURATION_MS = 1200
export const MIN_PERIODS = 1
export const MAX_PERIODS = 14
export const DEFAULT_PERIOD_DURATION_MINUTES = 50
export const DEFAULT_BREAK_MINUTES = 10

/** 单个节次单元格高度(rpx)。需与 components/timetable-grid/index.wxss 中的 height 保持一致。 */
export const CELL_HEIGHT = 124

export const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 学期总周数范围与默认值。 */
export const MIN_TOTAL_WEEKS = 1
export const MAX_TOTAL_WEEKS = 30
export const DEFAULT_TOTAL_WEEKS = 18
/** 常用学期周数，供快捷选择。 */
export const COMMON_TOTAL_WEEKS = [16, 18, 20]

export interface WeekModeOption {
  value: WeekMode
  label: string
}

export const WEEK_MODES: WeekModeOption[] = [
  { value: 'all', label: '全部周' },
  { value: 'odd', label: '单周' },
  { value: 'even', label: '双周' },
  { value: 'custom', label: '指定周次' },
]

export interface PeriodView {
  index: number
  label: string
  time: string // 完整时段，用于编辑页选择器显示
  start: string // 开始时间
  end: string // 结束时间
}

/** V1–V3 使用的九节课原始时间，迁移时必须原样保留。 */
export const DEFAULT_PERIOD_SETTINGS: PeriodSettings = {
  durationMinutes: DEFAULT_PERIOD_DURATION_MINUTES,
  breakMinutes: DEFAULT_BREAK_MINUTES,
  periods: [
    { start: '08:00', end: '08:50' },
    { start: '09:00', end: '09:50' },
    { start: '10:00', end: '10:50' },
    { start: '11:00', end: '11:50' },
    { start: '14:00', end: '14:50' },
    { start: '15:00', end: '15:50' },
    { start: '16:00', end: '16:50' },
    { start: '17:00', end: '17:50' },
    { start: '18:00', end: '18:50' },
  ],
}

/** 蓝绿色系为主的课程颜色板。 */
export const COLOR_PALETTE = [
  '#0ea5a4',
  '#10b981',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
]
