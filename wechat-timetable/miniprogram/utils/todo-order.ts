import type { TodoItem } from '../models/todo'

/** Storage 中的数组顺序就是手动顺序；按完成状态分区时保留组内顺序。 */
export function todosForDate(items: TodoItem[], date: string): TodoItem[] {
  const daily = items.filter((item) => item.taskDate === date)
  return [...daily.filter((item) => !item.completed), ...daily.filter((item) => item.completed)]
}

export interface TodoRowRect {
  top: number
  height: number
}

/** 以实际行高和间距计算插入位置，所有坐标均为页面坐标。 */
export function todoDragLayout(rows: TodoRowRect[], source: number, first: number, last: number, offset: number) {
  const row = rows[source]
  const minOffset = rows[first].top - row.top
  const maxOffset = rows[last].top + rows[last].height - row.height - row.top
  const bounded = Math.max(minOffset, Math.min(maxOffset, offset))
  let target = source
  if (bounded > 0) {
    for (let index = source + 1; index <= last; index += 1) {
      if (row.top + row.height + bounded > rows[index].top + rows[index].height / 2) target = index
    }
  } else if (bounded < 0) {
    for (let index = source - 1; index >= first; index -= 1) {
      if (row.top + bounded < rows[index].top + rows[index].height / 2) target = index
    }
  }
  const order = Array.from({ length: last - first + 1 }, (_, index) => first + index)
  order.splice(source - first, 1)
  order.splice(target - first, 0, source)
  const offsets = rows.map(() => 0)
  const gap = first < last ? Math.max(0, rows[first + 1].top - rows[first].top - rows[first].height) : 0
  let top = rows[first].top
  for (const index of order) {
    offsets[index] = top - rows[index].top
    top += rows[index].height + gap
  }
  return { target, offsets, minOffset, maxOffset }
}
