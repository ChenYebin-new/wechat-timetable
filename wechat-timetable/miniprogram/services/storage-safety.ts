/** 比较微信 Storage 中可序列化值的完整结构。 */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isMissingStoredValue(value: unknown): boolean {
  return value === '' || value === null || value === undefined
}

/** 原样恢复一个 Storage key，并回读确认恢复结果。 */
export function restoreStorageKey(key: string, previous: unknown): boolean {
  try {
    if (isMissingStoredValue(previous)) wx.removeStorageSync(key)
    else wx.setStorageSync(key, previous)
    const reread = wx.getStorageSync(key)
    return isMissingStoredValue(previous)
      ? isMissingStoredValue(reread)
      : sameStoredValue(reread, previous)
  } catch {
    return false
  }
}
