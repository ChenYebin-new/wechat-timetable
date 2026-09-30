import { DEFAULT_THEME } from '../../themes/index'

Component({
  properties: {
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    home: { type: Boolean, value: false },
    themeId: { type: String, value: DEFAULT_THEME },
    appearanceStyle: { type: String, value: '' },
    art: { type: String, value: '' },
  },
  data: { statusHeight: 24, navigationHeight: 44, capsuleSpace: 104, scrolled: false, compactTitle: false },
  lifetimes: {
    attached() { this.measureNavigation() },
  },
  pageLifetimes: {
    resize() { this.measureNavigation() },
  },
  methods: {
    updateScroll(scrollTop: number) {
      const scrolled = scrollTop > 1
      const compactTitle = scrollTop > 44
      if (scrolled !== this.data.scrolled || compactTitle !== this.data.compactTitle) this.setData({ scrolled, compactTitle })
    },
    measureNavigation() {
      const window = wx.getSystemInfoSync()
      const capsule = wx.getMenuButtonBoundingClientRect()
      const statusHeight = window.statusBarHeight || 24
      const valid = capsule.height > 0 && capsule.top >= statusHeight && capsule.left > 0
      this.setData({
        statusHeight,
        navigationHeight: valid ? Math.max(44, (capsule.top - statusHeight) * 2 + capsule.height) : 44,
        capsuleSpace: valid ? window.windowWidth - capsule.left + 8 : 104,
      })
    },
    onBack() {
      if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
      else wx.switchTab({ url: '/pages/timetable/index' })
    },
  },
})
