import { getCurrentThemeId } from '../services/appearance'
import { DEFAULT_THEME, THEMES, themeStyle, type ThemeId } from '../themes/index'

export function appearanceData(id: ThemeId = getCurrentThemeId()) {
  const theme = THEMES[id]
  return {
    themeId: id, appearanceStyle: themeStyle(id), appearanceName: theme.name,
    appearanceArt: theme.illustration, appearanceIcons: theme.icons,
  }
}

interface AppearancePage {
  data: { themeId?: string; showShareHomePreview?: boolean }
  route?: string
  getTabBar?: () => { setData(data: Record<string, unknown>): void } | undefined
  setData(data: ReturnType<typeof appearanceData>): void
}

/** Updates presentation fields only. Never reloads business state or remounts the page. */
export function syncAppearance(page: AppearancePage): void {
  const id = page.data.showShareHomePreview ? DEFAULT_THEME : getCurrentThemeId()
  if (page.data.themeId !== id) page.setData(appearanceData(id))
  page.getTabBar?.()?.setData({ ...appearanceData(id), selected: page.route === 'pages/todo/index' ? 1 : 0, hidden: !!page.data.showShareHomePreview })
  syncNativeAppearance(id)
}

export function syncNativeAppearance(id: ThemeId): void {
  const theme = THEMES[id]
  const ignoreFailure = () => { /* Retry on next onReady/onShow; do not disturb user input. */ }
  wx.setNavigationBarColor?.({ frontColor: '#000000', backgroundColor: theme.tokens.page, fail: ignoreFailure })
  wx.setBackgroundColor?.({ backgroundColor: theme.tokens.page, backgroundColorTop: theme.tokens.page, backgroundColorBottom: theme.tokens.page, fail: ignoreFailure })
}
