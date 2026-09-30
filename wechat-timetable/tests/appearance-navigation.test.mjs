import assert from 'node:assert/strict'
import test from 'node:test'
import './helpers/register-typescript.mjs'

const definitions = []
let windowInfo, capsule, stack = [], calls = []
globalThis.Component = value => definitions.push(value)
globalThis.getCurrentPages = () => stack
globalThis.wx = {
  getStorageSync() { return '' },
  getSystemInfoSync() { return windowInfo },
  getMenuButtonBoundingClientRect() { return capsule },
  navigateBack(options) { calls.push(['back', options]) },
  switchTab(options) { calls.push(['tab', options]) },
}
await import('../miniprogram/components/page-header/index.ts')
await import('../miniprogram/custom-tab-bar/index.ts')
const [header, tab] = definitions
function instance(definition) {
  return { ...definition.methods, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch) } }
}

test('custom header reserves measured status/capsule space at narrow and wide widths', () => {
  for (const width of [360, 390, 430]) {
    windowInfo = { windowWidth: width, statusBarHeight: 47 }
    capsule = { top: 55, height: 32, left: width - 94 }
    const context = instance(header)
    context.measureNavigation()
    assert.equal(context.data.statusHeight, 47)
    assert.equal(context.data.navigationHeight, 48)
    assert.equal(context.data.capsuleSpace, 102)
    // Invalid capsule measurements retain a usable 44px navigation target.
    capsule = { top: 0, left: 0, height: 0 }
    header.pageLifetimes.resize.call(context)
    assert.equal(context.data.navigationHeight, 44)
    assert.equal(context.data.capsuleSpace, 104)
  }
})

test('custom back uses the existing stack, or the timetable tab for a directly opened page', () => {
  calls = []
  const context = instance(header)
  stack = [{ route: 'pages/timetable/index' }, { route: 'pages/settings/index' }]
  context.onBack()
  assert.deepEqual(calls.pop(), ['back', { delta: 1 }])
  stack = [{ route: 'pages/settings/index' }]
  context.onBack()
  assert.deepEqual(calls.pop(), ['tab', { url: '/pages/timetable/index' }])
})

test('scrolling switches the fixed header to an opaque compact surface and restores the hero at top', () => {
  const context = instance(header)
  context.updateScroll(800)
  assert.equal(context.data.scrolled, true)
  assert.equal(context.data.compactTitle, true)
  context.updateScroll(12)
  assert.equal(context.data.scrolled, true)
  assert.equal(context.data.compactTitle, false)
  context.updateScroll(0)
  assert.equal(context.data.scrolled, false)
  assert.equal(context.data.compactTitle, false)
})

test('custom tabs follow actual route and do not show an unconfirmed navigation as selected', () => {
  calls = []
  const context = instance(tab)
  stack = [{ route: 'pages/timetable/index', data: { showShareHomePreview: false } }]
  tab.pageLifetimes.show.call(context)
  assert.equal(context.data.selected, 0)
  context.onSwitch({ currentTarget: { dataset: { index: 1 } } })
  assert.deepEqual(calls.pop(), ['tab', { url: '/pages/todo/index' }])
  assert.equal(context.data.selected, 0)
  stack = [{ route: 'pages/todo/index', data: { showShareHomePreview: false } }]
  tab.pageLifetimes.show.call(context)
  assert.equal(context.data.selected, 1)
  context.onSwitch({ currentTarget: { dataset: { index: 1 } } })
  context.onSwitch({ currentTarget: { dataset: { index: 9 } } })
  assert.deepEqual(calls, [])
  stack[0].data.showShareHomePreview = true
  context.syncSelected()
  assert.equal(context.data.hidden, true)
})
