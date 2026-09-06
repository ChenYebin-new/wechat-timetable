// pages/data-manage/index.ts
import { ImportPreview, TimetableBackupEnvelope } from '../../models/backup'
import {
  analyzeBackup,
  exportBackup,
  getRecentBackup,
  mergeFromBackup,
  overwriteFromBackup,
  parseBackup,
  restoreRecentBackup,
} from '../../services/backup-service'

interface RecentBackupInfo {
  savedAtText: string
  schemaVersion: number
  count: number
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
}

Page({
  data: {
    inputText: '',
    envelope: null as TimetableBackupEnvelope | null,
    preview: null as ImportPreview | null,
    previewErrors: [] as string[],
    recentBackupInfo: null as RecentBackupInfo | null,
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
    const json = exportBackup()
    wx.setClipboardData({
      data: json,
      success: () => wx.showToast({ title: '已复制课表 JSON', icon: 'success' }),
    })
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ inputText: e.detail.value })
  },

  onParse() {
    const parsed = parseBackup(this.data.inputText)
    if (!parsed.ok) {
      this.setData({ envelope: null, preview: null, previewErrors: [parsed.reason || '解析失败'] })
      return
    }
    const analyzed = analyzeBackup(parsed.envelope as TimetableBackupEnvelope)
    if (!analyzed.ok) {
      this.setData({ envelope: null, preview: null, previewErrors: analyzed.errors })
      return
    }
    this.setData({
      envelope: parsed.envelope as TimetableBackupEnvelope,
      preview: analyzed.preview as ImportPreview,
      previewErrors: [],
    })
  },

  confirm(message: string, onOk: () => void) {
    wx.showModal({
      title: '二次确认',
      content: message,
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
    this.confirm(
      `将用备份中的 ${preview ? preview.backupCount : 0} 门课程替换当前 ${preview ? preview.currentCount : 0} 门课程。此操作不可撤销（会先自动备份当前课表）。`,
      () => {
        const r = overwriteFromBackup(envelope)
        this.afterMutation(r.ok, r.reason)
      },
    )
  },

  onMerge() {
    const envelope = this.data.envelope
    const preview = this.data.preview
    if (!envelope) return
    this.confirm(
      `将把备份中没有重复、没有冲突的课程合并进当前课表（预计新增 ${preview ? preview.mergeAddCount : 0} 门）。`,
      () => {
        const r = mergeFromBackup(envelope)
        this.afterMutation(r.ok, r.reason, r.ok ? `已合并，新增 ${r.added} 门` : '合并失败')
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
      `将用最近备份（V${info.schemaVersion}，${info.count} 门课程）替换当前课表。此操作不可撤销（会先自动备份当前课表）。`,
      () => {
        const r = restoreRecentBackup()
        this.afterMutation(r.ok, r.reason)
      },
    )
  },

  afterMutation(ok: boolean, reason?: string, successMsg = '已保存') {
    if (ok) {
      wx.showToast({ title: successMsg, icon: 'success' })
    } else {
      wx.showToast({ title: reason || '操作失败', icon: 'none' })
    }
    // 数据已变化，清空解析结果以促使重新解析；刷新最近备份信息。
    this.setData({
      recentBackupInfo: this.buildRecentBackupInfo(),
      envelope: null,
      preview: null,
      previewErrors: [],
      inputText: '',
    })
  },
})
