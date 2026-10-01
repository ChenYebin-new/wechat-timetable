import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import './helpers/register-typescript.mjs'

let storage = new Map(), writes = [], nativeCalls = [], writeFailure = false, readFailure = false, corruptWrite = false
const pages = []
globalThis.Page = definition => pages.push(definition)
globalThis.wx = {
  getStorageSync(key) { if (readFailure) throw Error('read'); return storage.has(key) ? structuredClone(storage.get(key)) : '' },
  setStorageSync(key, value) { writes.push(key); if (writeFailure) throw Error('write'); storage.set(key, corruptWrite ? { broken: true } : structuredClone(value)); corruptWrite = false },
  removeStorageSync(key) { writes.push(key); storage.delete(key) },
  showShareMenu() {}, showToast() {},
  setNavigationBarColor(value) { nativeCalls.push(['nav', value]) },
  setBackgroundColor(value) { nativeCalls.push(['background', value]) },
  setTabBarStyle(value) { nativeCalls.push(['tab', value]) },
  setTabBarItem(value) { nativeCalls.push(['icon', value]) },
  navigateTo() {},
}
const themes = await import('../miniprogram/themes/index.ts')
const appearance = await import('../miniprogram/services/appearance.ts')
const bridge = await import('../miniprogram/utils/appearance-page.ts')
const layout = await import('../miniprogram/utils/timetable-layout.ts')
await import('../miniprogram/pages/appearance/index.ts')
await import('../miniprogram/pages/course-edit/index.ts')
await import('../miniprogram/pages/timetable/index.ts')
await import('../miniprogram/pages/todo/index.ts')
const [appearancePage, coursePage, timetablePage, todoPage] = pages
let grid
globalThis.Component = definition => { grid = definition }
await import('../miniprogram/components/timetable-grid/index.ts')
const KEY = appearance.APPEARANCE_STORAGE_KEY

function reset(value) {
  storage = new Map(value === undefined ? [] : [[KEY, value]])
  writes = []; nativeCalls = []; writeFailure = false; readFailure = false; corruptWrite = false
  appearance.initializeAppearance()
}
function page(definition, route) {
  return { ...definition, route, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch) } }
}
function course(overrides = {}) {
  return { id: 'math-1', groupId: 'math', name: '高等数学', color: '#abcdef', day: 1, startPeriod: 1, endPeriod: 2, weekMode: 'all', weeks: [1,2,3,4,5,6], createdAt: 1, updatedAt: 1, ...overrides }
}

test('A is the only default; missing, unknown and malformed preferences are read-only fallbacks', () => {
  for (const value of [undefined, '', null, [], 'campus', {version:2,themeId:'campus'}, {version:1,themeId:'old'}, {version:1,themeId:'cream',extra:true}]) {
    reset(value)
    const before = structuredClone([...storage])
    assert.equal(appearance.getCurrentThemeId(), 'paper')
    assert.deepEqual([...storage], before)
    assert.deepEqual(writes, [])
  }
  readFailure = true
  assert.equal(appearance.initializeAppearance(), 'paper')
})

test('known appearance survives restart; only the separate preference key is written', () => {
  reset()
  storage.set('timetable_courses', { original: 'courses' })
  storage.set('timetable_todos', { original: 'todos' })
  storage.set('timetable_todos_recent_backup', { original: 'backup' })
  const before = structuredClone([...storage])
  appearance.saveAppearance('campus')
  assert.equal(appearance.getCurrentThemeId(), 'campus')
  assert.equal(appearance.initializeAppearance(), 'campus')
  assert.deepEqual(storage.get(KEY), { version: 1, themeId: 'campus' })
  assert.deepEqual([...storage].filter(([key]) => key !== KEY), before)
  assert.deepEqual(writes, [KEY])
})

test('all existing explicit preferences, including C, survive the new A default', () => {
  for (const id of themes.THEME_IDS) {
    const preference = {version:1,themeId:id}
    reset(preference)
    assert.equal(appearance.getCurrentThemeId(), id)
    assert.equal(appearance.initializeAppearance(), id)
    assert.deepEqual(storage.get(KEY), preference)
    assert.deepEqual(writes, [])
  }
})

test('write/read-back failures retain active theme and restore original raw preference', () => {
  reset({version:1,themeId:'cream'})
  corruptWrite = true
  assert.throws(() => appearance.saveAppearance('campus'), /保存失败/)
  assert.deepEqual(storage.get(KEY), {version:1,themeId:'cream'})
  assert.equal(appearance.getCurrentThemeId(), 'cream')
  reset()
  corruptWrite = true
  assert.throws(() => appearance.saveAppearance('campus'), /保存失败/)
  assert.equal(storage.has(KEY), false)
  writeFailure = true
  assert.throws(() => appearance.saveAppearance('campus'), /保存失败/)
  readFailure = true
  assert.throws(() => appearance.saveAppearance('campus'), /无法读取/)
  assert.throws(() => appearance.saveAppearance('other'), /可用/)
})

test('unrecoverable preference failure is reported without switching in-memory theme', () => {
  reset({version:1,themeId:'campus'})
  writeFailure = true
  assert.throws(() => appearance.saveAppearance('cream'), /重新打开后请检查/)
  assert.equal(appearance.getCurrentThemeId(), 'campus')
})

test('fixed FNV-1a color slots are group-based, independent of identity text and legacy color', () => {
  assert.equal(themes.courseColorSlot({id:'unused',groupId:'hello'}), 0x4f9f2cab % 7)
  const original = course()
  const slot = themes.courseColorSlot(original)
  for (const changed of [course({id:'math-2',day:3}), course({name:'重命名',color:'#000000'}), course({startPeriod:5,endPeriod:6})]) {
    assert.equal(themes.courseColorSlot(changed), slot)
  }
  assert.equal(themes.courseColorSlot({id:'math'}), slot)
  assert.equal(themes.courseColorSlot({id:'数学😀'}), themes.courseColorSlot({id:'数学😀'}))
  assert.deepEqual(themes.getCourseAppearance(original,'cream'), themes.getCourseAppearance(course({color:'#FF0000'}),'cream'))
  assert.notEqual(themes.getCourseAppearance(original,'cream').background, themes.getCourseAppearance(original,'campus').background)
})

test('grid theme refresh retains row geometry, selection and source records while repainting cards', () => {
  const courses = [course(), course({ id: 'math-2', day: 3, startPeriod: 5, endPeriod: 6 })]
  const props = { themeId: 'cream', periods: Array.from({length:14},(_,i)=>({index:i+1})), daySlots: layout.buildDaySlots(courses), selectedKeys:['2-3'], disabledKeys:['1-1','1-2'] }
  const context = { properties: props, data: {}, ...grid.methods, setData(patch) { Object.assign(this.data,patch) } }
  const update = Object.values(grid.observers)[0]
  const source = structuredClone(props.daySlots)
  update.call(context)
  const before = structuredClone(context.data.columns)
  props.themeId = 'campus'
  update.call(context)
  assert.deepEqual(props.daySlots, source)
  assert.deepEqual(courses, [course(),course({id:'math-2',day:3,startPeriod:5,endPeriod:6})])
  for (let i=0;i<7;i++) {
    assert.deepEqual(context.data.columns[i].cells,before[i].cells)
    assert.equal(context.data.columns[i].cells.length,14)
    assert.deepEqual(context.data.columns[i].slots.map(s=>s.style),before[i].slots.map(s=>s.style))
  }
  const first=context.data.columns[0].slots[0], related=context.data.columns[2].slots[0]
  assert.notEqual(first.backgroundColor,before[0].slots[0].backgroundColor)
  assert.equal(first.backgroundColor,related.backgroundColor)
  assert.equal(first.backgroundColor,themes.getCourseAppearance(courses[0],'campus').background)
})

function luminance(hex) {
  const values = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
  return values[0]*.2126 + values[1]*.7152 + values[2]*.0722
}
function contrast(a,b) { const l=[luminance(a),luminance(b)].sort((x,y)=>y-x); return (l[0]+.05)/(l[1]+.05) }
test('all five palettes have seven accessible colors and tokenized readable controls', () => {
  for (const id of themes.THEME_IDS) {
    const theme = themes.THEMES[id]
    assert.equal(theme.courseColors.length,7)
    assert.equal(theme.courseBorders.length,7)
    for (const [front,back] of [['text','page'],['muted','surface'],['accent','soft'],['on-primary','primary'],['danger','danger-soft']]) {
      assert.ok(contrast(theme.tokens[front], theme.tokens[back]) >= 4.5, `${id}: ${front}/${back}`)
    }
    for(let i=0;i<80;i++) { const colors=themes.getCourseAppearance({id:`course-${i}`},id); assert.ok(contrast(colors.text,colors.background)>=4.5) }
    assert.match(themes.themeStyle(id),/--page:/)
    for(const icon of Object.values(theme.icons)) assert.ok(existsSync(new URL(`../miniprogram${icon}`,import.meta.url)))
  }
})

test('A B F can be previewed, applied and restored without changing business or backup storage', () => {
  for (const id of ['paper','swiss','pixel']) {
    reset({version:1,themeId:'campus'})
    const businessKeys=['timetable_courses','timetable_todos','timetable_recent_backup','timetable_todos_recent_backup']
    businessKeys.forEach((key,index)=>storage.set(key,{ untouched: index, color:'#aBcDeF', extra:['keep'] }))
    const businessBefore=businessKeys.map(key=>structuredClone(storage.get(key)))
    const context=page(appearancePage,'pages/appearance/index')
    context.onLoad({})
    context.onChoose({currentTarget:{dataset:{id}}})
    assert.equal(context.data.selectedTheme,id)
    assert.equal(context.data.themeId,'campus')
    assert.deepEqual(writes,[])
    context.onApply()
    assert.equal(context.data.themeId,id)
    assert.equal(appearance.initializeAppearance(),id)
    assert.deepEqual(storage.get(KEY),{version:1,themeId:id})
    assert.deepEqual(businessKeys.map(key=>storage.get(key)),businessBefore)
    assert.deepEqual(writes,[KEY])
  }
  for(const value of ['toString','constructor','dark','teal',null,{}])assert.equal(themes.isThemeId(value),false)
})

test('A B F repaint existing course groups without changing schedule coordinates or selections', () => {
  const source=layout.buildDaySlots([course(),course({id:'math-2',day:5,startPeriod:7,endPeriod:8})])
  const snapshot=structuredClone(source)
  for(const id of ['paper','swiss','pixel']) {
    const context={properties:{themeId:id,periods:Array.from({length:14},(_,i)=>({index:i+1})),daySlots:source,selectedKeys:['2-3'],disabledKeys:['1-1','1-2']},data:{},...grid.methods,setData(patch){Object.assign(this.data,patch)}}
    context.rebuildColumns()
    assert.deepEqual(source,snapshot)
    assert.equal(context.data.columns[1].cells[2].selected,true)
    assert.equal(context.data.columns[0].cells[0].disabled,true)
    assert.equal(context.data.columns[0].slots[0].backgroundColor,context.data.columns[4].slots[0].backgroundColor)
    for(let i=0;i<7;i++)assert.deepEqual(context.data.columns[i].slots.map(s=>s.style),source[i].map(s=>s.style))
  }
})

test('appearance preview is synthetic and does not apply until explicitly used', () => {
  reset()
  const context = page(appearancePage,'pages/appearance/index')
  context.onLoad({})
  context.onChoose({currentTarget:{dataset:{id:'campus'}}})
  assert.equal(context.data.selectedTheme,'campus')
  assert.equal(context.data.themeId,'paper')
  assert.equal(context.data.currentTheme,'paper')
  assert.equal(context.data.previewCourses.length,5)
  assert.deepEqual(writes,[])
  context.onChoose({currentTarget:{dataset:{id:'not-a-theme'}}})
  assert.equal(context.data.selectedTheme,'campus')
  context.onApply()
  assert.equal(context.data.currentTheme,'campus')
  assert.equal(context.data.themeId,'campus')
  assert.equal(context.data.saving,false)
  context.onApply()
  assert.deepEqual(writes,[KEY])
})

test('failed apply keeps the previous theme and preserves selected preview for retry', () => {
  reset()
  const context = page(appearancePage,'pages/appearance/index')
  context.onLoad({})
  context.onChoose({currentTarget:{dataset:{id:'campus'}}})
  writeFailure = true
  context.onApply()
  assert.equal(context.data.themeId,'paper')
  assert.equal(context.data.selectedTheme,'campus')
  assert.equal(context.data.saving,false)
  assert.match(context.data.problem,/保存失败/)
})

test('theme bridge changes presentation only, including retained drafts and calendar navigation', () => {
  reset()
  const context = page(todoPage,'pages/todo/index')
  const tabData = {}
  context.getTabBar = () => ({ setData(patch) { Object.assign(tabData, patch) } })
  Object.assign(context.data,{themeId:'cream',selectedDate:'2026-09-14',calendarMonth:'2026-10',calendarExpanded:true,title:'未保存目标',editorOpen:true,dailyNote:'未保存随想',dailyNoteDirty:true,noteSaveState:'error'})
  const before = structuredClone(context.data)
  appearance.saveAppearance('campus')
  bridge.syncAppearance(context)
  for(const key of ['selectedDate','calendarMonth','calendarExpanded','title','editorOpen','dailyNote','dailyNoteDirty','noteSaveState']) assert.deepEqual(context.data[key],before[key])
  assert.equal(context.data.themeId,'campus')
  assert.equal(tabData.themeId, 'campus')
  assert.equal(tabData.selected, 1)
  assert.equal(tabData.hidden, false)
  context.data.showShareHomePreview=true
  bridge.syncAppearance(context)
  assert.equal(context.data.themeId,'paper')
  assert.equal(tabData.hidden, true)
})

test('course editor retains legacy color only for serialization; new courses use fixed compatibility color', () => {
  reset()
  const context=page(coursePage,'pages/course-edit/index')
  context.applyCourse(course({color:'#aBcDeF'}),1)
  assert.equal('color' in context.data,false)
  assert.equal('colors' in context.data,false)
  appearance.saveAppearance('campus')
  bridge.syncAppearance(context)
  assert.equal(context.buildCourse().color,'#aBcDeF')
  assert.equal(context.data.name,'高等数学')
  const fresh=page(coursePage,'pages/course-edit/index')
  assert.equal(fresh.buildCourse().color,'#0ea5a4')
})

test('settings return preserves viewed week, clamps shortened term and repositions a changed start date', () => {
  reset()
  const fixture={schemaVersion:5,term:{startDate:'2026-09-07',totalWeeks:18},courses:[course()],periodSettings:{durationMinutes:50,breakMinutes:10,firstStart:'08:00',overrides:[],periods:[{start:'08:00',end:'08:50'},{start:'09:00',end:'09:50'}]}}
  storage.set('timetable_courses',fixture)
  const context=page(timetablePage,'pages/timetable/index')
  Object.assign(context.data,{currentWeek:8,termStartDate:'2026-09-07'})
  context.onSettings()
  appearance.saveAppearance('campus')
  context.onShow()
  assert.equal(context.data.currentWeek,8)
  assert.equal(context.data.themeId,'campus')
  fixture.term.totalWeeks=6
  context.onSettings()
  context.onShow()
  assert.equal(context.data.currentWeek,6)
  fixture.term.startDate='2030-09-02'
  context.onSettings()
  context.onShow()
  assert.equal(context.data.currentWeek,1)
  assert.equal(context.data.preserveSettingsWeek,false)
  assert.deepEqual(writes,[KEY])
})

test('all routes initialize/resume theme, isolated grids get explicit theme, and no old color selection remains', () => {
  const config=JSON.parse(readFileSync(new URL('../miniprogram/app.json',import.meta.url),'utf8'))
  assert.equal(config.pages.length,12)
  for(const route of config.pages) {
    const source=readFileSync(new URL(`../miniprogram/${route}.ts`,import.meta.url),'utf8')
    const markup=readFileSync(new URL(`../miniprogram/${route}.wxml`,import.meta.url),'utf8')
    assert.match(source,/appearanceData\(/,route)
    assert.match(source,/onShow\(\)\s*{\s*syncAppearance\(this\)/,route)
    assert.match(source,/onReady\(\)\s*{\s*syncAppearance\(this\)/,route)
    assert.match(markup,/page-meta page-style="{{appearanceStyle}}/,route)
    assert.match(markup,/class="page theme-{{themeId}}/,route)
    for(const grid of markup.matchAll(/<timetable-grid[^>]+>/g)) assert.match(grid[0],/theme-id="{{themeId}}" appearance-style="{{appearanceStyle}}"/)
  }
  const edit=readFileSync(new URL('../miniprogram/pages/course-edit/index.wxml',import.meta.url),'utf8')
  assert.doesNotMatch(edit,/onColor|选择颜色|class="colors"/)
  assert.equal(layout.computeCardStyle(course()),'top: 4rpx; height: 240rpx;')
})
