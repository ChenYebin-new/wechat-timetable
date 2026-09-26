import { createHash } from 'node:crypto'
import './register-typescript.mjs'
const courses = await import('../../miniprogram/services/course-storage.ts')
const backups = await import('../../miniprogram/services/backup-service.ts')
const todos = await import('../../miniprogram/services/todo-storage.ts')
const { DEFAULT_PERIOD_SETTINGS } = await import('../../miniprogram/constants/timetable.ts')

const TERM = { startDate: '2026-09-07', totalWeeks: 6 }
const clone = value => structuredClone(value)
export function courseSample(version) {
  const course = { id: 'a', name: '  数学  ', day: 1, startPeriod: 1, endPeriod: 2,
    teacher: '  老师  ', location: '  A101  ', color: '#123abc', createdAt: 1, updatedAt: 2 }
  if (version >= 2) Object.assign(course, { weekMode: 'all', weeks: [1, 2, 3, 4, 5, 6] })
  if (version >= 3) course.groupId = 'a'
  const data = { schemaVersion: version, courses: [course] }
  if (version >= 2) data.term = clone(TERM)
  if (version === 4) data.periodSettings = { durationMinutes: 50, breakMinutes: 10,
    periods: [{ start: '08:00', end: '08:40' }, { start: '13:00', end: '13:50' }] }
  if (version >= 5) data.periodSettings = clone(DEFAULT_PERIOD_SETTINGS)
  return data
}
export function todoSample(version) {
  const item = { id: 't', title: '  目标  ', note: '  备注\n', completed: true, createdAt: 1, updatedAt: 2, completedAt: 3 }
  if (version < 3) item.dueDate = '2026-09-12'
  if (version === 2) Object.assign(item, { scheduleDate: '2026-09-11', scheduleStartTime: '10:00', scheduleEndTime: '11:00' })
  if (version >= 3) item.taskDate = '2026-09-12'
  const data = { schemaVersion: version, items: [item] }
  if (version >= 3) data.dailyNotes = [{ date: '2026-09-12', content: '  随想\n😀', updatedAt: 4 }]
  return data
}

export function versionCases() {
  const cases = []
  const add = (domain, name, raw) => cases.push({ domain, name, raw })
  for (let version = 1; version <= 5; version++) {
    const base = courseSample(version)
    add('course', `course-v${version}`, base)
    for (const [label, mutate] of [
      ['empty', x => { x.courses = []; if (version >= 2) x.term = null }],
      ['root-extra', x => { x.unrecognized = true }],
      ['course-extra', x => { x.courses[0].unrecognized = true }],
      ['blank-optionals', x => { x.courses[0].teacher = '  '; x.courses[0].location = '' }],
      ['bad-period', x => { x.courses[0].startPeriod = 0 }],
      ['bad-timestamp', x => { x.courses[0].updatedAt = -1 }],
      ['duplicate-id', x => { x.courses.push(clone(x.courses[0])) }],
      ['conflict', x => { const other = clone(x.courses[0]); other.id = 'b'; if (version >= 3) other.groupId = 'b'; x.courses.push(other) }],
    ]) {
      const raw = clone(base); mutate(raw); add('course', `course-v${version}-${label}`, raw)
    }
    if (version >= 2) {
      for (const [label, mutate] of [
        ['all-empty', x => { x.courses[0].weeks = [] }],
        ['odd-valid', x => { x.courses[0].weekMode = 'odd'; x.courses[0].weeks = [1, 3, 5] }],
        ['custom-unordered', x => { x.courses[0].weekMode = 'custom'; x.courses[0].weeks = [3, 1] }],
        ['missing-term', x => { delete x.term }],
        ['term-extra', x => { x.term.extra = true }],
      ]) { const raw = clone(base); mutate(raw); add('course', `course-v${version}-${label}`, raw) }
    }
    if (version >= 3) {
      const raw = clone(base)
      raw.courses.push({ ...raw.courses[0], id: 'b', day: 2, name: '另一课程' })
      add('course', `course-v${version}-group-mismatch`, raw)
    }
  }
  const v4extra = courseSample(4); v4extra.periodSettings.extra = true
  add('course', 'course-v4-period-extra', v4extra)
  for (let version = 1; version <= 3; version++) {
    add('todo', `todo-v${version}`, todoSample(version))
    const empty = todoSample(version); empty.items = []; if (version === 3) empty.dailyNotes = []
    add('todo', `todo-v${version}-empty`, empty)
    const unfinished = todoSample(version); unfinished.items[0].completed = false; unfinished.items[0].completedAt = null
    add('todo', `todo-v${version}-unfinished`, unfinished)
    const duplicate = todoSample(version); duplicate.items.push(clone(duplicate.items[0]))
    add('todo', `todo-v${version}-duplicate`, duplicate)
    const extra = todoSample(version); extra.items[0].extra = true
    add('todo', `todo-v${version}-extra`, extra)
  }
  for (const domain of ['course', 'todo']) {
    add(domain, `${domain}-missing`, '')
    add(domain, `${domain}-unknown`, { schemaVersion: 99, untouched: true })
    add(domain, `${domain}-corrupt`, { schemaVersion: '3' })
    add(domain, `${domain}-non-object`, 'bad')
  }
  return cases
}

export function captureVersionCase(sample) {
  const storage = new Map()
  const key = sample.domain === 'course' ? 'timetable_courses' : 'timetable_todos'
  if (sample.raw !== '') storage.set(key, clone(sample.raw))
  const untouchedKey = sample.domain === 'course' ? 'timetable_todos' : 'timetable_courses'
  storage.set(untouchedKey, { sentinel: 'must-not-change' })
  const writes = []
  const previousWx = globalThis.wx
  const RealDate = globalThis.Date
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : ['2026-09-26T00:00:00.000Z'])) }
    static now() { return 1790380800000 }
  }
  globalThis.wx = {
    getStorageSync: key => clone(storage.get(key) ?? ''),
    setStorageSync: (key, value) => { writes.push(key); storage.set(key, clone(value)) },
    removeStorageSync: key => { writes.push(key); storage.delete(key) },
  }
  const attempt = action => { try { return action() } catch (error) { return { error: error.message } } }
  try {
    let result
    if (sample.domain === 'course') {
      const read = courses.getStorageSnapshot()
      const envelope = { app: 'qige-timetable', backupVersion: 1, exportedAt: '2026-09-26T00:00:00.000Z', data: clone(sample.raw) }
      const imported = attempt(() => backups.analyzeBackup(envelope, { ...courseSample(5), courses: [] }))
      const overwrite = attempt(() => backups.overwriteFromBackup(envelope, sample.raw?.schemaVersion === 1 ? TERM : undefined))
      result = { read, imported, overwrite, storage: [...storage], writes }
    } else {
      const read = todos.getTodoSnapshot()
      const migrated = attempt(() => todos.migrateTodosToV3('2026-09-26'))
      result = { read, migrated, after: todos.getTodoSnapshot(), storage: [...storage], writes }
    }
    if (JSON.stringify(storage.get(untouchedKey)) !== '{"sentinel":"must-not-change"}') throw new Error('Unrelated storage changed')
    const digest = createHash('sha256').update(JSON.stringify(result)).digest('hex')
    return { name: sample.name, readKind: result.read.kind,
      accepted: sample.domain === 'course' ? result.imported.ok === true : !result.migrated?.error,
      digest }
  } finally { globalThis.wx = previousWx; globalThis.Date = RealDate }
}
