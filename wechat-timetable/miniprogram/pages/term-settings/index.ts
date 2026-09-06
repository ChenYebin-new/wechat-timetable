// pages/term-settings/index.ts
import type { TermSettings } from '../../models/course'
import {
  COMMON_TOTAL_WEEKS,
  DEFAULT_TOTAL_WEEKS,
  MAX_TOTAL_WEEKS,
} from '../../constants/timetable'
import { applyTerm, getCourses, getTerm, needsMigration } from '../../services/course-storage'
import { formatLocalDate } from '../../utils/term'

function defaultMonday(): string {
  const now = new Date()
  const day = now.getDay() === 0 ? 7 : now.getDay()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1))
  return formatLocalDate(monday)
}

const weekOptions: string[] = []
for (let w = 1; w <= MAX_TOTAL_WEEKS; w++) weekOptions.push(`${w} 周`)

Page({
  data: {
    startDate: '',
    totalWeeks: DEFAULT_TOTAL_WEEKS,
    commonWeeks: COMMON_TOTAL_WEEKS,
    weekOptions,
    isMigration: false,
    isEdit: false,
    affectedCount: 0,
  },

  onLoad() {
    const term = getTerm()
    const courses = getCourses()
    this.setData({
      startDate: term ? term.startDate : defaultMonday(),
      totalWeeks: term ? term.totalWeeks : DEFAULT_TOTAL_WEEKS,
      isMigration: needsMigration(),
      isEdit: !!term,
      affectedCount: courses.length,
    })
  },

  onDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ startDate: e.detail.value as string })
  },

  onWeeksChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ totalWeeks: Number(e.detail.value) + 1 })
  },

  onCommonWeek(e: WechatMiniprogram.TouchEvent) {
    this.setData({ totalWeeks: Number(e.currentTarget.dataset.week) })
  },

  onSave() {
    const term: TermSettings = {
      startDate: this.data.startDate,
      totalWeeks: this.data.totalWeeks,
    }
    const count = this.data.affectedCount
    const isMigration = this.data.isMigration
    wx.showModal({
      title: isMigration ? '设置并迁移' : '保存学期设置',
      content: isMigration
        ? `将把当前 ${count} 门旧课程按"全部周"迁移到新学期（第一教学周星期一：${term.startDate}，共 ${term.totalWeeks} 周）。迁移前会自动备份当前课表。`
        : `保存后 ${count} 门课程的周次将按新总周数（${term.totalWeeks} 周）重新计算，指定周次课程只保留仍在新范围内的周次。保存前会自动备份当前课表。`,
      confirmText: isMigration ? '设置并迁移' : '保存',
      success: (res) => {
        if (!res.confirm) return
        const result = applyTerm(term)
        if (result.ok) {
          wx.showToast({ title: isMigration ? '迁移成功' : '已保存', icon: 'success' })
          wx.navigateBack()
        } else {
          wx.showModal({
            title: '无法保存',
            content: result.reason || '保存失败',
            showCancel: false,
            confirmText: '知道了',
          })
        }
      },
    })
  },
})
