import { appearanceData, syncAppearance } from '../../utils/appearance-page'
import { getCurrentThemeId, saveAppearance } from '../../services/appearance'
import { getCourseAppearance, isThemeId, THEMES, themeStyle, type ThemeId } from '../../themes/index'
import { initializeHomeSharing, shareHomeToFriend, shareHomeToTimeline } from '../../utils/share'

function previewData(id: ThemeId) {
  const theme = THEMES[id]
  return {
    selectedTheme: id, selectedName: theme.name, previewStyle: themeStyle(id), previewArt: theme.illustration,
    previewCourses: [
      { id: 'demo-math', name: '高等数学', room: 'A201', day: 0, period: 0 },
      { id: 'demo-code', name: '程序设计', room: 'C402', day: 1, period: 2 },
      { id: 'demo-physics', name: '大学物理', room: 'A108', day: 2, period: 0 },
      { id: 'demo-english', name: '大学英语', room: 'B305', day: 0, period: 4 },
      { id: 'demo-sport', name: '体育', room: '操场', day: 3, period: 4 },
    ].map(course => {
      const color = getCourseAppearance({ id: course.id, groupId: course.id }, id)
      return { ...course, style: `left:${course.day * 14.285714}%;top:${course.period * 38}rpx;background:${color.background};color:${color.text};` }
    }),
  }
}

Page({
  data: {
    ...appearanceData(), ...previewData(getCurrentThemeId()),
    currentTheme: getCurrentThemeId(), saving: false, problem: '', showShareHomePreview: false,
    choices: Object.values(THEMES).map(theme => ({ id: theme.id, name: theme.name, description: theme.description, style: themeStyle(theme.id), art: theme.illustration, colors: theme.courseColors.slice(0, 4) })),
    previewDays: ['一', '二', '三', '四', '五', '六', '日'],
    previewRows: [1, 2, 3, 4, 5, 6, 7, 8],
  },
  onLoad(options: Record<string, string | undefined>) {
    if (initializeHomeSharing(this, '/pages/appearance/index', options)) return
    const id = getCurrentThemeId()
    this.setData({ ...previewData(id), currentTheme: id })
    syncAppearance(this)
  },
  onShow() { syncAppearance(this) },
  onPageScroll(event: WechatMiniprogram.Page.IPageScrollOption) {
    this.selectComponent('.page-masthead')?.updateScroll(event.scrollTop)
  },

  onReady() { syncAppearance(this) },
  onShareAppMessage: shareHomeToFriend,
  onShareTimeline: shareHomeToTimeline,
  onChoose(e: WechatMiniprogram.TouchEvent) {
    const id: unknown = e.currentTarget.dataset.id
    if (!isThemeId(id) || this.data.saving) return
    this.setData({ ...previewData(id), problem: '' })
  },
  onApply() {
    if (this.data.saving || this.data.selectedTheme === this.data.currentTheme) return
    this.setData({ saving: true, problem: '' })
    try {
      saveAppearance(this.data.selectedTheme)
      this.setData({ currentTheme: this.data.selectedTheme })
      syncAppearance(this)
      wx.showToast({ title: '外观已更新', icon: 'success' })
    } catch (error) {
      this.setData({ problem: error instanceof Error ? error.message : '外观保存失败，请重试' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
