import { appearanceData, syncAppearance } from '../../utils/appearance-page'
import type { TodoItem } from '../../models/todo'
import { getTodoById, getTodoSnapshot, migrateTodosToV3, removeTodo, saveDailyNote, saveTodo, toggleTodo } from '../../services/todo-storage'
import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'
import { formatLocalDate, parseLocalDate } from '../../utils/local-date'
import { buildTodoCalendar, offsetTodoCalendarMonth } from '../../utils/todo-calendar'
import type { TodoCalendarDay } from '../../utils/todo-calendar'
import { unsavedDailyNotes, setGoalDraft, todoRevision, takeRequestedDraftDate } from '../../services/todo-session'

interface TodoView extends TodoItem {
  expired: boolean
}

interface PageState {
  revision: number
  discardingNote: boolean
  visible: boolean
  followingToday: boolean
  noteFocused: boolean
  noteDate: string
  savedNote: string
  originalGoal: { title: string; note: string } | null
  noteTimer: ReturnType<typeof setTimeout> | null
  midnightTimer: ReturnType<typeof setTimeout> | null
  goalDates: Set<string>
}

const pageStates = new WeakMap<object, PageState>()
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function stateFor(page: object): PageState {
  let state = pageStates.get(page)
  if (!state) {
    state = { revision: todoRevision(), discardingNote: false, visible: false, followingToday: true, noteFocused: false, noteDate: '', savedNote: '', originalGoal: null, noteTimer: null, midnightTimer: null, goalDates: new Set() }
    pageStates.set(page, state)
  }
  return state
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function offsetDate(date: string, days: number): string {
  const parsed = parseLocalDate(date)
  if (!parsed) return formatLocalDate(new Date())
  return formatLocalDate(new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + days))
}

Page({
  data: {
    ...appearanceData(),
    selectedDate: '',
    dateLabel: '',
    shortDateLabel: '',
    weekdayLabel: '',
    isToday: true,
    calendarExpanded: false,
    calendarMonth: '',
    calendarMonthLabel: '',
    calendarDays: [] as TodoCalendarDay[],
    calendarWeekdays: ['日', '一', '二', '三', '四', '五', '六'],
    sectionTitle: '今日目标',
    visibleItems: [] as TodoView[],
    completedCount: 0,
    totalCount: 0,
    storageProblem: '',
    editorOpen: false,
    editorId: '',
    editorDate: '',
    title: '',
    note: '',
    noteExpanded: false,
    savingGoal: false,
    goalProblem: '',
    dailyNote: '',
    dailyNoteDirty: false,
    noteSaveState: 'saved' as 'saved' | 'saving' | 'dirty' | 'error',
    noteStatusLabel: '自动保存',
    noteSaveProblem: '',
    showShareHomePreview: false,
  },

  onPageScroll(event: WechatMiniprogram.Page.IPageScrollOption) {
    this.selectComponent('.page-masthead')?.updateScroll(event.scrollTop)
  },

  onReady() { syncAppearance(this) },

  onLoad(options: Record<string, string | undefined>) {
    if (initializeHomeSharing(this, '/pages/todo/index', options)) return
    syncAppearance(this)
  },

  onShareAppMessage: shareHomeToFriend,
  onShareTimeline: shareHomeToTimeline,

  onShow() {
    syncAppearance(this)
    if (this.data.showShareHomePreview) return
    const state = stateFor(this)
    if (state.revision !== todoRevision()) {
      this.stopTimers()
      this.closeEditor()
      state.revision = todoRevision()
      state.discardingNote = false
      this.setData({ dailyNoteDirty: false, dailyNote: '', noteSaveProblem: '', noteSaveState: 'saved' })
    }
    const requestedDate = takeRequestedDraftDate()
    if (requestedDate) {
      state.followingToday = false
      this.setData({ selectedDate: requestedDate, calendarMonth: requestedDate.slice(0, 7) })
    }
    state.visible = true
    this.checkDayRollover()
    this.scheduleMidnightRefresh()
  },

  onHide() {
    if (this.data.showShareHomePreview) return
    stateFor(this).visible = false
    stateFor(this).noteFocused = false
    this.flushDailyNote()
    this.stopTimers()
  },

  onUnload() { this.onHide(); setGoalDraft(this, null) },

  checkDayRollover() {
    if (this.data.showShareHomePreview) return
    const state = stateFor(this)
    const today = formatLocalDate(new Date())
    if (!this.data.selectedDate) this.setData({ selectedDate: today, calendarMonth: today.slice(0, 7) })
    else if (state.followingToday && this.data.selectedDate !== today && !this.data.editorOpen && !state.noteFocused && !this.data.dailyNoteDirty) {
      this.setData({ selectedDate: today, calendarMonth: today.slice(0, 7) })
    }
    this.refresh()
  },

  refresh() {
    if (this.data.showShareHomePreview) return
    const today = formatLocalDate(new Date())
    const selectedDate = this.data.selectedDate || today
    const date = parseLocalDate(selectedDate)
    if (!date) return
    this.setData({
      selectedDate,
      dateLabel: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
      shortDateLabel: `${date.getMonth() + 1}月${date.getDate()}日`,
      weekdayLabel: WEEKDAYS[date.getDay()],
      isToday: selectedDate === today,
      sectionTitle: selectedDate === today ? '今日目标' : '当日目标',
      ...(!this.data.calendarMonth ? { calendarMonth: selectedDate.slice(0, 7) } : {}),
    })

    let snapshot = getTodoSnapshot()
    if (snapshot.kind === 'legacy') {
      try {
        migrateTodosToV3(today)
        snapshot = getTodoSnapshot()
      } catch (error) {
        this.showStorageProblem(errorMessage(error, '待办升级失败，原数据未被替换，请重试'))
        return
      }
    }
    if (!('data' in snapshot)) {
      this.showStorageProblem(snapshot.reason)
      return
    }

    const visibleItems = snapshot.data.items
      .filter((item) => item.taskDate === selectedDate)
      .sort((left, right) => Number(left.completed) - Number(right.completed) || left.createdAt - right.createdAt)
      .map((item) => ({ ...item, expired: !item.completed && item.taskDate < today }))
    const storedNote = snapshot.data.dailyNotes.find((entry) => entry.date === selectedDate)?.content || ''
    const state = stateFor(this)
    state.goalDates = new Set(snapshot.data.items.map((item) => item.taskDate))
    const draft = unsavedDailyNotes.get(selectedDate)
    const dirty = draft !== undefined && draft !== storedNote
    if (!dirty) unsavedDailyNotes.delete(selectedDate)
    const preserveError = dirty && state.noteDate === selectedDate && this.data.noteSaveState === 'error'
    state.noteDate = selectedDate
    state.savedNote = storedNote
    this.setData({
      visibleItems,
      completedCount: visibleItems.filter((item) => item.completed).length,
      totalCount: visibleItems.length,
      storageProblem: '',
      dailyNote: dirty ? draft : storedNote,
      dailyNoteDirty: dirty,
      noteSaveState: preserveError ? 'error' : dirty ? 'dirty' : 'saved',
      noteStatusLabel: preserveError ? '未保存，可重试' : dirty ? '未保存' : storedNote ? '已保存' : '自动保存',
      noteSaveProblem: preserveError ? this.data.noteSaveProblem : '',
    })
    this.refreshCalendar()
  },

  showStorageProblem(reason: string) {
    stateFor(this).goalDates.clear()
    this.setData({
      visibleItems: [],
      completedCount: 0,
      totalCount: 0,
      storageProblem: reason,
      ...(!this.data.dailyNoteDirty ? { dailyNote: '' } : {}),
      noteSaveState: 'error',
      noteStatusLabel: '暂时无法保存',
      noteSaveProblem: reason,
    })
    this.refreshCalendar()
  },

  refreshCalendar() {
    if (this.data.showShareHomePreview || !this.data.calendarExpanded) return
    const calendar = buildTodoCalendar(this.data.calendarMonth, this.data.selectedDate, formatLocalDate(new Date()), stateFor(this).goalDates)
    this.setData({ calendarMonthLabel: calendar.label, calendarDays: calendar.days })
  },

  onToggleCalendar() {
    if (this.data.showShareHomePreview) return
    const calendarExpanded = !this.data.calendarExpanded
    this.setData({ calendarExpanded, ...(calendarExpanded ? { calendarMonth: this.data.selectedDate.slice(0, 7) } : { calendarDays: [] }) })
    this.refreshCalendar()
  },

  onPreviousMonth() { this.browseCalendarMonth(-1) },
  onNextMonth() { this.browseCalendarMonth(1) },

  browseCalendarMonth(offset: number) {
    if (this.data.showShareHomePreview || !this.data.calendarExpanded) return
    this.setData({ calendarMonth: offsetTodoCalendarMonth(this.data.calendarMonth, offset) })
    this.refreshCalendar()
  },

  onCalendarDate(e: WechatMiniprogram.TouchEvent) {
    if (this.data.showShareHomePreview) return
    this.switchDate(String(e.currentTarget.dataset.date || ''))
  },

  onChooseDate(e: WechatMiniprogram.PickerChange) { this.switchDate(String(e.detail.value)) },
  onPreviousDate() { this.switchDate(offsetDate(this.data.selectedDate, -1)) },
  onNextDate() { this.switchDate(offsetDate(this.data.selectedDate, 1)) },
  onToday() { this.switchDate(formatLocalDate(new Date())) },

  switchDate(date: string) {
    if (this.data.showShareHomePreview || !parseLocalDate(date)) return
    if (date === this.data.selectedDate) {
      this.setData({ calendarMonth: date.slice(0, 7) })
      this.refreshCalendar()
      return
    }
    if (!this.flushDailyNote()) return
    this.afterDiscardingGoal(() => {
      this.closeEditor()
      stateFor(this).followingToday = date === formatLocalDate(new Date())
      this.setData({ selectedDate: date, calendarMonth: date.slice(0, 7) })
      this.refresh()
    })
  },

  afterDiscardingGoal(action: () => void) {
    const revision = todoRevision()
    const run = () => { if (stateFor(this).revision === revision && todoRevision() === revision) action() }
    const original = stateFor(this).originalGoal
    const dirty = this.data.editorOpen && original !== null
      && (this.data.title !== original.title || this.data.note !== original.note)
    if (!dirty) { run(); return }
    wx.showModal({
      title: '目标尚未保存',
      content: '继续操作会放弃尚未保存的目标内容。',
      cancelText: '继续编辑',
      confirmText: '放弃修改',
      success: (result) => { if (result.confirm) run() },
    })
  },

  onAdd() {
    if (this.data.showShareHomePreview || this.data.storageProblem || this.data.editorOpen) return
    stateFor(this).originalGoal = { title: '', note: '' }
    this.setData({ editorOpen: true, editorId: '', editorDate: this.data.selectedDate, title: '', note: '', noteExpanded: false, goalProblem: '' })
  },

  onEdit(e: WechatMiniprogram.TouchEvent) { this.editGoal(e.currentTarget.dataset.id as string) },

  editGoal(id: string) {
    if (this.data.showShareHomePreview || this.data.storageProblem || this.data.savingGoal) return
    this.afterDiscardingGoal(() => {
      try {
        const item = getTodoById(id)
        if (!item) throw new Error('这条目标可能已经被删除，请重新读取')
        stateFor(this).originalGoal = { title: item.title, note: item.note }
        this.setData({ editorOpen: true, editorId: id, editorDate: item.taskDate, title: item.title, note: item.note, noteExpanded: !!item.note, goalProblem: '' })
        this.trackGoalDraft()
      } catch (error) {
        this.setData({ goalProblem: errorMessage(error, '无法读取目标，请重新读取') })
        this.refresh()
      }
    })
  },

  onTitle(e: WechatMiniprogram.Input) {
    if (this.data.storageProblem || !this.data.editorOpen || stateFor(this).revision !== todoRevision()) return
    this.setData({ title: e.detail.value, goalProblem: '' })
    this.trackGoalDraft()
  },

  onNote(e: WechatMiniprogram.Input) {
    if (this.data.storageProblem || !this.data.editorOpen || stateFor(this).revision !== todoRevision()) return
    this.setData({ note: e.detail.value, goalProblem: '' })
    this.trackGoalDraft()
  },

  trackGoalDraft() {
    const original = stateFor(this).originalGoal
    const dirty = this.data.editorOpen && original !== null
      && (this.data.title !== original.title || this.data.note !== original.note)
    setGoalDraft(this, dirty ? this.data.editorDate : null)
  },

  onExpandNote() {
    if (!this.data.storageProblem) this.setData({ noteExpanded: !this.data.noteExpanded })
  },

  closeEditor() {
    setGoalDraft(this, null)
    stateFor(this).originalGoal = null
    this.setData({ editorOpen: false, editorId: '', editorDate: '', title: '', note: '', noteExpanded: false, savingGoal: false, goalProblem: '' })
  },

  onCancelEditor() {
    if (this.data.savingGoal) return
    this.closeEditor()
    this.checkDayRollover()
  },

  onSaveGoal() {
    if (this.data.showShareHomePreview || this.data.storageProblem || this.data.savingGoal || !this.data.editorOpen || stateFor(this).revision !== todoRevision()) return
    this.setData({ savingGoal: true, goalProblem: '' })
    try {
      const editing = !!this.data.editorId
      saveTodo({ ...(editing ? { id: this.data.editorId } : {}), title: this.data.title, note: this.data.note, taskDate: this.data.editorDate })
      this.closeEditor()
      this.checkDayRollover()
      wx.showToast({ title: editing ? '修改已保存' : '目标已添加', icon: 'success' })
    } catch (error) {
      this.setData({ savingGoal: false, goalProblem: errorMessage(error, '目标保存失败，请重试') })
      this.refresh()
    }
  },

  onToggle(e: WechatMiniprogram.TouchEvent) {
    if (this.data.showShareHomePreview || this.data.storageProblem || stateFor(this).revision !== todoRevision()) return
    try {
      toggleTodo(e.currentTarget.dataset.id as string)
      this.checkDayRollover()
    } catch (error) { this.showGoalError('无法更新目标', error) }
  },

  onMore(e: WechatMiniprogram.TouchEvent) {
    if (this.data.showShareHomePreview || this.data.storageProblem) return
    const id = e.currentTarget.dataset.id as string
    const revision = todoRevision()
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success: (result) => {
        if (todoRevision() !== revision) return
        if (result.tapIndex === 0) this.editGoal(id)
        else if (result.tapIndex === 1) this.confirmDelete(id)
      },
    })
  },

  confirmDelete(id: string) {
    if (this.data.showShareHomePreview || this.data.storageProblem) return
    const revision = todoRevision()
    wx.showModal({
      title: '删除目标',
      content: '确定删除这条目标吗？删除后无法恢复。',
      confirmColor: '#e64340',
      success: (result) => {
        if (!result.confirm || this.data.storageProblem || todoRevision() !== revision) return
        try {
          removeTodo(id)
          if (this.data.editorId === id) this.closeEditor()
          this.checkDayRollover()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (error) { this.showGoalError('无法删除目标', error) }
      },
    })
  },

  showGoalError(title: string, error: unknown) {
    this.refresh()
    wx.showModal({ title, content: errorMessage(error, '目标更新失败，请重试'), showCancel: false, confirmText: '知道了' })
  },

  onDailyNoteInput(e: WechatMiniprogram.Input) {
    if (this.data.showShareHomePreview || this.data.storageProblem || !this.data.selectedDate || stateFor(this).revision !== todoRevision()) return
    const eventDate = e.currentTarget?.dataset.date as string | undefined
    if (eventDate && eventDate !== this.data.selectedDate) return
    const state = stateFor(this)
    if (state.noteTimer !== null) clearTimeout(state.noteTimer)
    state.noteTimer = null
    const content = e.detail.value
    const dirty = content !== state.savedNote
    const date = state.noteDate
    if (dirty) unsavedDailyNotes.set(date, content)
    else unsavedDailyNotes.delete(date)
    this.setData({ dailyNote: content, dailyNoteDirty: dirty, noteSaveState: dirty ? 'dirty' : 'saved', noteStatusLabel: dirty ? '未保存' : content ? '已保存' : '自动保存', noteSaveProblem: '' })
    if (dirty && state.visible) {
      const revision = todoRevision()
      state.noteTimer = setTimeout(() => {
        state.noteTimer = null
        if (state.visible && state.noteDate === date && todoRevision() === revision) this.flushDailyNote()
      }, 500)
    }
  },

  onDailyNoteFocus() {
    if (!this.data.showShareHomePreview && !this.data.storageProblem) stateFor(this).noteFocused = true
  },

  onDailyNoteBlur() {
    stateFor(this).noteFocused = false
    if (stateFor(this).discardingNote) return
    this.flushDailyNote()
  },

  onPrepareDiscardNote() {
    const state = stateFor(this)
    if (state.noteTimer !== null) clearTimeout(state.noteTimer)
    state.noteTimer = null
    state.discardingNote = true
  },

  onCancelDiscardNote() {
    stateFor(this).discardingNote = false
    this.flushDailyNote()
  },

  onDiscardDailyNote() {
    if (!this.data.dailyNoteDirty || stateFor(this).revision !== todoRevision()) {
      stateFor(this).discardingNote = false
      return
    }
    this.onPrepareDiscardNote()
    const state = stateFor(this)
    const date = state.noteDate
    const content = this.data.dailyNote
    const revision = todoRevision()
    wx.showModal({
      title: '放弃随想修改',
      content: '只放弃尚未保存的修改，已保存的随想会保留。',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
      success: (result) => {
        if (!result.confirm || todoRevision() !== revision || state.noteDate !== date || this.data.dailyNote !== content) return
        unsavedDailyNotes.delete(date)
        this.setData({ dailyNoteDirty: false, noteSaveProblem: '' })
        this.refresh()
      },
      complete: () => {
        state.discardingNote = false
        if (state.visible) this.flushDailyNote()
      },
    })
  },

  flushDailyNote(): boolean {
    const state = stateFor(this)
    if (state.noteTimer !== null) clearTimeout(state.noteTimer)
    state.noteTimer = null
    if (this.data.showShareHomePreview || state.revision !== todoRevision() || state.discardingNote) return false
    if (!this.data.dailyNoteDirty) return true
    if (this.data.storageProblem || !state.noteDate) return false
    const content = unsavedDailyNotes.get(state.noteDate) ?? this.data.dailyNote
    this.setData({ noteSaveState: 'saving', noteStatusLabel: '保存中', noteSaveProblem: '' })
    try {
      saveDailyNote(state.noteDate, content)
      unsavedDailyNotes.delete(state.noteDate)
      state.savedNote = content
      this.setData({ dailyNoteDirty: false, noteSaveState: 'saved', noteStatusLabel: content ? '已保存' : '自动保存', noteSaveProblem: '' })
      return true
    } catch (error) {
      this.setData({ dailyNoteDirty: true, noteSaveState: 'error', noteStatusLabel: '未保存，可重试', noteSaveProblem: errorMessage(error, '随想保存失败，请重试') })
      this.refresh()
      return false
    }
  },

  onRetryDailyNote() {
    if (this.flushDailyNote()) this.checkDayRollover()
  },

  onRetry() {
    this.setData({ goalProblem: '' })
    this.checkDayRollover()
    if (!this.data.storageProblem && this.data.dailyNoteDirty && this.flushDailyNote()) this.checkDayRollover()
  },

  scheduleMidnightRefresh() {
    const state = stateFor(this)
    if (state.midnightTimer !== null) clearTimeout(state.midnightTimer)
    state.midnightTimer = null
    if (!state.visible || this.data.showShareHomePreview) return
    const now = new Date()
    const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    state.midnightTimer = setTimeout(() => {
      state.midnightTimer = null
      if (!state.visible) return
      this.checkDayRollover()
      this.scheduleMidnightRefresh()
    }, nextDay.getTime() - now.getTime() + 50)
  },

  stopTimers() {
    const state = stateFor(this)
    if (state.noteTimer !== null) clearTimeout(state.noteTimer)
    if (state.midnightTimer !== null) clearTimeout(state.midnightTimer)
    state.noteTimer = null
    state.midnightTimer = null
  },
})
