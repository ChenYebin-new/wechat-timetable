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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

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
    console.log('[term-settings] onLoad 执行')
    try {
      const term = getTerm()
      const courses = getCourses()
      this.setData({
        startDate: term ? term.startDate : defaultMonday(),
        totalWeeks: term ? term.totalWeeks : DEFAULT_TOTAL_WEEKS,
        isMigration: needsMigration(),
        isEdit: !!term,
        affectedCount: courses.length,
      })
    } catch (error) {
      this.setData({
        startDate: defaultMonday(),
        totalWeeks: DEFAULT_TOTAL_WEEKS,
        isMigration: false,
        affectedCount: 0,
      })
      wx.showModal({
        title: '读取数据失败',
        content: errorMessage(error, '读取课表数据失败，请稍后重试'),
        showCancel: false,
        confirmText: '知道了',
      })
    }
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
    console.log('[term-settings] onSave 被触发')
    const term: TermSettings = {
      startDate: this.data.startDate,
      totalWeeks: this.data.totalWeeks,
    }
    const count = this.data.affectedCount
    const isMigration = this.data.isMigration
    console.log('[term-settings] 准备调用 wx.showModal')
    wx.showModal({
      title: isMigration ? '设置并迁移' : '保存学期设置',
      content: isMigration
        ? `将把当前 ${count} 门旧课程按"全部周"迁移到新学期（第一教学周星期一：${term.startDate}，共 ${term.totalWeeks} 周）。迁移前会自动备份当前课表。`
        : `保存后 ${count} 门课程的周次将按新总周数（${term.totalWeeks} 周）重新计算，指定周次课程只保留仍在新范围内的周次。保存前会自动备份当前课表。`,
      confirmText: isMigration ? '设置并迁移' : '保存',
      success: (res) => {
        console.log('[term-settings] showModal success, confirm=', res.confirm)
        if (!res.confirm) return
        let result
        try {
          result = applyTerm(term)
        } catch (error) {
          wx.showModal({
            title: '迁移失败',
            content: errorMessage(error, '迁移过程发生错误，原数据未改动'),
            showCancel: false,
            confirmText: '知道了',
          })
          return
        }
        if (result.ok) {
          console.log('[term-settings] applyTerm 成功')
          wx.showToast({ title: isMigration ? '迁移成功' : '已保存', icon: 'success' })
          wx.navigateBack()
        } else {
          console.log('[term-settings] applyTerm 失败:', result.reason)
          wx.showModal({
            title: '无法保存',
            content: result.reason || '保存失败',
            showCancel: false,
            confirmText: '知道了',
          })
        }
      },
      fail: (err) => {
        console.log('[term-settings] showModal fail', err)
      },
    })
  },
})
