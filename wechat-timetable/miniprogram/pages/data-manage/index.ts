// pages/data-manage/index.ts
import type { ImportPreview, TimetableBackupEnvelope } from '../../models/backup'
import type { TermSettings } from '../../models/course'
import {
  analyzeBackup,
  exportBackup,
  getRecentBackup,
  mergeFromBackup,
  overwriteFromBackup,
  parseBackup,
  restoreRecentBackup,
} from '../../services/backup-service'
import { getTerm } from '../../services/course-storage'
import { DEFAULT_TOTAL_WEEKS, MAX_TOTAL_WEEKS } from '../../constants/timetable'
import { formatLocalDate, validateTerm } from '../../utils/term'

interface RecentBackupInfo {
  savedAtText: string
  schemaVersion: number
  count: number
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
}

function defaultMonday(): string {
  const now = new Date()
  const day = now.getDay() === 0 ? 7 : now.getDay()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1))
  return formatLocalDate(monday)
}

const weekOptions: string[] = []
for (let w = 1; w <= MAX_TOTAL_WEEKS; w++) weekOptions.push(`${w} 周`)

Page({
  data: {
    inputText: '',
    envelope: null as TimetableBackupEnvelope | null,
    preview: null as ImportPreview | null,
    previewErrors: [] as string[],
    recentBackupInfo: null as RecentBackupInfo | null,
    needsTerm: false,
    termStartDate: '',
    termTotalWeeks: DEFAULT_TOTAL_WEEKS,
    weekOptions,
  },

  onShow() {
    this.setData({ recentBackupInfo: this.buildRecentBackupInfo() })
  },

  buildRecentBackupInfo(): RecentBackupInfo | null {
    const rb = getRecentBackup()
    if (!rb) return null
    return {
      savedAtText: this.formatTime(rb.savedAt),
      schemaVersion: rb.export.data.schemaVersion,
      count: Array.isArray(rb.export.data.courses) ? rb.export.data.courses.length : 0,
    }
  },

  formatTime(ts: number): string {
    const d = new Date(ts)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  onExport() {
    let json = ''
    try {
      json = exportBackup()
    } catch (error) {
      wx.showModal({
        title: '无法导出',
        content:
          error instanceof Error && error.message
            ? error.message
            : '读取课表数据失败，请稍后重试',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    wx.setClipboardData({
      data: json,
      success: () => wx.showToast({ title: '已复制课表 JSON', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    })
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ inputText: e.detail.value })
  },

  onParse() {
    const parsed = parseBackup(this.data.inputText)
    if (!parsed.ok) {
      this.setData({
        envelope: null,
        preview: null,
        previewErrors: [parsed.reason || '解析失败'],
        needsTerm: false,
      })
      return
    }
    const analyzed = analyzeBackup(parsed.envelope as TimetableBackupEnvelope)
    if (!analyzed.ok) {
      this.setData({ envelope: null, preview: null, previewErrors: analyzed.errors, needsTerm: false })
      return
    }
    const needsTerm = analyzed.needsTerm === true
    const term = getTerm()
    this.setData({
      envelope: parsed.envelope as TimetableBackupEnvelope,
      preview: analyzed.preview as ImportPreview,
      previewErrors: [],
      needsTerm,
      termStartDate: term ? term.startDate : defaultMonday(),
      termTotalWeeks: term ? term.totalWeeks : DEFAULT_TOTAL_WEEKS,
    })
  },

  onTermDate(e: WechatMiniprogram.PickerChange) {
    this.setData({ termStartDate: e.detail.value as string })
  },

  onTermWeeks(e: WechatMiniprogram.PickerChange) {
    this.setData({ termTotalWeeks: Number(e.detail.value) + 1 })
  },

  buildImportTerm(): TermSettings | undefined {
    const term: TermSettings = {
      startDate: this.data.termStartDate,
      totalWeeks: this.data.termTotalWeeks,
    }
    const vt = validateTerm(term)
    if (!vt.ok) {
      wx.showModal({
        title: '学期设置无效',
        content: vt.reason || '请检查学期设置',
        showCancel: false,
        confirmText: '知道了',
      })
      return undefined
    }
    return term
  },

  confirm(title: string, message: string, confirmText: string, onOk: () => void) {
    wx.showModal({
      title,
      content: message,
      confirmText,
      confirmColor: '#267d78',
      success: (res) => {
        if (res.confirm) onOk()
      },
    })
  },

  onOverwrite() {
    const envelope = this.data.envelope
    const preview = this.data.preview
    if (!envelope) return
    let termArg: TermSettings | undefined
    if (this.data.needsTerm) {
      termArg = this.buildImportTerm()
      if (!termArg) return
    }
    this.confirm(
      '覆盖现有课表',
      `将用备份中的 ${preview ? preview.backupCount : 0} 门课程替换当前 ${preview ? preview.currentCount : 0} 门课程。继续前会自动保存当前课表，之后可在本页恢复。`,
      '确认覆盖',
      () => {
        const r = overwriteFromBackup(envelope, termArg)
        this.afterMutation(r.ok, r.reason)
      },
    )
  },

  onMerge() {
    const envelope = this.data.envelope
    const preview = this.data.preview
    if (!envelope) return
    let termArg: TermSettings | undefined
    if (this.data.needsTerm) {
      termArg = this.buildImportTerm()
      if (!termArg) return
    }
    this.confirm(
      '合并课表',
      `将把备份中没有重复、没有冲突的课程合并进当前课表（预计新增 ${preview ? preview.mergeAddCount : 0} 门）。`,
      '确认合并',
      () => {
        const r = mergeFromBackup(envelope, termArg)
        this.afterMutation(
          r.ok,
          r.reason,
          '合并完成',
          r.ok
            ? `新增 ${r.added || 0} 门，跳过重复 ${r.skippedDuplicate || 0} 门，跳过冲突 ${r.skippedConflict || 0} 门，当前共 ${r.finalCount || 0} 门课程。`
            : undefined,
        )
      },
    )
  },

  onRestoreRecent() {
    const info = this.data.recentBackupInfo
    if (!info) {
      wx.showToast({ title: '没有可用备份', icon: 'none' })
      return
    }
    this.confirm(
      '恢复最近备份',
      `将用最近备份（V${info.schemaVersion}，${info.count} 门课程）替换当前课表。继续前会自动保存当前课表，之后仍可在本页恢复。`,
      '确认恢复',
      () => {
        const r = restoreRecentBackup()
        this.afterMutation(r.ok, r.reason)
      },
    )
  },

  afterMutation(ok: boolean, reason?: string, successTitle = '已保存', successDetails?: string) {
    if (ok) {
      if (successDetails) {
        wx.showModal({
          title: successTitle,
          content: successDetails,
          showCancel: false,
          confirmText: '知道了',
        })
      } else {
        wx.showToast({ title: successTitle, icon: 'success' })
      }
    } else {
      wx.showModal({
        title: '操作失败',
        content: reason || '课表数据没有更新，请稍后重试',
        showCancel: false,
        confirmText: '知道了',
      })
    }
    if (ok) {
      // 数据已变化，清空旧预览并刷新最近备份信息。
      this.setData({
        recentBackupInfo: this.buildRecentBackupInfo(),
        envelope: null,
        preview: null,
        previewErrors: [],
        inputText: '',
        needsTerm: false,
      })
    } else {
      this.setData({ recentBackupInfo: this.buildRecentBackupInfo() })
    }
  },
})
