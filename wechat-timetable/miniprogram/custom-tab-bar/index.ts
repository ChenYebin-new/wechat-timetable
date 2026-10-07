import { appearanceData } from '../utils/appearance-page'

Component({
  data: { ...appearanceData(), selected: 0, hidden: false, safeBottom: 0, switching: false },
  lifetimes: { attached() { this.syncSelected() } },
  pageLifetimes: {
    show() { this.syncSelected() },
    resize() { this.measureSafeBottom() },
  },
  methods: {
    measureSafeBottom() {
      // Use screen coordinates: the usable window can shrink while the keyboard is closing.
      const { screenHeight, safeArea } = wx.getSystemInfoSync()
      const bottom = safeArea?.bottom
      const safeBottom = Number.isFinite(screenHeight) && Number.isFinite(bottom)
        && bottom > 0 && bottom <= screenHeight ? screenHeight - bottom : 0
      this.setData({ safeBottom })
    },
    syncSelected() {
      this.measureSafeBottom()
      const page = getCurrentPages().slice(-1)[0]
      this.setData({ ...appearanceData(), selected: page?.route === 'pages/todo/index' ? 1 : 0, hidden: !!page?.data.showShareHomePreview })
    },
    onSwitch(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      if (this.data.switching || index === this.data.selected || (index !== 0 && index !== 1)) return
      this.setData({ switching: true })
      // Finish dismissing the source page's input before switching its native viewport.
      wx.hideKeyboard({
        complete: () => wx.switchTab({
          url: index === 0 ? '/pages/timetable/index' : '/pages/todo/index',
          complete: () => this.setData({ switching: false }),
        }),
      })
    },
  },
})
