import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import './helpers/register-typescript.mjs'

const definitions = []
globalThis.Page = (definition) => definitions.push(definition)
globalThis.Component = (definition) => definitions.push(definition)
globalThis.wx = {
  getStorageSync() { return '' },
  setStorageSync() {},
}

await import('../miniprogram/pages/settings/index.ts')
await import('../miniprogram/pages/period-settings/index.ts')
await import('../miniprogram/pages/period-time-edit/index.ts')
await import('../miniprogram/pages/course-edit/index.ts')
await import('../miniprogram/pages/slot-select/index.ts')
await import('../miniprogram/components/timetable-grid/index.ts')

const timetableMarkup = readFileSync(new URL('../miniprogram/pages/timetable/index.wxml', import.meta.url), 'utf8')
const settingsMarkup = readFileSync(new URL('../miniprogram/pages/settings/index.wxml', import.meta.url), 'utf8')
const periodMarkup = readFileSync(new URL('../miniprogram/pages/period-settings/index.wxml', import.meta.url), 'utf8')
const periodEditMarkup = readFileSync(new URL('../miniprogram/pages/period-time-edit/index.wxml', import.meta.url), 'utf8')
const appConfig = JSON.parse(readFileSync(new URL('../miniprogram/app.json', import.meta.url), 'utf8'))

test('新增页面 TypeScript 均可解析并注册', () => {
  assert.equal(definitions.length, 6)
})

test('设置首页提供学期、课程时间和数据管理三级入口', () => {
  assert.match(settingsMarkup, /学期设置/)
  assert.match(settingsMarkup, /课程时间设置/)
  assert.match(settingsMarkup, /数据管理/)
  assert.ok(appConfig.pages.includes('pages/settings/index'))
  assert.ok(appConfig.pages.includes('pages/period-settings/index'))
  assert.ok(appConfig.pages.includes('pages/period-time-edit/index'))
})

test('课程时间设置包含自动联动规则、步进器、自定义标识和固定保存区', () => {
  assert.match(periodMarkup, /每节课时长/)
  assert.match(periodMarkup, /课间休息时长/)
  assert.match(periodMarkup, /立即更新下方时间/)
  assert.match(periodMarkup, /onDecrease/)
  assert.match(periodMarkup, /onIncrease/)
  assert.match(periodMarkup, /onEditPeriod/)
  assert.match(periodMarkup, /清除自定义时间并重新排布/)
  assert.match(periodMarkup, /custom-badge/)
  assert.match(periodMarkup, /class="save-area"/)
})

test('单节编辑说明开始时间联动、专属时长和后续重排', () => {
  assert.match(periodEditMarkup, /修改开始时间会自动计算结束时间/)
  assert.match(periodEditMarkup, /本节时长/)
  assert.match(periodEditMarkup, /impactText/)
  assert.doesNotMatch(periodEditMarkup, /下一节开始/)
})

test('课表入口改为设置并向所有网格传入动态节次', () => {
  assert.match(timetableMarkup, /bindtap="onSettings"/)
  assert.doesNotMatch(timetableMarkup, /bindtap="onDataManage"/)
  assert.equal((timetableMarkup.match(/periods="{{periods}}"/g) || []).length, 2)
})

test('课表组件直接根据选择和占用状态构建可交互格子', () => {
  const component = definitions[5]
  const context = {
    properties: {
      periods: [{ index: 1, label: '第1节', time: '08:00–08:50', start: '08:00', end: '08:50', isCustom: false, customLabel: '' }],
      daySlots: [],
      selectedKeys: ['1-1'],
      disabledKeys: ['2-1'],
    },
    data: {},
    setData(changes) { Object.assign(this.data, changes) },
  }
  component.methods.rebuildColumns.call(context)
  assert.equal(context.data.columns.length, 7)
  assert.equal(context.data.columns[0].cells[0].selected, true)
  assert.equal(context.data.columns[1].cells[0].disabled, true)
})

test('作息页面保存遇到 Storage 读取失败时恢复按钮状态并提示原因', async () => {
  const constants = await import('../miniprogram/constants/timetable.ts')
  const periodPage = definitions[1]
  const originalGetStorageSync = globalThis.wx.getStorageSync
  const originalShowModal = globalThis.wx.showModal
  let modal
  globalThis.wx.getStorageSync = () => { throw new Error('simulated read failure') }
  globalThis.wx.showModal = (options) => { modal = options }
  const context = {
    data: { settings: structuredClone(constants.DEFAULT_PERIOD_SETTINGS), saving: false },
    setData(changes) { Object.assign(this.data, changes) },
  }

  periodPage.onSave.call(context)

  assert.equal(context.data.saving, false)
  assert.equal(modal.title, '无法保存')
  assert.match(modal.content, /读取本地课表失败/)
  globalThis.wx.getStorageSync = originalGetStorageSync
  globalThis.wx.showModal = originalShowModal
})
