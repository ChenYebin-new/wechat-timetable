// pages/timetable/index.ts
import { Course } from '../../models/course'
import { getCourses } from '../../services/course-storage'
import { computeCardStyle } from '../../utils/timetable-layout'

interface CardItem {
  id: string
  course: Course
  style: string
}

Page({
  data: {
    courses: [] as Course[],
    cards: [] as CardItem[],
    isEmpty: true,
  },

  onShow() {
    const courses = getCourses()
    this.setData({
      courses,
      isEmpty: courses.length === 0,
      cards: courses.map((c) => ({ id: c.id, course: c, style: computeCardStyle(c) })),
    })
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/course-edit/index' })
  },

  onCourseTap(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    wx.navigateTo({ url: `/pages/course-edit/index?id=${id}` })
  },
})
