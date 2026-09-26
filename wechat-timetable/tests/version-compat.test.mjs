import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { versionCases, captureVersionCase, courseSample } from './helpers/version-compat-matrix.mjs'

const { decodeStoredTimetable, decodeBackupTimetable, expandV1CoursesWithTerm } = await import('../miniprogram/services/timetable-compat.ts')

// 在 ba5ca59 原实现上生成；摘要覆盖读取、迁移、导入、覆盖、写入顺序及最终 Storage。
const baseline = JSON.parse(readFileSync(new URL('./fixtures/version-compat-baseline.json', import.meta.url), 'utf8'))
const cases = versionCases()
assert.deepEqual(cases.map(x => x.name), baseline.map(x => x.name), '兼容样本不能静默删除')
for (const [index, sample] of cases.entries()) {
  test(`兼容基线：${sample.name}`, () => {
    assert.deepEqual(captureVersionCase(sample), baseline[index])
  })
}

test('兼容解码不访问 Storage，也不修改传入的历史或当前对象', () => {
  const previousWx = globalThis.wx
  globalThis.wx = new Proxy({}, { get() { throw new Error('纯解码不得访问 wx') } })
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze)
      Object.freeze(value)
    }
    return value
  }
  try {
    for (let version = 1; version <= 5; version++) {
      const raw = freeze(courseSample(version))
      const before = structuredClone(raw)
      const local = decodeStoredTimetable(raw)
      const imported = decodeBackupTimetable(raw)
      assert.equal(local.kind, version === 5 ? 'current' : 'legacy')
      assert.equal(imported.ok, true)
      assert.deepEqual(raw, before)
      assert.equal(local.data.courses[0].name, '  数学  ')
      assert.equal(imported.courses[0].name, '数学')
      assert.equal(Boolean(local.next), version >= 2 && version <= 4)
      if (version === 1) {
        const expanded = expandV1CoursesWithTerm(freeze(imported.courses), { startDate: '2026-09-07', totalWeeks: 6 })
        assert.deepEqual(expanded[0].weeks, [1, 2, 3, 4, 5, 6])
        assert.deepEqual(imported.courses[0].weeks, [])
      }
    }
  } finally { globalThis.wx = previousWx }
})

test('V4 两个解码入口都保留午休锚点和单节时长', () => {
  const raw = courseSample(4)
  const local = decodeStoredTimetable(raw).next
  const imported = decodeBackupTimetable(raw)
  assert.deepEqual(local.periodSettings, imported.periodSettings)
  assert.deepEqual(local.periodSettings.periods, raw.periodSettings.periods)
  assert.deepEqual(local.periodSettings.overrides, [
    { period: 1, durationMinutes: 40 },
    { period: 2, start: '13:00' },
  ])
})
