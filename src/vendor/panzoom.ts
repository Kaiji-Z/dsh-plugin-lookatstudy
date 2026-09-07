// Vendored from LookatStudy src/renderer/lib/panzoom.ts (MIT License,
// https://github.com/Kaiji-Z/LookatStudy) — verbatim pure math; the canvas
// pan/zoom single source of truth (why transform beats scroll-viewports is
// documented upstream). P14.
/**
 * panzoom —— 画布式 pan/zoom 的纯数学(单一真源,verify-panzoom 直测)。
 *
 * 为什么不用滚动视口(scrollLeft/scrollTop + 内容重排):缩放时内容尺寸/居中
 * margin 都在变,滚动补偿和重排互相打架 → 真机上捏合抖动、像"放大不动"
 * (实测事故)。画布式:内容保持自然尺寸,一个 transform: translate(x,y) scale(s)
 * 包打天下 —— 缩放锚定手势中点/光标,数学上"手指下的点不动",零布局耦合。
 */

export interface PanZoomTransform {
  x: number;
  y: number;
  scale: number;
}

/** 适屏(contain)缩放:内容完整装进视口(留 padding 边距),不超出 1。 */
export function fitScale(contentW: number, contentH: number, viewW: number, viewH: number, padding = 24): number {
  if (contentW <= 0 || contentH <= 0 || viewW <= 0 || viewH <= 0) return 1;
  const s = Math.min((viewW - padding * 2) / contentW, (viewH - padding * 2) / contentH, 1);
  return Math.max(0.02, s);
}

/** 适屏位姿:居中。 */
export function fitTransform(contentW: number, contentH: number, viewW: number, viewH: number, padding = 24): PanZoomTransform {
  const scale = fitScale(contentW, contentH, viewW, viewH, padding);
  return {
    scale,
    x: (viewW - contentW * scale) / 2,
    y: (viewH - contentH * scale) / 2,
  };
}

/**
 * 锚点缩放:factor>1 放大。锚点 (ax,ay) 是视口坐标 —— 缩放后锚点对准的内容点
 * 保持不动(标准图像查看器数学:new = anchor - (anchor - old) * factor)。
 */
export function zoomAt(t: PanZoomTransform, factor: number, ax: number, ay: number): PanZoomTransform {
  return {
    scale: t.scale * factor,
    x: ax - (ax - t.x) * factor,
    y: ay - (ay - t.y) * factor,
  };
}

/**
 * 平移钳制:内容不会被拖到完全离屏 —— 至少留 `keep`(默认 64px)可见,
 * 且内容小于视口时不允许拖走(保持居中观感)。
 */
export function clampPan(t: PanZoomTransform, contentW: number, contentH: number, viewW: number, viewH: number, keep = 64): PanZoomTransform {
  const w = contentW * t.scale;
  const h = contentH * t.scale;
  let { x, y } = t;
  if (w <= viewW) {
    x = (viewW - w) / 2; // 内容比视口窄:锁定居中
  } else {
    x = Math.min(Math.max(x, viewW - w - keep), keep);
  }
  if (h <= viewH) {
    y = (viewH - h) / 2;
  } else {
    y = Math.min(Math.max(y, viewH - h - keep), keep);
  }
  return { x, y, scale: t.scale };
}

/** 钳制缩放(先算锚点缩放,再夹 scale 到 [min,max],再钳平移)。 */
export function zoomAtClamped(
  t: PanZoomTransform,
  factor: number,
  ax: number,
  ay: number,
  bounds: { min: number; max: number; contentW: number; contentH: number; viewW: number; viewH: number },
): PanZoomTransform {
  const target = t.scale * factor;
  const clampedFactor = Math.min(Math.max(target, bounds.min), bounds.max) / t.scale;
  if (clampedFactor === 1) return t;
  return clampPan(zoomAt(t, clampedFactor, ax, ay), bounds.contentW, bounds.contentH, bounds.viewW, bounds.viewH);
}
