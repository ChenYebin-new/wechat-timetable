// pages/course-edit/index.ts
import type { Course, CourseDraft, CourseRange, WeekMode } from '../../models/course'
import { COLOR_PALETTE, DAYS, WEEK_MODES } from '../../constants/timetable'
import {
  createCourseGroup,
  detachCourseSegment,
  getStorageSnapshot,
  remove,
  removeCourseGroup,
  save,
  updateCourseGroup,
} from '../../services/course-storage'
import { expandWeeks, rangeWeeks } from '../../utils/term'
import { cellsToRanges, formatRanges, rangesToCells } from '../../utils/grid-selection'
import { buildPeriodViews } from '../../utils/period-settings'

const dayOptions = DAYS
const weekModeLabels = WEEK_MODES.map((m) => m.label)

type EditMode = 'single-create' | 'segment-edit' | 'group-create' | 'group-edit'

interface WeekChip {
  value: number
  selected: boolean
}

interface CourseEditorInit {
  ranges: CourseRange[]
  sourceWeek: number
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

Page({
  data: {
    id: '',
    groupId: '',
    groupSize: 0,
    groupCourseIds: [] as string[],
    editMode: 'single-create' as EditMode,
    isEdit: false,
    isGroupMode: false,
    saving: false,
    sourceWeek: 1,
    ranges: [] as CourseRange[],
    rangeItems: [] as string[],
    rangeSummary: '',
    dayOptions,
    periodOptions: [] as string[],
    colors: COLOR_PALETTE,
    weekModeLabels,
    name: '',
    dayIndex: 0,
    startIndex: 0,
    endIndex: 0,
    teacher: '',
    location: '',
    color: COLOR_PALETTE[0],
    totalWeeks: 0,
    weekMode: 'all' as WeekMode,
    weekModeIndex: 0,
    customWeeks: [] as number[],
    weekChips: [] as WeekChip[],
  },

  onLoad(options: Record<string, string | undefined>) {
    const snapshot = getStorageSnapshot()
    if (snapshot.kind === 'io-error' || snapshot.kind === 'corrupt' || snapshot.kind === 'unsupported') {
      wx.showModal({ title: '课表暂时不可编辑', content: snapshot.reason, showCancel: false })
      return
    }
    const term = snapshot.data.term
    const periodOptions = buildPeriodViews(snapshot.data.periodSettings).map((period) => `${period.label} ${period.time}`)
    const totalWeeks = term ? term.totalWeeks : 0
    const id = options && options.id ? options.id : ''
    const requestedMode = options && options.mode ? options.mode : ''
    const editMode: EditMode =
      requestedMode === 'group-create' || requestedMode === 'group-edit' || requestedMode === 'segment-edit'
        ? requestedMode
        : id
          ? 'segment-edit'
          : 'single-create'
    const sourceWeek = Math.max(1, Number(options.sourceWeek) || 1)
    this.setData({
      totalWeeks,
      periodOptions,
      sourceWeek,
      editMode,
      isEdit: !!id,
      isGroupMode: editMode === 'group-create' || editMode === 'group-edit',
      weekChips: this.buildWeekChips([], totalWeeks),
    })

    if (editMode === 'group-create') {
      wx.setNavigationBarTitle({ title: '新增课程' })
      this.getOpenerEventChannel().on('courseEditorInit', (init: CourseEditorInit) => {
        this.setRanges(init.ranges)
        this.setData({ sourceWeek: init.sourceWeek })
      })
      return
    }

    if (!id) {
      wx.setNavigationBarTitle({ title: '新增课程' })
      return
    }
    const course = snapshot.data.courses.find((item) => item.id === id)
    if (!course) {
      wx.showModal({ title: '课程不存在', content: '这门课程可能已经被删除。', showCancel: false })
      return
    }
    const group = snapshot.data.courses.filter((item) => item.groupId === course.groupId)
    this.setData({ groupCourseIds: group.map((item) => item.id) })
    this.applyCourse(course, group.length)
    if (editMode === 'group-edit') {
      this.setRanges(group.map((item) => ({
        day: item.day,
        startPeriod: item.startPeriod,
        endPeriod: item.endPeriod,
      })))
    }
  },

  applyCourse(course: Course, groupSize: number) {
    const weekMode = course.weekMode as WeekMode
    const customWeeks = weekMode === 'custom' ? [...course.weeks] : []
    this.setData({
      id: course.id,
      groupId: course.groupId,
      groupSize,
      name: course.name,
      dayIndex: course.day - 1,
      startIndex: course.startPeriod - 1,
      endIndex: course.endPeriod - 1,
      teacher: course.teacher || '',
      location: course.location || '',
      color: course.color,
      weekMode,
      weekModeIndex: Math.max(0, WEEK_MODES.findIndex((m) => m.value === weekMode)),
      customWeeks,
      weekChips: this.buildWeekChips(customWeeks, this.data.totalWeeks),
    })
  },

  setRanges(ranges: CourseRange[]) {
    const normalized = cellsToRanges(rangesToCells(ranges))
    this.setData({
      ranges: normalized,
      rangeItems: normalized.map((range) => formatRanges([range])),
      rangeSummary: formatRanges(normalized),
    })
  },

  buildWeekChips(selected: number[], totalWeeks: number): WeekChip[] {
    return rangeWeeks(totalWeeks).map((w) => ({ value: w, selected: selected.indexOf(w) >= 0 }))
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

  onWeekMode(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value)
    this.setData({ weekMode: WEEK_MODES[index].value as WeekMode, weekModeIndex: index })
  },

  onToggleWeek(e: WechatMiniprogram.TouchEvent) {
    const w = Number(e.currentTarget.dataset.week)
    const current = [...this.data.customWeeks]
    const idx = current.indexOf(w)
    if (idx >= 0) current.splice(idx, 1)
    else current.push(w)
    current.sort((a, b) => a - b)
    this.setData({ customWeeks: current, weekChips: this.buildWeekChips(current, this.data.totalWeeks) })
  },

  currentDraftWeeks(): number[] {
    const mode = this.data.weekMode as WeekMode
    if (mode === 'custom') {
      return this.data.customWeeks.length ? [...this.data.customWeeks] : [this.data.sourceWeek]
    }
    return expandWeeks(mode, this.data.totalWeeks)
  },

  onReselect() {
    const excludedIds = [...this.data.groupCourseIds]
    wx.navigateTo({
      url: '/pages/slot-select/index',
      success: (result) => {
        result.eventChannel.emit('slotSelectorInit', {
          ranges: this.data.ranges,
          excludedIds,
          activeWeeks: this.currentDraftWeeks(),
        })
        result.eventChannel.on('slotSelectorDone', (payload: { ranges: CourseRange[] }) => {
          this.setRanges(payload.ranges)
        })
      },
    })
  },

  buildCourse(range?: CourseRange): CourseDraft {
    const weekMode = this.data.weekMode as WeekMode
    return {
      ...(this.data.id ? { id: this.data.id } : {}),
      ...(this.data.groupId ? { groupId: this.data.groupId } : {}),
      name: this.data.name.trim(),
      day: range ? range.day : this.data.dayIndex + 1,
      startPeriod: range ? range.startPeriod : this.data.startIndex + 1,
      endPeriod: range ? range.endPeriod : this.data.endIndex + 1,
      teacher: this.data.teacher.trim() || undefined,
      location: this.data.location.trim() || undefined,
      color: this.data.color,
      weekMode,
      weeks: weekMode === 'custom' ? [...this.data.customWeeks] : [],
    }
  },

  showSaveError(error: unknown) {
    wx.showModal({
      title: '无法保存',
      content: mutationErrorMessage(error, '课表数据写入失败，请稍后重试'),
      showCancel: false,
      confirmText: '知道了',
    })
  },

  onSave() {
    if (this.data.saving) return
    const firstRange = this.data.ranges[0]
    if (this.data.isGroupMode && !firstRange) {
      this.showSaveError(new Error('请至少选择一个上课时段'))
      return
    }
    const course = this.buildCourse(firstRange)
    this.setData({ saving: true })
    try {
      if (this.data.editMode === 'group-create') createCourseGroup(course, this.data.ranges)
      else if (this.data.editMode === 'group-edit') updateCourseGroup(this.data.groupId, course, this.data.ranges)
      else if (this.data.editMode === 'segment-edit' && this.data.groupSize > 1) detachCourseSegment(course)
      else save(course)
    } catch (error) {
      this.setData({ saving: false })
      this.showSaveError(error)
      return
    }
    wx.showToast({ title: '已保存', icon: 'success' })
    wx.navigateBack()
  },

  confirmDelete(scope: 'segment' | 'group') {
    const wholeGroup = scope === 'group'
    wx.showModal({
      title: wholeGroup ? '删除整门课程' : '删除本时段',
      content: wholeGroup ? `确定删除这门课程的全部 ${this.data.groupSize} 个时段吗？` : '确定删除当前这个上课时段吗？',
      confirmColor: '#e64340',
      success: (result) => {
        if (!result.confirm) return
        try {
          if (wholeGroup) removeCourseGroup(this.data.groupId)
          else remove(this.data.id)
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
      },
    })
  },

  onDelete() {
    if (!this.data.id) return
    if (this.data.groupSize <= 1) {
      this.confirmDelete('segment')
      return
    }
    wx.showActionSheet({
      itemList: ['仅删除本时段', '删除整门课程'],
      success: (result) => this.confirmDelete(result.tapIndex === 0 ? 'segment' : 'group'),
    })
  },
})
