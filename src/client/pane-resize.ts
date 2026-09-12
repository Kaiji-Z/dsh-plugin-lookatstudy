/**
 * pane-resize —— 三栏拖拽调宽的纯函数层(ported from upstream LookatStudy
 * v0.29 issue #14, src/renderer/lib/pane-resize.ts @ v0.33.2, MIT — adapted
 * 2026-09-12; structural deviations recorded here):
 *  - budgets key off the PANEL container's own width (ResizeObserver), not
 *    window.innerWidth — the panel is a guest in the host's center column and
 *    its narrow mode is a container query, so the panel box IS the viewport;
 *  - no tier system: the wide layout always shows all three columns (exam
 *    rides INSIDE the chat column), and the narrow layout hides the handles
 *    entirely (container query in styles.ts);
 *  - the chat default mirrors the base sheet's clamp(480px,45%,800px), with
 *    the 45% resolved against the chat|note row (upstream used 36vw).
 *
 * 模型:黑板栏恒 flex-1 吃剩余(不持久化);只持久化 课程栏/对话栏 两个宽
 * (localStorage,null=未定制=CSS 默认)。三栏 shrink-0/flex-1 的宽度和超过
 * 容器时黑板栏被顶出屏幕(flex 兜不住),所以拖拽实时钳制与渲染期求解共用
 * 同一套预算:reserved = 其余栏最小宽之和(黑板 440 + 对侧有效宽 + 手柄)。
 */

/** 课程栏(rail)可调区间与默认宽。 */
export const RAIL_MIN = 240
export const RAIL_MAX = 480
export const RAIL_DEFAULT = 300
/** 对话栏(chat)可调区间;硬底=容器极端挤压时的兜底(保布局不溢出优先于保阅读黄金宽)。 */
export const CHAT_MIN = 480
export const CHAT_MAX = 1100
export const CHAT_HARD_FLOOR = 320
/** 黑板栏 flex-1 的 min-w(与样式表 .lks14-note 同源,预算口径必须一致)。 */
export const NOTE_MIN = 440
/** 两条手柄各 6px,预算里要算上。 */
export const HANDLES_W = 12

const clampNum = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** 对话栏未定制时的默认宽数值形式(= clamp(480px,45%,800px) 在 rowW 下;rowW = 容器宽 − rail 有效宽)。 */
export function defaultChatWidth(rowW: number): number {
  return clampNum(rowW * 0.45, CHAT_MIN, 800)
}

/** 课程栏拖拽候选钳制:reserved = 对话栏有效宽 + NOTE_MIN + 手柄。 */
export function clampRailCandidate(next: number, containerW: number, reserved: number): number {
  return clampNum(next, RAIL_MIN, Math.min(RAIL_MAX, Math.max(RAIL_MIN, containerW - reserved)))
}

/** 对话栏拖拽候选钳制:reserved = 课程栏有效宽 + NOTE_MIN;极端挤压允许压到硬底。 */
export function clampChatCandidate(next: number, rowW: number, reserved: number): number {
  return clampNum(next, CHAT_MIN, Math.min(CHAT_MAX, Math.max(CHAT_HARD_FLOOR, rowW - reserved)))
}

/** 存储值解析:空/非数/超区间 → null(回默认;历史脏值不硬吃)。 */
export function parseStoredWidth(v: string | null | undefined, min: number, max: number): number | null {
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return Math.round(n)
}

/**
 * The panel root's font-zoom factor (E7 zoom scales the px-fixed layout) —
 * getBoundingClientRect returns VISUAL px under zoom while flex-basis/width
 * apply in LAYOUT px, so every drag measurement divides by this (upstream had
 * no zoom; this is the one place our port must normalize).
 */
export function panelZoomOf(el: HTMLElement | null): number {
  const z = el?.closest('.lks14')?.style.zoom
  const n = z === undefined || z === '' ? NaN : Number(z)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * 渲染时有效宽度求解(持久化值 × 当前容器宽):拖拽钳制保证提交时刻不溢出,
 * 但宿主列后来变窄会破坏旧组合 —— 存储值按当前容器重新压回预算。
 * 返回 null = 未定制(挂 CSS 默认)。求解序 acyclic:rail 基准(默认 300 是
 * 常数)→ row 宽 → chat 默认(% 对 row)→ rail 预算按 chat 有效宽。
 */
export function solvePaneWidths(
  railStored: number | null,
  chatStored: number | null,
  containerW: number,
): { rail: number | null; chat: number | null } {
  const railBasis = railStored ?? RAIL_DEFAULT
  const rowW = Math.max(0, containerW - railBasis - HANDLES_W)
  const chat = chatStored == null ? null : clampChatCandidate(chatStored, rowW, NOTE_MIN)
  const chatBasis = chat ?? defaultChatWidth(rowW)
  const rail = railStored == null ? null : clampRailCandidate(railStored, containerW, chatBasis + NOTE_MIN + HANDLES_W)
  return { rail, chat }
}
