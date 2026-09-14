import assert from 'node:assert/strict'
import test from 'node:test'
import './helpers/register-typescript.mjs'

let storage = new Map()
const definitions = []

globalThis.Page = (definition) => definitions.push(definition)
globalThis.wx = {
  getStorageSync(key) {
    return storage.has(key) ? structuredClone(storage.get(key)) : ''
  },
  setStorageSync(key, value) {
    storage.set(key, structuredClone(value))
  },
  showShareMenu() {},
}

const constants = await import('../miniprogram/constants/timetable.ts')
await import('../miniprogram/pages/data-manage/index.ts')
await import('../miniprogram/pages/term-settings/index.ts')

const dataManagePage = definitions[0]
const termSettingsPage = definitions[1]

function course(overrides) {
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

test('修改导入文本会立即作废旧的解析结果', () => {
  const context = {
    data: {
      inputText: 'backup-a',
      envelope: { source: 'backup-a' },
      preview: { backupCount: 3 },
      previewErrors: ['old error'],
      needsTerm: true,
    },
    setData(changes) { Object.assign(this.data, changes) },
  }

  dataManagePage.onInput.call(context, { detail: { value: 'backup-b' } })

  assert.equal(context.data.inputText, 'backup-b')
  assert.equal(context.data.envelope, null)
  assert.equal(context.data.preview, null)
  assert.deepEqual(context.data.previewErrors, [])
  assert.equal(context.data.needsTerm, false)
})

test('学期设置按课程组而非时段数量显示受影响课程', () => {
  storage = new Map([['timetable_courses', {
    schemaVersion: constants.SCHEMA_VERSION,
    term: { startDate: '2026-09-07', totalWeeks: 18 },
    courses: [
      course({ id: 'math-monday', groupId: 'math', day: 1, startPeriod: 1, endPeriod: 2 }),
      course({ id: 'math-wednesday', groupId: 'math', day: 3, startPeriod: 5, endPeriod: 5 }),
      course({ id: 'english', groupId: 'english', name: '英语', day: 2, startPeriod: 3, endPeriod: 3 }),
    ],
    periodSettings: structuredClone(constants.DEFAULT_PERIOD_SETTINGS),
  }]])
  const context = {
    data: structuredClone(termSettingsPage.data),
    setData(changes) { Object.assign(this.data, changes) },
  }

  termSettingsPage.onLoad.call(context, {})

  assert.equal(context.data.affectedCount, 2)
})
