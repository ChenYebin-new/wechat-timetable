// constants/timetable.ts
// 第一版固定的课表常量：星期、九节课时、色板、存储 key

export const STORAGE_KEY = 'timetable_courses'
export const SCHEMA_VERSION = 1
export const MAX_PERIOD = 9

/** 单个节次单元格高度(rpx)。需与 components/timetable-grid/index.wxss 中的 height 保持一致。 */
export const CELL_HEIGHT = 96

export const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export interface Period {
  index: number
  label: string
  time: string
}

/** 第一版固定九节课的时间。 */
export const PERIODS: Period[] = [
  { index: 1, label: '第1节', time: '08:00-08:50' },
  { index: 2, label: '第2节', time: '09:00-09:50' },
  { index: 3, label: '第3节', time: '10:00-10:50' },
  { index: 4, label: '第4节', time: '11:00-11:50' },
  { index: 5, label: '第5节', time: '14:00-14:50' },
  { index: 6, label: '第6节', time: '15:00-15:50' },
  { index: 7, label: '第7节', time: '16:00-16:50' },
  { index: 8, label: '第8节', time: '17:00-17:50' },
  { index: 9, label: '第9节', time: '18:00-18:50' },
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
