import { appearanceData, syncTabAppearance } from '../utils/appearance-page'
import { getCurrentThemeId } from '../services/appearance'
import { DEFAULT_THEME } from '../themes/index'

const pendingSwitches = new WeakMap<object, object>()

Component({
  data: { ...appearanceData(), selected: 0, hidden: false, safeBottom: 0, switching: false },
  lifetimes: {
    attached() { this.syncSelected() },
    detached() { pendingSwitches.delete(this) },
  },
  pageLifetimes: {
    show() { this.cancelSwitch(); this.syncSelected() },
    hide() { this.cancelSwitch() },
    resize() { this.measureSafeBottom() },
  },
  methods: {
    cancelSwitch() {
      pendingSwitches.delete(this)
      if (this.data.switching) this.setData({ switching: false })
    },
    measureSafeBottom() {
      // Use screen coordinates: the usable window can shrink while the keyboard is closing.
      const { screenHeight, safeArea } = wx.getSystemInfoSync()
      const bottom = safeArea?.bottom
      const safeBottom = Number.isFinite(screenHeight) && Number.isFinite(bottom)
        && bottom > 0 && bottom <= screenHeight ? screenHeight - bottom : 0
      if (safeBottom !== this.data.safeBottom) this.setData({ safeBottom })
    },
    syncSelected() {
      this.measureSafeBottom()
      const page = getCurrentPages().slice(-1)[0]
      const hidden = !!page?.data.showShareHomePreview
      syncTabAppearance(this, hidden ? DEFAULT_THEME : getCurrentThemeId(), page?.route === 'pages/todo/index' ? 1 : 0, hidden)
    },
    onSwitch(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      if (this.data.switching || index === this.data.selected || (index !== 0 && index !== 1)) return
      const pending = {}
      pendingSwitches.set(this, pending)
      this.setData({ switching: true })
      // Finish dismissing the source page's input before switching its native viewport.
      wx.hideKeyboard({
        complete: () => {
          if (pendingSwitches.get(this) !== pending) return
          wx.switchTab({
            url: index === 0 ? '/pages/timetable/index' : '/pages/todo/index',
            complete: () => {
              if (pendingSwitches.get(this) === pending) this.cancelSwitch()
            },
          })
        },
      })
    },
  },
})
