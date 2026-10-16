import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import './helpers/register-typescript.mjs'
const { todoDragLayout } = await import('../miniprogram/utils/todo-order.ts')

const source = readFileSync(new URL('../miniprogram/pages/todo/drag.wxs', import.meta.url), 'utf8')
function gesture() {
  const module = { exports: {} }
  runInNewContext(source, { module }, { filename: 'todo-drag.wxs' })
  const state = {}
  const calls = []
  const rows = Array.from({ length: 3 }, () => ({ style: {}, setStyle(value) { Object.assign(this.style, value) } }))
  const owner = {
    getState: () => state,
    selectAllComponents: () => rows,
    callMethod(name, value) { calls.push({ name, value: structuredClone(value) }) },
  }
  const event = (y = 100, options = {}) => ({
    currentTarget: { dataset: { id: 'a', draggable: options.draggable ?? true } },
    touches: options.touches ?? [{ identifier: 0, clientX: 30, clientY: y }],
    changedTouches: [{ identifier: 0, clientX: 30, clientY: y }],
  })
  return { api: module.exports, state, calls, rows, owner, event }
}

test('不同行高与间距按实际几何让位，上下拖动均限制在本组', () => {
  const rows = [{ top: 100, height: 50 }, { top: 160, height: 120 }, { top: 290, height: 80 }, { top: 380, height: 60 }]
  const down = todoDragLayout(rows, 0, 0, 2, 10000)
  assert.equal(down.target, 2)
  assert.deepEqual(down.offsets, [220, -60, -60, 0])
  assert.equal(down.maxOffset, 220)
  const up = todoDragLayout(rows, 2, 0, 2, -10000)
  assert.equal(up.target, 0)
  assert.deepEqual(up.offsets, [90, 90, -190, 0])
  assert.equal(up.minOffset, -190)
  assert.equal(todoDragLayout(rows, 1, 0, 2, 0).target, 1)
  assert.deepEqual(todoDragLayout(rows, 3, 3, 3, 500).offsets, [0, 0, 0, 0])
})

test('普通轻点仍进入编辑；普通上下滑动不拦截滚动且不会误开编辑', () => {
  const g = gesture()
  assert.equal(g.api.touchStart(g.event(), g.owner), undefined)
  assert.equal(g.api.touchEnd(g.event(), g.owner), undefined)
  g.api.tap(g.event(), g.owner)
  assert.equal(g.calls.at(-1).name, 'onEdit')
  g.calls.length = 0
  g.api.touchStart(g.event(), g.owner)
  assert.equal(g.api.touchMove(g.event(130), g.owner), undefined)
  assert.equal(g.api.longPress(g.event(130), g.owner), undefined)
  g.api.touchEnd(g.event(130), g.owner)
  assert.equal(g.api.tap(g.event(130), g.owner), false)
  assert.deepEqual(g.calls, [])
})

test('长按后才拦截移动，渲染层跟手并计入页面滚动，松手不误编辑', () => {
  const g = gesture()
  g.api.touchStart(g.event(), g.owner)
  assert.equal(g.api.longPress(g.event(), g.owner), false)
  assert.equal(g.calls.at(-1).name, 'onTodoDragStart')
  g.api.layoutChanged({ active: true, token: 1, source: 0, offsets: [0, 0, 0], startY: 100, scrollDelta: 0, minOffset: 0, maxOffset: 200 }, null, g.owner)
  assert.equal(g.api.touchMove(g.event(150), g.owner), false)
  assert.equal(g.rows[0].style.transform, 'translateY(50px)')
  g.api.layoutChanged({ active: true, token: 1, source: 0, offsets: [0, -50, 0], startY: 100, scrollDelta: 40, minOffset: 0, maxOffset: 200 }, null, g.owner)
  assert.equal(g.rows[0].style.transform, 'translateY(90px)')
  assert.equal(g.rows[1].style.transform, 'translateY(-50px)')
  g.api.touchMove(g.event(900), g.owner)
  assert.equal(g.rows[0].style.transform, 'translateY(200px)')
  assert.equal(g.api.touchEnd(g.event(900), g.owner), false)
  assert.equal(g.calls.at(-1).name, 'onTodoDragEnd')
  assert.equal(g.api.tap(g.event(), g.owner), false)
  assert.ok(g.calls.every(call => call.name !== 'onEdit'))
  g.api.layoutChanged({ active: false }, null, g.owner)
  assert.ok(g.rows.every(row => row.style.transform === 'translateY(0px)'))
  g.api.touchStart(g.event(), g.owner)
  g.api.touchEnd(g.event(), g.owner)
  g.api.tap(g.event(), g.owner)
  assert.equal(g.calls.at(-1).name, 'onEdit')
})

test('多指触摸及系统中断取消拖动；单条或编辑状态不启动拖动', () => {
  for (const cancel of ['touchCancel', 'touchMove', 'touchStart']) {
    const g = gesture()
    g.api.touchStart(g.event(), g.owner)
    g.api.longPress(g.event(), g.owner)
    g.api[cancel](g.event(100, { touches: [{ identifier: 0 }, { identifier: 1 }] }), g.owner)
    assert.equal(g.calls.at(-1).name, 'onTodoDragCancel')
    g.api.touchEnd(g.event(), g.owner)
    assert.equal(g.calls.filter(call => call.name === 'onTodoDragEnd').length, 0)
    assert.equal(g.api.tap(g.event(), g.owner), false)
  }
  const g = gesture()
  g.api.touchStart(g.event(), g.owner)
  assert.equal(g.api.longPress(g.event(100, { draggable: false }), g.owner), undefined)
  assert.equal(g.api.touchMove(g.event(120), g.owner), undefined)
  assert.deepEqual(g.calls, [])
})

test('页面取消后恢复正常滚动，迟到或其它页面的位移不会重启手势', () => {
  const first = gesture()
  const second = gesture()
  first.api.touchStart(first.event(), first.owner)
  first.api.longPress(first.event(), first.owner)
  first.api.layoutChanged({ active: false }, null, first.owner)
  assert.equal(first.api.touchMove(first.event(200), first.owner), undefined)
  first.api.layoutChanged({ active: true, token: 1, source: 0, offsets: [200, 20, 30] }, null, first.owner)
  assert.ok(first.rows.every(row => row.style.transform === 'translateY(0px)'))
  assert.deepEqual(second.state, {})
})

test('松手后的位移继续落向插入位置，落位期间新触摸可以立即打断', () => {
  const g = gesture()
  g.api.touchStart(g.event(), g.owner)
  g.api.longPress(g.event(), g.owner)
  g.api.layoutChanged({ active: true, token: 1, source: 0, offsets: [0, -60, -60], startY: 100, scrollDelta: 0, minOffset: 0, maxOffset: 220 }, null, g.owner)
  g.api.touchMove(g.event(260), g.owner)
  assert.equal(g.rows[0].style.transition, 'none', '拖动卡片不加位置补间，保持跟手')
  assert.match(g.rows[1].style.transition, /220ms/)
  g.api.touchEnd(g.event(260), g.owner)
  g.api.layoutChanged({ active: true, settling: true, token: 1, source: 0, offsets: [220, -60, -60] }, null, g.owner)
  assert.equal(g.rows[0].style.transform, 'translateY(220px)')
  assert.match(g.rows[0].style.transition, /220ms/)
  g.api.touchStart(g.event(), g.owner)
  assert.equal(g.calls.at(-1).name, 'onTodoDropInterrupted')
  g.api.layoutChanged({ active: false }, null, g.owner)
  assert.ok(g.rows.every(row => row.style.transition === 'none'))
})

test('模拟器全零的结束坐标沿用最后移动点，避免松手排序跳回起点', () => {
  const g = gesture()
  g.api.touchStart(g.event(), g.owner)
  g.api.longPress(g.event(), g.owner)
  g.api.touchMove(g.event(240), g.owner)
  g.api.touchEnd({ changedTouches: [{ identifier: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0 }] }, g.owner)
  assert.equal(g.calls.at(-1).value.clientY, 240)
})

test('原生 WXS 属性观察器使用无连字符的属性名，动效表面和插槽都保留', () => {
  const markup = readFileSync(new URL('../miniprogram/pages/todo/index.wxml', import.meta.url), 'utf8')
  assert.match(markup, /draglayout="{{dragPresentation}}"\s+change:draglayout="{{todoDrag\.layoutChanged}}"/)
  assert.match(markup, /class="todo-surface"/)
  assert.match(markup, /style="{{dragSlotStyle}}"/)
})
