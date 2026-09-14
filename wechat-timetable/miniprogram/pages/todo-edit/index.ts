import type { TodoDraft } from '../../models/todo'
import { getTodoById, getTodoDraftWarning, saveTodo } from '../../services/todo-storage'
import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'
import { formatLocalDate } from '../../utils/local-date'

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

Page({
  data: {
    id: '',
    isEdit: false,
    title: '',
    note: '',
    dueDate: '',
    dueDatePickerValue: formatLocalDate(new Date()),
    scheduleExpanded: false,
    scheduleDate: '',
    scheduleStartTime: '',
    scheduleEndTime: '',
    scheduleDatePickerValue: formatLocalDate(new Date()),
    scheduleStartPickerValue: '09:00',
    scheduleEndPickerValue: '10:00',
    saving: false,
    showShareHomePreview: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (initializeHomeSharing(this, '/pages/todo-edit/index', options)) return
    const id = options && options.id ? options.id : ''
    if (!id) return
    try {
      const item = getTodoById(id)
      if (!item) {
        this.showLoadError('这条待办可能已经被删除。')
        return
      }
      this.setData({
        id: item.id,
        isEdit: true,
        title: item.title,
        note: item.note,
        dueDate: item.dueDate,
        dueDatePickerValue: item.dueDate || formatLocalDate(new Date()),
        scheduleExpanded: !!item.scheduleDate,
        scheduleDate: item.scheduleDate,
        scheduleStartTime: item.scheduleStartTime,
        scheduleEndTime: item.scheduleEndTime,
        scheduleDatePickerValue: item.scheduleDate || formatLocalDate(new Date()),
        scheduleStartPickerValue: item.scheduleStartTime || '09:00',
        scheduleEndPickerValue: item.scheduleEndTime || '10:00',
      })
      wx.setNavigationBarTitle({ title: '编辑待办' })
    } catch (error) {
      this.showLoadError(errorMessage(error, '待办数据读取失败，请稍后重试'))
    }
  },

  onShareAppMessage: shareHomeToFriend,

  onShareTimeline: shareHomeToTimeline,

  showLoadError(content: string) {
    wx.showModal({
      title: '无法打开待办',
      content,
      showCancel: false,
      confirmText: '返回',
      success: () => wx.navigateBack(),
    })
  },

  onTitle(e: WechatMiniprogram.Input) {
    this.setData({ title: e.detail.value })
  },

  onNote(e: WechatMiniprogram.Input) {
    this.setData({ note: e.detail.value })
  },

  onDate(e: WechatMiniprogram.PickerChange) {
    const dueDate = String(e.detail.value)
    this.setData({ dueDate, dueDatePickerValue: dueDate })
  },

  onClearDate() {
    this.setData({ dueDate: '' })
  },

  onAddSchedule() {
    this.setData({ scheduleExpanded: true })
  },

  onScheduleDate(e: WechatMiniprogram.PickerChange) {
    const scheduleDate = String(e.detail.value)
    this.setData({ scheduleDate, scheduleDatePickerValue: scheduleDate })
  },

  onScheduleStart(e: WechatMiniprogram.PickerChange) {
    const scheduleStartTime = String(e.detail.value)
    this.setData({ scheduleStartTime, scheduleStartPickerValue: scheduleStartTime })
  },

  onScheduleEnd(e: WechatMiniprogram.PickerChange) {
    const scheduleEndTime = String(e.detail.value)
    this.setData({ scheduleEndTime, scheduleEndPickerValue: scheduleEndTime })
  },

  onClearSchedule() {
    this.setData({
      scheduleExpanded: false,
      scheduleDate: '',
      scheduleStartTime: '',
      scheduleEndTime: '',
      scheduleDatePickerValue: formatLocalDate(new Date()),
      scheduleStartPickerValue: '09:00',
      scheduleEndPickerValue: '10:00',
    })
  },

  showSaveError(content: string) {
    wx.showModal({
      title: '无法保存',
      content,
      showCancel: false,
      confirmText: '知道了',
    })
  },

  persistTodo(draft: TodoDraft) {
    try {
      saveTodo(draft)
    } catch (error) {
      this.setData({ saving: false })
      this.showSaveError(errorMessage(error, '待办数据写入失败，请稍后重试'))
      return
    }
    wx.showToast({ title: this.data.isEdit ? '修改已保存' : '待办已创建', icon: 'success' })
    wx.navigateBack()
  },

  onSave() {
    if (this.data.saving) return
    const draft: TodoDraft = {
      ...(this.data.id ? { id: this.data.id } : {}),
      title: this.data.title,
      note: this.data.note,
      dueDate: this.data.dueDate,
      scheduleDate: this.data.scheduleDate,
      scheduleStartTime: this.data.scheduleStartTime,
      scheduleEndTime: this.data.scheduleEndTime,
    }
    let warning = ''
    try {
      warning = getTodoDraftWarning(draft)
    } catch (error) {
      this.showSaveError(errorMessage(error, '请检查待办内容后重试'))
      return
    }
    this.setData({ saving: true })
    if (warning) {
      wx.showModal({
        title: '确认执行时间',
        content: warning,
        cancelText: '返回修改',
        confirmText: '仍然保存',
        success: (result) => {
          if (result.confirm) this.persistTodo(draft)
          else this.setData({ saving: false })
        },
        fail: () => this.setData({ saving: false }),
      })
      return
    }
    this.persistTodo(draft)
  },
})
