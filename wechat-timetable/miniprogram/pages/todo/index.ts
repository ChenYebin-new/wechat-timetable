import { appearanceData, syncAppearance } from '../../utils/appearance-page'
import type { TodoItem } from '../../models/todo'
import { getTodoById, getTodoSnapshot, migrateTodosToV3, removeTodo, reorderTodos, saveDailyNote, saveTodo, toggleTodo } from '../../services/todo-storage'
import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'
import { formatLocalDate, parseLocalDate } from '../../utils/local-date'
import { buildTodoCalendar, offsetTodoCalendarMonth } from '../../utils/todo-calendar'
import type { TodoCalendarDay } from '../../utils/todo-calendar'
import { unsavedDailyNotes, setGoalDraft, todoRevision, takeRequestedDraftDate } from '../../services/todo-session'
import { todosForDate, todoDragLayout } from '../../utils/todo-order'
import type { TodoRowRect } from '../../utils/todo-order'

interface TodoView extends TodoItem {
  expired: boolean
}

interface TodoDragEvent {
  token: number
  clientY: number
}

interface TodoDragState {
  token: number
  revision: number
  date: string
  completed: boolean
  originalIds: string[]
  source: number
  first: number
  last: number
  target: number
  startY: number
  clientY: number
  startScroll: number
  rows: TodoRowRect[]
  ready: boolean
  viewportTop: number
  viewportBottom: number
  maxScroll: number
  scrollTimer: ReturnType<typeof setInterval> | null
  settling: boolean
  settleTimer: ReturnType<typeof setTimeout> | null
  finalItems: TodoView[] | null
}

function idleDragPresentation() {
  return { active: false, settling: false, token: 0, source: 0, startY: 0, scrollDelta: 0, minOffset: 0, maxOffset: 0, offsets: [] as number[] }
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
  scrollTop: number
  drag: TodoDragState | null
}

const pageStates = new WeakMap<object, PageState>()
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function stateFor(page: object): PageState {
  let state = pageStates.get(page)
  if (!state) {
    state = { revision: todoRevision(), discardingNote: false, visible: false, followingToday: true, noteFocused: false, noteDate: '', savedNote: '', originalGoal: null, noteTimer: null, midnightTimer: null, goalDates: new Set(), scrollTop: 0, drag: null }
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
    draggingId: '',
    dragSettling: false,
    dragSlotStyle: '',
    dragPresentation: idleDragPresentation(),
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
    stateFor(this).scrollTop = event.scrollTop
    if (stateFor(this).drag?.ready) this.updateTodoDrag()
  },

  onResize() { this.cancelTodoDrag() },

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
    this.cancelTodoDrag()
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
    this.cancelTodoDrag()
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
    this.cancelTodoDrag(false)
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

    const visibleItems = todosForDate(snapshot.data.items, selectedDate)
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
      draggingId: '', dragSettling: false, dragSlotStyle: '', dragPresentation: idleDragPresentation(),
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
    this.cancelTodoDrag()
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
    this.cancelTodoDrag()
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
    this.cancelTodoDrag()
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
    this.finishTodoDrop()
    if (stateFor(this).drag || this.data.showShareHomePreview || this.data.storageProblem || this.data.editorOpen) return
    stateFor(this).originalGoal = { title: '', note: '' }
    this.setData({ editorOpen: true, editorId: '', editorDate: this.data.selectedDate, title: '', note: '', noteExpanded: false, goalProblem: '' })
  },

  onEdit(e: WechatMiniprogram.TouchEvent) { this.editGoal(e.currentTarget.dataset.id as string) },

  onTodoDragStart(event: TodoDragEvent & { id: string }) {
    this.finishTodoDrop()
    const state = stateFor(this)
    const source = this.data.visibleItems.findIndex((item) => item.id === event.id)
    const item = this.data.visibleItems[source]
    if (!state.visible || state.noteFocused || state.revision !== todoRevision()
      || this.data.showShareHomePreview || this.data.storageProblem || this.data.editorOpen || this.data.savingGoal
      || !item || !Number.isFinite(event.clientY)) {
      this.cancelTodoDrag()
      return
    }
    const originalIds = this.data.visibleItems.filter((entry) => entry.completed === item.completed).map((entry) => entry.id)
    if (originalIds.length < 2) { this.cancelTodoDrag(); return }
    if (state.drag && state.drag.scrollTimer !== null) clearInterval(state.drag.scrollTimer)
    const first = this.data.visibleItems.findIndex((entry) => entry.completed === item.completed)
    const drag: TodoDragState = {
      token: event.token, revision: todoRevision(), date: this.data.selectedDate, completed: item.completed,
      originalIds, source, first, last: first + originalIds.length - 1, target: source,
      startY: event.clientY, clientY: event.clientY, startScroll: state.scrollTop, rows: [], ready: false,
      viewportTop: 0, viewportBottom: 0, maxScroll: 0, scrollTimer: null,
      settling: false, settleTimer: null, finalItems: null,
    }
    state.drag = drag
    // 先测量原始行的位置；松手、切日或恢复数据后，迟到的测量回调直接失效。
    this.createSelectorQuery().selectAll('.todo-row').boundingClientRect()
      .selectViewport().scrollOffset().select('.page').boundingClientRect().exec((results) => {
        if (state.drag !== drag) return
        if (!state.visible || drag.revision !== todoRevision() || drag.date !== this.data.selectedDate) { this.cancelTodoDrag(); return }
        const rows = results[0] as Array<TodoRowRect & { dataset: { id: string } }>
        const scroll = results[1] as { scrollTop: number } | null
        const page = results[2] as { bottom: number } | null
        if (!rows || rows.length !== this.data.visibleItems.length || !scroll || !page
          || !Number.isFinite(scroll.scrollTop) || !Number.isFinite(page.bottom)
          || rows.some((row, index) => !row || row.height <= 0 || !Number.isFinite(row.height) || !Number.isFinite(row.top)
            || row.dataset?.id !== this.data.visibleItems[index].id)) {
          this.cancelTodoDrag()
          return
        }
        const window = wx.getSystemInfoSync()
        const header = this.selectComponent('.page-masthead')?.data
        const safeBottom = Math.max(0, window.screenHeight - (window.safeArea?.bottom || window.screenHeight))
        drag.viewportTop = header ? header.statusHeight + header.navigationHeight : (window.statusBarHeight || 0) + 44
        drag.viewportBottom = window.windowHeight - Math.max(44, 118 * window.windowWidth / 750) - safeBottom
        drag.startScroll = scroll.scrollTop
        state.scrollTop = scroll.scrollTop
        drag.maxScroll = Math.max(0, page.bottom + scroll.scrollTop - window.windowHeight)
        drag.rows = rows.map((row) => ({ top: row.top + scroll.scrollTop, height: row.height }))
        drag.ready = true
        this.updateTodoDrag()
      })
  },

  onTodoDragMove(event: TodoDragEvent) {
    const drag = stateFor(this).drag
    if (!drag || drag.settling || drag.token !== event.token || !Number.isFinite(event.clientY)) return
    drag.clientY = event.clientY
    if (drag.ready) this.updateTodoDrag()
  },

  updateTodoDrag() {
    const state = stateFor(this)
    const drag = state.drag
    if (!drag?.ready || drag.settling) return
    if (drag.revision !== todoRevision() || drag.date !== this.data.selectedDate || !state.visible) {
      this.cancelTodoDrag()
      return
    }
    const scrollDelta = state.scrollTop - drag.startScroll
    const layout = todoDragLayout(drag.rows, drag.source, drag.first, drag.last, drag.clientY - drag.startY + scrollDelta)
    const previous = this.data.dragPresentation
    if (!previous.active || layout.target !== drag.target || previous.scrollDelta !== scrollDelta) {
      this.setData({
        draggingId: this.data.visibleItems[drag.source].id, dragSettling: false,
        dragSlotStyle: `--todo-slot-y:${drag.rows[drag.source].top + layout.offsets[drag.source] - drag.rows[0].top}px;--todo-slot-height:${drag.rows[drag.source].height}px;`,
        dragPresentation: {
          active: true, settling: false, token: drag.token, source: drag.source, startY: drag.startY, scrollDelta,
          minOffset: layout.minOffset, maxOffset: layout.maxOffset, offsets: layout.offsets,
        },
      })
    }
    drag.target = layout.target
    const delta = this.todoDragScrollDelta()
    if (delta && drag.scrollTimer === null) {
      drag.scrollTimer = setInterval(() => this.scrollTodoDrag(), 32)
    } else if (!delta && drag.scrollTimer !== null) {
      clearInterval(drag.scrollTimer)
      drag.scrollTimer = null
    }
  },

  todoDragScrollDelta(): number {
    const state = stateFor(this)
    const drag = state.drag
    if (!drag?.ready || drag.settling) return 0
    const first = drag.rows[drag.first]
    const last = drag.rows[drag.last]
    if (drag.clientY < drag.viewportTop + 48 && first.top - state.scrollTop < drag.viewportTop && state.scrollTop > 0) {
      return -Math.min(16, Math.max(4, (drag.viewportTop + 48 - drag.clientY) / 3))
    }
    if (drag.clientY > drag.viewportBottom - 48 && last.top + last.height - state.scrollTop > drag.viewportBottom
      && state.scrollTop < drag.maxScroll) {
      return Math.min(16, Math.max(4, (drag.clientY - drag.viewportBottom + 48) / 3))
    }
    return 0
  },

  scrollTodoDrag() {
    const state = stateFor(this)
    const drag = state.drag
    if (!drag?.ready || drag.revision !== todoRevision() || !state.visible) { this.cancelTodoDrag(); return }
    if (drag.settling) return
    const delta = this.todoDragScrollDelta()
    if (!delta) { this.updateTodoDrag(); return }
    wx.pageScrollTo({
      scrollTop: Math.max(0, Math.min(drag.maxScroll, state.scrollTop + delta)), duration: 0,
      fail: () => { if (state.drag === drag) this.cancelTodoDrag() },
    })
  },

  onTodoDragEnd(event: TodoDragEvent) {
    const state = stateFor(this)
    const drag = state.drag
    if (!drag || drag.settling || drag.token !== event.token) return
    if (!drag.ready || drag.revision !== todoRevision() || drag.date !== this.data.selectedDate || !state.visible) {
      this.cancelTodoDrag()
      return
    }
    if (Number.isFinite(event.clientY)) drag.clientY = event.clientY
    const layout = todoDragLayout(drag.rows, drag.source, drag.first, drag.last,
      drag.clientY - drag.startY + state.scrollTop - drag.startScroll)
    const ids = [...drag.originalIds]
    const [id] = ids.splice(drag.source - drag.first, 1)
    ids.splice(layout.target - drag.first, 0, id)
    try {
      reorderTodos(drag.date, drag.completed, ids, drag.originalIds)
      if (drag.scrollTimer !== null) clearInterval(drag.scrollTimer)
      drag.scrollTimer = null
      drag.settling = true
      const finalItems = [...this.data.visibleItems]
      const [item] = finalItems.splice(drag.source, 1)
      finalItems.splice(layout.target, 0, item)
      drag.finalItems = finalItems
      // 先在原 DOM 中落到插入位置，再一次性换序并清零位移，避免松手时跳回原处。
      this.setData({
        dragSettling: true,
        dragSlotStyle: `--todo-slot-y:${drag.rows[drag.source].top + layout.offsets[drag.source] - drag.rows[0].top}px;--todo-slot-height:${drag.rows[drag.source].height}px;`,
        dragPresentation: {
          active: true, settling: true, token: drag.token, source: drag.source, startY: drag.startY,
          scrollDelta: state.scrollTop - drag.startScroll, minOffset: layout.minOffset, maxOffset: layout.maxOffset,
          offsets: layout.offsets,
        },
      })
      drag.settleTimer = setTimeout(() => { if (state.drag === drag) this.refresh() }, 220)
    } catch (error) { this.cancelTodoDrag(); this.showGoalError('顺序未保存', error) }
  },

  onTodoDropInterrupted(event: { token: number }) {
    if (stateFor(this).drag?.token === event.token) this.finishTodoDrop()
  },

  finishTodoDrop() {
    if (stateFor(this).drag?.settling) this.refresh()
  },

  onTodoDragCancel(event: { token: number }) {
    if (stateFor(this).drag?.token === event.token) this.cancelTodoDrag()
  },

  cancelTodoDrag(updateView = true) {
    const state = stateFor(this)
    const finalItems = state.drag?.settling && state.drag.revision === todoRevision() ? state.drag.finalItems : null
    if (state.drag && state.drag.scrollTimer !== null) clearInterval(state.drag.scrollTimer)
    if (state.drag && state.drag.settleTimer !== null) clearTimeout(state.drag.settleTimer)
    state.drag = null
    if (updateView) this.setData({
      ...(finalItems ? { visibleItems: finalItems } : {}),
      draggingId: '', dragSettling: false, dragSlotStyle: '', dragPresentation: idleDragPresentation(),
    })
  },

  editGoal(id: string) {
    this.finishTodoDrop()
    if (stateFor(this).drag || this.data.showShareHomePreview || this.data.storageProblem || this.data.savingGoal) return
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
    this.finishTodoDrop()
    if (stateFor(this).drag || this.data.showShareHomePreview || this.data.storageProblem || stateFor(this).revision !== todoRevision()) return
    try {
      toggleTodo(e.currentTarget.dataset.id as string)
      this.checkDayRollover()
    } catch (error) { this.showGoalError('无法更新目标', error) }
  },

  onMore(e: WechatMiniprogram.TouchEvent) {
    this.finishTodoDrop()
    if (stateFor(this).drag || this.data.showShareHomePreview || this.data.storageProblem) return
    const id = e.currentTarget.dataset.id as string
    const revision = todoRevision()
    const date = this.data.selectedDate
    const item = this.data.visibleItems.find((entry) => entry.id === id)
    if (!item) return
    const ids = this.data.visibleItems.filter((entry) => entry.completed === item.completed).map((entry) => entry.id)
    const index = ids.indexOf(id)
    const moves = [0, 0]
    const itemList = ['编辑', '删除']
    if (index > 0) { itemList.push('上移'); moves.push(-1) }
    if (index < ids.length - 1) { itemList.push('下移'); moves.push(1) }
    wx.showActionSheet({
      itemList,
      success: (result) => {
        if (todoRevision() !== revision || this.data.selectedDate !== date || stateFor(this).drag) return
        if (result.tapIndex === 0) this.editGoal(id)
        else if (result.tapIndex === 1) this.confirmDelete(id)
        else if (moves[result.tapIndex]) {
          const next = [...ids]
          const target = index + moves[result.tapIndex]
          next[index] = next[target]
          next[target] = id
          try {
            reorderTodos(date, item.completed, next, ids)
            this.refresh()
          } catch (error) { this.showGoalError('顺序未保存', error) }
        }
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
    this.cancelTodoDrag()
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
