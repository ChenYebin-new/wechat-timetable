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
const DEFAULT_COLOR = '#0ea5a4'
const TERM = { startDate: '2026-09-07', totalWeeks: 18 }
const ALL_WEEKS = Array.from({ length: TERM.totalWeeks }, (_, index) => index + 1)
let storage = new Map()
let timetableWriteFailures = 0

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

globalThis.wx = {
  getStorageSync(key) {
    return storage.has(key) ? clone(storage.get(key)) : ''
  },
  setStorageSync(key, value) {
    if (key === TIMETABLE_KEY && timetableWriteFailures > 0) {
      timetableWriteFailures--
      throw new Error('simulated write failure')
    }
    storage.set(key, clone(value))
  },
}

const backupService = await import('../miniprogram/services/backup-service.ts')
const courseStorage = await import('../miniprogram/services/course-storage.ts')

function course(overrides = {}) {
  return {
    id: 'course-1',
    name: '高等数学',
    day: 1,
    startPeriod: 1,
    endPeriod: 1,
    color: DEFAULT_COLOR,
    createdAt: 1,
    updatedAt: 1,
    weekMode: 'all',
    weeks: [...ALL_WEEKS],
    ...overrides,
  }
}

function envelope(courses = [course()], overrides = {}) {
  return {
    app: 'qige-timetable',
    backupVersion: 1,
    exportedAt: '2026-09-06T08:00:00.000Z',
    data: { schemaVersion: 2, term: clone(TERM), courses },
    ...overrides,
  }
}

function v1Course(overrides = {}) {
  const value = course(overrides)
  delete value.weekMode
  delete value.weeks
  return value
}

function v1Envelope(courses = [v1Course()], overrides = {}) {
  return envelope(courses, {
    data: { schemaVersion: 1, courses },
    ...overrides,
  })
}

function reset(currentCourses = []) {
  storage = new Map([
    [TIMETABLE_KEY, { schemaVersion: 2, term: clone(TERM), courses: clone(currentCourses) }],
  ])
  timetableWriteFailures = 0
}

test('只接受小程序导出的标准 UTC ISO 时间', () => {
  reset()
  assert.equal(backupService.parseBackup(JSON.stringify(envelope())).ok, true)
  for (const exportedAt of ['2026/09/06', 'September 6, 2026', '2026-02-30T08:00:00.000Z']) {
    const parsed = backupService.parseBackup(JSON.stringify(envelope([], { exportedAt })))
    assert.equal(parsed.ok, false, exportedAt)
  }
})

test('空课表可以导出并重新解析', () => {
  reset()
  const parsed = backupService.parseBackup(backupService.exportBackup())
  assert.equal(parsed.ok, true)
  const analyzed = backupService.analyzeBackup(parsed.envelope)
  assert.equal(analyzed.ok, true)
  assert.equal(analyzed.preview.backupCount, 0)
})

test('拒绝无效 JSON、错误标识、缺失学期、未知版本和超大内容', () => {
  reset()
  assert.equal(backupService.parseBackup('{').ok, false)
  assert.equal(
    backupService.parseBackup(JSON.stringify(envelope([], { app: 'other-app' }))).ok,
    false,
  )
  assert.equal(backupService.overwriteFromBackup(envelope([], { app: 'other-app' })).ok, false)
  assert.equal(
    backupService.parseBackup(JSON.stringify(envelope([], { backupVersion: 2 }))).ok,
    false,
  )
  assert.equal(
    backupService.analyzeBackup(envelope([], { data: { schemaVersion: 2, courses: [] } })).ok,
    false,
  )
  assert.equal(
    backupService.analyzeBackup(envelope([], { data: { schemaVersion: 3, courses: [] } })).ok,
    false,
  )
  assert.equal(backupService.parseBackup(' '.repeat(1024 * 1024 + 1)).ok, false)
})

test('拒绝非整数节次、非法颜色、时间戳和可选字段类型', () => {
  reset()
  const invalidCourses = [
    course({ day: 1.5 }),
    course({ startPeriod: 1.5 }),
    course({ endPeriod: 2.5 }),
    course({ color: '#ffffff' }),
    course({ createdAt: -1 }),
    course({ updatedAt: Number.MAX_SAFE_INTEGER + 1 }),
    course({ teacher: 42 }),
    course({ location: false }),
  ]
  for (const invalidCourse of invalidCourses) {
    const analyzed = backupService.analyzeBackup(envelope([invalidCourse]))
    assert.equal(analyzed.ok, false, JSON.stringify(invalidCourse))
  }
})

test('拒绝备份内部重复的课程 ID', () => {
  reset()
  const analyzed = backupService.analyzeBackup(
    envelope([
      course(),
      course({ day: 2, startPeriod: 2, endPeriod: 2 }),
    ]),
  )
  assert.equal(analyzed.ok, false)
  assert.match(analyzed.errors[0], /重复课程 ID/)
})

test('拒绝备份内部同一天的重叠课程', () => {
  reset()
  const analyzed = backupService.analyzeBackup(
    envelope([
      course(),
      course({ id: 'course-2', name: '大学物理', startPeriod: 1, endPeriod: 2 }),
    ]),
  )
  assert.equal(analyzed.ok, false)
  assert.match(analyzed.errors[0], /备份内部存在冲突/)
})

test('覆盖时只写入校验后的规范化课程', () => {
  reset()
  const result = backupService.overwriteFromBackup(
    envelope([course({ name: '  高等数学  ', teacher: '  刘老师  ', location: '  ' })]),
  )
  assert.equal(result.ok, true)
  const saved = storage.get(TIMETABLE_KEY).courses[0]
  assert.equal(saved.name, '高等数学')
  assert.equal(saved.teacher, '刘老师')
  assert.equal(saved.location, undefined)
})

test('合并统计新增、重复、冲突和最终数量', () => {
  const current = [
    course(),
    course({ id: 'course-2', name: '英语', startPeriod: 2, endPeriod: 2 }),
  ]
  reset(current)
  const result = backupService.mergeFromBackup(
    envelope([
      course({ id: 'backup-1' }),
      course({ id: 'backup-2', name: '大学物理', startPeriod: 2, endPeriod: 2 }),
      course({ id: 'backup-3', name: '体育', startPeriod: 3, endPeriod: 3 }),
    ]),
  )
  assert.deepEqual(result, {
    ok: true,
    added: 1,
    skippedDuplicate: 1,
    skippedConflict: 1,
    finalCount: 3,
  })
})

test('同名同时间但周次不相交的课程可以合并', () => {
  const oddWeeks = ALL_WEEKS.filter((week) => week % 2 === 1)
  const evenWeeks = ALL_WEEKS.filter((week) => week % 2 === 0)
  reset([course({ id: 'odd-course', weekMode: 'odd', weeks: oddWeeks })])

  const incoming = envelope([
    course({ id: 'even-course', weekMode: 'even', weeks: evenWeeks }),
  ])
  const analyzed = backupService.analyzeBackup(incoming)
  assert.equal(analyzed.preview.mergeAddCount, 1)
  assert.equal(analyzed.preview.duplicateCount, 0)
  assert.deepEqual(backupService.mergeFromBackup(incoming), {
    ok: true,
    added: 1,
    skippedDuplicate: 0,
    skippedConflict: 0,
    finalCount: 2,
  })
})

test('不同学期的 V2 备份不能直接合并', () => {
  const current = [course()]
  reset(current)
  const otherTerm = { startDate: '2026-09-14', totalWeeks: 18 }
  const incoming = envelope(
    [course({ id: 'course-2', name: '英语', day: 2 })],
    { data: { schemaVersion: 2, term: otherTerm, courses: [course({ id: 'course-2', name: '英语', day: 2 })] } },
  )

  const analyzed = backupService.analyzeBackup(incoming)
  assert.equal(analyzed.ok, true)
  assert.equal(analyzed.preview.mergeAllowed, false)
  assert.match(analyzed.preview.mergeReason, /学期/)
  assert.match(backupService.mergeFromBackup(incoming).reason, /不能直接合并/)
  assert.deepEqual(storage.get(TIMETABLE_KEY).courses, current)
})

test('V1 备份设置学期后可以覆盖为完整 V2 数据', () => {
  reset()
  const result = backupService.overwriteFromBackup(
    v1Envelope([v1Course({ name: '  高等数学  ' })]),
    TERM,
  )
  assert.equal(result.ok, true)
  const saved = storage.get(TIMETABLE_KEY)
  assert.equal(saved.schemaVersion, 2)
  assert.deepEqual(saved.term, TERM)
  assert.equal(saved.courses[0].name, '高等数学')
  assert.equal(saved.courses[0].weekMode, 'all')
  assert.deepEqual(saved.courses[0].weeks, ALL_WEEKS)
})

test('V2 备份拒绝缺失或不一致的周次字段', () => {
  reset()
  const missingWeeks = v1Course()
  assert.equal(backupService.analyzeBackup(envelope([missingWeeks])).ok, false)
  assert.equal(
    backupService.analyzeBackup(
      envelope([course({ weekMode: 'odd', weeks: [...ALL_WEEKS] })]),
    ).ok,
    false,
  )
})

test('成功覆盖后可以恢复最近自动备份', () => {
  const original = [course()]
  const replacement = [course({ id: 'course-2', name: '英语', day: 2 })]
  reset(original)

  assert.equal(backupService.overwriteFromBackup(envelope(replacement)).ok, true)
  assert.equal(
    JSON.stringify(storage.get(RECENT_BACKUP_KEY).export.data.courses),
    JSON.stringify(original),
  )
  assert.equal(backupService.restoreRecentBackup().ok, true)
  assert.equal(JSON.stringify(storage.get(TIMETABLE_KEY).courses), JSON.stringify(original))
  assert.equal(
    JSON.stringify(storage.get(RECENT_BACKUP_KEY).export.data.courses),
    JSON.stringify(replacement),
  )
})

test('迁移生成的 V1 最近备份可以按当前学期恢复', () => {
  const original = [v1Course()]
  storage = new Map([[TIMETABLE_KEY, { schemaVersion: 1, courses: clone(original) }]])
  assert.equal(courseStorage.applyTerm(TERM).ok, true)

  const replacement = [course({ id: 'course-2', name: '英语', day: 2 })]
  storage.set(TIMETABLE_KEY, { schemaVersion: 2, term: clone(TERM), courses: replacement })
  assert.equal(backupService.restoreRecentBackup().ok, true)

  const restored = storage.get(TIMETABLE_KEY)
  assert.equal(restored.schemaVersion, 2)
  assert.deepEqual(restored.term, TERM)
  assert.equal(restored.courses[0].id, original[0].id)
  assert.deepEqual(restored.courses[0].weeks, ALL_WEEKS)
  assert.equal(
    JSON.stringify(storage.get(RECENT_BACKUP_KEY).export.data.courses),
    JSON.stringify(replacement),
  )
})

test('未知高版本数据不能被编辑、删除、导出或覆盖', () => {
  const futureStorage = {
    schemaVersion: 3,
    term: { startDate: '2026-09-07', totalWeeks: 18 },
    courses: [course({ futureField: 'keep-me' })],
  }
  storage = new Map([[TIMETABLE_KEY, clone(futureStorage)]])

  assert.throws(() => courseStorage.save(course({ name: '修改后' })), /仅支持修改 V2/)
  assert.throws(() => courseStorage.remove('course-1'), /仅支持修改 V2/)
  assert.throws(() => backupService.exportBackup(), /仅支持 V2/)
  assert.equal(backupService.overwriteFromBackup(envelope()).ok, false)
  assert.equal(courseStorage.applyTerm(TERM).ok, false)
  assert.deepEqual(storage.get(TIMETABLE_KEY), futureStorage)
})

test('覆盖写入持续失败时不抛异常，并保留操作前自动备份', () => {
  const original = [course()]
  reset(original)
  timetableWriteFailures = 2

  const result = backupService.overwriteFromBackup(
    envelope([course({ id: 'course-2', name: '英语', day: 2 })]),
  )
  assert.equal(result.ok, false)
  assert.match(result.reason, /无法确认原课表状态/)
  assert.equal(JSON.stringify(storage.get(TIMETABLE_KEY).courses), JSON.stringify(original))
  assert.equal(
    JSON.stringify(storage.get(RECENT_BACKUP_KEY).export.data.courses),
    JSON.stringify(original),
  )
})

test('恢复失败时保留恢复前课表和原来的最近备份', () => {
  const original = [course()]
  const replacement = [course({ id: 'course-2', name: '英语', day: 2 })]
  reset(original)
  assert.equal(backupService.overwriteFromBackup(envelope(replacement)).ok, true)
  const recentBeforeRestore = clone(storage.get(RECENT_BACKUP_KEY))

  timetableWriteFailures = 2
  const result = backupService.restoreRecentBackup()

  assert.equal(result.ok, false)
  assert.match(result.reason, /无法确认原课表状态/)
  assert.equal(JSON.stringify(storage.get(TIMETABLE_KEY).courses), JSON.stringify(replacement))
  assert.equal(JSON.stringify(storage.get(RECENT_BACKUP_KEY)), JSON.stringify(recentBeforeRestore))
})

test('损坏的最近备份不会进入恢复流程', () => {
  reset()
  storage.set(RECENT_BACKUP_KEY, {
    savedAt: Date.now(),
    export: envelope([course({ day: 1.5 })]),
  })
  assert.equal(backupService.getRecentBackup(), null)
  assert.deepEqual(backupService.restoreRecentBackup(), {
    ok: false,
    reason: '没有可用且通过校验的最近备份',
  })
})
