// components/timetable-grid/index.ts
import { Course } from '../../models/course'
import { DAYS, PERIODS } from '../../constants/timetable'

interface CardItem {
  id: string
  course: Course
  style: string
}

Component({
  properties: {
    cards: {
      type: Array,
      value: [] as CardItem[],
    },
  },

  data: {
    days: DAYS,
    periods: PERIODS,
  },

  methods: {
    onCardTap(e: WechatMiniprogram.TouchEvent) {
      const id = e.currentTarget.dataset.id as string
      this.triggerEvent('cardtap', { id })
    },
  },
})
