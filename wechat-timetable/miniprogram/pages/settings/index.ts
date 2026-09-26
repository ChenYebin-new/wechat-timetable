import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'

Page({
  data: {
    showShareHomePreview: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (initializeHomeSharing(this, '/pages/settings/index', options)) return
  },

  onShareAppMessage: shareHomeToFriend,

  onShareTimeline: shareHomeToTimeline,

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
