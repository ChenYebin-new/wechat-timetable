import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('.') || specifier.startsWith('/')) && !/[.]\w+$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }),
      }
    }
    return nextLoad(url, context)
  },
})

const TIMETABLE_KEY = 'timetable_courses'
const RECENT_BACKUP_KEY = 'timetable_recent_backup'
const TERM = { startDate: '2026-09-07', totalWeeks: 18 }
let storage = new Map()
let writeFailures = 0

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

globalThis.wx = {
  getStorageSync(key) {
    return storage.has(key) ? clone(storage.get(key)) : ''
  },
  setStorageSync(key, value) {
    if (key === TIMETABLE_KEY && writeFailures > 0) {
      writeFailures--
      throw new Error('simulated write failure')
    }
    storage.set(key, clone(value))
  },
}

const periods = await import('../miniprogram/utils/period-settings.ts')
const constants = await import('../miniprogram/constants/timetable.ts')
const courseStorage = await import('../miniprogram/services/course-storage.ts')
const backupService = await import('../miniprogram/services/backup-service.ts')
const timetableLayout = await import('../miniprogram/utils/timetable-layout.ts')
const courseValidator = await import('../miniprogram/utils/course-validator.ts')

function currentStorage(overrides = {}) {
  return {
    schemaVersion: 4,
    term: clone(TERM),
    courses: [],
    periodSettings: periods.clonePeriodSettings(constants.DEFAULT_PERIOD_SETTINGS),
    ...overrides,
  }
}

function course(overrides = {}) {
  return {
    id: 'course-1',
    groupId: 'group-1',
    name: '高等数学',
    day: 1,
    startPeriod: 1,
    endPeriod: 1,
    color: '#0ea5a4',
    createdAt: 1,
    updatedAt: 1,
    weekMode: 'all',
    weeks: Array.from({ length: 18 }, (_, index) => index + 1),
    ...overrides,
  }
}

function envelope(data) {
  return {
    app: 'qige-timetable',
    backupVersion: 1,
    exportedAt: '2026-09-10T08:00:00.000Z',
    data,
  }
}

test('默认九节作息完整保留原始时间', () => {
  const defaults = constants.DEFAULT_PERIOD_SETTINGS
  assert.equal(defaults.periods.length, 9)
  assert.deepEqual(defaults.periods[0], { start: '08:00', end: '08:50' })
  assert.deepEqual(defaults.periods[8], { start: '18:00', end: '18:50' })
  assert.equal(periods.validatePeriodSettings(defaults).ok, true)
})

test('规则生成支持 1、9、14 节并拒绝跨越午夜', () => {
  assert.equal(periods.generatePeriods('08:00', 1, 50, 10).length, 1)
  assert.equal(periods.generatePeriods('08:00', 9, 50, 10).length, 9)
  assert.equal(periods.generatePeriods('06:00', 14, 40, 5).length, 14)
  assert.equal(periods.generatePeriods('23:30', 2, 50, 10), null)
})

test('增加节次只追加时间，修改生成规则不覆盖手动时间', () => {
  const manual = periods.clonePeriodSettings(constants.DEFAULT_PERIOD_SETTINGS)
  manual.periods[1] = { start: '09:20', end: '10:05' }
  manual.durationMinutes = 45
  manual.breakMinutes = 15
  const resized = periods.resizePeriods(manual, 10)
  assert.deepEqual(resized.periods[1], { start: '09:20', end: '10:05' })
  assert.deepEqual(resized.periods[9], { start: '19:05', end: '19:50' })
})

test('校验拒绝非法分钟、倒置时间和相邻重叠', () => {
  const invalidDuration = periods.clonePeriodSettings(constants.DEFAULT_PERIOD_SETTINGS)
  invalidDuration.durationMinutes = 181
  assert.equal(periods.validatePeriodSettings(invalidDuration).ok, false)

  const inverted = periods.clonePeriodSettings(constants.DEFAULT_PERIOD_SETTINGS)
  inverted.periods[0] = { start: '09:00', end: '08:00' }
  assert.match(periods.validatePeriodSettings(inverted).reason, /早于/)

  const overlapping = periods.clonePeriodSettings(constants.DEFAULT_PERIOD_SETTINGS)
  overlapping.periods[1] = { start: '08:40', end: '09:30' }
  assert.match(periods.validatePeriodSettings(overlapping).reason, /重叠/)
})

test('已有课程占用高节次时服务层阻止缩减', () => {
  storage = new Map([[TIMETABLE_KEY, currentStorage({ courses: [course({ startPeriod: 9, endPeriod: 9 })] })]])
  const shorter = periods.resizePeriods(constants.DEFAULT_PERIOD_SETTINGS, 8)
  const result = courseStorage.savePeriodSettings(shorter)
  assert.equal(result.ok, false)
  assert.match(result.reason, /第 9 节/)
  assert.equal(storage.get(TIMETABLE_KEY).periodSettings.periods.length, 9)
})

test('课程校验和服务层按当前 14 节作息接受第 14 节', () => {
  const settings = periods.clonePeriodSettings(constants.DEFAULT_PERIOD_SETTINGS)
  const generated = periods.generatePeriods('06:00', 14, 40, 5)
  settings.durationMinutes = 40
  settings.breakMinutes = 5
  settings.periods = generated
  const lastPeriodCourse = course({ id: '', groupId: '', startPeriod: 14, endPeriod: 14 })
  assert.equal(courseValidator.validate(lastPeriodCourse, [], undefined, 18, 14).ok, true)

  storage = new Map([[TIMETABLE_KEY, currentStorage({ periodSettings: settings })]])
  courseStorage.save(lastPeriodCourse)
  assert.equal(storage.get(TIMETABLE_KEY).courses[0].endPeriod, 14)
})

test('保存作息写入失败时恢复 V4 原数据并保留自动备份', () => {
  const original = currentStorage()
  storage = new Map([[TIMETABLE_KEY, clone(original)]])
  writeFailures = 1
  const longer = periods.resizePeriods(original.periodSettings, 10)
  const result = courseStorage.savePeriodSettings(longer)
  assert.equal(result.ok, false)
  assert.match(result.reason, /原数据已恢复/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), original)
  assert.equal(storage.get(RECENT_BACKUP_KEY).export.data.schemaVersion, 4)
})

test('V3 首次读取安全迁移为 V4 并保留原始快照', () => {
  const legacy = { schemaVersion: 3, term: clone(TERM), courses: [course()] }
  storage = new Map([[TIMETABLE_KEY, clone(legacy)]])
  writeFailures = 0
  const migrated = courseStorage.getStorage()
  assert.equal(migrated.schemaVersion, 4)
  assert.deepEqual(migrated.periodSettings, constants.DEFAULT_PERIOD_SETTINGS)
  assert.deepEqual(storage.get(RECENT_BACKUP_KEY).export.data, legacy)
})

test('V3 迁移写入失败时恢复原数据并保持只读版本', () => {
  const legacy = { schemaVersion: 3, term: clone(TERM), courses: [course()] }
  storage = new Map([[TIMETABLE_KEY, clone(legacy)]])
  writeFailures = 1
  const result = courseStorage.getStorage()
  assert.equal(result.schemaVersion, 3)
  assert.deepEqual(storage.get(TIMETABLE_KEY), legacy)
  assert.deepEqual(storage.get(RECENT_BACKUP_KEY).export.data, legacy)
})

test('V4 备份完整保留作息，作息不同则拒绝合并', () => {
  const custom = currentStorage()
  custom.periodSettings.periods[0] = { start: '07:50', end: '08:40' }
  storage = new Map([[TIMETABLE_KEY, clone(custom)]])
  const exported = JSON.parse(backupService.exportBackup())
  assert.deepEqual(exported.data.periodSettings, custom.periodSettings)

  const incoming = currentStorage({ courses: [course({ id: 'other', groupId: 'other', day: 2 })] })
  const analyzed = backupService.analyzeBackup(envelope(incoming))
  assert.equal(analyzed.ok, true)
  assert.equal(analyzed.preview.mergeAllowed, false)
  assert.match(analyzed.preview.mergeReason, /课程时间设置不同/)
  assert.match(backupService.mergeFromBackup(envelope(incoming)).reason, /课程时间设置不同/)
})

test('V4 覆盖和最近备份恢复分别采用对应作息', () => {
  const original = currentStorage()
  const incoming = currentStorage({ courses: [course({ id: 'other', groupId: 'other', day: 2 })] })
  incoming.periodSettings.periods[0] = { start: '07:50', end: '08:40' }
  storage = new Map([[TIMETABLE_KEY, clone(original)]])

  assert.equal(backupService.overwriteFromBackup(envelope(incoming)).ok, true)
  assert.deepEqual(storage.get(TIMETABLE_KEY).periodSettings, incoming.periodSettings)
  assert.equal(backupService.restoreRecentBackup().ok, true)
  assert.deepEqual(storage.get(TIMETABLE_KEY).periodSettings, original.periodSettings)
})

test('V4 备份缺失作息、时间错误、重叠或课程越界时整体拒绝', () => {
  const missing = currentStorage()
  delete missing.periodSettings
  assert.equal(backupService.analyzeBackup(envelope(missing)).ok, false)

  const malformed = currentStorage()
  malformed.periodSettings.periods[0].start = '8:00'
  assert.equal(backupService.analyzeBackup(envelope(malformed)).ok, false)

  const overlapping = currentStorage()
  overlapping.periodSettings.periods[1].start = '08:30'
  assert.equal(backupService.analyzeBackup(envelope(overlapping)).ok, false)

  const onePeriod = currentStorage({ courses: [course({ startPeriod: 2, endPeriod: 2 })] })
  onePeriod.periodSettings.periods = onePeriod.periodSettings.periods.slice(0, 1)
  assert.equal(backupService.analyzeBackup(envelope(onePeriod)).ok, false)
})

test('本地 V4 作息损坏时保持原始数据并停止编辑和导出', () => {
  const corrupted = currentStorage({ courses: [course({ startPeriod: 14, endPeriod: 14 })] })
  delete corrupted.periodSettings
  storage = new Map([[TIMETABLE_KEY, clone(corrupted)]])
  const loaded = courseStorage.getStorage()
  assert.equal(loaded.courses[0].endPeriod, 14)
  assert.match(courseStorage.getStorageProblem(loaded), /缺失或损坏/)
  assert.throws(() => courseStorage.remove('course-1'), /缺失或损坏/)
  assert.throws(() => backupService.exportBackup(), /缺失或损坏/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), corrupted)
})

test('动态网格高度按节次数量增长', () => {
  assert.equal(timetableLayout.timetableGridHeightRpx(1), 220)
  assert.equal(timetableLayout.timetableGridHeightRpx(14), 1832)
})
