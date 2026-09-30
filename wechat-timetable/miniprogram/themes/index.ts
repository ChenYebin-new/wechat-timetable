import type { Course } from '../models/course'
import { getContrastText } from '../utils/color'
import { PAPER_TEXTURE } from './paper-texture'
import { PIXEL_FRAME, PIXEL_COURSE_FRAME } from './pixel-frame'

export type ThemeId = 'cream' | 'campus' | 'paper' | 'swiss' | 'pixel'
export const THEME_IDS: readonly ThemeId[] = ['cream', 'campus', 'paper', 'swiss', 'pixel']
export const DEFAULT_THEME: ThemeId = 'paper'

export interface ThemeDefinition {
  id: ThemeId
  name: string
  description: string
  tokens: Record<string, string>
  courseColors: readonly string[]
  courseBorders: readonly string[]
  illustration: string
  icons: {
    calendar: string; todo: string; neutralCalendar: string; neutralTodo: string
    settings: string; term: string
    backupExport: string; backupImport: string; backupRecent: string; backupEmpty: string
    brand: string; goal: string; journal: string
    menuAppearance: string; menuTerm: string; menuTime: string; menuData: string; menuBackup: string
  }
}

const shared = {
  'font-family': "-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft Yahei',sans-serif",
  'page-texture': 'none',
  'font-numeric': "Arial,'Helvetica Neue',sans-serif",
  'danger': '#A72F35', 'danger-soft': '#FDEBEC', 'warning': '#82511E',
  'warning-soft': '#FFF0D9', 'success': '#23723F', 'on-dark': '#FFFFFF',
  'radius': '24rpx', 'radius-small': '18rpx', 'card-radius': '16rpx',
  'font-body': '28rpx', 'font-title': '36rpx', 'font-small': '24rpx',
  'weight-title': '700', 'shadow': '0 4rpx 14rpx rgba(38, 44, 52, 0.04)',
}

function icons(id: ThemeId): ThemeDefinition['icons'] {
  if (id === 'paper' || id === 'swiss' || id === 'pixel') {
    const asset = (name: string) => `/assets/appearance/${name}-${id}.svg`
    return { calendar: asset('calendar').replace('.svg','-accent.svg'), todo: asset('todo').replace('.svg','-accent.svg'),
      neutralCalendar: asset('calendar'), neutralTodo: asset('todo'), settings: asset('settings'), term: asset('calendar'),
      backupExport: asset('export'), backupImport: asset('import'), backupRecent: asset('clock'), backupEmpty: asset('document'),
      brand: asset('book').replace('.svg','-accent.svg'), goal: id === 'paper' ? '/assets/appearance/paper-sprig.png' : asset('todo'),
      journal: id === 'paper' ? '/assets/appearance/paper-sprig.png' : asset('book'),
      menuAppearance: asset('palette'), menuTerm: asset(id === 'swiss' ? 'book' : 'calendar'), menuTime: asset('clock'), menuData: asset('data'), menuBackup: asset('todo') }
  }
  return {
    calendar: `/assets/appearance/calendar-${id}.svg`, todo: `/assets/appearance/todo-${id}.svg`,
    neutralCalendar: '/assets/appearance/calendar-neutral.svg', neutralTodo: '/assets/appearance/todo-neutral.svg',
    settings: `/assets/appearance/settings-${id}.svg`, term: '/assets/appearance/book-campus.svg',
    backupExport: `/assets/appearance/export${id === 'campus' ? '-campus' : ''}.svg`,
    backupImport: `/assets/appearance/import${id === 'campus' ? '-campus' : ''}.svg`,
    backupRecent: `/assets/appearance/recent${id === 'campus' ? '-campus' : ''}.svg`,
    backupEmpty: '/assets/appearance/backup-empty.svg',
    brand: '/assets/appearance/book-campus.svg', goal: '/assets/appearance/target.svg', journal: '/assets/appearance/journal.svg',
    menuAppearance: '/assets/appearance/palette.svg', menuTerm: `/assets/appearance/${id === 'cream' ? 'cream-term' : 'book'}.svg`,
    menuTime: `/assets/appearance/${id === 'cream' ? 'cream-time' : 'clock'}.svg`,
    menuData: `/assets/appearance/${id === 'cream' ? 'cream-data' : 'campus-data'}.svg`,
    menuBackup: `/assets/appearance/${id === 'cream' ? 'cream-backup' : 'campus-backup'}.svg`,
  }
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  cream: {
    id: 'cream', name: '奶油积木', description: '奶油底色与柔和彩块，轻快又耐看。',
    tokens: {
      ...shared, 'page': '#FFFAF2', 'surface': '#FFFCF7', 'soft': '#FFF0E1',
      'text': '#151D2B', 'muted': '#69717F', 'accent': '#AE460E',
      'primary': '#FF914D', 'on-primary': '#482309', 'selected': '#FFD8B5',
      'border': '#EBE3D8', 'disabled': '#E9E7E4', 'selection-bar': '#603916',
      'selection-muted': '#FFE7CE', 'input': '#F7F3EC', 'grid-head': '#FCF6ED',
      'grid-line': '#F0E9DF', 'grid-time': '#596273',
      'icon-export-bg': '#FFD1B0', 'icon-import-bg': '#C9E4FF', 'icon-recent-bg': '#E3D5FD',
    },
    courseColors: ['#FFC796', '#D9C9F5', '#BBDCF7', '#FFE08A', '#CBE7D5', '#F4C8D3', '#E8D9C3'],
    courseBorders: ['#D8A374', '#B09CCF', '#91B6D4', '#C9AC58', '#9DBEAA', '#CB9BA8', '#BFAF94'],
    illustration: '', icons: icons('cream'),
  },
  campus: {
    id: 'campus', name: '校园晴日', description: '天空蓝与校园绿，让每一天更明亮。',
    tokens: {
      ...shared, 'page': '#E7F7FF', 'surface': '#FFFFFF', 'soft': '#EAF8EF',
      'text': '#122344', 'muted': '#536785', 'accent': '#21803B',
      'primary': '#23833C', 'on-primary': '#FFFFFF', 'selected': '#B8E8BE',
      'border': '#DCECF5', 'disabled': '#DFE7EE', 'selection-bar': '#214D37',
      'selection-muted': '#DDF5E5', 'input': '#F2F9FE', 'grid-head': '#EDF9FF',
      'grid-line': '#E2F0F7', 'grid-time': '#536785',
      'icon-export-bg': '#DAF6D9', 'icon-import-bg': '#FFF0B4', 'icon-recent-bg': '#D5E9FD',
    },
    courseColors: ['#C1EDB6', '#BEE4FB', '#FFE790', '#FFD5C4', '#C7E6DC', '#DED5F7', '#F6D7E7'],
    courseBorders: ['#92C887', '#8DBDDA', '#C9AC56', '#D8A38D', '#95BDAF', '#B3A6CE', '#CBA4BA'],
    illustration: '/assets/appearance/campus-header.jpg', icons: icons('campus'),
  },
  paper: {
    id: 'paper', name: '纸上拾课', description: '暖纸、墨字与砖红，像随身翻开的手账。',
    tokens: { ...shared, 'font-family': "'Songti SC','STSong','SimSun','Noto Serif CJK SC',serif", 'font-numeric': "'Times New Roman',Georgia,serif", 'page-texture': PAPER_TEXTURE,
      'page':'#F7F3EB','surface':'#F9F6EF','soft':'#EEE7DB','text':'#2E2923','muted':'#6A6257','accent':'#923F2C',
      'primary':'#994A36','on-primary':'#FFFFFF','selected':'#E7C9BA','border':'#D6CBB9','disabled':'#E1DED7',
      'selection-bar':'#674334','selection-muted':'#F9E8D8','input':'#FAF7F1','grid-head':'#F0EADF','grid-line':'#D8CDBB','grid-time':'#62594B',
      'radius':'8rpx','radius-small':'6rpx','card-radius':'6rpx','icon-export-bg':'#EEE7DB','icon-import-bg':'#EEE7DB','icon-recent-bg':'#EEE7DB' },
    courseColors:['#E9CFC4','#F1DEB7','#D7DDCA','#D0DCE0','#E1D4E2','#E2DCCF','#D2DFD6'],
    courseBorders:['#CEAEA1','#D4BA86','#B2BBA4','#ADC0C9','#C0B0C2','#BFB4A6','#ACC1B2'],
    illustration:'', icons:icons('paper'),
  },
  swiss: {
    id:'swiss',name:'秩序之间',description:'黑白网格、醒目周次与朱红，清晰有序。',
    tokens:{ ...shared,'page':'#FFFFFF','surface':'#FFFFFF','soft':'#F1F1F1','text':'#111111','muted':'#585858','accent':'#C82415',
      'primary':'#E32A17','on-primary':'#FFFFFF','selected':'#FFDCD6','border':'#797979','disabled':'#E2E2E2',
      'selection-bar':'#202020','selection-muted':'#EEEEEE','input':'#FFFFFF','grid-head':'#FFFFFF','grid-line':'#707070','grid-time':'#222222',
      'radius':'0rpx','radius-small':'0rpx','card-radius':'0rpx','icon-export-bg':'#FFFFFF','icon-import-bg':'#FFFFFF','icon-recent-bg':'#FFFFFF' },
    courseColors:['#FADAD5','#FFF1D1','#E7E7E7','#E7E7E7','#D5E5DC','#DCE8F2','#EBE0F1'],
    courseBorders:['#E32A17','#E7AD10','#6A6A6A','#6A6A6A','#448A61','#467AAB','#986CA2'],
    illustration:'',icons:icons('swiss'),
  },
  pixel: {
    id:'pixel',name:'像素课间',description:'钴蓝描边、像素校园与明亮色块，课间有趣。',
    tokens:{ ...shared,'page':'#FFFAEF','surface':'#FFFDF7','soft':'#EAF3FF','text':'#092572','muted':'#506395','accent':'#073CCD',
      'primary':'#0952ED','on-primary':'#FFFFFF','selected':'#B9DFFF','border':'#8BB9F1','disabled':'#D5DAE5',
      'selection-bar':'#073CCD','selection-muted':'#E5EFFF','input':'#FFFFFF','grid-head':'#EDF5FF','grid-line':'#A4D0F5','grid-time':'#173B83',
      'pixel-frame':PIXEL_FRAME,'pixel-course-frame':PIXEL_COURSE_FRAME,'radius':'0rpx','radius-small':'2rpx','card-radius':'0rpx','icon-export-bg':'#FFFDF7','icon-import-bg':'#FFFDF7','icon-recent-bg':'#FFFDF7' },
    courseColors:['#B8E0F5','#D9F3B8','#F8CDD6','#FFE5A4','#DECEF8','#CFDFF6','#FFD2AB'],
    courseBorders:['#1243D8','#1243D8','#1243D8','#1243D8','#1243D8','#1243D8','#1243D8'],
    illustration:'/assets/appearance/pixel-campus.png',icons:icons('pixel'),
  },
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.includes(value as ThemeId)
}

export function themeStyle(id: ThemeId): string {
  return Object.entries(THEMES[id].tokens).map(([key, value]) => `--${key}:${value}`).join(';') + ';'
}

/** Fixed FNV-1a over UTF-16 code units; independent of course order, date and name. */
export function courseColorSlot(course: Pick<Course, 'id'> & { groupId?: string }): number {
  const key = course.groupId || course.id
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0
  }
  return hash % 7
}

export function getCourseAppearance(course: Pick<Course, 'id'> & { groupId?: string }, themeId: ThemeId) {
  const slot = courseColorSlot(course)
  const theme = THEMES[themeId]
  const background = theme.courseColors[slot]
  return { slot, background, text: getContrastText(background), border: theme.courseBorders[slot] }
}
