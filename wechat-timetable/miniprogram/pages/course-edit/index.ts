// pages/course-edit/index.ts
import type { Course } from '../../models/course'
import { COLOR_PALETTE, DAYS, PERIODS } from '../../constants/timetable'
import { getCourses, getCourseById, remove, save } from '../../services/course-storage'
import { validate } from '../../utils/course-validator'

const dayOptions = DAYS
const periodOptions = PERIODS.map((p) => `${p.label} ${p.time}`)

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

Page({
  data: {
    id: '',
    isEdit: false,
    dayOptions,
    periodOptions,
    colors: COLOR_PALETTE,
    name: '',
    dayIndex: 0,
    startIndex: 0,
    endIndex: 0,
    teacher: '',
    location: '',
    color: COLOR_PALETTE[0],
  },

  onLoad(options: Record<string, string | undefined>) {
    const id = options && options.id ? options.id : ''
    if (!id) return
    const course = getCourseById(id)
    if (!course) return
    this.setData({
      id,
      isEdit: true,
      name: course.name,
      dayIndex: course.day - 1,
      startIndex: course.startPeriod - 1,
      endIndex: course.endPeriod - 1,
      teacher: course.teacher || '',
      location: course.location || '',
      color: course.color,
    })
  },

  onName(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value })
  },

  onDay(e: WechatMiniprogram.PickerChange) {
    this.setData({ dayIndex: Number(e.detail.value) })
  },

  onStart(e: WechatMiniprogram.PickerChange) {
    this.setData({ startIndex: Number(e.detail.value) })
  },

  onEnd(e: WechatMiniprogram.PickerChange) {
    this.setData({ endIndex: Number(e.detail.value) })
  },

  onTeacher(e: WechatMiniprogram.Input) {
    this.setData({ teacher: e.detail.value })
  },

  onLocation(e: WechatMiniprogram.Input) {
    this.setData({ location: e.detail.value })
  },

  onColor(e: WechatMiniprogram.TouchEvent) {
    this.setData({ color: e.currentTarget.dataset.color as string })
  },

  buildCourse(): Course {
    return {
      id: this.data.id,
      name: this.data.name.trim(),
      day: this.data.dayIndex + 1,
      startPeriod: this.data.startIndex + 1,
      endPeriod: this.data.endIndex + 1,
      teacher: this.data.teacher.trim() || undefined,
      location: this.data.location.trim() || undefined,
      color: this.data.color,
      createdAt: 0,
      updatedAt: 0,
    }
  },

  onSave() {
    const course = this.buildCourse()
    const result = validate(course, getCourses(), this.data.id || undefined)
    if (!result.ok) {
      wx.showModal({
        title: '无法保存',
        content: result.errors[0],
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    try {
      save(course)
    } catch (error) {
      wx.showModal({
        title: '无法保存',
        content: mutationErrorMessage(error, '课表数据写入失败，请稍后重试'),
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    wx.showToast({ title: '已保存', icon: 'success' })
    wx.navigateBack()
  },

  onDelete() {
    if (!this.data.id) return
    wx.showModal({
      title: '删除课程',
      content: '确定要删除这门课程吗？',
      confirmColor: '#e64340',
      success: (res) => {
        if (res.confirm) {
          try {
            remove(this.data.id)
          } catch (error) {
            wx.showModal({
              title: '无法删除',
              content: mutationErrorMessage(error, '课表数据写入失败，请稍后重试'),
              showCancel: false,
              confirmText: '知道了',
            })
            return
          }
          wx.showToast({ title: '已删除', icon: 'success' })
          wx.navigateBack()
        }
      },
    })
  },
})
