// components/timetable-grid/index.ts
import { DAYS, GRID_HOLD_DURATION_MS, PERIODS } from '../../constants/timetable'
import { cellKey } from '../../utils/grid-selection'
import type { TimetableCardItem } from '../../utils/timetable-layout'

interface GridCellItem {
  key: string
  day: number
  period: number
  selected: boolean
  disabled: boolean
}

interface GridColumnItem {
  day: number
  slots: TimetableCardItem[]
  cells: GridCellItem[]
}

interface HoldState {
  timer: ReturnType<typeof setTimeout> | null
  key: string
  ignoreTapKey: string
  ignoreTapUntil: number
  startX: number
  startY: number
}

const holdStates = new WeakMap<object, HoldState>()

function getHoldState(instance: object): HoldState {
  let state = holdStates.get(instance)
  if (!state) {
    state = { timer: null, key: '', ignoreTapKey: '', ignoreTapUntil: 0, startX: 0, startY: 0 }
    holdStates.set(instance, state)
  }
  return state
}

function clearHoldTimer(instance: object): void {
  const state = holdStates.get(instance)
  if (!state) return
  if (state.timer !== null) clearTimeout(state.timer)
  state.timer = null
  state.key = ''
}

Component({
  properties: {
    daySlots: {
      type: Array,
      value: [] as TimetableCardItem[][],
      observer: 'rebuildColumns',
    },
    selectionMode: {
      type: Boolean,
      value: false,
    },
    selectedKeys: {
      type: Array,
      value: [] as string[],
      observer: 'rebuildColumns',
    },
    disabledKeys: {
      type: Array,
      value: [] as string[],
      observer: 'rebuildColumns',
    },
    holdEnabled: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    days: DAYS,
    periods: PERIODS,
    columns: [] as GridColumnItem[],
    pressingKey: '',
  },

  lifetimes: {
    attached() {
      this.rebuildColumns()
    },
    detached() {
      clearHoldTimer(this)
      holdStates.delete(this)
    },
  },

  methods: {
    rebuildColumns() {
      const selected = new Set(this.properties.selectedKeys as string[])
      const disabled = new Set(this.properties.disabledKeys as string[])
      const daySlots = this.properties.daySlots as TimetableCardItem[][]
      const columns = DAYS.map((_, dayIndex) => ({
        day: dayIndex + 1,
        slots: daySlots[dayIndex] || [],
        cells: PERIODS.map((period) => {
          const key = cellKey(dayIndex + 1, period.index)
          return {
            key,
            day: dayIndex + 1,
            period: period.index,
            selected: selected.has(key),
            disabled: disabled.has(key),
          }
        }),
      }))
      this.setData({ columns })
    },

    onCardTap(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string
      this.triggerEvent(this.properties.selectionMode ? 'occupiedtap' : 'cardtap', { id })
    },

    onCellTouchStart(e: WechatMiniprogram.TouchEvent) {
      if (!this.properties.holdEnabled || this.properties.selectionMode) return
      if (e.currentTarget.dataset.disabled) return
      const touch = e.touches[0]
      if (!touch) return
      const state = getHoldState(this)
      clearHoldTimer(this)
      state.key = e.currentTarget.dataset.key as string
      state.startX = touch.clientX
      state.startY = touch.clientY
      this.setData({ pressingKey: state.key })
      state.timer = setTimeout(() => {
        const key = state.key
        clearHoldTimer(this)
        state.ignoreTapKey = key
        state.ignoreTapUntil = Date.now() + 600
        this.setData({ pressingKey: '' })
        this.triggerEvent('cellhold', {
          key,
          day: Number(e.currentTarget.dataset.day),
          period: Number(e.currentTarget.dataset.period),
        })
      }, GRID_HOLD_DURATION_MS)
    },

    onCellTouchMove(e: WechatMiniprogram.TouchEvent) {
      const state = getHoldState(this)
      if (state.timer === null) return
      const touch = e.touches[0]
      if (!touch) return
      if (Math.abs(touch.clientX - state.startX) > 12 || Math.abs(touch.clientY - state.startY) > 12) {
        clearHoldTimer(this)
        this.setData({ pressingKey: '' })
      }
    },

    onCellTouchEnd() {
      clearHoldTimer(this)
      this.setData({ pressingKey: '' })
    },

    onCellTap(e: WechatMiniprogram.TouchEvent) {
      const state = getHoldState(this)
      const key = e.currentTarget.dataset.key as string
      if (state.ignoreTapKey === key && Date.now() <= state.ignoreTapUntil) {
        state.ignoreTapKey = ''
        state.ignoreTapUntil = 0
        return
      }
      state.ignoreTapKey = ''
      state.ignoreTapUntil = 0
      if (!this.properties.selectionMode) return
      if (e.currentTarget.dataset.disabled && !e.currentTarget.dataset.selected) {
        this.triggerEvent('occupiedtap')
        return
      }
      this.triggerEvent('celltap', {
        key,
        day: Number(e.currentTarget.dataset.day),
        period: Number(e.currentTarget.dataset.period),
      })
    },
  },
})
