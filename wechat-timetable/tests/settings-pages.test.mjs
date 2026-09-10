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

test('课程时间设置包含规则、步进器、列表、重新生成和固定保存区', () => {
  assert.match(periodMarkup, /每节课默认时长/)
  assert.match(periodMarkup, /默认课间休息/)
  assert.match(periodMarkup, /onDecrease/)
  assert.match(periodMarkup, /onIncrease/)
  assert.match(periodMarkup, /onEditPeriod/)
  assert.match(periodMarkup, /按当前规则重新生成/)
  assert.match(periodMarkup, /class="save-area"/)
})

test('课表入口改为设置并向所有网格传入动态节次', () => {
  assert.match(timetableMarkup, /bindtap="onSettings"/)
  assert.doesNotMatch(timetableMarkup, /bindtap="onDataManage"/)
  assert.equal((timetableMarkup.match(/periods="{{periods}}"/g) || []).length, 2)
})
