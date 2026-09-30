import { appearanceData, syncAppearance } from '../../utils/appearance-page'
import type { TodoBackupSummary, TodoRestorePreview } from '../../models/todo-backup'
import { exportTodoBackup, getRecentTodoBackup, previewRecentTodoBackup, previewTodoBackup, restoreTodoBackup } from '../../services/todo-backup-service'
import { firstTodoDraftDate, requestTodoDraft, todoWriteProblem } from '../../services/todo-session'
import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'

const previews = new WeakMap<object, TodoRestorePreview>()
function message(error: unknown): string { return error instanceof Error ? error.message : '读取或保存失败，请重试' }
function displaySummary(value: TodoBackupSummary): TodoBackupSummary {
  const date = new Date(value.exportedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { ...value, exportedAt: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` }
}

Page({
  data: {
    ...appearanceData(),
    showShareHomePreview: false,
    inputText: '',
    preview: null as TodoBackupSummary | null,
    recent: null as TodoBackupSummary | null,
    currentItemCount: 0,
    currentNoteCount: 0,
    previewSource: '' as '' | 'input' | 'recent',
    problem: '',
    recentProblem: '',
    draftDate: '',
    writeProblem: '',
    busy: false,
  },

  onPageScroll(event: WechatMiniprogram.Page.IPageScrollOption) {
    this.selectComponent('.page-masthead')?.updateScroll(event.scrollTop)
  },

  onReady() { syncAppearance(this) },

  onLoad(options: Record<string, string | undefined>) {
    if (initializeHomeSharing(this, '/pages/todo-backup/index', options)) return
    syncAppearance(this)
  },
  onShareAppMessage: shareHomeToFriend,
  onShareTimeline: shareHomeToTimeline,
  onShow() {
    syncAppearance(this)
    if (this.data.showShareHomePreview) return
    this.clearPreview()
    this.refreshStatus()
  },
  onHide() {
    if (this.data.showShareHomePreview) return
    this.clearPreview()
    this.setData({ busy: false })
  },
  clearPreview() {
    previews.delete(this)
    this.setData({ preview: null, previewSource: '', currentItemCount: 0, currentNoteCount: 0 })
  },
  refreshStatus() {
    this.setData({ draftDate: firstTodoDraftDate(), writeProblem: todoWriteProblem() })
    try { this.setData({ recent: displayRecent(), recentProblem: '' }) }
    catch (error) { this.setData({ recent: null, recentProblem: message(error) }) }
  },
  onReturnToTodo() {
    requestTodoDraft()
    wx.switchTab({ url: '/pages/todo/index' })
  },
  onExport() {
    if (this.data.busy || this.data.showShareHomePreview) return
    this.refreshStatus()
    try {
      const text = exportTodoBackup()
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '备份已复制', icon: 'success' }),
        fail: () => this.setData({ problem: '复制失败，请重试；本机数据没有改变' }),
      })
      this.setData({ problem: '' })
    } catch (error) { this.setData({ problem: message(error) }) }
  },
  onInput(event: WechatMiniprogram.Input) {
    if (event.detail.value === this.data.inputText) return
    this.clearPreview()
    this.setData({ inputText: event.detail.value, problem: '' })
  },
  onParse() {
    if (this.data.busy || this.data.showShareHomePreview) return
    this.clearPreview()
    try { this.showPreview(previewTodoBackup(this.data.inputText), 'input') }
    catch (error) { this.setData({ problem: message(error) }) }
    this.refreshStatus()
  },
  onPreviewRecent() {
    if (this.data.busy || this.data.showShareHomePreview) return
    this.clearPreview()
    try { this.showPreview(previewRecentTodoBackup(), 'recent') }
    catch (error) { this.setData({ problem: message(error) }) }
    this.refreshStatus()
  },
  showPreview(value: TodoRestorePreview, source: 'input' | 'recent') {
    previews.set(this, value)
    this.setData({
      preview: displaySummary(value.summary), previewSource: source, problem: '',
      currentItemCount: value.currentItemCount, currentNoteCount: value.currentNoteCount,
    })
  },
  onRestore() {
    const value = previews.get(this)
    if (!value || this.data.busy || this.data.showShareHomePreview) return
    this.refreshStatus()
    if (this.data.draftDate || this.data.writeProblem) return
    const empty = value.summary.itemCount === 0 && value.summary.noteCount === 0
    this.setData({ busy: true })
    wx.showModal({
      title: this.data.previewSource === 'recent' ? '恢复最近备份' : '覆盖待办与随想',
      content: `${empty ? '这是空备份，将清空全部已保存目标与随想。' : `将替换所有日期的数据，恢复 ${value.summary.itemCount} 个目标、${value.summary.noteCount} 篇随想。`}本机现有 ${value.currentItemCount} 个目标、${value.currentNoteCount} 篇随想会先保存为最近备份，可在本页恢复。`,
      confirmText: '确认恢复',
      confirmColor: '#267d78',
      success: (result) => {
        if (!result.confirm || previews.get(this) !== value) return
        try {
          restoreTodoBackup(value)
          this.clearPreview()
          this.setData({ inputText: '', problem: '' })
          wx.showToast({ title: '恢复完成', icon: 'success' })
        } catch (error) {
          this.clearPreview()
          this.setData({ problem: message(error) })
        }
        this.refreshStatus()
      },
      fail: () => this.setData({ problem: '未能打开确认窗口，请重试' }),
      complete: () => this.setData({ busy: false }),
    })
  },
})

function displayRecent(): TodoBackupSummary | null {
  const value = getRecentTodoBackup()
  return value ? displaySummary(value) : null
}
