import { appearanceData } from '../utils/appearance-page'

Component({
  data: { ...appearanceData(), selected: 0, hidden: false },
  lifetimes: { attached() { this.syncSelected() } },
  pageLifetimes: { show() { this.syncSelected() } },
  methods: {
    syncSelected() {
      const page = getCurrentPages().slice(-1)[0]
      this.setData({ ...appearanceData(), selected: page?.route === 'pages/todo/index' ? 1 : 0, hidden: !!page?.data.showShareHomePreview })
    },
    onSwitch(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      if (index === this.data.selected || (index !== 0 && index !== 1)) return
      wx.switchTab({ url: index === 0 ? '/pages/timetable/index' : '/pages/todo/index' })
    },
  },
})
