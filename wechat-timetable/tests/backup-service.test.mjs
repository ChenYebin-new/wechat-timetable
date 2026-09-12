import assert from 'node:assert/strict'
import test from 'node:test'
import './helpers/register-typescript.mjs'

const TIMETABLE_KEY = 'timetable_courses'
const RECENT_BACKUP_KEY = 'timetable_recent_backup'
const DEFAULT_COLOR = '#0ea5a4'
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
}

const backupService = await import('../miniprogram/services/backup-service.ts')
const courseStorage = await import('../miniprogram/services/course-storage.ts')

function course(overrides = {}) {
  const value = {
    id: 'course-1',
    groupId: 'group-1',
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
  if (!Object.prototype.hasOwnProperty.call(overrides, 'groupId')) value.groupId = value.id
  return value
}

function envelope(courses = [course()], overrides = {}) {
  return {
    app: 'qige-timetable',
    backupVersion: 1,
    exportedAt: '2026-09-06T08:00:00.000Z',
    data: { schemaVersion: 3, term: clone(TERM), courses },
    ...overrides,
  }
}

function v1Course(overrides = {}) {
  const value = course(overrides)
  delete value.groupId
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

function v2Course(overrides = {}) {
  const value = course(overrides)
  delete value.groupId
  return value
}

function v2Envelope(courses = [v2Course()], overrides = {}) {
  return envelope(courses, {
    data: { schemaVersion: 2, term: clone(TERM), courses },
    ...overrides,
  })
}

function reset(currentCourses = []) {
  storage = new Map([
    [TIMETABLE_KEY, { schemaVersion: 5, term: clone(TERM), courses: clone(currentCourses), periodSettings: clone(DEFAULT_PERIOD_SETTINGS) }],
  ])
  timetableWriteFailures = 0
  timetableReadFailures = 0
}

function assertReadFailurePreservesCurrent(action, original) {
  timetableReadFailures = 1
  try {
    const result = action()
    if (result && typeof result === 'object' && 'ok' in result) assert.equal(result.ok, false)
    else assert.fail('操作应在读取失败时中止')
  } catch (error) {
    assert.match(error instanceof Error ? error.message : String(error), /读取本地课表失败/)
  }
  assert.deepEqual(storage.get(TIMETABLE_KEY), original)
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
    backupService.analyzeBackup(envelope([], { data: { schemaVersion: 3, courses: [] } })).ok,
    false,
  )
  assert.equal(
    backupService.analyzeBackup(envelope([], { data: { schemaVersion: 4, courses: [] } })).ok,
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
    course({ color: 'not-a-color' }),
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
    addedGroups: 1,
    skippedDuplicateGroups: 1,
    skippedConflictGroups: 1,
    finalGroupCount: 3,
    skippedGroupReasons: [
      '「高等数学」包含与当前课表重复的时段，整门课程已跳过',
      '「大学物理」包含与当前课表冲突的时段，整门课程已跳过',
    ],
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
    addedGroups: 1,
    skippedDuplicateGroups: 0,
    skippedConflictGroups: 0,
    finalGroupCount: 2,
    skippedGroupReasons: [],
  })
})

test('不同学期的新版备份不能直接合并', () => {
  const current = [course()]
  reset(current)
  const otherTerm = { startDate: '2026-09-14', totalWeeks: 18 }
  const incoming = envelope(
    [course({ id: 'course-2', name: '英语', day: 2 })],
    { data: { schemaVersion: 3, term: otherTerm, courses: [course({ id: 'course-2', groupId: 'group-2', name: '英语', day: 2 })] } },
  )

  const analyzed = backupService.analyzeBackup(incoming)
  assert.equal(analyzed.ok, true)
  assert.equal(analyzed.preview.mergeAllowed, false)
  assert.match(analyzed.preview.mergeReason, /学期/)
  assert.match(backupService.mergeFromBackup(incoming).reason, /不能直接合并/)
  assert.deepEqual(storage.get(TIMETABLE_KEY).courses, current)
})

test('V1 备份设置学期后可以覆盖为完整 V5 数据', () => {
  reset()
  const result = backupService.overwriteFromBackup(
    v1Envelope([v1Course({ name: '  高等数学  ' })]),
    TERM,
  )
  assert.equal(result.ok, true)
  const saved = storage.get(TIMETABLE_KEY)
  assert.equal(saved.schemaVersion, 5)
  assert.deepEqual(saved.periodSettings, DEFAULT_PERIOD_SETTINGS)
  assert.equal(saved.courses[0].groupId, saved.courses[0].id)
  assert.deepEqual(saved.term, TERM)
  assert.equal(saved.courses[0].name, '高等数学')
  assert.equal(saved.courses[0].weekMode, 'all')
  assert.deepEqual(saved.courses[0].weeks, ALL_WEEKS)
})

test('V2 备份覆盖时为每个旧课程补齐独立课程组', () => {
  reset()
  const result = backupService.overwriteFromBackup(v2Envelope([
    v2Course({ id: 'old-1' }),
    v2Course({ id: 'old-2', name: '英语', day: 2 }),
  ]))
  assert.equal(result.ok, true)
  const saved = storage.get(TIMETABLE_KEY)
  assert.equal(saved.schemaVersion, 5)
  assert.deepEqual(saved.periodSettings, DEFAULT_PERIOD_SETTINGS)
  assert.deepEqual(saved.courses.map((item) => item.groupId), ['old-1', 'old-2'])
})

test('V3 备份拒绝同一课程组的共同信息不一致', () => {
  reset()
  const analyzed = backupService.analyzeBackup(envelope([
    course({ id: 'slot-1', groupId: 'shared', day: 1 }),
    course({ id: 'slot-2', groupId: 'shared', day: 2, name: '不同名称' }),
  ]))
  assert.equal(analyzed.ok, false)
  assert.match(analyzed.errors[0], /共同信息不一致/)
})

test('合并 V3 备份会重建 ID 并保留导入课程组关联', () => {
  reset()
  const incoming = envelope([
    course({ id: 'slot-1', groupId: 'shared', day: 1 }),
    course({ id: 'slot-2', groupId: 'shared', day: 3 }),
  ])
  const result = backupService.mergeFromBackup(incoming)
  assert.equal(result.ok, true)
  const saved = storage.get(TIMETABLE_KEY).courses
  assert.equal(saved.length, 2)
  assert.equal(new Set(saved.map((item) => item.id)).size, 2)
  assert.ok(saved.every((item) => item.id !== 'slot-1' && item.id !== 'slot-2'))
  assert.equal(new Set(saved.map((item) => item.groupId)).size, 1)
  assert.notEqual(saved[0].groupId, 'shared')
})

test('V3 备份拒绝缺失或不一致的周次字段', () => {
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
  storage.set(TIMETABLE_KEY, { schemaVersion: 5, term: clone(TERM), courses: replacement, periodSettings: clone(DEFAULT_PERIOD_SETTINGS) })
  assert.equal(backupService.restoreRecentBackup().ok, true)

  const restored = storage.get(TIMETABLE_KEY)
  assert.equal(restored.schemaVersion, 5)
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
    schemaVersion: 6,
    term: { startDate: '2026-09-07', totalWeeks: 18 },
    courses: [course({ futureField: 'keep-me' })],
  }
  storage = new Map([[TIMETABLE_KEY, clone(futureStorage)]])

  assert.throws(() => courseStorage.save(course({ name: '修改后' })), /仅支持修改 V5/)
  assert.throws(() => courseStorage.remove('course-1'), /仅支持修改 V5/)
  assert.throws(() => backupService.exportBackup(), /仅支持 V5/)
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

test('V5 备份与本地读取共用严格快照校验并拒绝未知字段', () => {
  reset()
  const invalid = envelope([], {
    data: {
      schemaVersion: 5,
      term: clone(TERM),
      courses: [{ ...course(), futureField: 'not-in-v5' }],
      periodSettings: clone(DEFAULT_PERIOD_SETTINGS),
    },
  })
  const analyzed = backupService.analyzeBackup(invalid)
  assert.equal(analyzed.ok, false)
  assert.match(analyzed.errors[0], /未知字段/)
})

test('合法六位颜色的当前课表可以完整导出并重新导入', () => {
  reset([course({ color: '#123456' })])
  const parsed = backupService.parseBackup(backupService.exportBackup())
  assert.equal(parsed.ok, true)
  const analyzed = backupService.analyzeBackup(parsed.envelope)
  assert.equal(analyzed.ok, true)
  assert.equal(analyzed.courses[0].color, '#123456')
  assert.equal(backupService.overwriteFromBackup(parsed.envelope).ok, true)
  assert.equal(storage.get(TIMETABLE_KEY).courses[0].color, '#123456')
})

test('课程组任一时段冲突时整组跳过且预览与结果一致', () => {
  const current = [course({ id: 'existing', groupId: 'existing', name: '数学', day: 1, startPeriod: 1, endPeriod: 1 })]
  reset(current)
  const incoming = [
    course({ id: 'physics-1', groupId: 'physics', name: '物理', day: 1, startPeriod: 1, endPeriod: 1 }),
    course({ id: 'physics-2', groupId: 'physics', name: '物理', day: 3, startPeriod: 4, endPeriod: 4 }),
  ]
  const backup = envelope(incoming)
  const analyzed = backupService.analyzeBackup(backup)
  assert.equal(analyzed.ok, true)
  assert.equal(analyzed.preview.mergeAddGroupCount, 0)
  assert.equal(analyzed.preview.mergeSkipConflictGroupCount, 1)
  assert.equal(analyzed.preview.mergeAddCount, 0)
  assert.equal(analyzed.preview.mergeSkipConflictCount, 2)

  const result = backupService.mergeFromBackup(backup)
  assert.equal(result.ok, true)
  assert.equal(result.addedGroups, 0)
  assert.equal(result.skippedConflictGroups, 1)
  assert.equal(result.added, 0)
  assert.deepEqual(storage.get(TIMETABLE_KEY).courses, current)
})

test('临时读取失败时导出、覆盖、合并和恢复操作全部中止且原数据不变', () => {
  const currentCourses = [course()]
  reset(currentCourses)
  const original = clone(storage.get(TIMETABLE_KEY))
  const incoming = envelope([course({ id: 'course-2', groupId: 'group-2', name: '英语', day: 2 })])
  storage.set(RECENT_BACKUP_KEY, { savedAt: Date.now(), export: clone(incoming) })

  assertReadFailurePreservesCurrent(() => backupService.exportBackup(), original)
  assertReadFailurePreservesCurrent(() => backupService.overwriteFromBackup(incoming), original)
  assertReadFailurePreservesCurrent(() => backupService.mergeFromBackup(incoming), original)
  assertReadFailurePreservesCurrent(() => backupService.restoreRecentBackup(), original)
  timetableReadFailures = 0
})
