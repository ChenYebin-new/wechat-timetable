import type { Course, CourseRange } from '../../models/course'
import { DAYS } from '../../constants/timetable'
import { getCourses } from '../../services/course-storage'
import { weeksOverlap } from '../../utils/course-validator'
import { getContrastText } from '../../utils/color'
import { computeCardStyle } from '../../utils/timetable-layout'
import { formatRanges, keysToRanges, rangesToKeys } from '../../utils/grid-selection'

interface CardItem {
  id: string
  course: Course
  style: string
  textColor: string
}

interface SlotSelectorInit {
  ranges: CourseRange[]
  excludedIds: string[]
  activeWeeks: number[]
}

Page({
  data: {
    ready: false,
    daySlots: [] as CardItem[][],
    selectedKeys: [] as string[],
    disabledKeys: [] as string[],
    selectedCount: 0,
    rangeCount: 0,
    summary: '',
  },

  onLoad() {
    this.getOpenerEventChannel().on('slotSelectorInit', (init: SlotSelectorInit) => {
      const excluded = new Set(Array.isArray(init.excludedIds) ? init.excludedIds : [])
      const activeWeeks = Array.isArray(init.activeWeeks) ? init.activeWeeks : []
      const occupied = getCourses().filter(
        (course) => !excluded.has(course.id) && weeksOverlap(course.weeks, activeWeeks),
      )
      this.setData({
        ready: true,
        daySlots: this.buildSlots(occupied),
        disabledKeys: rangesToKeys(occupied.map((course) => ({
          day: course.day,
          startPeriod: course.startPeriod,
          endPeriod: course.endPeriod,
        }))),
      })
      this.updateSelection(rangesToKeys(Array.isArray(init.ranges) ? init.ranges : []))
    })
  },

  buildSlots(courses: Course[]): CardItem[][] {
    const slots: CardItem[][] = DAYS.map(() => [])
    for (const course of courses) {
      if (course.day < 1 || course.day > DAYS.length) continue
      slots[course.day - 1].push({
        id: course.id,
        course,
        style: computeCardStyle(course),
        textColor: getContrastText(course.color),
      })
    }
    return slots
  },

  updateSelection(keys: string[]) {
    const ranges = keysToRanges(keys)
    const selectedKeys = rangesToKeys(ranges)
    this.setData({
      selectedKeys,
      selectedCount: selectedKeys.length,
      rangeCount: ranges.length,
      summary: formatRanges(ranges),
    })
  },

  onCellTap(e: WechatMiniprogram.CustomEvent) {
    const key = e.detail.key as string
    const selected = [...this.data.selectedKeys]
    const index = selected.indexOf(key)
    if (index >= 0) selected.splice(index, 1)
    else selected.push(key)
    this.updateSelection(selected)
  },

  onOccupiedTap() {
    wx.showToast({ title: '该时段已有课程', icon: 'none' })
  },

  onCancel() {
    wx.navigateBack()
  },

  onDone() {
    const ranges = keysToRanges(this.data.selectedKeys)
    if (!ranges.length) {
      wx.showToast({ title: '请至少选择一个时段', icon: 'none' })
      return
    }
    this.getOpenerEventChannel().emit('slotSelectorDone', { ranges })
    wx.navigateBack()
  },
})
