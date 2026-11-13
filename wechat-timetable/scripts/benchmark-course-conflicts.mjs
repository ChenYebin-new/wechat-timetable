// Run from wechat-timetable: node --disable-warning=ExperimentalWarning scripts/benchmark-course-conflicts.mjs
// Diagnostic only: elapsed times are not CI assertions or device-performance claims.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import '../tests/helpers/register-typescript.mjs'

const { firstCourseConflict } = await import('../miniprogram/utils/course-data-rules.ts')
const { isOverlapping } = await import('../miniprogram/utils/course-validator.ts')
const { planCourseGroupMerge, groupCourses } = await import('../miniprogram/utils/course-groups.ts')

function pairwiseConflict(courses) {
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      if (isOverlapping(courses[i], courses[j])) return [courses[i], courses[j]]
    }
  }
  return null
}

function pairwiseMerge(incoming, existing) {
  return groupCourses(incoming).map((courses) => {
    const duplicate = courses.some((course) => existing.some((item) => course.id === item.id || (
      course.name.trim() === item.name.trim() && course.day === item.day
      && course.startPeriod === item.startPeriod && course.endPeriod === item.endPeriod
      && course.weeks.length === item.weeks.length && course.weeks.every((week, index) => week === item.weeks[index])
    )))
    const conflict = courses.some((course) => existing.some((item) => isOverlapping(course, item)))
    if (duplicate) return { groupId: courses[0].groupId, courses, kind: 'duplicate', reason: `「${courses[0].name}」包含与当前课表重复的时段，整门课程已跳过` }
    if (conflict) return { groupId: courses[0].groupId, courses, kind: 'conflict', reason: `「${courses[0].name}」包含与当前课表冲突的时段，整门课程已跳过` }
    return { groupId: courses[0].groupId, courses, kind: 'add' }
  })
}

function medianMilliseconds(fn, courses) {
  const iterations = courses.length < 100 ? 100 : 10
  for (let warmup = 0; warmup < 20; warmup++) fn(courses)
  const samples = Array.from({ length: 21 }, () => {
    const start = performance.now()
    for (let iteration = 0; iteration < iterations; iteration++) fn(courses)
    return (performance.now() - start) / iterations
  }).sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]
}

const regular = []
for (let day = 1; day <= 5; day++) {
  for (let period = 1; period <= 7; period += 2) {
    regular.push({ day, startPeriod: period, endPeriod: period + 1, weeks: Array.from({ length: 18 }, (_, index) => index + 1) })
  }
}
const dense = []
for (let day = 1; day <= 7; day++) {
  for (let period = 1; period <= 14; period++) {
    for (let week = 1; week <= 30; week++) dense.push({ day, startPeriod: period, endPeriod: period, weeks: [week] })
  }
}
const scenarios = [
  ['regular 20 weekly courses', regular],
  ['maximum 2940 non-overlapping occurrences', dense],
  ['maximum plus final conflicting occurrence', [...dense, { ...dense.at(-1) }]],
]
console.log(`Node ${process.version}; ${process.platform}/${process.arch}; median per call, 21 samples`)
console.table(scenarios.map(([scenario, courses]) => {
  assert.deepEqual(firstCourseConflict(courses), pairwiseConflict(courses))
  const before = medianMilliseconds(pairwiseConflict, courses)
  const after = medianMilliseconds(firstCourseConflict, courses)
  return { scenario, courses: courses.length, pairwiseMs: Number(before.toFixed(4)), indexedMs: Number(after.toFixed(4)), speedup: `${(before / after).toFixed(2)}x` }
}))

console.log('Merge planning against an equal-size stored timetable')
console.table([['regular 20 courses', regular], ['maximum 2940 occurrences', dense]].map(([scenario, slots]) => {
  const courses = slots.map((slot, index) => ({ ...slot, id: `course-${index}`, groupId: `group-${index}`, name: `课程 ${index}` }))
  assert.deepEqual(planCourseGroupMerge(courses, courses), pairwiseMerge(courses, courses))
  const before = medianMilliseconds((incoming) => pairwiseMerge(incoming, courses), courses)
  const after = medianMilliseconds((incoming) => planCourseGroupMerge(incoming, courses), courses)
  return { scenario, courses: courses.length, pairwiseMs: Number(before.toFixed(4)), indexedMs: Number(after.toFixed(4)), speedup: `${(before / after).toFixed(2)}x` }
}))
