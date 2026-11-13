// Optional simulator acceptance. Point WECHAT_AUTOMATOR_MODULE at an installed
// miniprogram-automator package and WECHAT_AUDIT_ENDPOINT at an isolated test project.
// Storage APIs are mocked in memory; original values never leave the simulator.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const automator = require(process.env.WECHAT_AUTOMATOR_MODULE || 'miniprogram-automator')
const output = path.resolve(process.argv[2] || '../dist/optimization-native')
fs.mkdirSync(output, { recursive: true })
const report = { checks: [], exceptions: [], navigation: [] }
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let app
const mocked = []
async function current(route) {
  for (let count = 0; count < 40; count++) {
    const page = await app.currentPage()
    if (page?.path === `pages/${route}/index`) return page
    await wait(100)
  }
  throw new Error(`Expected ${route}; stack=${JSON.stringify((await app.pageStack()).map(page => page.path))}`)
}
async function settled(route) {
  const page = await current(route)
  // Native navigation animations must finish before another navigateTo/navigateBack.
  await wait(500)
  return page
}
async function back(route) {
  await app.callWxMethod('navigateBack', { delta: 1 })
  return settled(route)
}
async function check(name, action) {
  if (process.env.NATIVE_CHECK_FILTER && !new RegExp(process.env.NATIVE_CHECK_FILTER).test(name)) return
  console.log(`Checking ${name}`)
  await action()
  report.checks.push(name)
  save()
}

;(async () => {
  app = await automator.connect({ wsEndpoint: process.env.WECHAT_AUDIT_ENDPOINT || 'ws://127.0.0.1:9421' })
  app.on('exception', error => report.exceptions.push(String(error.message || error)))
  const device = await app.systemInfo()
  assert.equal(device.platform, 'devtools', 'Use an isolated simulator, not a real device')
  report.device = { model: device.model, width: device.windowWidth, height: device.windowHeight, SDKVersion: device.SDKVersion }
  const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  const courses = {
    schemaVersion: 5, term: { startDate: '2026-09-07', totalWeeks: 30 },
    periodSettings: { durationMinutes: 50, breakMinutes: 10, firstStart: '08:00', overrides: [], periods: Array.from({ length: 9 }, (_, index) => ({ start: time(480 + index * 60), end: time(530 + index * 60) })) },
    courses: [{ id: 'native-course', groupId: 'native-group', name: '合成验收课程', day: 1, startPeriod: 1, endPeriod: 2, weeks: Array.from({ length: 30 }, (_, index) => index + 1), weekMode: 'all', color: '#abcdef', createdAt: 1, updatedAt: 1 }],
  }
  const goals = {
    schemaVersion: 3,
    items: [{ id: 'native-goal', title: '合成验收目标', note: '已保存备注', completed: false, taskDate: '2026-11-13', createdAt: 1, updatedAt: 1, completedAt: null }],
    dailyNotes: [],
  }
  await app.evaluate((timetable, todo) => {
    getApp().__optimizationAudit = {
      original: JSON.stringify(wx.getStorageInfoSync().keys.slice().sort().map(key => [key, wx.getStorageSync(key)])),
      values: { timetable_courses: timetable, timetable_todos: todo, timetable_appearance: { version: 1, themeId: 'aqua' } },
      failTodoRead: false,
    }
  }, courses, goals)
  try {
    for (const [name, replacement] of [
      ['getStorageSync', function (key) { const state = getApp().__optimizationAudit; if (key === 'timetable_todos' && state.failTodoRead) throw Error('Synthetic read failure'); return JSON.parse(JSON.stringify(state.values[key] ?? '')) }],
      ['setStorageSync', function (key, value) { getApp().__optimizationAudit.values[key] = JSON.parse(JSON.stringify(value)) }],
      ['removeStorageSync', function (key) { delete getApp().__optimizationAudit.values[key] }],
    ]) { await app.mockWxMethod(name, replacement); mocked.push(name) }
    await app.evaluate(() => getApp().onLaunch())
    await app.reLaunch('/pages/timetable/index')
    let page = await settled('timetable')
    await page.callMethod('changeWeek', 15)
    await check('settings return preserves the explicitly selected week', async () => {
      await page.callMethod('onSettings')
      await settled('settings')
      report.navigation.push((await app.pageStack()).map(entry => entry.path))
      page = await back('timetable')
      report.navigation.push((await app.pageStack()).map(entry => entry.path))
      assert.equal(await page.data('currentWeek'), 15)
    })
    await check('all six themes preserve week and native selected-cell state through settings', async () => {
      for (const theme of ['paper', 'cream', 'campus', 'swiss', 'pixel', 'aqua']) {
        await page.callMethod('onSettings')
        const settings = await settled('settings')
        await settings.callMethod('onAppearance')
        const appearance = await settled('appearance')
        await appearance.callMethod('onChoose', { currentTarget: { dataset: { id: theme } } })
        await appearance.callMethod('onApply')
        await back('settings')
        page = await back('timetable')
        assert.equal(await page.data('themeId'), theme)
        assert.equal(await page.data('currentWeek'), 15)
        await page.callMethod('updateSelection', ['7-9'])
        await page.callMethod('updateSelection', ['7-8', '7-9'])
        const flags = await app.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('.course-grid').data.columns[6].cells.map(cell => cell.selected))
        assert.deepEqual(flags, [false, false, false, false, false, false, false, true, true])
        await page.callMethod('updateSelection', [])
      }
      await app.screenshot({ path: path.join(output, 'timetable.png') })
    })
    await check('neighboring and distant week patches render the correct dates and courses', async () => {
      for (const week of [16, 1, 30, 15]) {
        await page.callMethod('changeWeek', week)
        await wait(300)
        const rendered = await app.evaluate(() => {
          const page = getCurrentPages().slice(-1)[0]
          const panel = page.data.weekPanels[page.data.currentWeek - 1]
          const grid = page.selectAllComponents('.course-grid').find(grid => grid.properties.calendarDays[0]?.dateKey === panel.calendar.days[0]?.dateKey)
          return { week: page.data.currentWeek, date: grid?.properties.calendarDays[0]?.dateKey, expected: panel.calendar.days[0]?.dateKey, course: grid?.data.columns[0].slots[0]?.id }
        })
        assert.equal(rendered.week, week)
        assert.equal(rendered.date, rendered.expected)
        assert.equal(rendered.course, 'native-course')
      }
    })
    await check('storage read failure keeps an existing goal draft visible and cancellable', async () => {
      await app.switchTab('/pages/todo/index')
      page = await settled('todo')
      await page.callMethod('switchDate', '2026-11-13')
      await page.callMethod('editGoal', 'native-goal')
      await page.callMethod('onTitle', { detail: { value: '尚未保存的目标草稿' } })
      await app.evaluate(() => { getApp().__optimizationAudit.failTodoRead = true })
      await page.callMethod('refresh')
      assert.ok(await page.data('storageProblem'))
      const cancel = await page.$('.goal-editor .cancel-button')
      assert.ok(cancel, 'The fallback editor must be mounted')
      assert.equal(await (await page.$('.goal-editor .title-input')).value(), '尚未保存的目标草稿')
      assert.equal(String(await cancel.attribute('disabled')), 'false')
      assert.equal(String(await (await page.$('.goal-editor .save-button')).attribute('disabled')), 'true')
      await app.screenshot({ path: path.join(output, 'todo-read-failure.png') })
      await cancel.tap()
      for (let attempt = 0; attempt < 20 && await page.data('editorOpen'); attempt++) await wait(100)
      assert.equal(await page.data('editorOpen'), false)
      await app.evaluate(() => { getApp().__optimizationAudit.failTodoRead = false })
      await page.callMethod('refresh')
      assert.equal((await page.data('visibleItems'))[0].title, '合成验收目标')
    })
    await check('custom tab navigation reflects actual route and retains bottom safe area', async () => {
      await app.evaluate(() => getCurrentPages().slice(-1)[0].getTabBar().onSwitch({ currentTarget: { dataset: { index: 0 } } }))
      await settled('timetable')
      const data = await app.evaluate(() => { const data = getCurrentPages().slice(-1)[0].getTabBar().data; return { selected: data.selected, switching: data.switching, safeBottom: data.safeBottom } })
      assert.equal(data.selected, 0)
      assert.equal(data.switching, false)
      assert.ok(data.safeBottom >= 0 && data.safeBottom < 100)
    })
    report.businessUnchanged = await app.evaluate((timetable, todo) => JSON.stringify(getApp().__optimizationAudit.values.timetable_courses) === JSON.stringify(timetable) && JSON.stringify(getApp().__optimizationAudit.values.timetable_todos) === JSON.stringify(todo), courses, goals)
    assert.equal(report.businessUnchanged, true)
  } finally {
    await app.evaluate(() => { getApp().__optimizationAudit.failTodoRead = false })
    await app.reLaunch('/pages/timetable/index')
    for (const name of mocked.reverse()) await app.restoreWxMethod(name)
    await app.evaluate(() => getApp().onLaunch())
    await app.reLaunch('/pages/timetable/index')
    report.storageUnchanged = await app.evaluate(() => {
      const unchanged = JSON.stringify(wx.getStorageInfoSync().keys.slice().sort().map(key => [key, wx.getStorageSync(key)])) === getApp().__optimizationAudit.original
      delete getApp().__optimizationAudit
      return unchanged
    })
    save()
    app.disconnect()
  }
  assert.equal(report.storageUnchanged, true)
  assert.deepEqual(report.exceptions, [])
  console.log(JSON.stringify(report, null, 2))
})().catch(error => { report.failure = String(error.stack || error); save(); app?.disconnect(); console.error(error); process.exitCode = 1 })
