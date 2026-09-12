/**
 * PaneResizeHandle —— 栏间拖拽手柄(ported from upstream LookatStudy v0.29
 * issue #14, src/renderer/components/PaneResizeHandle.tsx @ v0.33.2, MIT —
 * adapted 2026-09-12; structural deviations recorded here):
 *  - the drag target is the handle's OWN previousElementSibling (the column it
 *    follows in the DOM), not a document.querySelector testid anchor;
 *  - rail widths apply through flex-basis (its class is flex:0 0 basis), chat
 *    widths through width (flex-basis:auto) — the side prop picks the channel;
 *  - on commit the parent's layout effect clears the inline width once the
 *    container-level CSS vars carry the truth (same paint, no flash), so this
 *    component only writes during the drag and hands over on finish.
 *
 * 命中区触屏 44px / 细指针 12px(styles.ts ::before);拖拽期宽度 imperative
 * 直写目标元素(对话栏是消息流整树,逐帧 setState 不可接受),100ms 节流,
 * 松手终值必达;双击 = 重置回响应式默认(清 inline + onCommit(null),类/clamp
 * 接管)。a11y:role=separator + aria-label;键盘调整不在本期范围。
 */
import { createElement, useEffect, useRef, useState } from 'react'
import { tr } from './locale.ts'
import { panelZoomOf } from './pane-resize.ts'

/** 拖拽中宽度应用节流(松手必应用终值,不受节流影响)。 */
const DRAG_APPLY_MIN_MS = 100

/** Inline width ← px;null clears it (class/var/CSS default takes over). */
function applyWidth(el: HTMLElement, side: 'rail' | 'chat', px: number | null): void {
  if (side === 'rail') el.style.flexBasis = px === null ? '' : `${String(px)}px`
  else el.style.width = px === null ? '' : `${String(px)}px`
}

export function PaneResizeHandle(props: {
  side: 'rail' | 'chat'
  /** 实时钳制(容器感知,pane-resize 纯函数;父级组装 reserved 预算)。 */
  clampLive: (px: number) => number
  /** 松手提交(px=终值;null=双击重置)。 */
  onCommit: (px: number | null) => void
}) {
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number; lastAppliedAt: number; targetEl: HTMLElement } | null>(null)
  /** props 进 effect 闭包会滞后:拖拽全程用 ref 取最新。 */
  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    if (!dragging) return
    document.body.classList.add('pane-dragging')
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current
      if (d == null) return
      const now = performance.now()
      if (now - d.lastAppliedAt < DRAG_APPLY_MIN_MS) return
      d.lastAppliedAt = now
      applyWidth(d.targetEl, propsRef.current.side, propsRef.current.clampLive(d.startW + (e.clientX - d.startX)))
    }
    const finish = (e: PointerEvent): void => {
      const d = dragRef.current
      dragRef.current = null
      setDragging(false)
      if (d == null) return
      d.targetEl.style.transition = ''
      // 终值必达:节流窗内松手也按全程位移结算
      const finalW = propsRef.current.clampLive(d.startW + (e.clientX - d.startX))
      applyWidth(d.targetEl, propsRef.current.side, finalW)
      propsRef.current.onCommit(finalW)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      document.body.classList.remove('pane-dragging')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [dragging])

  const startDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const target = (e.currentTarget as HTMLElement).previousElementSibling
    if (!(target instanceof HTMLElement)) return
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      // rect returns VISUAL px under the panel's font-zoom; widths apply in
      // LAYOUT px — normalize through the zoom factor or drags skew at 0.9/1.1
      startW: target.getBoundingClientRect().width / panelZoomOf(target),
      lastAppliedAt: 0,
      targetEl: target,
    }
    target.style.transition = 'none' // 宽度 transition 拖拽中不跟手 → 关
    setDragging(true)
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // 合成事件无活跃指针 id(测试)会抛 InvalidPointerId:window 兜底监听已够
    }
  }

  return createElement('div', {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': props.side === 'rail' ? tr('pane.rail.aria') : tr('pane.chat.aria'),
    'data-tooltip': tr('pane.tip'),
    'data-testid': `pane-handle-${props.side}`,
    'data-dragging': dragging ? 'true' : undefined,
    className: 'lks14-panehandle',
    onPointerDown: startDrag,
    onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => {
      // dragRef 已随 pointerup 清空 —— 从事件现场重找目标栏,清 inline 后交给父级
      const target = (e.currentTarget as HTMLElement).previousElementSibling
      if (target instanceof HTMLElement) applyWidth(target, props.side, null)
      props.onCommit(null)
    },
  })
}
