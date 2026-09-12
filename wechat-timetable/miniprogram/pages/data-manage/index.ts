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
import { getStorageSnapshot } from '../../services/course-storage'
import { DEFAULT_TOTAL_WEEKS, MAX_TOTAL_WEEKS } from '../../constants/timetable'
import { currentMonday, validateTerm } from '../../utils/term'

interface RecentBackupInfo {
  savedAtText: string
  schemaVersion: number
  groupCount: number
  segmentCount: number
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
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
      groupCount: Array.isArray(rb.export.data.courses)
        ? new Set(rb.export.data.courses.map((course) => 'groupId' in course ? course.groupId : course.id)).size
        : 0,
      segmentCount: Array.isArray(rb.export.data.courses) ? rb.export.data.courses.length : 0,
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
    const snapshot = getStorageSnapshot()
    if (snapshot.kind === 'io-error') {
      this.setData({ envelope: null, preview: null, previewErrors: [snapshot.reason], needsTerm: false })
      return
    }
    const analyzed = analyzeBackup(parsed.envelope as TimetableBackupEnvelope, snapshot.data)
    if (!analyzed.ok) {
      this.setData({ envelope: null, preview: null, previewErrors: analyzed.errors, needsTerm: false })
      return
    }
    const needsTerm = analyzed.needsTerm === true
    const term = snapshot.data.term
    this.setData({
      envelope: parsed.envelope as TimetableBackupEnvelope,
      preview: analyzed.preview as ImportPreview,
      previewErrors: [],
      needsTerm,
      termStartDate: term ? term.startDate : currentMonday(),
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
        title: '设置无效',
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
      '覆盖确认',
      `将用备份中的 ${preview ? preview.backupGroupCount : 0} 门课程（${preview ? preview.backupCount : 0} 个时段）替换当前 ${preview ? preview.currentGroupCount : 0} 门课程。继续前会自动保存当前课表，之后可在本页恢复。`,
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
    if (preview && !preview.mergeAllowed) {
      wx.showModal({
        title: '无法合并',
        content: preview.mergeReason || '当前课表与备份不满足合并条件',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    let termArg: TermSettings | undefined
    if (this.data.needsTerm) {
      termArg = this.buildImportTerm()
      if (!termArg) return
    }
    this.confirm(
      '合并课表',
      `将按整门课程合并备份（预计新增 ${preview ? preview.mergeAddGroupCount : 0} 门、${preview ? preview.mergeAddCount : 0} 个时段）。任一时段重复或冲突时会跳过整门课程。`,
      '确认合并',
      () => {
        const r = mergeFromBackup(envelope, termArg)
        this.afterMutation(
          r.ok,
          r.reason,
          '合并完成',
          r.ok
            ? `新增 ${r.addedGroups || 0} 门课程（${r.added || 0} 个时段），整门跳过重复 ${r.skippedDuplicateGroups || 0} 门、冲突 ${r.skippedConflictGroups || 0} 门；当前共 ${r.finalGroupCount || 0} 门课程（${r.finalCount || 0} 个时段）。`
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
      '恢复确认',
      `将用最近备份（V${info.schemaVersion}，${info.groupCount} 门课程、${info.segmentCount} 个时段）替换当前课表。继续前会自动保存当前课表，之后仍可在本页恢复。`,
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
