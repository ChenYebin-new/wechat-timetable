// Storage 仓库只负责原始课表快照的读写；版本识别、迁移与领域校验由上层处理。

import { STORAGE_KEY } from '../constants/timetable'

export type RawStorageReadResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string }

export function readTimetableRaw(): RawStorageReadResult {
  try {
    return { ok: true, value: wx.getStorageSync(STORAGE_KEY) }
  } catch (error) {
    const detail = error instanceof Error && error.message ? `：${error.message}` : ''
    return { ok: false, reason: `读取本地课表失败${detail}` }
  }
}

export function writeTimetableRaw(value: unknown): void {
  wx.setStorageSync(STORAGE_KEY, value)
}

export function clearTimetableRaw(): void {
  wx.removeStorageSync(STORAGE_KEY)
}
