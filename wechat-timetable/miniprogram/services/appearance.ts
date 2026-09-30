import { DEFAULT_THEME, isThemeId, type ThemeId } from '../themes/index'
import { restoreStorageKey, sameStoredValue } from './storage-safety'

export const APPEARANCE_STORAGE_KEY = 'timetable_appearance'
export interface AppearancePreference { version: 1; themeId: ThemeId }
let currentTheme: ThemeId = DEFAULT_THEME
let initialized = false

export function decodeAppearance(value: unknown): ThemeId | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return record.version === 1 && isThemeId(record.themeId)
    && Object.keys(record).length === 2 ? record.themeId : null
}

/** Reads only the appearance key. Invalid/unknown data is never overwritten on startup. */
export function initializeAppearance(): ThemeId {
  try { currentTheme = decodeAppearance(wx.getStorageSync(APPEARANCE_STORAGE_KEY)) || DEFAULT_THEME }
  catch { currentTheme = DEFAULT_THEME }
  initialized = true
  return currentTheme
}

export function getCurrentThemeId(): ThemeId {
  return initialized ? currentTheme : initializeAppearance()
}

export function saveAppearance(themeId: ThemeId): void {
  if (!isThemeId(themeId)) throw new Error('请选择可用的外观')
  let previous: unknown
  try { previous = wx.getStorageSync(APPEARANCE_STORAGE_KEY) }
  catch { throw new Error('无法读取外观偏好，已保留当前外观，请重试') }
  const next: AppearancePreference = { version: 1, themeId }
  try {
    wx.setStorageSync(APPEARANCE_STORAGE_KEY, next)
    if (!sameStoredValue(wx.getStorageSync(APPEARANCE_STORAGE_KEY), next)) throw new Error('read-back')
  } catch {
    const restored = restoreStorageKey(APPEARANCE_STORAGE_KEY, previous)
    throw new Error(restored ? '外观保存失败，已保留当前外观，请重试' : '外观保存失败，当前外观未切换；重新打开后请检查外观设置')
  }
  currentTheme = themeId
  initialized = true
}
