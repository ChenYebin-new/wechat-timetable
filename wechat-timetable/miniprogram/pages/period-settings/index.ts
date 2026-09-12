import type { PeriodSettings } from '../../models/course'
import { MAX_PERIODS, MIN_PERIODS } from '../../constants/timetable'
import { getStorageSnapshot, savePeriodSettings } from '../../services/course-storage'
import {
  buildPeriodViews,
  clearPeriodOverrides,
  clonePeriodSettings,
  reflowPeriodSettings,
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
    const snapshot = getStorageSnapshot()
    if (snapshot.kind === 'io-error' || snapshot.kind === 'corrupt' || snapshot.kind === 'unsupported') {
      wx.showModal({ title: '无法读取课程时间', content: snapshot.reason, showCancel: false })
      return
    }
    this.updateDraft(snapshot.data.periodSettings)
    this.setData({
      maxUsedPeriod: snapshot.data.courses.reduce((highest, course) => Math.max(highest, course.endPeriod), 0),
    })
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

  showReflowError(reason?: string) {
    wx.showModal({
      title: '无法自动更新',
      content: reason || '按当前设置无法生成有效的课程时间',
      showCancel: false,
      confirmText: '知道了',
    })
  },

  applyRuleChange(changes: Partial<Pick<PeriodSettings, 'durationMinutes' | 'breakMinutes'>>) {
    const current = this.data.settings
    if (!current) return
    const result = reflowPeriodSettings({ ...clonePeriodSettings(current), ...changes })
    if (!result.ok || !result.settings) {
      this.showReflowError(result.reason)
      return
    }
    this.updateDraft(result.settings)
  },

  onDurationChange(e: WechatMiniprogram.PickerChange) {
    const durationIndex = Number(e.detail.value)
    this.applyRuleChange({ durationMinutes: durationOptions[durationIndex] })
  },

  onBreakChange(e: WechatMiniprogram.PickerChange) {
    const breakIndex = Number(e.detail.value)
    this.applyRuleChange({ breakMinutes: breakOptions[breakIndex] })
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
      this.showReflowError('增加节次后会跨越当天 24:00，请先缩短课程时长或课间休息。')
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
          settings: clonePeriodSettings(settings),
        })
        result.eventChannel.on('periodTimeEditDone', (payload: { settings: PeriodSettings }) => {
          const check = validatePeriodSettings(payload.settings)
          if (!check.ok) {
            this.showReflowError(check.reason)
            return
          }
          this.updateDraft(payload.settings)
        })
      },
    })
  },

  onClearOverrides() {
    const settings = this.data.settings
    if (!settings) return
    wx.showModal({
      title: '清除全部自定义时间？',
      content: '将保留第一节开始时间，清除午休锚点和单节自定义时长，再按当前规则连续排布全部节次。',
      confirmText: '清除并重排',
      confirmColor: '#267d78',
      success: (result) => {
        if (!result.confirm) return
        const cleared = clearPeriodOverrides(settings)
        if (!cleared.ok || !cleared.settings) {
          this.showReflowError(cleared.reason)
          return
        }
        this.updateDraft(cleared.settings)
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
    let result: ReturnType<typeof savePeriodSettings>
    try {
      result = savePeriodSettings(settings)
    } catch (error) {
      result = {
        ok: false,
        reason: error instanceof Error && error.message ? error.message : '读取课表数据失败，请稍后重试',
      }
    }
    this.setData({ saving: false })
    if (!result.ok) {
      wx.showModal({ title: '无法保存', content: result.reason || '保存失败，请稍后重试', showCancel: false })
      return
    }
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 400)
  },
})
