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
 *    the 45% resolved against the chat|note row (upstream used 36vw) — and,
 *    since 2026-11-26, it is BUDGETED: the lesser of that clamp and what
 *    leaves the notebook NOTE_MIN, floored at CHAT_HARD_FLOOR (the CSS is
 *    clamp(320px,min(clamp(480px,45%,800px),100% - 446px),800px)). Upstream
 *    never needs this: its three-column tier starts at 1240px of window.
 *
 * 模型:黑板栏恒 flex-1 吃剩余(不持久化);只持久化 课程栏/对话栏 两个宽
 * (localStorage,null=未定制=CSS 默认)。黑板栏没有硬 min-width(styles.ts ——
 * flex 兜不住的下限只会把它顶出屏幕),它的 440 由这里保护:默认宽走 CSS 的
 * 预算,拖拽宽走下面同一套预算 chatBudget = 黑板 NOTE_MIN + 对话栏自己那根
 * 6px 手柄。
 *
 * 行宽的口径(两个入口必须一致,否则松手瞬间回弹):容器 = 课程栏 + 手柄 +
 * [行:对话栏 + 手柄 + 黑板] —— 行内只有对话栏那根手柄,课程栏那根在行外。
 * 拖拽时量的是 .lks14-row 的真实宽;求解时行宽 = 容器宽 − rail − HANDLE_W
 * (不是 HANDLES_W:那会把行内的手柄再扣一次,预算凭空少 6px —— 探针抓到的
 * "存了 888、落定 882、黑板 446" 就是它)。
 */

/** 课程栏(rail)可调区间与默认宽。 */
export const RAIL_MIN = 240
export const RAIL_MAX = 480
export const RAIL_DEFAULT = 300
/** 对话栏(chat):预算宽裕时的拖拽下限(阅读黄金宽)与上限;硬底=默认宽在
 *  960–1100px 那一段的实际落点,也是挤压时的兜底(保布局不溢出优先于黄金宽)。 */
export const CHAT_MIN = 480
export const CHAT_MAX = 1100
export const CHAT_HARD_FLOOR = 320
/** 黑板栏的设计最小宽(CSS 里不再有 min-width,预算口径必须与 styles.ts 的
 *  "calc(100% - 446px)" 同源:NOTE_MIN + HANDLE_W)。 */
export const NOTE_MIN = 440
/** 一根手柄 6px;两条手柄都在容器宽里,但只有对话栏那根在 chat|note 行内。 */
export const HANDLE_W = 6
export const HANDLES_W = HANDLE_W * 2

const clampNum = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** 对话栏在行宽 rowW 下、黑板仍保有 NOTE_MIN 时的最大宽
 *  (rowW = .lks14-row 的宽 = 对话 + 自己的手柄 + 黑板,与 CSS 的 "100%" 同口径)。 */
export function chatBudget(rowW: number): number {
  return rowW - NOTE_MIN - HANDLE_W
}

/** 对话栏未定制时的默认宽数值形式(= styles.ts 的
 *  clamp(320px,min(clamp(480px,45%,800px),calc(100% - 446px)),800px) 在行宽 rowW 下)。 */
export function defaultChatWidth(rowW: number): number {
  return Math.max(CHAT_HARD_FLOOR, Math.min(clampNum(rowW * 0.45, CHAT_MIN, 800), chatBudget(rowW)))
}

/** 课程栏拖拽候选钳制:reserved = 对话栏有效宽 + NOTE_MIN + 两条手柄。 */
export function clampRailCandidate(next: number, containerW: number, reserved: number): number {
  return clampNum(next, RAIL_MIN, Math.min(RAIL_MAX, Math.max(RAIL_MIN, containerW - reserved)))
}

/** 对话栏拖拽候选钳制(rowW = .lks14-row 行宽,含对话栏自己那根手柄)。上限 = 预算
 *  (黑板保 NOTE_MIN),极端挤压允许压到硬底;下限在预算宽裕时是黄金宽 CHAT_MIN,
 *  预算吃紧时(rowW < 926)放开到硬底 —— 默认宽自己就落在 480 以下,手柄得跟得过去。 */
export function clampChatCandidate(next: number, rowW: number): number {
  const budget = chatBudget(rowW)
  const max = Math.min(CHAT_MAX, Math.max(CHAT_HARD_FLOOR, budget))
  const min = budget < CHAT_MIN ? CHAT_HARD_FLOOR : CHAT_MIN
  return clampNum(next, min, max)
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
  const z = (el?.closest('.lks14') as HTMLElement | null)?.style.zoom
  const n = z === undefined || z === '' ? NaN : Number(z)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * 渲染时有效宽度求解(持久化值 × 当前容器宽):拖拽钳制保证提交时刻不溢出,
 * 但宿主列后来变窄会破坏旧组合 —— 存储值按当前容器重新压回预算。
 * 返回 null = 未定制(挂 CSS 默认)。求解序 acyclic:rail 基准(默认 300 是
 * 常数)→ row 宽 → chat 默认(% 对 row)→ rail 预算按 chat 有效宽。
 * containerW 与两个存储宽都是布局 px(ResizeObserver / clientWidth 在缩放根
 * 内读到的就是布局 px —— 与拖拽路径除以 zoom 后同口径)。
 */
export function solvePaneWidths(
  railStored: number | null,
  chatStored: number | null,
  containerW: number,
): { rail: number | null; chat: number | null } {
  const railBasis = railStored ?? RAIL_DEFAULT
  // 行宽 = 容器 − rail − 课程栏那根手柄;对话栏自己的手柄在行内,由 chatBudget 扣
  const rowW = Math.max(0, containerW - railBasis - HANDLE_W)
  const chat = chatStored == null ? null : clampChatCandidate(chatStored, rowW)
  const chatBasis = chat ?? defaultChatWidth(rowW)
  const rail = railStored == null ? null : clampRailCandidate(railStored, containerW, chatBasis + NOTE_MIN + HANDLES_W)
  return { rail, chat }
}
