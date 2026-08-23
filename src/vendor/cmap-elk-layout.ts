// Vendored from LookatStudy src/renderer/lib/cmap-elk-layout.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header (elkjs dynamic import target adapted to CDN).
/**
 * cmap-elk-layout —— 概念图 v2 布局(ELK layered,复合分组 + 正交路由)。
 *
 * v0.12 径向布局的视觉评审结论:空白与拥挤并存/边交叉/无层级,且交叉消解要靠
 * 自研启发式。v0.21 换 elkjs(draw.io 新版同款 Eclipse Layout Kernel):
 *   - 分组 = ELK 复合图(compound children):组容器盒 + 标题栏留白
 *   - 连线 = elk.edgeRouting ORTHOGONAL:直角折线绕开盒子,结构性消灭"线穿节点"
 *   - 分组来源:LLM show_concept_map 的可选 groups 字段;缺省/无效时客户端按
 *     邻接聚类兜底(clusterByAdjacency,确定性多源 BFS),不回头折腾 prompt
 *
 * 结构分层(全部可单测):
 *   resolveGroups / clusterByAdjacency / cmNodeBox / buildElkGraph —— 纯函数
 *   flattenElkResult —— 把 ELK 输出递归拍平成绝对坐标(复合嵌套只有一层)
 *   layoutConceptMap —— 异步管线,elkjs 走动态 import(lazy chunk,同 mermaid)
 *
 * CJK 估宽/两行包裹沿用 v0.12 已验证的实现(estTextWidth/wrapLabel 原样迁移)。
 * 全链确定性:输入序驱动 + ELK 无随机源,verify-artifact-cmap-v2 断言两次运行
 * 逐坐标全等。
 */

// ============================================================
// 数据类型(与 artifact-harness ConceptMapData 对齐,groups 为 v2 增列)
// ============================================================

export interface CmNode {
  id: string;
  label: string;
}
export interface CmEdge {
  from: string;
  to: string;
  label?: string;
}
export interface CmGroup {
  id: string;
  label: string;
  nodeIds: string[];
}

// ============================================================
// 文本度量(v0.12 迁移,CJK 感知)
// ============================================================

/** 字符宽度估算:CJK 全宽,ASCII 约 0.58em,其余(BBOP…)同 ASCII。 */
export function estTextWidth(text: string, fontSize = 13): number {
  let w = 0;
  for (const ch of text) w += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch) ? fontSize : fontSize * 0.58;
  return w;
}

const LINE_MAX_PX = 118;

/** 标签包裹:≤2 行;优先自然断点(空格///-),CJK 连续按宽度一半硬拆;仍超宽截断。 */
export function wrapLabel(label: string): string[] {
  if (estTextWidth(label) <= LINE_MAX_PX) return [label];
  const breaks: number[] = [];
  for (let i = 0; i < label.length; i++) {
    if (/[\s/\-—·]/.test(label[i] ?? "")) breaks.push(i);
  }
  const mid = label.length / 2;
  let split = -1;
  let best = Infinity;
  for (const b of breaks) {
    const d = Math.abs(b + 1 - mid);
    if (d < best) {
      best = d;
      split = b;
    }
  }
  let l1: string;
  let l2: string;
  if (split >= 0) {
    l1 = label.slice(0, split + 1).trim();
    l2 = label.slice(split + 1).trim();
  } else {
    let acc = 0;
    let idx = 0;
    for (const ch of label) {
      acc += estTextWidth(ch);
      idx++;
      if (acc >= estTextWidth(label) / 2) break;
    }
    l1 = label.slice(0, idx);
    l2 = label.slice(idx);
  }
  if (estTextWidth(l1) <= LINE_MAX_PX && estTextWidth(l2) <= LINE_MAX_PX) return [l1, l2];
  const fit = (s: string) => {
    let out = "";
    for (const ch of s) {
      if (estTextWidth(out + ch + "…") > LINE_MAX_PX) break;
      out += ch;
    }
    return out + "…";
  };
  return [estTextWidth(l1) > LINE_MAX_PX ? fit(l1) : l1, estTextWidth(l2) > LINE_MAX_PX ? fit(l2) : l2];
}

/** 节点盒:hub(度数最大或 ≥4)字号/内边距更大;宽高由包裹后行宽决定。 */
export function cmNodeBox(label: string, hub: boolean): { width: number; height: number; lines: string[] } {
  const lines = wrapLabel(label);
  const fs = hub ? 14 : 13;
  const textW = Math.max(...lines.map((l) => estTextWidth(l, fs)));
  const padX = hub ? 30 : 24;
  const lh = 17;
  const padY = hub ? 18 : 14;
  return {
    width: Math.min(hub ? 200 : 180, Math.max(hub ? 92 : 76, textW + padX)),
    height: padY + lines.length * lh,
    lines,
  };
}

// ============================================================
// 分组解析:LLM groups 优先,邻接聚类兜底
// ============================================================

export interface ResolvedGroups {
  groups: CmGroup[];
  /** true = 来自客户端聚类(LLM 未给/无效) */
  fallback: boolean;
}

/**
 * 净化 LLM groups:丢弃指向不存在节点的 nodeIds、去重(先到先得)、
 * 剩余成员 < 2 的组丢弃;唯一覆盖全部节点的单组视为无效(一个巨容器没有信息量)。
 * 净化后为空 → clusterByAdjacency 兜底。
 */
export function resolveGroups(nodes: CmNode[], edges: CmEdge[], input?: CmGroup[] | null): ResolvedGroups {
  const ids = new Set(nodes.map((n) => n.id));
  if (Array.isArray(input) && input.length > 0) {
    const assigned = new Set<string>();
    const groups: CmGroup[] = [];
    for (const g of input) {
      if (!g || typeof g.id !== "string" || !g.id) continue;
      const nodeIds = Array.isArray(g.nodeIds)
        ? [...new Set(g.nodeIds.filter((x) => typeof x === "string" && ids.has(x) && !assigned.has(x)))]
        : [];
      if (nodeIds.length < 2) continue;
      nodeIds.forEach((x) => assigned.add(x));
      groups.push({ id: g.id, label: typeof g.label === "string" && g.label ? g.label : "分组", nodeIds });
    }
    if (groups.length > 0 && !(groups.length === 1 && assigned.size === nodes.length && nodes.length > 2)) {
      return { groups, fallback: false };
    }
  }
  return { groups: clusterByAdjacency(nodes, edges), fallback: true };
}

/**
 * 邻接聚类兜底(确定性):度数 top-k 节点做种子(k = clamp(ceil(n/4),1,3)),
 * 多源 BFS 就近归属(平手先出现的种子赢);孤立节点不归组(根层漂浮,不造假组)。
 * 组名 = 种子标签(≤5 字加"相关")。
 */
export function clusterByAdjacency(nodes: CmNode[], edges: CmEdge[]): CmGroup[] {
  if (nodes.length < 4) return []; // 太小不分组
  const index = new Map(nodes.map((n, i) => [n.id, i] as const));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  const seenPair = new Set<string>();
  for (const e of edges) {
    if (!index.has(e.from) || !index.has(e.to) || e.from === e.to) continue;
    const key = [e.from, e.to].sort().join("→");
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const ranked = [...nodes].sort((a, b) => {
    const da = adj.get(a.id)!.length;
    const db = adj.get(b.id)!.length;
    return da !== db ? db - da : (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0);
  });
  const k = Math.min(3, Math.max(1, Math.ceil(nodes.length / 4)));
  const seeds = ranked.slice(0, k).filter((s) => (adj.get(s.id)?.length ?? 0) > 0);
  if (seeds.length === 0) return [];
  const owner = new Map<string, number>(); // nodeId → seed 下标
  seeds.forEach((s, si) => owner.set(s.id, si));
  const queue = seeds.map((s) => s.id);
  while (queue.length) {
    const cur = queue.shift()!;
    const si = owner.get(cur)!;
    for (const nb of adj.get(cur) ?? []) {
      if (owner.has(nb)) continue;
      owner.set(nb, si);
      queue.push(nb);
    }
  }
  const groups: CmGroup[] = [];
  seeds.forEach((s, si) => {
    const nodeIds = nodes.filter((n) => owner.get(n.id) === si).map((n) => n.id);
    if (nodeIds.length < 2) return;
    groups.push({
      id: `grp-${s.id}`,
      label: s.label.length <= 5 ? `${s.label}相关` : s.label,
      nodeIds,
    });
  });
  return groups;
}

// ============================================================
// ELK 图构建(纯函数,不触 elkjs —— 结构可脱离引擎直测)
// ============================================================

/** ELK JSON 的最小结构(只声明我们用到的字段;elkjs 原样吃任意附加字段)。 */
export interface ElkGraphJSON {
  id: string;
  layoutOptions?: Record<string, string>;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkGraphJSON[];
  edges?: {
    id: string;
    sources: string[];
    targets: string[];
    /** elkjs 在 hierarchyHandling=INCLUDE_CHILDREN 下把全部边挂到根,坐标属于 container 指向的容器 */
    container?: string;
    sections?: {
      startPoint: { x: number; y: number };
      endPoint: { x: number; y: number };
      bendPoints?: { x: number; y: number }[];
    }[];
  }[];
}

/** 组容器标题栏高度:ELK 组盒顶部 padding 要为标题留白。 */
export const GROUP_TITLE_PX = 34;

export function buildElkGraph(nodes: CmNode[], edges: CmEdge[], groups: CmGroup[]): ElkGraphJSON {
  const ids = new Set(nodes.map((n) => n.id));
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  const seenPair = new Set<string>();
  const drawEdges: CmEdge[] = [];
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const key = [e.from, e.to].sort().join("→");
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    drawEdges.push(e);
    degree.set(e.from, degree.get(e.from)! + 1);
    degree.set(e.to, degree.get(e.to)! + 1);
  }
  let hubId = nodes[0]?.id ?? "";
  for (const n of nodes) if ((degree.get(n.id) ?? 0) > (degree.get(hubId) ?? 0)) hubId = n.id;

  const inGroup = new Map<string, string>(); // nodeId → groupId
  for (const g of groups) for (const nid of g.nodeIds) if (ids.has(nid) && !inGroup.has(nid)) inGroup.set(nid, g.id);

  const nodeChild = (n: CmNode): ElkGraphJSON => {
    const box = cmNodeBox(n.label, n.id === hubId || (degree.get(n.id) ?? 0) >= 4);
    return { id: n.id, width: Math.ceil(box.width), height: Math.ceil(box.height) };
  };

  const children: ElkGraphJSON[] = [];
  for (const g of groups) {
    const members = g.nodeIds.filter((nid) => inGroup.get(nid) === g.id && ids.has(nid));
    if (members.length === 0) continue;
    children.push({
      id: `g:${g.id}`,
      layoutOptions: { "elk.padding": `[top=${GROUP_TITLE_PX},left=14,bottom=12,right=14]` },
      children: members.map((nid) => nodeChild(nodes.find((n) => n.id === nid)!)),
    });
  }
  for (const n of nodes) {
    if (!inGroup.has(n.id)) children.push(nodeChild(n));
  }

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      // 复合图关键开关:layered 默认不处理嵌套(跨组边不路由、无 sections),
      // INCLUDE_CHILDREN 让整个复合图一次分层,跨组边才有正交折线
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "34",
      "elk.spacing.edgeNode": "26",
      "elk.spacing.componentComponent": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
    },
    children,
    edges: drawEdges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
}

// ============================================================
// ELK 输出拍平(复合嵌套一层:root → 组盒 → 节点盒)
// ============================================================

export interface CmapNodeGeo {
  id: string;
  x: number; // 左上角(绝对)
  y: number;
  w: number;
  h: number;
  lines: string[];
  hub: boolean;
  groupId: string | null;
  /** 颜色档 = 所属组序号(0-4 循环);无组 = -1(中性) */
  colorIdx: number;
}
export interface CmapGroupGeo {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  colorIdx: number;
}
export interface CmapEdgeGeo {
  from: string;
  to: string;
  label?: string;
  pts: { x: number; y: number }[];
  /** 边标签锚点(折线弧长中点);无标签为 null */
  labelPt: { x: number; y: number } | null;
}
export interface CmapLayout {
  width: number;
  height: number;
  nodes: CmapNodeGeo[];
  groups: CmapGroupGeo[];
  edges: CmapEdgeGeo[];
  hubId: string;
  /** true = 分组来自客户端兜底(调试/未来 UI 提示用) */
  groupsFallback: boolean;
}

/** 折线弧长中点(标签锚点)。 */
function polylineMidpoint(pts: { x: number; y: number }[]): { x: number; y: number } {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];
  const segLens = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLens.push(l);
    total += l;
  }
  let remain = total / 2;
  for (let i = 0; i < segLens.length; i++) {
    if (remain <= segLens[i] || i === segLens.length - 1) {
      const t = segLens[i] === 0 ? 0 : remain / segLens[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    remain -= segLens[i];
  }
  return pts[pts.length - 1];
}

export function flattenElkResult(
  elkOut: ElkGraphJSON,
  nodes: CmNode[],
  edges: CmEdge[],
  groups: CmGroup[],
  groupsFallback: boolean,
  hubId: string,
): CmapLayout {
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const groupColor = new Map<string, number>();
  groups.forEach((g, i) => groupColor.set(g.id, i % 5));
  const groupById = new Map(groups.map((g) => [g.id, g] as const));
  const memberGroup = new Map<string, string>();
  for (const g of groups) for (const nid of g.nodeIds) if (!memberGroup.has(nid)) memberGroup.set(nid, g.id);

  const outNodes: CmapNodeGeo[] = [];
  const outGroups: CmapGroupGeo[] = [];
  const outEdges: CmapEdgeGeo[] = [];

  // elkjs 把边统一挂到根数组,坐标属于 e.container 指向的容器(INCLUDE_CHILDREN 下)——
  // 必须先收集"容器 id → 绝对偏移"表,再按 container 加偏移;按树位置加偏移会让组内边整体错位。
  const containerOff = new Map<string, { x: number; y: number }>([["root", { x: 0, y: 0 }]]);
  const rawEdges: { e: NonNullable<ElkGraphJSON["edges"]>[number]; fallback: { x: number; y: number } }[] = [];

  const walk = (elk: ElkGraphJSON, offX: number, offY: number, containerId: string | null) => {
    for (const child of elk.children ?? []) {
      const cx = offX + (child.x ?? 0);
      const cy = offY + (child.y ?? 0);
      if (child.children?.length) {
        const gid = child.id.startsWith("g:") ? child.id.slice(2) : child.id;
        const meta = groupById.get(gid);
        outGroups.push({
          id: gid,
          label: meta?.label ?? "分组",
          x: cx,
          y: cy,
          w: child.width ?? 0,
          h: child.height ?? 0,
          colorIdx: groupColor.get(gid) ?? 0,
        });
        containerOff.set(child.id, { x: cx, y: cy });
        walk(child, cx, cy, gid);
      } else {
        const n = nodesById.get(child.id);
        if (!n) continue;
        const box = cmNodeBox(n.label, n.id === hubId);
        const gid = memberGroup.get(n.id) ?? null;
        outNodes.push({
          id: n.id,
          x: cx,
          y: cy,
          w: child.width ?? Math.ceil(box.width),
          h: child.height ?? Math.ceil(box.height),
          lines: box.lines,
          hub: n.id === hubId,
          groupId: containerId,
          colorIdx: gid != null ? groupColor.get(gid) ?? 0 : -1,
        });
      }
    }
    for (const e of elk.edges ?? []) {
      // 记录现场偏移兜底:理论上边也可挂在 LCA 自己的 edges 里(无 container 字段)
      rawEdges.push({ e, fallback: { x: offX, y: offY } });
    }
  };
  walk(elkOut, 0, 0, null);

  for (const { e, fallback } of rawEdges) {
    const sec = e.sections?.[0];
    if (!sec) continue;
    const off = (e.container != null ? containerOff.get(e.container) : undefined) ?? fallback;
    const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({
      x: p.x + off.x,
      y: p.y + off.y,
    }));
    const idx = Number(e.id.slice(1));
    const src = edges[idx];
    if (!src) continue;
    outEdges.push({ from: src.from, to: src.to, label: src.label, pts, labelPt: src.label ? polylineMidpoint(pts) : null });
  }

  return {
    width: Math.ceil(elkOut.width ?? 0),
    height: Math.ceil(elkOut.height ?? 0),
    nodes: outNodes,
    groups: outGroups,
    edges: outEdges,
    hubId,
    groupsFallback,
  };
}

// ============================================================
// 异步管线:elkjs 动态 import(独立 lazy chunk)
// ============================================================

type ElkInstance = { layout: (graph: ElkGraphJSON) => Promise<ElkGraphJSON> };
let elkPromise: Promise<ElkInstance> | null = null;

/** elkjs 单例:elk.bundled.js 主线程版(无 Worker,打包器友好,React Flow 生态同款)。 */
function loadElk(): Promise<ElkInstance> {
  elkPromise ??= import(/* @vite-ignore */ "https://esm.sh/elkjs@0.12/lib/elk.bundled.js").then((mod: { default: unknown }) => {
    // interop 双环境:CJS(Node/tsx)default 在 mod.default;打包后 ESM 可能整包即构造器
    const m = mod as unknown as Record<string, unknown>;
    const Ctor = (m.default ?? m) as new () => ElkInstance;
    return new Ctor();
  });
  return elkPromise;
}

/** 概念图 → 分组解析 → ELK 布局 → 绝对坐标几何。输入相同则输出逐字段全等。 */
export async function layoutConceptMap(
  nodes: CmNode[],
  edges: CmEdge[],
  groups?: CmGroup[] | null,
): Promise<CmapLayout> {
  const resolved = resolveGroups(nodes, edges, groups);
  const graph = buildElkGraph(nodes, edges, resolved.groups);
  const hubId = computeHubId(nodes, edges);
  const elk = await loadElk();
  const out = await elk.layout(graph);
  return flattenElkResult(out, nodes, edges, resolved.groups, resolved.fallback, hubId);
}

function computeHubId(nodes: CmNode[], edges: CmEdge[]): string {
  const ids = new Set(nodes.map((n) => n.id));
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  const seen = new Set<string>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const key = [e.from, e.to].sort().join("→");
    if (seen.has(key)) continue;
    seen.add(key);
    degree.set(e.from, degree.get(e.from)! + 1);
    degree.set(e.to, degree.get(e.to)! + 1);
  }
  let hubId = nodes[0]?.id ?? "";
  for (const n of nodes) if ((degree.get(n.id) ?? 0) > (degree.get(hubId) ?? 0)) hubId = n.id;
  return hubId;
}
