import assert from 'node:assert/strict'
import test from 'node:test'
import './helpers/register-typescript.mjs'

globalThis.wx = { getStorageSync() { return '' } }
const { THEME_IDS, DEFAULT_THEME } = await import('../miniprogram/themes/index.ts')
const { initializeAppearance } = await import('../miniprogram/services/appearance.ts')
const { appearanceData, syncAppearance, syncTabAppearance } = await import('../miniprogram/utils/appearance-page.ts')

function tabFor(id) {
  const patches = []
  return {
    patches,
    data: { ...appearanceData(id), selected: 0, hidden: false, safeBottom: 34, switching: false },
    setData(patch) { patches.push(patch); Object.assign(this.data, patch) },
  }
}

test('repeated page lifecycle synchronization sends no unchanged theme payload for all six themes', () => {
  for (const id of THEME_IDS) {
    wx.getStorageSync = () => ({ version: 1, themeId: id })
    initializeAppearance()
    const tab = tabFor(id)
    const page = {
      route: 'pages/timetable/index', data: { ...appearanceData(id), title: '未保存目标' },
      getTabBar: () => tab,
      setData() { assert.fail('unchanged page must not be repainted') },
    }
    for (let i = 0; i < 3; i++) syncAppearance(page)
    assert.deepEqual(tab.patches, [])
    page.route = 'pages/todo/index'
    syncAppearance(page)
    assert.deepEqual(tab.patches, [{ selected: 1 }])
    assert.equal(page.data.title, '未保存目标')
  }
})

test('theme, route and public preview changes update the bottom bar without touching navigation state', () => {
  const tab = tabFor('paper')
  syncTabAppearance(tab, 'aqua', 1, false)
  assert.deepEqual(tab.patches[0], { ...appearanceData('aqua'), selected: 1 })
  syncTabAppearance(tab, DEFAULT_THEME, 1, true)
  assert.deepEqual(tab.patches[1], { hidden: true })
  syncTabAppearance(tab, 'paper', 0, false)
  assert.equal(tab.data.appearanceStyle, appearanceData('paper').appearanceStyle)
  assert.equal(tab.data.hidden, false)
  assert.equal(tab.data.selected, 0)
  assert.equal(tab.data.safeBottom, 34)
  assert.equal(tab.data.switching, false)
})
