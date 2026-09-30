import { appearanceData, syncAppearance } from '../../utils/appearance-page'
import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'

Page({
  data: {
    ...appearanceData(),
    showShareHomePreview: false,
  },

  onShow() { syncAppearance(this) },

  onPageScroll(event: WechatMiniprogram.Page.IPageScrollOption) {
    this.selectComponent('.page-masthead')?.updateScroll(event.scrollTop)
  },

  onReady() { syncAppearance(this) },

  onLoad(options: Record<string, string | undefined>) {
    if (initializeHomeSharing(this, '/pages/settings/index', options)) return
    syncAppearance(this)
  },

  onShareAppMessage: shareHomeToFriend,

  onShareTimeline: shareHomeToTimeline,

  onAppearance() {
    wx.navigateTo({ url: '/pages/appearance/index' })
  },

  onTermSettings() {
    wx.navigateTo({ url: '/pages/term-settings/index' })
  },

  onPeriodSettings() {
    wx.navigateTo({ url: '/pages/period-settings/index' })
  },

  onDataManage() {
    wx.navigateTo({ url: '/pages/data-manage/index' })
  },

  onTodoBackup() {
    wx.navigateTo({ url: '/pages/todo-backup/index' })
  },
})
