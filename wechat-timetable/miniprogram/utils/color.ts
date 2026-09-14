// utils/color.ts
// 依据背景色亮度自动选择可读的文字颜色，避免课程卡片白字在浅色背景上看不清。

export function getContrastText(hexColor: string): string {
  const hex = hexColor.replace('#', '')
  if (hex.length < 6) return '#ffffff'
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const channels = [r, g, b].map((value) => {
    const normalized = value / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4)
  })
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]

  // 0.179 是黑、白文字对比度相等的 WCAG 分界点；取较强一侧可保证至少 4.5:1。
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
