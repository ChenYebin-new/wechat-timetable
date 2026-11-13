import assert from 'node:assert/strict'
import test from 'node:test'
import './helpers/register-typescript.mjs'
const { firstCourseConflict } = await import('../miniprogram/utils/course-data-rules.ts')
const { isOverlapping } = await import('../miniprogram/utils/course-validator.ts')
const { planCourseGroupMerge, groupCourses } = await import('../miniprogram/utils/course-groups.ts')

function course(day, startPeriod, endPeriod, weeks) {
  return { day, startPeriod, endPeriod, weeks }
}

function pairwiseConflict(courses) {
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      if (isOverlapping(courses[i], courses[j])) return [courses[i], courses[j]]
    }
  }
  return null
}

test('冲突索引保留首对课程的原数组顺序，而非最先发现的冲突', () => {
  const courses = [course(1, 1, 2, [1]), course(2, 1, 1, [1]), course(2, 1, 1, [1]), course(1, 2, 3, [1])]
  assert.deepEqual(firstCourseConflict(courses), [courses[0], courses[3]])
})

test('冲突索引覆盖第 30 周、第 14 节和旧版全周哨兵，不跨星期误报', () => {
  assert.equal(firstCourseConflict([]), null)
  assert.equal(firstCourseConflict([course(7, 14, 14, [30]), course(1, 1, 1, [1])]), null)
  assert.equal(firstCourseConflict([course(7, 14, 14, [29]), course(7, 14, 14, [30])]), null)
  for (const weeks of [[], [30], [30, 30]]) {
    const courses = [course(7, 14, 14, weeks), course(7, 13, 14, [30])]
    assert.deepEqual(firstCourseConflict(courses), courses)
    assert.equal(firstCourseConflict([courses[0]]), null)
  }
})

test('2,940 个按周拆分的合法时段互不冲突，末尾重复准确定位', () => {
  const courses = []
  for (let day = 1; day <= 7; day++) {
    for (let period = 1; period <= 14; period++) {
      for (let week = 1; week <= 30; week++) courses.push(course(day, period, period, [week]))
    }
  }
  assert.equal(firstCourseConflict(courses), null)
  const duplicate = course(7, 14, 14, [30])
  assert.deepEqual(firstCourseConflict([...courses, duplicate]), [courses.at(-1), duplicate])
})

test('固定种子随机课表与两两比较结果一致，输入保持原样', () => {
  let seed = 0x5eeda11
  function random(max) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % max
  }
  for (let sample = 0; sample < 500; sample++) {
    const courses = Array.from({ length: random(100) }, () => {
      const start = random(14) + 1
      const weeks = Array.from({ length: random(6) }, () => random(30) + 1)
      return course(random(7) + 1, start, start + random(15 - start), weeks)
    })
    const original = structuredClone(courses)
    assert.deepEqual(firstCourseConflict(courses), pairwiseConflict(courses), `sample ${sample}`)
    assert.deepEqual(courses, original)
  }
})

test('合并索引保留整组原子性、重复优先级和第 30 周边界', () => {
  const existing = [{ ...course(7, 14, 14, [30]), id: 'existing', groupId: 'existing', name: '原课程' }]
  const incoming = [
    { ...course(7, 14, 14, [30]), id: 'conflict', groupId: 'a', name: '冲突时段' },
    { ...course(1, 1, 1, [1]), id: 'existing', groupId: 'a', name: '重复 ID' },
    { ...course(7, 14, 14, [29]), id: 'week-29', groupId: 'b', name: '不同周' },
    { ...course(7, 14, 14, []), id: 'all', groupId: 'c', name: '旧版全部周' },
    { ...course(7, 14, 14, [30]), id: 'renamed-id', groupId: 'd', name: '  原课程  ' },
  ]
  assert.deepEqual(planCourseGroupMerge(incoming, existing).map(({ kind, courses }) => [kind, courses.length]), [
    ['duplicate', 2], ['add', 1], ['conflict', 1], ['duplicate', 1],
  ])
})

test('固定种子合并结果与原始重复和冲突规则一致，输入保持原样', () => {
  let seed = 0x123e4567
  function random(max) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed % max
  }
  function makeCourses(count, prefix) {
    return Array.from({ length: count }, (_, index) => {
      const start = random(14) + 1
      return {
        ...course(random(7) + 1, start, start + random(15 - start), Array.from({ length: random(5) }, () => random(30) + 1)),
        id: `${prefix}-${index}`, groupId: `${prefix}-group-${random(8)}`, name: `${random(10)} 课程`,
      }
    })
  }
  for (let sample = 0; sample < 200; sample++) {
    const existing = makeCourses(random(90), 'existing')
    const incoming = makeCourses(random(60), 'incoming')
    if (existing.length && incoming.length) incoming.push({ ...existing[random(existing.length)], groupId: incoming[0].groupId })
    const original = structuredClone([incoming, existing])
    const expected = groupCourses(incoming).map((group) => {
      const duplicate = group.some((item) => existing.some((other) => item.id === other.id || (
        item.name.trim() === other.name.trim() && item.day === other.day && item.startPeriod === other.startPeriod
        && item.endPeriod === other.endPeriod && item.weeks.length === other.weeks.length
        && item.weeks.every((week, index) => week === other.weeks[index])
      )))
      return duplicate ? 'duplicate' : group.some((item) => existing.some((other) => isOverlapping(item, other))) ? 'conflict' : 'add'
    })
    const actual = planCourseGroupMerge(incoming, existing)
    assert.deepEqual(actual.map(({ kind }) => kind), expected, `sample ${sample}`)
    assert.deepEqual(actual.map(({ courses }) => courses), groupCourses(incoming))
    assert.deepEqual([incoming, existing], original)
  }
})
