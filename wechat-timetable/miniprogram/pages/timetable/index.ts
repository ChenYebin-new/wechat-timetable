// pages/timetable/index.ts
import type { Course, CourseRange, TermSettings } from '../../models/course'
import { DAYS } from '../../constants/timetable'
import { getStorageSnapshot } from '../../services/course-storage'
import { calcCurrentWeek } from '../../utils/term'
import {
  buildWeekPanels,
  coursesForWeek,
  timetableGridHeightRpx,
} from '../../utils/timetable-layout'
import type { WeekPanel } from '../../utils/timetable-layout'
import { formatRanges, keysToRanges, rangesToKeys } from '../../utils/grid-selection'
import { buildPeriodViews } from '../../utils/period-settings'
import type { PeriodView } from '../../constants/timetable'
import { courseGroupCount } from '../../utils/course-groups'

interface CourseEditorInit {
  ranges: CourseRange[]
  sourceWeek: number
}

Page({
  data: {
    weekPanels: [] as WeekPanel[],
    periods: [] as PeriodView[],
    swiperHeightRpx: timetableGridHeightRpx(9),
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
    storageProblem: '',
  },

  onLoad() {
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline'],
    })
  },

  onShareAppMessage() {
    return {
      path: '/pages/timetable/index',
    }
  },

  onShareTimeline() {
    return {}
  },

  onShow() {
    this.refresh()
  },

  onHide() {
    if (this.data.selectionMode) this.updateSelection([])
  },

  /** 整页刷新（进入页面/返回时）：默认定位到当前自然周。 */
  refresh() {
    const snapshot = getStorageSnapshot()
    if (snapshot.kind === 'io-error') {
      this.setData({ storageProblem: snapshot.reason })
      return
    }
    const storage = snapshot.data
    const term = storage.term
    const periods = buildPeriodViews(storage.periodSettings)
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
      needsMigration: snapshot.kind === 'legacy',
      storageProblem: snapshot.kind === 'corrupt' || snapshot.kind === 'unsupported' ? snapshot.reason : '',
      weekStatus,
      periods,
      swiperHeightRpx: timetableGridHeightRpx(periods.length),
    })
    this.renderWeek(currentWeek, term, storage.courses)
  },

  /** 按指定周渲染课表（选周时调用，不再受当前自然周覆盖）。 */
  renderWeek(week: number, term: TermSettings | null, courses: Course[]) {
    const visible = term
      ? coursesForWeek(courses, week)
      : courses
    const systemDay = new Date().getDay()
    const today = systemDay === 0 ? 7 : systemDay
    const todayCourses = visible.filter((course) => course.day === today)
    const todayCount = courseGroupCount(todayCourses)
    const totalCount = courseGroupCount(visible)
    const todayText = todayCount > 0 ? `今天有 ${todayCount} 门课` : '今天没有课程'
    const todayWeek = calcCurrentWeek(term, new Date())
    const overviewText = term
      ? todayWeek === week
        ? `第 ${week} 周 · ${todayText} · ${DAYS[today - 1]} · 本周共 ${totalCount} 门课程`
        : `第 ${week} 周 · 本周共 ${totalCount} 门课程、${visible.length} 个时段`
      : `${todayText} · ${DAYS[today - 1]} · 共 ${courseGroupCount(courses)} 门课程`
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
    const snapshot = getStorageSnapshot()
    if (snapshot.kind === 'io-error') {
      wx.showToast({ title: '读取课表失败，请重试', icon: 'none' })
      return
    }
    this.renderWeek(w, snapshot.data.term, snapshot.data.courses)
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
    const snapshot = getStorageSnapshot()
    if (snapshot.kind === 'io-error' || snapshot.kind === 'corrupt' || snapshot.kind === 'unsupported') {
      wx.showModal({
        title: '课表暂时不可编辑',
        content: snapshot.reason,
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    if (snapshot.data.term) {
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

  onSettings() {
    if (this.data.selectionMode) return
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  onTermSettings() {
    if (this.data.selectionMode) return
    wx.navigateTo({ url: '/pages/term-settings/index' })
  },

  onRetryMigration() {
    this.refresh()
    const snapshot = getStorageSnapshot()
    if (snapshot.kind === 'legacy') {
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
