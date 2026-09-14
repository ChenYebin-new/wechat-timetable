import type { TodoItem } from '../../models/todo'
import { getTodoSnapshot, removeTodo, toggleTodo } from '../../services/todo-storage'
import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'

type TodoFilter = 'pending' | 'completed'
type DueTone = 'normal' | 'today' | 'overdue'
type ScheduleTone = 'normal' | 'missed'

interface TodoView extends TodoItem {
  dueText: string
  dueTone: DueTone
  scheduleText: string
  scheduleTone: ScheduleTone
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function offsetDateKey(date: Date, days: number): string {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
  return dateKey(copy)
}

function dueView(dueDate: string, completed: boolean, today: Date): { dueText: string; dueTone: DueTone } {
  if (!dueDate) return { dueText: '', dueTone: 'normal' }
  const [year, month, day] = dueDate.split('-').map(Number)
  const todayKey = dateKey(today)
  if (dueDate === todayKey) return { dueText: '今天截止', dueTone: completed ? 'normal' : 'today' }
  if (dueDate === offsetDateKey(today, 1)) return { dueText: '明天截止', dueTone: 'normal' }
  const label = year === today.getFullYear() ? `${month}月${day}日` : `${year}年${month}月${day}日`
  return dueDate < todayKey && !completed
    ? { dueText: `已逾期 · ${label}`, dueTone: 'overdue' }
    : { dueText: `${label}截止`, dueTone: 'normal' }
}

function scheduleDateLabel(scheduleDate: string, today: Date): string {
  if (scheduleDate === dateKey(today)) return '今天'
  if (scheduleDate === offsetDateKey(today, 1)) return '明天'
  const [year, month, day] = scheduleDate.split('-').map(Number)
  return year === today.getFullYear() ? `${month}月${day}日` : `${year}年${month}月${day}日`
}

function localDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute)
}

function scheduleView(item: TodoItem, now: Date): { scheduleText: string; scheduleTone: ScheduleTone } {
  if (!item.scheduleDate) return { scheduleText: '', scheduleTone: 'normal' }
  const label = `${scheduleDateLabel(item.scheduleDate, now)} ${item.scheduleStartTime}–${item.scheduleEndTime}`
  const missed = !item.completed && localDateTime(item.scheduleDate, item.scheduleEndTime).getTime() <= now.getTime()
  return missed
    ? { scheduleText: `计划时间已过 · ${label}`, scheduleTone: 'missed' }
    : { scheduleText: label, scheduleTone: 'normal' }
}

function sortTodos(items: TodoItem[], filter: TodoFilter): TodoItem[] {
  return [...items]
    .filter((item) => filter === 'completed' ? item.completed : !item.completed)
    .sort((left, right) => {
      if (filter === 'completed') return (right.completedAt || right.updatedAt) - (left.completedAt || left.updatedAt)
      if (left.scheduleDate && right.scheduleDate) {
        const leftSchedule = `${left.scheduleDate}T${left.scheduleStartTime}`
        const rightSchedule = `${right.scheduleDate}T${right.scheduleStartTime}`
        if (leftSchedule !== rightSchedule) return leftSchedule.localeCompare(rightSchedule)
      }
      if (left.scheduleDate !== right.scheduleDate) return left.scheduleDate ? -1 : 1
      if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate)
      if (left.dueDate !== right.dueDate) return left.dueDate ? -1 : 1
      return right.createdAt - left.createdAt
    })
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

Page({
  data: {
    filter: 'pending' as TodoFilter,
    visibleItems: [] as TodoView[],
    pendingCount: 0,
    completedCount: 0,
    overviewText: '把接下来要做的事记下来。',
    emptyTitle: '还没有待办',
    emptyDescription: '新建第一条待办，让重要的事情有处可放。',
    storageProblem: '',
    showShareHomePreview: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (initializeHomeSharing(this, '/pages/todo/index', options)) return
  },

  onShareAppMessage: shareHomeToFriend,

  onShareTimeline: shareHomeToTimeline,

  onShow() {
    if (this.data.showShareHomePreview) return
    this.refresh()
  },

  refresh() {
    const snapshot = getTodoSnapshot()
    if (!('data' in snapshot)) {
      this.setData({
        visibleItems: [],
        pendingCount: 0,
        completedCount: 0,
        storageProblem: snapshot.reason,
      })
      return
    }
    const now = new Date()
    const pendingCount = snapshot.data.items.filter((item) => !item.completed).length
    const completedCount = snapshot.data.items.length - pendingCount
    const scheduledToday = snapshot.data.items.filter((item) => !item.completed && item.scheduleDate === dateKey(now)).length
    const dueToday = snapshot.data.items.filter((item) => !item.completed && item.dueDate === dateKey(now)).length
    const visibleItems = sortTodos(snapshot.data.items, this.data.filter).map((item) => ({
      ...item,
      ...scheduleView(item, now),
      ...dueView(item.dueDate, item.completed, now),
    }))
    const todayParts = [
      ...(scheduledToday ? [`今天计划 ${scheduledToday} 项`] : []),
      ...(dueToday ? [`今天截止 ${dueToday} 项`] : []),
    ]
    const overviewText = pendingCount === 0
      ? snapshot.data.items.length === 0
        ? '把接下来要做的事记下来。'
        : '待办已经清空，可以轻装上阵。'
      : `还有 ${pendingCount} 项待完成${todayParts.length ? ` · ${todayParts.join(' · ')}` : ''}`
    const emptyTitle = this.data.filter === 'completed'
      ? '还没有完成记录'
      : completedCount > 0
        ? '待完成列表已清空'
        : '还没有待办'
    const emptyDescription = this.data.filter === 'completed'
      ? '完成一项待办后，它会保留在这里。'
      : '新建第一条待办，让重要的事情有处可放。'
    this.setData({
      visibleItems,
      pendingCount,
      completedCount,
      overviewText,
      emptyTitle,
      emptyDescription,
      storageProblem: '',
    })
  },

  onFilter(e: WechatMiniprogram.TouchEvent) {
    const filter = e.currentTarget.dataset.filter as TodoFilter
    if (filter === this.data.filter) return
    this.setData({ filter })
    this.refresh()
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/todo-edit/index' })
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.navigateTo({ url: `/pages/todo-edit/index?id=${id}` })
  },

  onToggle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    try {
      toggleTodo(id)
      this.refresh()
    } catch (error) {
      wx.showModal({
        title: '无法更新待办',
        content: errorMessage(error, '待办数据写入失败，请稍后重试'),
        showCancel: false,
        confirmText: '知道了',
      })
    }
  },

  onMore(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success: (result) => {
        if (result.tapIndex === 0) {
          wx.navigateTo({ url: `/pages/todo-edit/index?id=${id}` })
          return
        }
        this.confirmDelete(id)
      },
    })
  },

  confirmDelete(id: string) {
    wx.showModal({
      title: '删除待办',
      content: '确定删除这条待办吗？删除后无法恢复。',
      confirmColor: '#e64340',
      success: (result) => {
        if (!result.confirm) return
        try {
          removeTodo(id)
          this.refresh()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (error) {
          wx.showModal({
            title: '无法删除',
            content: errorMessage(error, '待办数据写入失败，请稍后重试'),
            showCancel: false,
            confirmText: '知道了',
          })
        }
      },
    })
  },

  onRetry() {
    this.refresh()
  },
})
