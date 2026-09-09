// pages/timetable/index.ts
import type { CourseRange, TermSettings } from '../../models/course'
import { DAYS } from '../../constants/timetable'
import { getCourses, getTerm, needsMigration } from '../../services/course-storage'
import { calcCurrentWeek } from '../../utils/term'
import {
  buildWeekPanels,
  coursesForWeek,
  TIMETABLE_GRID_HEIGHT_RPX,
} from '../../utils/timetable-layout'
import type { WeekPanel } from '../../utils/timetable-layout'
import { formatRanges, keysToRanges, rangesToKeys } from '../../utils/grid-selection'

interface CourseEditorInit {
  ranges: CourseRange[]
  sourceWeek: number
}

Page({
  data: {
    weekPanels: [] as WeekPanel[],
    swiperHeightRpx: TIMETABLE_GRID_HEIGHT_RPX,
    isEmpty: true,
    overviewText: '',
    termReady: false,
    needsMigration: false,
    currentWeek: 1,
    weekIndex: 0,
    weekOptions: [] as string[],
    weekStatus: '',
    selectionMode: false,
    selectedKeys: [] as string[],
    selectedCount: 0,
    selectedRangeCount: 0,
    selectionSummary: '',
  },

  onShow() {
    this.refresh()
  },

  onHide() {
    if (this.data.selectionMode) this.updateSelection([])
  },

  /** 整页刷新（进入页面/返回时）：默认定位到当前自然周。 */
  refresh() {
    const term = getTerm()
    const todayWeek = calcCurrentWeek(term, new Date())
    let currentWeek = todayWeek || 1
    const weekOptions: string[] = []
    if (term) {
      for (let w = 1; w <= term.totalWeeks; w++) weekOptions.push(`第 ${w} 周`)
      if (currentWeek > term.totalWeeks) currentWeek = term.totalWeeks
    }
    const weekStatus = term && todayWeek === null ? '当前不在教学周内，可手动选择周次查看' : ''
    this.setData({
      weekOptions,
      termReady: !!term,
      needsMigration: needsMigration(),
      weekStatus,
    })
    this.renderWeek(currentWeek, term)
  },

  /** 按指定周渲染课表（选周时调用，不再受当前自然周覆盖）。 */
  renderWeek(week: number, term: TermSettings | null) {
    const courses = getCourses()
    const visible = term
      ? coursesForWeek(courses, week)
      : courses
    const systemDay = new Date().getDay()
    const today = systemDay === 0 ? 7 : systemDay
    const todayCount = visible.filter((c) => c.day === today).length
    const todayText = todayCount > 0 ? `今天有 ${todayCount} 门课` : '今天没有课程'
    const overviewText = term
      ? `第 ${week} 周 · ${todayText} · ${DAYS[today - 1]} · 本周共 ${visible.length} 门`
      : `${todayText} · ${DAYS[today - 1]} · 共 ${courses.length} 门课`
    this.setData({
      currentWeek: week,
      weekIndex: week - 1,
      weekPanels: buildWeekPanels(courses, week, term?.totalWeeks),
      isEmpty: courses.length === 0,
      overviewText,
    })
  },

  changeWeek(w: number) {
    if (this.data.selectionMode) return
    const total = this.data.weekOptions.length
    if (total === 0) return
    if (w < 1) w = 1
    if (w > total) w = total
    if (w === this.data.currentWeek) return
    this.renderWeek(w, getTerm())
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

  onWeekSwipeChange(e: WechatMiniprogram.SwiperChange) {
    if (e.detail.source !== 'touch') return
    this.changeWeek(e.detail.current + 1)
  },

  openCourseEditor(url: string, init?: CourseEditorInit) {
    if (getTerm()) {
      wx.navigateTo({
        url,
        success: (result) => {
          if (init) result.eventChannel.emit('courseEditorInit', init)
        },
      })
      return
    }
    wx.showModal({
      title: '先设学期',
      content: '设置第一教学周星期一和总周数后，才能为课程保存正确的上课周次。',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) wx.navigateTo({ url: '/pages/term-settings/index' })
      },
    })
  },

  onAdd() {
    if (this.data.selectionMode) return
    this.openCourseEditor('/pages/course-edit/index')
  },

  onDataManage() {
    if (this.data.selectionMode) return
    wx.navigateTo({ url: '/pages/data-manage/index' })
  },

  onTermSettings() {
    if (this.data.selectionMode) return
    wx.navigateTo({ url: '/pages/term-settings/index' })
  },

  onRetryMigration() {
    this.refresh()
    if (needsMigration()) {
      wx.showToast({ title: '升级仍未完成，请稍后重试', icon: 'none' })
    } else {
      wx.showToast({ title: '课表数据已升级', icon: 'success' })
    }
  },

  onCourseTap(e: WechatMiniprogram.CustomEvent) {
    const id = e.detail.id as string
    wx.showActionSheet({
      itemList: ['仅编辑本时段', '编辑整门课程'],
      success: (result) => {
        const mode = result.tapIndex === 0 ? 'segment-edit' : 'group-edit'
        this.openCourseEditor(`/pages/course-edit/index?id=${id}&mode=${mode}&sourceWeek=${this.data.currentWeek}`)
      },
    })
  },

  updateSelection(keys: string[]) {
    const ranges = keysToRanges(keys)
    const normalizedKeys = rangesToKeys(ranges)
    this.setData({
      selectionMode: normalizedKeys.length > 0,
      selectedKeys: normalizedKeys,
      selectedCount: normalizedKeys.length,
      selectedRangeCount: ranges.length,
      selectionSummary: formatRanges(ranges),
    })
  },

  onCellHold(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.termReady || this.data.selectionMode) return
    const key = e.detail.key as string
    this.updateSelection([key])
    wx.vibrateShort({ type: 'light' })
  },

  onCellTap(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.selectionMode) return
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

  onCancelSelection() {
    this.updateSelection([])
  },

  onSelectionNext() {
    const ranges = keysToRanges(this.data.selectedKeys)
    if (!ranges.length) return
    const init: CourseEditorInit = { ranges, sourceWeek: this.data.currentWeek }
    this.updateSelection([])
    this.openCourseEditor('/pages/course-edit/index?mode=group-create', init)
  },
})
