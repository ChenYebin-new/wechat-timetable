import { getTodoById, saveTodo } from '../../services/todo-storage'
import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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
    datePickerValue: dateKey(new Date()),
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
        datePickerValue: item.dueDate || dateKey(new Date()),
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
    this.setData({ dueDate, datePickerValue: dueDate })
  },

  onClearDate() {
    this.setData({ dueDate: '' })
  },

  onSave() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      saveTodo({
        ...(this.data.id ? { id: this.data.id } : {}),
        title: this.data.title,
        note: this.data.note,
        dueDate: this.data.dueDate,
      })
    } catch (error) {
      this.setData({ saving: false })
      wx.showModal({
        title: '无法保存',
        content: errorMessage(error, '待办数据写入失败，请稍后重试'),
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    wx.showToast({ title: this.data.isEdit ? '修改已保存' : '待办已创建', icon: 'success' })
    wx.navigateBack()
  },
})
