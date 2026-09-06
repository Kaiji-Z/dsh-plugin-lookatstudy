/**
 * VENDORED from LookatStudy v0.28.0 (src/renderer/lib/mapLayout.ts) — verbatim.
 * Provenance: https://github.com/Upston-Liu/LookatStudy, dark-first port round
 * 2026-09-06; upstream file is pure (zero imports) and test-frozen there
 * (verify-map-layout T11). Only the module docblock moves into this header.
 *
 * mapLayout —— 选关地图节点布局引擎(纯函数,易测易调)。
 *
 * v0.6:从"三布局模式 + 手动切换器"重做为单一"漂浮气球"布局。
 * 节点像飘在空中的气球,位置带轻微种子确定性抖动(用 section id 哈希),
 * 每次渲染位置完全一致,不会乱跳,但又不整齐规整。
 * 连接用下垂的贝塞尔绳子(模拟重力),不再是 S 形箭头。
 *
 * 坐标系:相对章节容器左上角(0,0),x 横向 y 纵向,单位 px。
 * 节点尺寸:球 56px(w-14 h-14),卡片宽 110px(含名字)。
 */

/** 单个节点的布局结果(相对章节容器)。 */
export interface NodeLayout {
  /** 节点中心 x(px,相对章节容器左上) */
  x: number
  /** 节点中心 y(px,相对章节容器左上) */
  y: number
  /** 该节点在 lessons 数组里的索引 */
  index: number
}

/** 两节点间的连接段(供 SVG path 绘制)。 */
export interface PathSegment {
  /** 起点(上一节点中心) */
  from: { x: number; y: number }
  /** 终点(下一节点中心) */
  to: { x: number; y: number }
  /** 段索引(from 节点的 index) */
  index: number
}

export interface SectionLayout {
  nodes: NodeLayout[]
  segments: PathSegment[]
  /** 该 section 容器所需高度(px)。贪心防重叠后按最后节点真实底边算,
   *  供 MapRail 精确设 minHeight / SVG height(不再用估算)。 */
  height: number
}

/** 容器宽度(章节内可用宽度,扣除 padding)。MapRail 章节容器 px-2。 */
const CONTAINER_WIDTH = 268 // 300px rail - padding
const NODE_RADIUS = 28 // w-14 h-14 = 56px,半径 28
const NODE_NAME_H = 20 // 球下方的 lesson 名字行高度
/** 节点可视盒高(球 56 + 名字 20)。**必须与 MapRail 渲染的 NODE_H 一致** —— 重叠判定基于此。 */
export const NODE_BOX_H = NODE_RADIUS * 2 + NODE_NAME_H // 76
/** 相邻节点中心最小纵向间距 = 盒高 + 呼吸。贪心推下保证 ≥ 此值 → 视觉永不重叠。 */
export const MIN_GAP_Y = NODE_BOX_H + 8 // 84
const NODE_SPACING_Y = 104 // 基线间距(略 > MIN_GAP_Y,多数情况无需推下,保持自然飘感)
const BALLOON_MARGIN = 18 // 气球左右留白(减小让抖动幅度更明显,不再呆板直线)
/** 首节点中心下限(防顶撞上方章节路牌)。MapRail 渲染偏移 +12 + NODE_H/2=38 → wrapper 顶 = y-26 ≥ 8。 */
const TOP_PAD = NODE_RADIUS + 6 // 34
/** y 轴抖动幅度(px)。贪心兜底后,jitter 不再是重叠源,仅负责高低参差。 */
const Y_JITTER = 26
/** 绳子下垂量(px,模拟重力)。让贝塞尔像被拽下来的绳子,而非 S 形箭头。 */
const ROPE_SAG = 22

/**
 * 确定性字符串哈希(FNV-1a 变体,32-bit)。
 * 同输入永远同输出 → 同一节点 id 每次渲染算出的抖动相同 → 气球位置稳定不跳。
 * 用于气球横向抖动 + bob 相位 + 星点位置 + 天体色切。
 */
export function hashStr(s: string): number {
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // 等价 h *= 16777619,用 Math.imul 避免 32-bit 溢出丢精度
    h = Math.imul(h, 0x01000193)
  }
  // 雪崩搅拌(avalanche finalizer):FNV-1a 对"末位递增"输入(seed:0, seed:1, seed:2…)
  // 输出近乎线性相关 → 相邻气球哈希接近 → 排成直线。加 xorshift + imul 搅拌彻底打散。
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * 算某 section 的气球节点坐标 + 绳子连接路径。
 * 容器高度由 nodes 数量决定(调用方据此设容器 min-height)。
 *
 * 抖动算法:v0.6 同时在 x 和 y 两轴抖动 → 气球真正"飘"在空中,
 * 不再是呆板的直线/微弯列。x 大幅抖动(用满容器宽度),y 在基线上下 ±Y_JITTER。
 * 两个独立哈希(x 用 seed:i,y 用 seed:i:y)→ 抖动方向不相关,分布更自然。
 *
 * v0.8 防重叠:抖动后跑一趟**贪心向下推**(确定性,只增 y,保持单调),
 *   1) 首节点中心不低于 TOP_PAD —— 防顶撞上方章节路牌;
 *   2) 相邻节点中心纵向距 ≥ MIN_GAP_Y(= 盒高 + 8px 呼吸)—— 视觉盒永不重叠。
 * 任何 seed / 任何课数都保证不重叠(verify-map-layout T11 跨 240 种子穷举验证)。
 */
export function computeBalloonLayout(
  lessonCount: number,
  containerWidth: number = CONTAINER_WIDTH,
  seed: string = '',
): SectionLayout {
  const nodes: NodeLayout[] = []
  const centerX = containerWidth / 2
  const maxDrift = containerWidth / 2 - BALLOON_MARGIN - NODE_RADIUS

  // 第一遍:基线 + 确定性抖动(x/y 双轴,两独立哈希 → 方向不相关,分布自然)
  for (let i = 0; i < lessonCount; i++) {
    const baseY = TOP_PAD + i * NODE_SPACING_Y
    // x 抖动:哈希归一化到 [-1,1],×maxDrift → 大幅左右飘
    const hx = hashStr(`${seed}:${i}`)
    const normX = (hx / 0xffffffff) * 2 - 1 // [-1, 1]
    const x = centerX + normX * maxDrift
    // y 抖动:另一独立哈希,±Y_JITTER 围绕基线 → 高低参差
    const hy = hashStr(`${seed}:${i}:y`)
    const normY = (hy / 0xffffffff) * 2 - 1 // [-1, 1]
    const y = baseY + normY * Y_JITTER
    nodes.push({ x, y, index: i })
  }

  // 第二遍:贪心防重叠(确定性,只向下推 → y 仍单调,与原 T4 不变量兼容)
  if (nodes.length > 0) {
    // 首节点下限:防顶撞章节路牌
    if (nodes[0]!.y < TOP_PAD) nodes[0]!.y = TOP_PAD
    // 相邻中心距 ≥ MIN_GAP_Y:用已定稿的前驱 y 推后继(级联正确)
    for (let i = 1; i < nodes.length; i++) {
      const minY = nodes[i - 1]!.y + MIN_GAP_Y
      if (nodes[i]!.y < minY) nodes[i]!.y = minY
    }
  }

  // 绳子段:相邻节点(用防重叠后的最终坐标)
  const segments: PathSegment[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    segments.push({ from: nodes[i]!, to: nodes[i + 1]!, index: i })
  }

  // 容器精确高度:最后节点底边 + 余量(供 MapRail 设 minHeight / SVG height)
  const height = nodes.length === 0
    ? 40
    : nodes[nodes.length - 1]!.y + NODE_BOX_H / 2 + 10

  return { nodes, segments, height }
}

/** 容器所需高度的**保守上界**估算。
 *  实际精确高度请用 `computeBalloonLayout(...).height`(贪心后按真实底边算)。
 *  本函数供拿不到 layout 的调用方做兜底估算;单调递增(verify T7)。 */
export function sectionHeight(lessonCount: number): number {
  if (lessonCount === 0) return 40
  return TOP_PAD + (lessonCount - 1) * MIN_GAP_Y + NODE_BOX_H / 2 + 10
}

/**
 * 两节点间的绳子贝塞尔(下垂)。
 * 控制点:y 中点 + ROPE_SAG(向下垂,模拟重力);x 用各自端点 x。
 * 比原 S 形软,像被拽下来的绳子。
 */
export function balloonSegmentToPath(seg: PathSegment): string {
  const { from, to } = seg
  const controlY = (from.y + to.y) / 2 + ROPE_SAG
  return `M ${from.x} ${from.y} C ${from.x} ${controlY}, ${to.x} ${controlY}, ${to.x} ${to.y}`
}
