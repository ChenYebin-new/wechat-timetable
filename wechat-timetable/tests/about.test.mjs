import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { beforeEach, test } from 'node:test'
import './helpers/register-typescript.mjs'

const definitions = []
let calls = []
globalThis.Page = (definition) => definitions.push(definition)
globalThis.wx = { getStorageSync() { return '' } }
await import('../miniprogram/pages/settings/index.ts')
await import('../miniprogram/pages/about/index.ts')
const [settingsPage, aboutPage] = definitions

function page(data = {}) {
  return {
    ...aboutPage,
    data: { ...structuredClone(aboutPage.data), ...data },
    setData(changes) { Object.assign(this.data, changes) },
  }
}

beforeEach(() => {
  calls = []
  globalThis.wx = {
    getStorageSync() { return '' },
    setStorageSync() { assert.fail('关于页不应写入 Storage') },
    navigateTo(options) { calls.push(['navigate', options]) },
    setClipboardData(options) { calls.push(['clipboard', options]) },
    getImageInfo(options) { calls.push(['image', options]) },
    previewImage(options) { calls.push(['preview', options]) },
    showToast(options) { calls.push(['toast', options]) },
  }
})

test('设置入口进入关于页，联系信息包含已确认的邮箱和本地二维码原图', () => {
  settingsPage.onAbout()
  assert.deepEqual(calls, [['navigate', { url: '/pages/about/index' }]])
  assert.equal(aboutPage.data.email, 'leochen7531@gmail.com')
  assert.equal(aboutPage.data.wechatQrImage, '/assets/about/developer-wechat.jpg')
  assert.ok(existsSync(new URL('../miniprogram' + aboutPage.data.wechatQrImage, import.meta.url)))
})

test('邮箱复制只复制邮箱原文，微信确认成功后才提示成功', () => {
  page().onCopyEmail()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'clipboard')
  assert.equal(calls[0][1].data, 'leochen7531@gmail.com')
  calls[0][1].success()
  assert.deepEqual(calls[1], ['toast', { title: '邮箱已复制', icon: 'success' }])
})

test('邮箱复制失败时提示长按复制，不误报成功', () => {
  page().onCopyEmail()
  calls[0][1].fail()
  assert.deepEqual(calls[1], ['toast', { title: '复制失败，请长按邮箱复制', icon: 'none' }])
  assert.equal(calls.length, 2)
})

test('未提供或加载失败的二维码不可预览', () => {
  page({ wechatQrImage: '' }).onPreviewQr()
  const context = page({ wechatQrImage: '/assets/about/provided-qr.png' })
  context.onQrImageError()
  assert.equal(context.data.qrImageFailed, true)
  context.onPreviewQr()
  assert.deepEqual(calls, [])
})

test('二维码预览使用解析后的本地路径并打开原生长按菜单', () => {
  page({ wechatQrImage: '/assets/about/provided-qr.png' }).onPreviewQr()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'image')
  assert.equal(calls[0][1].src, '/assets/about/provided-qr.png')
  calls[0][1].success({ path: 'wxfile://resolved-qr.png' })
  assert.equal(calls[1][0], 'preview')
  assert.equal(calls[1][1].current, 'wxfile://resolved-qr.png')
  assert.deepEqual(calls[1][1].urls, ['wxfile://resolved-qr.png'])
  assert.equal(calls[1][1].showmenu, true)
})

test('二维码路径解析失败时引导邮箱联系，不调用预览', () => {
  page({ wechatQrImage: '/assets/about/provided-qr.png' }).onPreviewQr()
  calls[0][1].fail()
  assert.deepEqual(calls[1], ['toast', { title: '二维码无法打开，请通过邮箱联系', icon: 'none' }])
  assert.equal(calls.length, 2)
})

test('二维码原生预览失败时引导邮箱联系', () => {
  page({ wechatQrImage: '/assets/about/provided-qr.png' }).onPreviewQr()
  calls[0][1].success({ path: 'wxfile://resolved-qr.png' })
  calls[1][1].fail()
  assert.deepEqual(calls[2], ['toast', { title: '二维码无法打开，请通过邮箱联系', icon: 'none' }])
})

test('朋友圈单页预览不会复制邮箱或打开二维码', () => {
  const context = page({ showShareHomePreview: true, wechatQrImage: '/assets/about/provided-qr.png' })
  context.onCopyEmail()
  context.onPreviewQr()
  context.onQrImageError()
  assert.equal(context.data.qrImageFailed, false)
  assert.deepEqual(calls, [])
})
