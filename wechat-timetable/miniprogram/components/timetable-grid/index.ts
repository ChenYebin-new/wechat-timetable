import { getCourseAppearance, isThemeId, DEFAULT_THEME } from '../../themes/index'
// components/timetable-grid/index.ts
import { DAYS, GRID_HOLD_DURATION_MS } from '../../constants/timetable'
import type { PeriodView } from '../../constants/timetable'
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
  slots: (TimetableCardItem & { backgroundColor: string; textColor: string; borderColor: string })[]
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
    themeId: { type: String, value: DEFAULT_THEME },
    appearanceStyle: { type: String, value: '' },
    periods: {
      type: Array,
      value: [] as PeriodView[],
    },
    daySlots: {
      type: Array,
      value: [] as TimetableCardItem[][],
    },
    selectionMode: {
      type: Boolean,
      value: false,
    },
    selectedKeys: {
      type: Array,
      value: [] as string[],
    },
    disabledKeys: {
      type: Array,
      value: [] as string[],
    },
    holdEnabled: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    days: DAYS,
    columns: [] as GridColumnItem[],
    pressingKey: '',
  },

  observers: {
    'themeId, periods, daySlots, selectedKeys, disabledKeys'() {
      this.rebuildColumns()
    },
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

  pageLifetimes: {
    hide() { this.onCellTouchEnd() },
  },

  methods: {
    rebuildColumns() {
      const selected = new Set(this.properties.selectedKeys as string[])
      const disabled = new Set(this.properties.disabledKeys as string[])
      const daySlots = this.properties.daySlots as TimetableCardItem[][]
      const columns = DAYS.map((_, dayIndex) => ({
        day: dayIndex + 1,
        slots: (daySlots[dayIndex] || []).map(item => {
          const colors = getCourseAppearance(item.course, isThemeId(this.properties.themeId) ? this.properties.themeId : DEFAULT_THEME)
          return { ...item, backgroundColor: colors.background, textColor: colors.text, borderColor: colors.border }
        }),
        cells: (this.properties.periods as PeriodView[]).map((period) => {
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
      const state = getHoldState(this)
      state.ignoreTapKey = ''
      state.ignoreTapUntil = 0
      if (!this.properties.holdEnabled || this.properties.selectionMode) return
      if (e.currentTarget.dataset.disabled) return
      const touch = e.touches[0]
      if (!touch) return
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
      const state = getHoldState(this)
      if (state.ignoreTapKey) state.ignoreTapUntil = Date.now() + 600
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
