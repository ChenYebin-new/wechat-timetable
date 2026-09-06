// pages/timetable/index.ts
import { Course } from '../../models/course'
import { DAYS } from '../../constants/timetable'
import { getCourses } from '../../services/course-storage'
import { computeCardStyle } from '../../utils/timetable-layout'
import { getContrastText } from '../../utils/color'

interface CardItem {
  id: string
  course: Course
  style: string
  textColor: string
}

Page({
  data: {
    daySlots: [] as CardItem[][],
    isEmpty: true,
    todayName: '',
    todayCount: 0,
    courseCount: 0,
    overviewText: '',
  },

  onShow() {
    const courses = getCourses()
    const slots: CardItem[][] = DAYS.map(() => [])
    for (const c of courses) {
      if (c.day >= 1 && c.day <= DAYS.length) {
        slots[c.day - 1].push({
          id: c.id,
          course: c,
          style: computeCardStyle(c),
          textColor: getContrastText(c.color),
        })
      }
    }

    const systemDay = new Date().getDay()
    const today = systemDay === 0 ? 7 : systemDay
    const todayCount = courses.filter((course) => course.day === today).length
    const todayText = todayCount > 0 ? `今天有 ${todayCount} 门课` : '今天没有课程'

    this.setData({
      daySlots: slots,
      isEmpty: courses.length === 0,
      todayName: DAYS[today - 1],
      todayCount,
      courseCount: courses.length,
      overviewText: `${todayText} · ${DAYS[today - 1]} · 本周共 ${courses.length} 门`,
    })
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/course-edit/index' })
  },

  onDataManage() {
    wx.navigateTo({ url: '/pages/data-manage/index' })
  },

  onCourseTap(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    wx.navigateTo({ url: `/pages/course-edit/index?id=${id}` })
  },
})
