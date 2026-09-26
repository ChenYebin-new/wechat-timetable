/** 历史课表格式，仅供识别、迁移和备份导入。 */
import type { CourseFields, Course, WeekMode, TermSettings, PeriodTime, TimetableStorage } from './course'

export type CourseV1 = CourseFields

/** V2 课程：在 V1 字段基础上增加周次信息。 */
export interface CourseV2 extends CourseV1 {
  weekMode: WeekMode
  /** 实际上课周次，升序、去重、非空；旧数据未迁移时可为空表示"每周"。 */
  weeks: number[]
}

/** V1 旧数据结构（用于迁移识别）。 */
export interface TimetableStorageV1 {
  schemaVersion: 1
  courses: CourseV1[]
}

/** V2：增加学期与周次。 */
export interface TimetableStorageV2 {
  schemaVersion: 2
  term: TermSettings
  courses: CourseV2[]
}

/** V3：增加课程组。 */
export interface TimetableStorageV3 {
  schemaVersion: 3
  term: TermSettings
  courses: Course[]
}

/** V4：增加完整课程作息，尚未包含规则锚点。 */
export interface PeriodSettingsV4 {
  durationMinutes: number
  breakMinutes: number
  periods: PeriodTime[]
}

export interface TimetableStorageV4 {
  schemaVersion: 4
  term: TermSettings
  courses: Course[]
  periodSettings: PeriodSettingsV4
}

export type LegacyTimetableStorage =
  | TimetableStorageV1
  | TimetableStorageV2
  | TimetableStorageV3
  | TimetableStorageV4

export type SupportedTimetableStorage = LegacyTimetableStorage | TimetableStorage
