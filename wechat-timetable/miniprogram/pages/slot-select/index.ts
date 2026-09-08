import type { CourseRange } from '../../models/course'
import { getCourses } from '../../services/course-storage'
import { weeksOverlap } from '../../utils/course-validator'
import { buildDaySlots } from '../../utils/timetable-layout'
import type { TimetableCardItem } from '../../utils/timetable-layout'
import { formatRanges, keysToRanges, rangesToKeys } from '../../utils/grid-selection'

interface SlotSelectorInit {
  ranges: CourseRange[]
  excludedIds: string[]
  activeWeeks: number[]
}

Page({
  data: {
    ready: false,
    daySlots: [] as TimetableCardItem[][],
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
        daySlots: buildDaySlots(occupied),
        disabledKeys: rangesToKeys(occupied.map((course) => ({
          day: course.day,
          startPeriod: course.startPeriod,
          endPeriod: course.endPeriod,
        }))),
      })
      this.updateSelection(rangesToKeys(Array.isArray(init.ranges) ? init.ranges : []))
    })
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
