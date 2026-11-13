// Reproduce repeated onLoad/onShow/onReady synchronization of an unchanged tab.
import '../tests/helpers/register-typescript.mjs'
globalThis.wx = { getStorageSync() { return '' } }
const { THEME_IDS } = await import('../miniprogram/themes/index.ts')
const { appearanceData, syncAppearance } = await import('../miniprogram/utils/appearance-page.ts')
const { initializeAppearance } = await import('../miniprogram/services/appearance.ts')
const byteLength = value => Buffer.byteLength(JSON.stringify(value))

console.log(JSON.stringify({
  fixture: 'Three lifecycle calls, unchanged theme and timetable route',
  measurements: THEME_IDS.map(id => {
    wx.getStorageSync = () => ({ version: 1, themeId: id })
    initializeAppearance()
    let afterBytes = 0
    const tab = {
      data: { ...appearanceData(id), selected: 0, hidden: false },
      setData(patch) { afterBytes += byteLength(patch); Object.assign(this.data, patch) },
    }
    const page = { data: appearanceData(id), route: 'pages/timetable/index', getTabBar: () => tab, setData() {} }
    for (let i = 0; i < 3; i++) syncAppearance(page)
    return { theme: id, beforeBytes: 3 * byteLength({ ...appearanceData(id), selected: 0, hidden: false }), afterBytes }
  }),
  limitation: 'Sum of serialized setData payloads, excluding framing; not native rendering latency.',
}, null, 2))
