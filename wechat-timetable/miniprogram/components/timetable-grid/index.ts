// components/timetable-grid/index.ts
import { Course } from '../../models/course'
import { DAYS, GRID_HOLD_DURATION_MS, PERIODS } from '../../constants/timetable'
import { cellKey } from '../../utils/grid-selection'

interface CardItem {
  id: string
  course: Course
  style: string
}

interface GridCellItem {
  key: string
  day: number
  period: number
  selected: boolean
  disabled: boolean
}

interface GridColumnItem {
  day: number
  slots: CardItem[]
  cells: GridCellItem[]
}

let holdTimer: ReturnType<typeof setTimeout> | null = null
let holdKey = ''
let ignoreTapKey = ''
let ignoreTapUntil = 0
let holdStartX = 0
let holdStartY = 0

function clearHoldTimer(): void {
  if (holdTimer !== null) clearTimeout(holdTimer)
  holdTimer = null
  holdKey = ''
}

Component({
  properties: {
    daySlots: {
      type: Array,
      value: [] as CardItem[][],
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
      clearHoldTimer()
    },
  },

  methods: {
    rebuildColumns() {
      const selected = new Set(this.properties.selectedKeys as string[])
      const disabled = new Set(this.properties.disabledKeys as string[])
      const daySlots = this.properties.daySlots as CardItem[][]
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
      clearHoldTimer()
      holdKey = e.currentTarget.dataset.key as string
      holdStartX = touch.clientX
      holdStartY = touch.clientY
      this.setData({ pressingKey: holdKey })
      holdTimer = setTimeout(() => {
        const key = holdKey
        clearHoldTimer()
        ignoreTapKey = key
        ignoreTapUntil = Date.now() + 600
        this.setData({ pressingKey: '' })
        this.triggerEvent('cellhold', {
          key,
          day: Number(e.currentTarget.dataset.day),
          period: Number(e.currentTarget.dataset.period),
        })
      }, GRID_HOLD_DURATION_MS)
    },

    onCellTouchMove(e: WechatMiniprogram.TouchEvent) {
      if (holdTimer === null) return
      const touch = e.touches[0]
      if (!touch) return
      if (Math.abs(touch.clientX - holdStartX) > 12 || Math.abs(touch.clientY - holdStartY) > 12) {
        clearHoldTimer()
        this.setData({ pressingKey: '' })
      }
    },

    onCellTouchEnd() {
      clearHoldTimer()
      this.setData({ pressingKey: '' })
    },

    onCellTap(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as string
      if (ignoreTapKey === key && Date.now() <= ignoreTapUntil) {
        ignoreTapKey = ''
        ignoreTapUntil = 0
        return
      }
      ignoreTapKey = ''
      ignoreTapUntil = 0
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
