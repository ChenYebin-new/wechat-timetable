/** 仅当前小程序会话有效；草稿不进入备份或 Storage。 */
export const unsavedDailyNotes = new Map<string, string>()
const goalDrafts = new Map<object, string>()
let revision = 0
let writeProblem = ''
let requestedDraftDate = ''

export function setGoalDraft(owner: object, date: string | null): void {
  if (date) goalDrafts.set(owner, date)
  else goalDrafts.delete(owner)
}

export function firstTodoDraftDate(): string {
  return goalDrafts.values().next().value || unsavedDailyNotes.keys().next().value || ''
}

export function requestTodoDraft(): void { requestedDraftDate = firstTodoDraftDate() }
export function takeRequestedDraftDate(): string {
  const date = requestedDraftDate
  requestedDraftDate = ''
  return date
}

export function todoRevision(): number { return revision }
export function markTodosReplaced(): void { revision += 1 }
export function todoWriteProblem(): string { return writeProblem }
export function lockTodoWrites(): void {
  writeProblem = '无法确认待办回滚结果，本次会话已暂停写入。请保留备份，重新启动小程序后检查数据。'
}
export function assertTodoWritable(): void {
  if (writeProblem) throw new Error(writeProblem)
}
