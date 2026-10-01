import { appearanceData, syncAppearance } from '../../utils/appearance-page'
import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'
import { ABOUT_CONTACT } from './config'

function showQrPreviewError() {
  wx.showToast({ title: '二维码无法打开，请通过邮箱联系', icon: 'none' })
}

Page({
  data: {
    ...appearanceData(),
    ...ABOUT_CONTACT,
    showShareHomePreview: false,
    qrImageFailed: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (initializeHomeSharing(this, '/pages/about/index', options)) return
    syncAppearance(this)
  },

  onShow() { syncAppearance(this) },

  onReady() { syncAppearance(this) },

  onPageScroll(event: WechatMiniprogram.Page.IPageScrollOption) {
    this.selectComponent('.page-masthead')?.updateScroll(event.scrollTop)
  },

  onShareAppMessage: shareHomeToFriend,

  onShareTimeline: shareHomeToTimeline,

  onCopyEmail() {
    if (this.data.showShareHomePreview) return
    wx.setClipboardData({
      data: this.data.email,
      success: () => wx.showToast({ title: '邮箱已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请长按邮箱复制', icon: 'none' }),
    })
  },

  onQrImageError() {
    if (this.data.showShareHomePreview) return
    this.setData({ qrImageFailed: true })
  },

  onPreviewQr() {
    if (this.data.showShareHomePreview || !this.data.wechatQrImage || this.data.qrImageFailed) return
    wx.getImageInfo({
      src: this.data.wechatQrImage,
      success: ({ path }) => wx.previewImage({
        current: path,
        urls: [path],
        showmenu: true,
        fail: showQrPreviewError,
      }),
      fail: showQrPreviewError,
    })
  },
})
