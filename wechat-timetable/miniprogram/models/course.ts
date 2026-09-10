// models/course.ts
// 课程、学期、课程作息与本地存储根数据的数据类型（V4）

/** V1 课程字段（迁移前旧课程，无周次信息）。 */
export interface CourseV1 {
  id: string;          // 唯一主键
  name: string;        // 课程名称（必填）
  day: number;         // 1=周一 … 7=周日
  startPeriod: number; // 开始节次，1..9
  endPeriod: number;   // 结束节次，1..9
  teacher?: string;    // 教师（可选）
  location?: string;   // 教室（可选）
  color: string;       // 主题色，来自预设色板
  createdAt: number;   // 创建时间戳
  updatedAt: number;   // 更新时间戳
}

/** 课程周次模式。 */
export type WeekMode = 'all' | 'odd' | 'even' | 'custom'

/** V2 课程：在 V1 字段基础上增加周次信息。 */
export interface CourseV2 extends CourseV1 {
  weekMode: WeekMode
  /** 实际上课周次，升序、去重、非空；旧数据未迁移时可为空表示"每周"。 */
  weeks: number[]
}

/** V3 课程：每条记录表示一个连续时段，同一 groupId 表示同一门课程。 */
export interface Course extends CourseV2 {
  groupId: string
}

/** 课表中一个可选择的星期/节次格子。 */
export interface GridCell {
  day: number
  period: number
}

/** 一门课程在某一天的一段连续节次。 */
export interface CourseRange {
  day: number
  startPeriod: number
  endPeriod: number
}

/** 学期设置。 */
export interface TermSettings {
  startDate: string // YYYY-MM-DD，第一教学周的星期一
  totalWeeks: number // 1..30
}

/** 单节课程的实际起止时间，同一天内使用 HH:mm。 */
export interface PeriodTime {
  start: string
  end: string
}

/** 全局课程作息。时长和课间只用于新增节次及显式重新生成。 */
export interface PeriodSettings {
  durationMinutes: number
  breakMinutes: number
  periods: PeriodTime[]
}

/** 整个课表存在一个 Storage key 下的根对象结构（当前为 V4）。 */
export interface TimetableStorage {
  schemaVersion: number
  term: TermSettings | null
  courses: Course[]
  periodSettings: PeriodSettings
}

/** V1 旧数据结构（用于迁移识别）。 */
export interface TimetableStorageV1 {
  schemaVersion: 1
  courses: CourseV1[]
}
