import assert from 'node:assert/strict'
import test from 'node:test'
import './helpers/register-typescript.mjs'

const TIMETABLE_KEY = 'timetable_courses'
const RECENT_BACKUP_KEY = 'timetable_recent_backup'
const TERM = { startDate: '2026-09-07', totalWeeks: 18 }
const ALL_WEEKS = Array.from({ length: TERM.totalWeeks }, (_, index) => index + 1)
const DEFAULT_PERIOD_SETTINGS = {
  durationMinutes: 50,
  breakMinutes: 10,
  firstStart: '08:00',
  overrides: [{ period: 5, start: '14:00' }],
  periods: ['08:00-08:50', '09:00-09:50', '10:00-10:50', '11:00-11:50', '14:00-14:50', '15:00-15:50', '16:00-16:50', '17:00-17:50', '18:00-18:50']
    .map((value) => { const [start, end] = value.split('-'); return { start, end } }),
}
let storage = new Map()
let timetableWriteFailures = 0
let timetableReadFailures = 0

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

globalThis.wx = {
  getStorageSync(key) {
    if (key === TIMETABLE_KEY && timetableReadFailures > 0) {
      timetableReadFailures--
      throw new Error('simulated read failure')
    }
    return storage.has(key) ? clone(storage.get(key)) : ''
  },
  setStorageSync(key, value) {
    if (key === TIMETABLE_KEY && timetableWriteFailures > 0) {
      timetableWriteFailures--
      throw new Error('simulated write failure')
    }
    storage.set(key, clone(value))
  },
  removeStorageSync(key) {
    storage.delete(key)
  },
}

const termUtils = await import('../miniprogram/utils/term.ts')
const validator = await import('../miniprogram/utils/course-validator.ts')
const courseStorage = await import('../miniprogram/services/course-storage.ts')
const storageCodec = await import('../miniprogram/services/storage-codec.ts')

function v1Course(overrides = {}) {
  return {
    id: 'course-1',
    name: '高等数学',
    day: 1,
    startPeriod: 1,
    endPeriod: 2,
    teacher: '刘老师',
    location: 'A101',
    color: '#0ea5a4',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function v2Course(overrides = {}) {
  const value = {
    ...v1Course(),
    groupId: 'group-1',
    weekMode: 'all',
    weeks: [...ALL_WEEKS],
    ...overrides,
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, 'groupId')) value.groupId = value.id
  return value
}

test('学期日期必须是真实存在的星期一', () => {
  assert.equal(termUtils.parseLocalDate('2026-02-30'), null)
  assert.equal(termUtils.parseLocalDate('2026-2-3'), null)
  assert.equal(termUtils.validateTerm({ startDate: '2026-09-08', totalWeeks: 18 }).ok, false)
  assert.equal(termUtils.validateTerm(TERM).ok, true)
})

test('教学周在开始、周边界、结束前后计算正确', () => {
  const term = { startDate: '2026-09-07', totalWeeks: 2 }
  assert.equal(termUtils.calcCurrentWeek(term, new Date(2026, 8, 6, 12)), null)
  assert.equal(termUtils.calcCurrentWeek(term, new Date(2026, 8, 7, 12)), 1)
  assert.equal(termUtils.calcCurrentWeek(term, new Date(2026, 8, 13, 12)), 1)
  assert.equal(termUtils.calcCurrentWeek(term, new Date(2026, 8, 14, 12)), 2)
  assert.equal(termUtils.calcCurrentWeek(term, new Date(2026, 8, 20, 12)), 2)
  assert.equal(termUtils.calcCurrentWeek(term, new Date(2026, 8, 21, 12)), null)
})

test('课程校验会展开单双周后再判断冲突', () => {
  const even = v2Course({ id: 'even', weekMode: 'even', weeks: ALL_WEEKS.filter((w) => w % 2 === 0) })
  const oddDraft = v2Course({ id: '', weekMode: 'odd', weeks: [] })
  assert.equal(validator.validate(oddDraft, [even], undefined, TERM.totalWeeks).ok, true)

  const allDraft = v2Course({ id: '', weekMode: 'all', weeks: [] })
  const result = validator.validate(allDraft, [even], undefined, TERM.totalWeeks)
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /第2,4,6/)
})

test('指定周次为空、重复或越界时不能保存', () => {
  const duplicate = v2Course({ id: '', weekMode: 'custom', weeks: [1, 1, 3] })
  const outOfRange = v2Course({ id: '', weekMode: 'custom', weeks: [1, 19] })
  assert.match(validator.validate(duplicate, [], undefined, 18).errors[0], /不能重复/)
  assert.match(validator.validate(outOfRange, [], undefined, 18).errors[0], /1–18/)
})

test('未设置学期时服务层拒绝新增课程', () => {
  storage = new Map([[TIMETABLE_KEY, { schemaVersion: 5, term: null, courses: [], periodSettings: clone(DEFAULT_PERIOD_SETTINGS) }]])
  timetableWriteFailures = 0
  assert.throws(() => courseStorage.save(v2Course({ id: '' })), /学期/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), { schemaVersion: 5, term: null, courses: [], periodSettings: DEFAULT_PERIOD_SETTINGS })
})

test('V1 迁移完整保留课程字段并展开全部周', () => {
  const original = v1Course()
  storage = new Map([[TIMETABLE_KEY, { schemaVersion: 1, courses: [clone(original)] }]])
  timetableWriteFailures = 0

  const result = courseStorage.applyTerm(TERM)
  assert.deepEqual(result, { ok: true, migrated: true })
  const saved = storage.get(TIMETABLE_KEY)
  assert.equal(saved.schemaVersion, 5)
  assert.deepEqual(saved.periodSettings, DEFAULT_PERIOD_SETTINGS)
  assert.deepEqual(saved.term, TERM)
  assert.deepEqual(saved.courses[0], {
    ...original,
    groupId: original.id,
    weekMode: 'all',
    weeks: ALL_WEEKS,
  })
  assert.equal(storage.get(RECENT_BACKUP_KEY).export.data.schemaVersion, 1)
})

test('学期调整校验失败时不覆盖原来的最近备份', () => {
  const current = {
    schemaVersion: 5,
    term: { startDate: '2026-09-07', totalWeeks: 20 },
    courses: [v2Course({ weekMode: 'custom', weeks: [20] })],
    periodSettings: clone(DEFAULT_PERIOD_SETTINGS),
  }
  const previousRecent = { marker: 'keep-me' }
  storage = new Map([
    [TIMETABLE_KEY, clone(current)],
    [RECENT_BACKUP_KEY, clone(previousRecent)],
  ])
  timetableWriteFailures = 0

  const result = courseStorage.applyTerm(TERM)
  assert.equal(result.ok, false)
  assert.deepEqual(storage.get(TIMETABLE_KEY), current)
  assert.deepEqual(storage.get(RECENT_BACKUP_KEY), previousRecent)
})

test('学期写入失败时恢复原数据并保留操作前备份', () => {
  const current = { schemaVersion: 1, courses: [v1Course()] }
  storage = new Map([[TIMETABLE_KEY, clone(current)]])
  timetableWriteFailures = 1

  const result = courseStorage.applyTerm(TERM)
  assert.equal(result.ok, false)
  assert.match(result.reason, /原数据已恢复/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), current)
  assert.deepEqual(storage.get(RECENT_BACKUP_KEY).export.data, current)
})

test('全新安装首次设置学期无需伪造旧快照并可写入有效 V5', () => {
  storage = new Map()
  timetableWriteFailures = 0
  timetableReadFailures = 0

  const result = courseStorage.applyTerm(TERM)
  assert.deepEqual(result, { ok: true, migrated: false })
  assert.deepEqual(storage.get(TIMETABLE_KEY), {
    schemaVersion: 5,
    term: TERM,
    courses: [],
    periodSettings: DEFAULT_PERIOD_SETTINGS,
  })
  assert.equal(storage.has(RECENT_BACKUP_KEY), false)
})

test('全新安装首次写入失败时恢复为无课表数据状态', () => {
  storage = new Map()
  timetableWriteFailures = 1
  timetableReadFailures = 0

  const result = courseStorage.applyTerm(TERM)
  assert.equal(result.ok, false)
  assert.match(result.reason, /原数据已恢复/)
  assert.equal(storage.has(TIMETABLE_KEY), false)
  assert.equal(storage.has(RECENT_BACKUP_KEY), false)
  timetableWriteFailures = 0
})

test('临时读取失败时学期、作息和课程增删都中止且原数据不变', () => {
  const original = { schemaVersion: 5, term: clone(TERM), courses: [v2Course()], periodSettings: clone(DEFAULT_PERIOD_SETTINGS) }
  storage = new Map([[TIMETABLE_KEY, clone(original)]])
  timetableWriteFailures = 0
  timetableReadFailures = 1
  assert.throws(() => courseStorage.applyTerm({ startDate: '2026-09-14', totalWeeks: 18 }), /读取本地课表失败/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), original)

  timetableReadFailures = 1
  assert.throws(() => courseStorage.save(v2Course({ id: '' })), /读取本地课表失败/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), original)

  timetableReadFailures = 1
  assert.throws(() => courseStorage.savePeriodSettings(DEFAULT_PERIOD_SETTINGS), /读取本地课表失败/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), original)

  timetableReadFailures = 1
  assert.throws(() => courseStorage.remove('course-1'), /读取本地课表失败/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), original)
  timetableReadFailures = 0
})

test('损坏的当前 V5 周次数据保持只读且不会被无关操作清洗', () => {
  const corrupted = {
    schemaVersion: 5,
    term: clone(TERM),
    courses: [v2Course({ weekMode: 'custom', weeks: [99] })],
    periodSettings: clone(DEFAULT_PERIOD_SETTINGS),
  }
  storage = new Map([[TIMETABLE_KEY, clone(corrupted)]])
  timetableReadFailures = 0
  const snapshot = courseStorage.getStorageSnapshot()
  assert.equal(snapshot.kind, 'corrupt')
  assert.match(snapshot.reason, /周次/)
  assert.throws(() => courseStorage.remove('course-1'), /停止写入/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), corrupted)
})

test('包含未知字段的 V5 快照保持逐项不变且不会在删除时被顺带清洗', () => {
  const corrupted = {
    schemaVersion: 5,
    term: clone(TERM),
    courses: [{ ...v2Course(), futureField: 'keep-me' }],
    periodSettings: clone(DEFAULT_PERIOD_SETTINGS),
  }
  storage = new Map([[TIMETABLE_KEY, clone(corrupted)]])
  const snapshot = courseStorage.getStorageSnapshot()
  assert.equal(snapshot.kind, 'corrupt')
  assert.match(snapshot.reason, /未知字段/)
  assert.throws(() => courseStorage.remove('course-1'), /停止写入/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), corrupted)
})

test('存储解码明确区分六种读取结果且纯解码不写入', () => {
  const current = { schemaVersion: 5, term: clone(TERM), courses: [], periodSettings: clone(DEFAULT_PERIOD_SETTINGS) }
  const before = clone(current)
  assert.equal(storageCodec.classifyStorageValue('').kind, 'missing')
  assert.equal(storageCodec.classifyStorageValue(current).kind, 'current')
  assert.equal(storageCodec.classifyStorageValue({ schemaVersion: 1, courses: [] }).kind, 'legacy')
  assert.equal(storageCodec.classifyStorageValue({ schemaVersion: 99, courses: [] }).kind, 'unsupported')
  assert.equal(storageCodec.classifyStorageValue({ ...current, courses: 'invalid' }).kind, 'corrupt')
  assert.deepEqual(current, before)

  storage = new Map([[TIMETABLE_KEY, clone(current)]])
  timetableReadFailures = 1
  const ioResult = courseStorage.getStorageSnapshot()
  assert.equal(ioResult.kind, 'io-error')
  assert.match(ioResult.reason, /读取本地课表失败/)
  assert.deepEqual(storage.get(TIMETABLE_KEY), current)
  timetableReadFailures = 0
})
