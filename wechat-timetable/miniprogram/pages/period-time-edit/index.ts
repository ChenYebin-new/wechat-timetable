import type { PeriodTime } from '../../models/course'
import { timeToMinutes } from '../../utils/period-settings'

interface PeriodTimeEditInit {
  index: number
  period: PeriodTime
  previousEnd: string
  nextStart: string
}

Page({
  data: {
    ready: false,
    index: 0,
    title: '',
    start: '08:00',
    end: '08:50',
    previousEnd: '',
    nextStart: '',
  },

  onLoad() {
    this.getOpenerEventChannel().on('periodTimeEditInit', (init: PeriodTimeEditInit) => {
      this.setData({
        ready: true,
        index: init.index,
        title: `第 ${init.index + 1} 节课`,
        start: init.period.start,
        end: init.period.end,
        previousEnd: init.previousEnd || '',
        nextStart: init.nextStart || '',
      })
      wx.setNavigationBarTitle({ title: `编辑第 ${init.index + 1} 节` })
    })
  },

  onStartChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ start: String(e.detail.value) })
  },

  onEndChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ end: String(e.detail.value) })
  },

  onSave() {
    const start = timeToMinutes(this.data.start)
    const end = timeToMinutes(this.data.end)
    const previousEnd = this.data.previousEnd ? timeToMinutes(this.data.previousEnd) : null
    const nextStart = this.data.nextStart ? timeToMinutes(this.data.nextStart) : null
    let reason = ''
    if (start === null || end === null || start >= end) reason = '开始时间必须早于结束时间'
    else if (previousEnd !== null && start < previousEnd) reason = `开始时间不能早于上一节结束时间 ${this.data.previousEnd}`
    else if (nextStart !== null && end > nextStart) reason = `结束时间不能晚于下一节开始时间 ${this.data.nextStart}`
    if (reason) {
      wx.showModal({ title: '时间无效', content: reason, showCancel: false, confirmText: '知道了' })
      return
    }
    this.getOpenerEventChannel().emit('periodTimeEditDone', {
      index: this.data.index,
      period: { start: this.data.start, end: this.data.end },
    })
    wx.navigateBack()
  },
})
