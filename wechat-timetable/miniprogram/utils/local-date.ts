function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 把本地自然日格式化为 YYYY-MM-DD，不经过 UTC 转换。 */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 解析 YYYY-MM-DD 为本地自然日；格式错误或日期不存在时返回 null。 */
export function parseLocalDate(value: string): Date | null {
  if (!value || typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return !Number.isNaN(date.getTime()) && formatLocalDate(date) === value ? date : null
}
