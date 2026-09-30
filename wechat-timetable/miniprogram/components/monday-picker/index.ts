import { buildMondayPickerState, changeMondayPickerColumn, resolveMondayPickerDate } from '../../utils/monday-picker'
import { DEFAULT_THEME } from '../../themes/index'

Component({
  properties: {
    themeId: { type: String, value: DEFAULT_THEME },
    appearanceStyle: { type: String, value: '' },
    value: { type: String, value: '', observer: 'resetSelection' },
  },
  data: {
    picker: buildMondayPickerState(''),
  },
  lifetimes: {
    attached() {
      this.resetSelection()
    },
  },
  methods: {
    resetSelection() {
      this.setData({ picker: buildMondayPickerState(this.properties.value) })
    },
    onColumnChange(e: WechatMiniprogram.PickerColumnChange) {
      const { column, value } = e.detail
      this.setData({ picker: changeMondayPickerColumn(this.data.picker, column, value) })
    },
    onConfirm(e: WechatMiniprogram.PickerChange) {
      const value = resolveMondayPickerDate(this.data.picker, e.detail.value)
      if (!value) {
        this.resetSelection()
        return
      }
      this.setData({ picker: buildMondayPickerState(value) })
      this.triggerEvent('change', { value })
    },
  },
})
