/** 各数据域独立演进；这些版本号不要求相等。改变代码组织不增加格式版本。 */
export const TIMETABLE_SCHEMA_VERSION = 5
export const TODO_SCHEMA_VERSION = 3
export const TIMETABLE_BACKUP_VERSION = 1
export const TODO_BACKUP_VERSION = 1

export const LEGACY_TIMETABLE_SCHEMA_VERSIONS = [1, 2, 3, 4] as const
export const SUPPORTED_TIMETABLE_SCHEMA_VERSIONS = [...LEGACY_TIMETABLE_SCHEMA_VERSIONS, TIMETABLE_SCHEMA_VERSION] as const

export function isLegacySchemaVersion(value: number): boolean {
  return (LEGACY_TIMETABLE_SCHEMA_VERSIONS as readonly number[]).includes(value)
}

export function isSupportedSchemaVersion(value: number): boolean {
  return (SUPPORTED_TIMETABLE_SCHEMA_VERSIONS as readonly number[]).includes(value)
}
