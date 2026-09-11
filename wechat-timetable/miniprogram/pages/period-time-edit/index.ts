import type { PeriodSettings } from '../../models/course'
import {
  clonePeriodSettings,
  minutesToTime,
  timeToMinutes,
  updatePeriodTime,
} from '../../utils/period-settings'

interface PeriodTimeEditInit {
  index: number
  settings: PeriodSettings
}

Page({
  data: {
    ready: false,
    index: 0,
    title: '',
    start: '08:00',
    end: '08:50',
    originalStart: '08:00',
    settings: null as PeriodSettings | null,
    effectiveDuration: 50,
    durationText: '50 分钟',
    startChanged: false,
    endChanged: false,
    impactText: '',
    customText: '',
  },

  onLoad() {
    this.getOpenerEventChannel().on('periodTimeEditInit', (init: PeriodTimeEditInit) => {
      const settings = clonePeriodSettings(init.settings)
      const period = settings.periods[init.index]
      if (!period) return
      const start = timeToMinutes(period.start) as number
      const end = timeToMinutes(period.end) as number
      const override = settings.overrides.find((item) => item.period === init.index + 1)
      const customParts: string[] = []
      if (override?.start !== undefined) customParts.push('开始时间')
      if (override?.durationMinutes !== undefined) customParts.push('本节时长')
      this.setData({
        ready: true,
        index: init.index,
        title: `第 ${init.index + 1} 节课`,
        start: period.start,
        end: period.end,
        originalStart: period.start,
        settings,
        effectiveDuration: end - start,
        durationText: `${end - start} 分钟`,
        impactText:
          init.index < settings.periods.length - 1
            ? `保存后将按规则更新第 ${init.index + 1}–${settings.periods.length} 节；遇到手动开始锚点时会保留该时间。`
            : '保存后只更新本节课程时间。',
        customText: customParts.length > 0 ? `当前已自定义：${customParts.join('、')}` : '当前跟随全局作息规则',
      })
      wx.setNavigationBarTitle({ title: `编辑第 ${init.index + 1} 节` })
    })
  },

  onStartChange(e: WechatMiniprogram.PickerChange) {
    const startText = String(e.detail.value)
    const start = timeToMinutes(startText)
    if (start === null) return
    const endText = minutesToTime(start + this.data.effectiveDuration)
    if (!endText) {
      wx.showModal({
        title: '时间无效',
        content: '按本节当前时长计算会跨越当天 24:00，请选择更早的开始时间或先缩短结束时间。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    this.setData({
      start: startText,
      end: endText,
      startChanged: startText !== this.data.originalStart,
    })
  },

  onEndChange(e: WechatMiniprogram.PickerChange) {
    const endText = String(e.detail.value)
    const start = timeToMinutes(this.data.start)
    const end = timeToMinutes(endText)
    const duration = start !== null && end !== null ? end - start : 0
    const isValidDuration = duration >= 1 && duration <= 180
    this.setData({
      end: endText,
      ...(isValidDuration ? { effectiveDuration: duration } : {}),
      durationText:
        duration <= 0 ? '结束时间需晚于开始时间' : duration > 180 ? '本节时长不能超过 180 分钟' : `${duration} 分钟`,
      endChanged: true,
    })
  },

  onSave() {
    const settings = this.data.settings
    if (!settings) return
    const result = updatePeriodTime(settings, {
      period: this.data.index + 1,
      start: this.data.start,
      end: this.data.end,
      startChanged: this.data.startChanged,
      endChanged: this.data.endChanged,
    })
    if (!result.ok || !result.settings) {
      wx.showModal({
        title: '无法更新课程时间',
        content: result.reason || '当前时间无法生成有效作息',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    this.getOpenerEventChannel().emit('periodTimeEditDone', { settings: result.settings })
    wx.navigateBack()
  },
})
