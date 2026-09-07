// constants/timetable.ts
// 课表常量：星期、九节课时、色板、版本、学期与周次相关常量

import type { WeekMode } from '../models/course'

export const STORAGE_KEY = 'timetable_courses'
export const SCHEMA_VERSION = 2
export const MAX_PERIOD = 9

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

export interface Period {
  index: number
  label: string
  time: string // 完整时段，用于编辑页选择器显示
  start: string // 开始时间
  end: string // 结束时间
}

/** 第一版固定九节课的时间。 */
export const PERIODS: Period[] = [
  { index: 1, label: '第1节', time: '08:00-08:50', start: '08:00', end: '08:50' },
  { index: 2, label: '第2节', time: '09:00-09:50', start: '09:00', end: '09:50' },
  { index: 3, label: '第3节', time: '10:00-10:50', start: '10:00', end: '10:50' },
  { index: 4, label: '第4节', time: '11:00-11:50', start: '11:00', end: '11:50' },
  { index: 5, label: '第5节', time: '14:00-14:50', start: '14:00', end: '14:50' },
  { index: 6, label: '第6节', time: '15:00-15:50', start: '15:00', end: '15:50' },
  { index: 7, label: '第7节', time: '16:00-16:50', start: '16:00', end: '16:50' },
  { index: 8, label: '第8节', time: '17:00-17:50', start: '17:00', end: '17:50' },
  { index: 9, label: '第9节', time: '18:00-18:50', start: '18:00', end: '18:50' },
]

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
