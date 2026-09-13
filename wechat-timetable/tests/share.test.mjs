import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import './helpers/register-typescript.mjs'

const appConfig = JSON.parse(readFileSync(new URL('../miniprogram/app.json', import.meta.url), 'utf8'))
const definitions = []
let scene = 1001
let menuOptions = []
let switchedUrls = []
let relaunchedUrls = []
let failSwitch = false

globalThis.Page = (definition) => definitions.push(definition)
globalThis.wx = {
  getStorageSync() { return '' },
  setStorageSync() {},
  getEnterOptionsSync() { return { scene } },
  showShareMenu(options) { menuOptions.push(structuredClone(options)) },
  switchTab(options) {
    switchedUrls.push(options.url)
    if (failSwitch && options.fail) options.fail({ errMsg: 'simulated switch failure' })
  },
  reLaunch(options) { relaunchedUrls.push(options.url) },
}

for (const pagePath of appConfig.pages) {
  await import(new URL(`../miniprogram/${pagePath}.ts`, import.meta.url))
}

const share = await import('../miniprogram/utils/share.ts')

function resetCalls() {
  scene = 1001
  menuOptions = []
  switchedUrls = []
  relaunchedUrls = []
  failSwitch = false
}

function pageContext(definition) {
  return {
    data: structuredClone(definition.data),
    setData(changes) { Object.assign(this.data, changes) },
    getOpenerEventChannel() { throw new Error('preview must not read EventChannel') },
    refresh() { throw new Error('preview must not refresh local data') },
    buildRecentBackupInfo() { throw new Error('preview must not read recent backup') },
  }
}

function jpegDimensions(buffer) {
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  for (let index = 0; index < buffer.length - 8; index += 1) {
    if (buffer[index] === 0xff && startOfFrameMarkers.has(buffer[index + 1])) {
      return {
        height: buffer.readUInt16BE(index + 5),
        width: buffer.readUInt16BE(index + 7),
      }
    }
  }
  throw new Error('JPEG dimensions not found')
}

test('app.json 中的全部页面统一注册好友与朋友圈分享', () => {
  assert.equal(definitions.length, appConfig.pages.length)
  assert.equal(appConfig.usingComponents['share-home-preview'], '/components/share-home-preview/index')

  for (let index = 0; index < appConfig.pages.length; index += 1) {
    const pagePath = appConfig.pages[index]
    const definition = definitions[index]
    const markup = readFileSync(new URL(`../miniprogram/${pagePath}.wxml`, import.meta.url), 'utf8')
    assert.equal(definition.data.showShareHomePreview, false, pagePath)
    assert.equal(definition.onShareAppMessage, share.shareHomeToFriend, pagePath)
    assert.equal(definition.onShareTimeline, share.shareHomeToTimeline, pagePath)
    assert.equal(typeof definition.onLoad, 'function', pagePath)
    assert.match(markup, /<share-home-preview wx:if="{{showShareHomePreview}}"\s*\/>/, pagePath)
    assert.match(markup, /<block wx:else>/, pagePath)
  }
})

test('好友卡片固定进入课表首页且朋友圈参数不携带业务数据', () => {
  assert.deepEqual(share.shareHomeToFriend(), {
    title: '拾课课表｜课表与待办',
    path: '/pages/timetable/index',
    imageUrl: '/assets/share/friend-card-5x4.jpg',
  })
  assert.deepEqual(share.shareHomeToTimeline(), {
    title: '拾课课表｜课表与待办',
    query: 'qige_share=home',
    imageUrl: '/assets/share/timeline-square.jpg',
  })
  assert.equal('path' in share.shareHomeToTimeline(), false)
  assert.doesNotMatch(share.TIMELINE_HOME_QUERY, /course|todo|week|date|group|\bid\b/i)
})

test('正常页面加载请求显示好友与朋友圈菜单', () => {
  resetCalls()
  const context = { setData() {} }
  const shouldStop = share.initializeHomeSharing(context, '/pages/settings/index', {})
  assert.equal(shouldStop, false)
  assert.deepEqual(menuOptions, [{ menus: ['shareAppMessage', 'shareTimeline'] }])
  assert.deepEqual(switchedUrls, [])
})

test('朋友圈单页模式只显示安全预览并阻止全部页面原初始化', () => {
  resetCalls()
  scene = 1154

  for (let index = 0; index < appConfig.pages.length; index += 1) {
    const pagePath = appConfig.pages[index]
    const definition = definitions[index]
    const context = pageContext(definition)
    assert.doesNotThrow(
      () => definition.onLoad.call(context, { qige_share: 'home' }),
      pagePath,
    )
    assert.equal(context.data.showShareHomePreview, true, pagePath)
    if (definition.onShow) {
      assert.doesNotThrow(() => definition.onShow.call(context), pagePath)
    }
  }

  assert.deepEqual(menuOptions, [])
  assert.deepEqual(switchedUrls, [])
  assert.deepEqual(relaunchedUrls, [])
})

test('朋友圈桥接进入完整小程序后切换首页并在失败时兜底', () => {
  resetCalls()
  scene = 1155
  const context = {
    data: { showShareHomePreview: false },
    setData(changes) { Object.assign(this.data, changes) },
  }
  assert.equal(
    share.initializeHomeSharing(context, '/pages/todo-edit/index', { qige_share: 'home' }),
    true,
  )
  assert.equal(context.data.showShareHomePreview, true)
  assert.deepEqual(switchedUrls, ['/pages/timetable/index'])
  assert.deepEqual(relaunchedUrls, [])

  resetCalls()
  scene = 1155
  failSwitch = true
  share.initializeHomeSharing(context, '/pages/settings/index', { qige_share: 'home' })
  assert.deepEqual(switchedUrls, ['/pages/timetable/index'])
  assert.deepEqual(relaunchedUrls, ['/pages/timetable/index'])
})

test('首页自身从朋友圈进入完整模式时不重复跳转', () => {
  resetCalls()
  const context = {
    data: { showShareHomePreview: true },
    setData(changes) { Object.assign(this.data, changes) },
  }
  assert.equal(
    share.initializeHomeSharing(context, share.HOME_PAGE_PATH, { qige_share: 'home' }),
    false,
  )
  assert.equal(context.data.showShareHomePreview, false)
  assert.deepEqual(switchedUrls, [])
  assert.deepEqual(menuOptions, [{ menus: ['shareAppMessage', 'shareTimeline'] }])
})

test('分享图片使用微信建议的 5:4 与 1:1 比例', () => {
  const friend = jpegDimensions(readFileSync(new URL('../miniprogram/assets/share/friend-card-5x4.jpg', import.meta.url)))
  const timeline = jpegDimensions(readFileSync(new URL('../miniprogram/assets/share/timeline-square.jpg', import.meta.url)))
  assert.deepEqual(friend, { width: 1000, height: 800 })
  assert.deepEqual(timeline, { width: 600, height: 600 })
})
