// pages/timetable/index.ts
import { Course } from '../../models/course'
import { DAYS } from '../../constants/timetable'
import { getCourses } from '../../services/course-storage'
import { computeCardStyle } from '../../utils/timetable-layout'

interface CardItem {
  id: string
  course: Course
  style: string
}

Page({
  data: {
    daySlots: [] as CardItem[][],
    isEmpty: true,
  },

  onShow() {
    const courses = getCourses()
    const slots: CardItem[][] = DAYS.map(() => [])
    for (const c of courses) {
      if (c.day >= 1 && c.day <= DAYS.length) {
        slots[c.day - 1].push({ id: c.id, course: c, style: computeCardStyle(c) })
      }
    }
    this.setData({ daySlots: slots, isEmpty: courses.length === 0 })
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/course-edit/index' })
  },

  onCourseTap(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    wx.navigateTo({ url: `/pages/course-edit/index?id=${id}` })
  },
})
