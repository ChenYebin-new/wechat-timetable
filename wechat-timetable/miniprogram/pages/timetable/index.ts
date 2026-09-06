// pages/timetable/index.ts
import type { Course } from '../../models/course'
import { DAYS } from '../../constants/timetable'
import { getCourses, getTerm, needsMigration } from '../../services/course-storage'
import { calcCurrentWeek } from '../../utils/term'
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
    overviewText: '',
    termReady: false,
    needsMigration: false,
    currentWeek: 1,
    weekIndex: 0,
    weekOptions: [] as string[],
    weekStatus: '',
  },

  onShow() {
    this.refresh()
  },

  buildSlots(courses: Course[]): CardItem[][] {
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
    return slots
  },

  refresh() {
    const term = getTerm()
    const migrating = needsMigration()
    const courses = getCourses()
    const now = new Date()
    const todayWeek = calcCurrentWeek(term, now)

    let currentWeek = todayWeek || 1
    const weekOptions: string[] = []
    if (term) {
      for (let w = 1; w <= term.totalWeeks; w++) weekOptions.push(`第 ${w} 周`)
      if (currentWeek > term.totalWeeks) currentWeek = term.totalWeeks
    }

    const visible = term
      ? courses.filter((c) => c.weeks.length === 0 || c.weeks.includes(currentWeek))
      : courses

    const systemDay = new Date().getDay()
    const today = systemDay === 0 ? 7 : systemDay
    const todayCount = visible.filter((c) => c.day === today).length
    const todayText = todayCount > 0 ? `今天有 ${todayCount} 门课` : '今天没有课程'
    const weekStatus =
      term && todayWeek === null ? '当前不在教学周内，可手动选择周次查看' : ''
    const overviewText = term
      ? `第 ${currentWeek} 周 · ${todayText} · ${DAYS[today - 1]} · 本周共 ${visible.length} 门`
      : `${todayText} · ${DAYS[today - 1]} · 共 ${courses.length} 门课`

    this.setData({
      daySlots: this.buildSlots(visible),
      isEmpty: courses.length === 0,
      overviewText,
      termReady: !!term,
      needsMigration: migrating,
      currentWeek,
      weekIndex: currentWeek - 1,
      weekOptions,
      weekStatus,
    })
  },

  changeWeek(w: number) {
    const total = this.data.weekOptions.length
    if (total === 0) return
    if (w < 1) w = 1
    if (w > total) w = total
    if (w === this.data.currentWeek) return
    this.setData({ currentWeek: w, weekIndex: w - 1 }, () => {
      this.refresh()
    })
  },

  onPrevWeek() {
    this.changeWeek(this.data.currentWeek - 1)
  },

  onNextWeek() {
    this.changeWeek(this.data.currentWeek + 1)
  },

  onWeekChange(e: WechatMiniprogram.PickerChange) {
    this.changeWeek(Number(e.detail.value) + 1)
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/course-edit/index' })
  },

  onDataManage() {
    wx.navigateTo({ url: '/pages/data-manage/index' })
  },

  onTermSettings() {
    wx.navigateTo({ url: '/pages/term-settings/index' })
  },

  onCourseTap(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    wx.navigateTo({ url: `/pages/course-edit/index?id=${id}` })
  },
})
