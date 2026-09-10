import type { PeriodSettings, PeriodTime } from '../../models/course'
import { MAX_PERIODS, MIN_PERIODS } from '../../constants/timetable'
import { getMaxUsedPeriod, getPeriodSettings, savePeriodSettings } from '../../services/course-storage'
import {
  buildPeriodViews,
  clonePeriodSettings,
  generatePeriods,
  resizePeriods,
  validatePeriodSettings,
} from '../../utils/period-settings'

const durationOptions = Array.from({ length: 180 }, (_, index) => index + 1)
const breakOptions = Array.from({ length: 121 }, (_, index) => index)

Page({
  data: {
    settings: null as PeriodSettings | null,
    periods: [] as ReturnType<typeof buildPeriodViews>,
    durationOptions,
    breakOptions,
    durationIndex: 49,
    breakIndex: 10,
    maxUsedPeriod: 0,
    saving: false,
  },

  onLoad() {
    const settings = getPeriodSettings()
    this.updateDraft(settings)
    this.setData({ maxUsedPeriod: getMaxUsedPeriod() })
  },

  updateDraft(settings: PeriodSettings) {
    const draft = clonePeriodSettings(settings)
    this.setData({
      settings: draft,
      periods: buildPeriodViews(draft),
      durationIndex: draft.durationMinutes - 1,
      breakIndex: draft.breakMinutes,
    })
  },

  onDurationChange(e: WechatMiniprogram.PickerChange) {
    if (!this.data.settings) return
    const durationIndex = Number(e.detail.value)
    this.updateDraft({ ...this.data.settings, durationMinutes: durationOptions[durationIndex] })
  },

  onBreakChange(e: WechatMiniprogram.PickerChange) {
    if (!this.data.settings) return
    const breakIndex = Number(e.detail.value)
    this.updateDraft({ ...this.data.settings, breakMinutes: breakOptions[breakIndex] })
  },

  changeCount(delta: number) {
    const current = this.data.settings
    if (!current) return
    const count = current.periods.length + delta
    if (count < MIN_PERIODS || count > MAX_PERIODS) return
    if (count < this.data.maxUsedPeriod) {
      wx.showModal({
        title: '无法减少课程数',
        content: `已有课程使用到第 ${this.data.maxUsedPeriod} 节，请先调整相关课程时段。`,
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    const resized = resizePeriods(current, count)
    if (!resized) {
      wx.showModal({
        title: '无法增加课程数',
        content: '按当前时长和课间继续生成会跨越当天 24:00，请先调整规则或已有节次时间。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    this.updateDraft(resized)
  },

  onDecrease() {
    this.changeCount(-1)
  },

  onIncrease() {
    this.changeCount(1)
  },

  onEditPeriod(e: WechatMiniprogram.TouchEvent) {
    const settings = this.data.settings
    const index = Number(e.currentTarget.dataset.index)
    if (!settings || !Number.isInteger(index) || index < 0 || index >= settings.periods.length) return
    wx.navigateTo({
      url: '/pages/period-time-edit/index',
      success: (result) => {
        result.eventChannel.emit('periodTimeEditInit', {
          index,
          period: settings.periods[index],
          previousEnd: index > 0 ? settings.periods[index - 1].end : '',
          nextStart: index < settings.periods.length - 1 ? settings.periods[index + 1].start : '',
        })
        result.eventChannel.on('periodTimeEditDone', (payload: { index: number; period: PeriodTime }) => {
          const current = this.data.settings
          if (!current || payload.index < 0 || payload.index >= current.periods.length) return
          const next = clonePeriodSettings(current)
          next.periods[payload.index] = { ...payload.period }
          const check = validatePeriodSettings(next)
          if (!check.ok) {
            wx.showToast({ title: check.reason || '时间无效', icon: 'none' })
            return
          }
          this.updateDraft(next)
        })
      },
    })
  },

  onRegenerate() {
    const settings = this.data.settings
    if (!settings) return
    wx.showModal({
      title: '重新生成全部节次？',
      content: '将以第一节开始时间为起点，按当前课时时长和课间休息重建全部课程时间。手动调整的时间会被覆盖。',
      confirmText: '重新生成',
      confirmColor: '#267d78',
      success: (result) => {
        if (!result.confirm) return
        const periods = generatePeriods(
          settings.periods[0].start,
          settings.periods.length,
          settings.durationMinutes,
          settings.breakMinutes,
        )
        if (!periods) {
          wx.showModal({
            title: '无法重新生成',
            content: '按当前规则生成会跨越当天 24:00，请缩短时长、课间或课程数。',
            showCancel: false,
          })
          return
        }
        this.updateDraft({ ...settings, periods })
      },
    })
  },

  onSave() {
    const settings = this.data.settings
    if (!settings || this.data.saving) return
    const check = validatePeriodSettings(settings)
    if (!check.ok) {
      wx.showModal({ title: '无法保存', content: check.reason || '课程时间设置无效', showCancel: false })
      return
    }
    this.setData({ saving: true })
    const result = savePeriodSettings(settings)
    this.setData({ saving: false })
    if (!result.ok) {
      wx.showModal({ title: '无法保存', content: result.reason || '保存失败，请稍后重试', showCancel: false })
      return
    }
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 400)
  },
})
