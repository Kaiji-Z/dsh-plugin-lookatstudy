import type { MatterBody, MatterConstraint } from './matter.ts'
// Vendored from LookatStudy src/renderer/lib/mapPhysics.ts (MIT License,
// https://github.com/Kaiji-Z/LookatStudy) — verbatim (P15); the Matter import
// resolves to the vendored ./matter.ts UMD wrapper. Matter.Body/Constraint
// types loosen to the local minimal surface.
/**
 * mapPhysics —— 左栏地图物理引擎适配层(Matter.js 0.19)。
 *
 * 物理模型(v2,2026-08-16 实测反馈重做):
 * - **真实重力场**:engine.gravity=1 作用于一切——球有重量,绳子(粒子链)也有重量。
 * - **球自带浮力**悬停:每球浮力 ≈ 自重(确定性哈希 0.97-1.05 微差),还要扛住
 *   绳子的那份重量 → 有的球微微上顶把绳拉直,有的球微微下垂,形成彩旗串般的悬垂链。
 * - **绳子 = 粒子链 + 距离约束**(balloons.html 手法):不受力时像普通绳子
 *   自然垂坠(每段静止长度比实际间距长 8%),受拉时有弹力(段内刚度 0.9);
 *   绳粒不与任何东西碰撞(纯受力链,轻量且不抖)。
 * - **顺序 = 绳链**:路牌金色绳结 → 球1 → … → 紫球(考试)。无弹簧回位,自由摆布。
 * - **天气驱动环境**(不是只有风):风基值/阵风/雨滴冲击/雪载增重/浓雾阻尼
 *   由 weatherPhysFor 纯函数从天气映射,岛创建时定格。
 * - 每 section 一个物理岛:墙 = 栏宽(左右) + section 边界(上下);视口外冻结。
 * - 碰撞命中点统一用 collision.supports(球-墙也用——中心连线中点会飞到容器外)。
 * - 本模块不碰 DOM/React;reduced-motion 时调用方完全不启用(静态布局兜底)。
 */
import Matter from './matter.ts'

// Matter 对低速接触按"静息"处理(默认 <4px/步 不给反弹冲量)→ 慢速把解锁球
// 推向锁定球时像被吸附。阈值调低到 1.4:慢碰也保留一点弹性。
// (Resolver 内部常量,0.19 暴露在 Matter.Resolver 上;防御式赋值防版本变动)
{
  const resolver = (Matter as unknown as { Resolver?: { _restingThresh?: number } }).Resolver;
  if (resolver && typeof resolver._restingThresh === "number") resolver._restingThresh = 1.4;
}

/** 指针位移 < 此值(px)判为点击(拖拽阈值);超出判为拖拽。与按压时长无关。 */
export const DRAG_THRESHOLD_PX = 6;
/** 球物理半径(px)。必须与视觉 w-14 h-14(56px)匹配。 */
export const BALL_RADIUS = 28;
/** 绳在球上的悬挂点:球心下方 r*0.92(绳从球底垂下)。 */
export const ROPE_ATTACH = 0.92;
/** 绳静止长度比实际间距的富余(>1 = 有松量可垂坠)。 */
export const ROPE_SLACK = 1.12;
/** 绳段粒子的目标段长(px)。段数 = clamp(round(距/段长), 5, 14)。 */
export const ROPE_SEG_LEN = 34;

export interface Vec2 {
  x: number;
  y: number;
}

/* ============================================================
 * 纯函数(渲染层每帧用,全部无副作用,verify-map-physics 覆盖)
 * ============================================================ */

export interface PointerTrack {
  startX: number;
  startY: number;
}
/** 指针按下→抬起分类:位移 < DRAG_THRESHOLD_PX = 点击,否则拖拽。 */
export function classifyPointer(track: PointerTrack, endX: number, endY: number): "click" | "drag" {
  const dist = Math.hypot(endX - track.startX, endY - track.startY);
  return dist < DRAG_THRESHOLD_PX ? "click" : "drag";
}

/**
 * 绳链 SVG path:平滑弧线穿绳粒(垂坠/绷直是物理结果,渲染只负责圆滑)。
 * 手法:二次贝塞尔以绳粒为控制点、穿过相邻粒的中点 → Catmull-Rom 近似的光滑绳。
 */
export function ropeChainPathD(points: Vec2[]): string {
  const n = points.length;
  if (n === 0) return "";
  const f = (p: Vec2) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  if (n === 1) return `M ${f(points[0]!)}`;
  if (n === 2) return `M ${f(points[0]!)} L ${f(points[1]!)}`;
  let d = `M ${f(points[0]!)}`;
  for (let i = 1; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    d += ` Q ${f(a)} ${((a.x + b.x) / 2).toFixed(1)} ${((a.y + b.y) / 2).toFixed(1)}`;
  }
  return `${d} L ${f(points[n - 1]!)}`;
}

/** squash 指数衰减(时间常数 ~90ms)。dt 毫秒。 */
export function decaySquash(squash: number, dtMs: number): number {
  return squash * Math.exp(-dtMs / 90);
}

/** squash → CSS transform 片段:沿碰撞法线方向压扁。squash < 0.01 视为无形变。 */
export function squashTransform(dx: number, dy: number, squash: number, angleRad: number): string {
  const t = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
  if (squash < 0.01) return t;
  const deg = (angleRad * 180) / Math.PI;
  const s = Math.min(0.35, squash);
  return `${t} rotate(${deg.toFixed(1)}deg) scale(${(1 + s).toFixed(3)}, ${(1 - s).toFixed(3)}) rotate(${(-deg).toFixed(1)}deg)`;
}

/** 确定性风场基频(balloons.html 手法):双频行波正弦,随位置/时间缓慢变化。 */
export const WIND_STRENGTH = 0.00004;
export const GUST_STRENGTH = 0.0005;
export function swirlAt(x: number, y: number, tMs: number): number {
  return (
    Math.sin(tMs * 0.00037 + y * 0.0013) * 0.6 +
    Math.sin(tMs * 0.00019 + x * 0.0007 + 1.7) * 0.4
  );
}

/** 视口门控:返回与 [viewportTop, viewportBottom](± pad) 相交的 section id 集合。 */
export function activeIslandIds(
  sections: { id: string; top: number; bottom: number }[],
  viewportTop: number,
  viewportBottom: number,
  pad = 200,
): Set<string> {
  const out = new Set<string>();
  for (const s of sections) {
    if (s.bottom >= viewportTop - pad && s.top <= viewportBottom + pad) out.add(s.id);
  }
  return out;
}

/* ============================================================
 * 天气 → 环境物理参数(纯函数,可测)
 * ============================================================ */

export interface WeatherPhys {
  /** 基础风力 0..1(乘 swirlAt 出发力)。 */
  wind: number;
  /** 阵风强度 0..1(storm 随机触发,指数衰减)。 */
  gust: number;
  /** 每步每球被雨滴砸中的概率(雨滴施加小冲量)。 */
  rainRate: number;
  /** 雪载增速(每步,球顶积雪增重压坠,撞一下震落 60%)。 */
  snowRate: number;
  /** 空气阻尼乘数(雾天浓稠空气,运动更钝)。 */
  airDrag: number;
}

/** 天气 → 环境物理。未知天气按 clear(微风)。 */
export function weatherPhysFor(weather: string): WeatherPhys {
  switch (weather) {
    case "storm": return { wind: 0.95, gust: 1, rainRate: 0.006, snowRate: 0, airDrag: 1.05 };
    case "rain": return { wind: 0.6, gust: 0.25, rainRate: 0.004, snowRate: 0, airDrag: 1.0 };
    case "snow": return { wind: 0.25, gust: 0, rainRate: 0, snowRate: 0.0004, airDrag: 1.0 };
    case "fog": return { wind: 0.06, gust: 0, rainRate: 0, snowRate: 0, airDrag: 1.7 };
    case "cloudy": return { wind: 0.4, gust: 0.1, rainRate: 0, snowRate: 0, airDrag: 1.0 };
    case "clear":
    default: return { wind: 0.3, gust: 0, rainRate: 0, snowRate: 0, airDrag: 1.0 };
  }
}

/* ============================================================
 * 物理岛(每 section 一个)
 * ============================================================ */

export interface IslandBall {
  nodeId: string;
  body: MatterBody;
  /** mapLayout 的确定性初始位(渲染层 transform 的参照原点)。 */
  layoutX: number;
  layoutY: number;
  /** 考试(boss)球更沉。 */
  isExam: boolean;
  /** 雪载 0..1(雪天缓涨,碰撞震落)。 */
  snow: number;
  /** 力场激活度 0..1(有球进入力场半径时升高,离开渐隐)——渲染层画光环。 */
  field: number;
  squash: number;
  squashAngle: number;
}

/** 绳链:from("__anchor" = 路牌绳结)|nodeId → to 节点,中间是绳粒。 */
export interface RopeLink {
  from: string;
  to: string;
  /** 悬挂点间距的静止长度(信息/测试用)。 */
  restLen: number;
  /** 中间绳粒(渲染层每帧读位置画折线)。 */
  particles: MatterBody[];
}

/** 碰撞事件(岛坐标系):渲染层画脉冲环 / 转换后喂天气层溅水花。 */
export interface ImpactEvent {
  x: number;
  y: number;
  speed: number;
}

/**
 * 雪屑事件(岛坐标系):球快速移动/被拖拽/碰撞时从球顶半球甩出的雪,
 * 带初速度(继承球速)。渲染层做轻量弹道积分(重力+渐隐),**不是** Matter 刚体
 * ——雪屑量大,物理真算会炸;观感与耦合(球变轻)由 snow 标量保证。
 */
export interface FlakeEvent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  amount: number;
}

export interface SectionIsland {
  readonly balls: IslandBall[];
  readonly links: RopeLink[];
  /** 路牌绳结锚点(岛坐标,容器上缘上方)。 */
  readonly anchor: Vec2;
  /** 下一段路牌上缘绳结(岛坐标,容器下缘下方;仅末球为考试球且给了挂点时存在)。
   *  考试球绳系到这里 → 整张地图串成一条链:牌底→球1→…→考试球→下一段牌顶。 */
  readonly nextKnot?: Vec2;
  ball(nodeId: string): IslandBall | undefined;
  step(dtMs: number): void;
  beginDrag(nodeId: string, px: number, py: number): void;
  moveDrag(px: number, py: number): void;
  endDrag(): void;
  isDragging(): boolean;
  /** 取走并清空累积的碰撞事件。 */
  drainImpacts(): ImpactEvent[];
  /** 取走并清空累积的雪屑事件(快速移动/拖拽/碰撞甩出的球顶积雪)。 */
  drainFlakes(): FlakeEvent[];
  dispose(): void;
}

/** 确定性 FNV 哈希(mapLayout.hashStr 的本地副本,避免渲染/物理循环依赖)。 */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

const WALL_THICKNESS = 120;
/** 绳段内刚度(高 = 绳感,受拉有弹力但不过分伸长)。 */
const ROPE_STIFF_IN = 0.9;
/** 绳端挂到球/绳结上的刚度(略软,挂点有弹性)。 */
const ROPE_STIFF_ATTACH = 0.7;
/** 软抓取刚度(balloons.html MouseConstraint 手法):拖拽是"牵",不是"钉"。 */
const DRAG_STIFFNESS = 0.09;
/** 产生 squash/脉冲的最低相对速度(px/step)。 */
const IMPACT_MIN_SPEED = 2.2;
/* 雪载不增重(实测反馈):整串球被积雪压着集体下沉,彩旗串沉底。
 * 雪只做视觉(堆积/甩落/撞掉),球的浮沉始终只由浮力校准决定。 */
/** 触发甩雪的最低球速(px/step ≈ 120px/s):普通拖动即掉雪(慢于它不掉),
 * 快速甩/被撞掉得更猛。原 3.5(≈210px/s)太高——拖动根本触发不了(实测反馈)。 */
const FLAKE_MIN_SPEED = 2.0;
/**
 * 球体力场半径(2.45×球半径 ≈ 69px):进入即相斥,像磁铁同极靠近。
 * 取值依据:球缘外的装饰件最远到半径 34px(选中环 ring-4+offset-2),
 * 常态悬停间隙 ≈ FIELD_RANGE - 2r = 12.6px > 34-28=6px —— 选中环/待复习
 * 角标不再叠进邻球。
 */
export const FIELD_RANGE = BALL_RADIUS * 2.45;
/** 力场最强推离加速度(px/step²,≈6×重力):贴得越近推得越狠(平方衰减)。 */
const FIELD_MAX_ACCEL = 0.006;
/** 球速上限(px/step):Matter 无 CCD,超速会整帧穿透对撞;快但不至于穿。 */
const MAX_ORB_SPEED = 22;
/** 甩雪地板:一次抖动/拖拽把雪盖甩到只剩一点(≈6%),再往下不掉,靠天气慢慢积回。 */
const SHED_FLOOR = 0.06;

export function createSectionIsland(opts: {
  nodes: { id: string; x: number; y: number; isExam?: boolean; locked?: boolean; spawn?: { x: number; y: number; vx?: number; vy?: number } }[];
  width: number;
  height: number;
  ballRadius?: number;
  /** 天气(默认 clear)——环境物理参数在创建时定格。 */
  weather?: string;
  /** 路牌下缘绳结 x(随机挂点,渲染层用 knotX() 算);缺省 = 首球布局 x(旧行为)。 */
  anchorKnotX?: number;
  /** 下一段路牌上缘绳结(岛坐标,渲染层量 DOM 算)。给了且末球是考试球 → 系考试绳。 */
  nextKnot?: Vec2;
}): SectionIsland {
  const r = opts.ballRadius ?? BALL_RADIUS;
  const env = weatherPhysFor(opts.weather ?? "clear");
  const { Engine, Bodies, Body, Composite, Constraint, Events } = Matter;

  const engine = Engine.create();
  engine.gravity.y = 1; // 真实重力场:球和绳粒都受重力
  engine.positionIterations = 8;
  engine.velocityIterations = 4;

  const balls: IslandBall[] = opts.nodes.map((n) => {
    // 重建续接:有 spawn(上一岛的最后位置/速度)就从那生,否则布局位
    const sx = n.spawn?.x ?? n.x;
    const sy = n.spawn?.y ?? n.y;
    const body = Bodies.circle(sx, sy, r, {
      restitution: 0.5,
      friction: 0.01,
      frictionAir: 0.03 * env.airDrag,
      density: n.isExam ? 0.0016 : 0.001, // 考试(boss)球更沉
      inertia: Infinity, // 不打转:进度环/皇冠朝向不随物理旋转
      // 锁定球 = static 刚体:不可拖、风吹不动、别的球撞它如撞墙——
      // 地图初始状态稳定,随学习进度逐球"苏醒"(解锁时重建岛)。
      isStatic: !!n.locked,
      collisionFilter: { group: 0, category: 0x0002, mask: 0x0002 | 0x0004 },
    });
    return {
      nodeId: n.id, body, layoutX: n.x, layoutY: n.y,
      isExam: !!n.isExam, snow: 0, field: 0, squash: 0, squashAngle: 0,
    };
  });
  for (const b of balls) {
    Composite.add(engine.world, b.body);
    const sp = opts.nodes.find((n) => n.id === b.nodeId)?.spawn;
    if (sp && (sp.vx !== undefined || sp.vy !== undefined)) {
      Body.setVelocity(b.body, { x: sp.vx ?? 0, y: sp.vy ?? 0 });
    }
  }

  // 墙(不可见):左右 = 栏宽,上下 = section 边界。内表面分别位于 0 / width / 0 / height。
  const half = WALL_THICKNESS / 2;
  const wallOpts = { isStatic: true, restitution: 0.4, friction: 0.05, collisionFilter: { category: 0x0004, mask: 0x0002 } };
  /** 拖拽点钳进盒内:指针拉到墙外时,弹簧的靶点停在墙内 —— 手感是"拉到墙就拉不动"。 */
  const clampPoint = (px: number, py: number): Vec2 => ({
    x: Math.min(opts.width - r, Math.max(r, px)),
    y: Math.min(opts.height - r, Math.max(r, py)),
  });
  Composite.add(engine.world, [
    Bodies.rectangle(opts.width / 2, -half, opts.width * 3, WALL_THICKNESS, wallOpts),
    Bodies.rectangle(opts.width / 2, opts.height + half, opts.width * 3, WALL_THICKNESS, wallOpts),
    Bodies.rectangle(-half, opts.height / 2, WALL_THICKNESS, opts.height * 3, wallOpts),
    Bodies.rectangle(opts.width + half, opts.height / 2, WALL_THICKNESS, opts.height * 3, wallOpts),
  ]);

  /* ── 绳子:粒子链(balloons.html createRope 手法) ──
     每段 = 一个小圆粒 + 两条距离约束;绳粒碰撞掩码 0(纯受力链,不与球/墙碰撞)。
     段静止长度 = 悬挂点间距 × ROPE_SLACK / 段数 → 不受力时自然垂坠,受拉绷直。 */
  const attachOf = (b: IslandBall): Vec2 => ({ x: b.body.position.x, y: b.body.position.y + r * ROPE_ATTACH });
  const links: RopeLink[] = [];

  /** 绳头:挂在刚体上(球,带局部偏移)或纯点(路牌绳结)。球不旋转(inertia=∞),局部偏移恒屏幕对齐。 */
  type RopeHead = { body: MatterBody; offset: Vec2 } | { point: Vec2 };

  function ropeConstraintFrom(head: RopeHead, bodyB: MatterBody, pointB: Vec2 | undefined, length: number, stiffness: number) {
    return "body" in head
      ? Constraint.create({ bodyA: head.body, pointA: head.offset, bodyB, pointB, length, stiffness, damping: 0.05 })
      : Constraint.create({ pointA: head.point, bodyB, pointB, length, stiffness, damping: 0.05 });
  }

  function createRope(a: Vec2, bodyA: MatterBody | null, ballB: IslandBall, fromId: string) {
    const bAttach = { x: ballB.body.position.x, y: ballB.body.position.y + r * ROPE_ATTACH };
    const dx = bAttach.x - a.x;
    const dy = bAttach.y - a.y;
    const dist = Math.max(60, Math.hypot(dx, dy));
    const segs = Math.max(5, Math.min(14, Math.round(dist / ROPE_SEG_LEN)));
    const restLen = (dist * ROPE_SLACK) / segs;
    const particles: Matter.Body[] = [];
    let head: RopeHead = bodyA
      ? { body: bodyA, offset: { x: a.x - bodyA.position.x, y: a.y - bodyA.position.y } }
      : { point: a };
    let isFirst = true;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      // 初始摆在带垂度的弧上(sin 半波,接近松量):绳生下来就接近垂坠平衡,
      // 不会先直线再掉下来(解锁重建时不闪)
      const bow = Math.sin(Math.PI * t) * dist * (ROPE_SLACK - 1) * 0.85;
      const p = Bodies.circle(a.x + dx * t, a.y + dy * t + bow, 3.5, {
        density: 0.0007, // 绳很轻,但受重力(球要扛住它)
        frictionAir: 0.1 * env.airDrag,
        collisionFilter: { category: 0x0008, mask: 0 },
      });
      particles.push(p);
      Composite.add(engine.world, p);
      // 首段挂在球/绳结上(软 0.7),粒子之间是绳本体(硬 0.9)→ 受拉有弹力、松弛垂坠
      Composite.add(
        engine.world,
        ropeConstraintFrom(head, p, undefined, restLen, isFirst ? ROPE_STIFF_ATTACH : ROPE_STIFF_IN),
      );
      isFirst = false;
      head = { body: p, offset: { x: 0, y: 0 } };
    }
    // 尾段:最后绳粒(或起点)→ 球B 悬挂点(挂点软)
    Composite.add(
      engine.world,
      ropeConstraintFrom(head, ballB.body, { x: 0, y: r * ROPE_ATTACH }, restLen, ROPE_STIFF_ATTACH),
    );
    links.push({ from: fromId, to: ballB.nodeId, restLen: dist * ROPE_SLACK, particles });
  }

  // 路牌绳结:锚在容器上缘上方(视觉落在路牌下缘,x 随机挂点),绳系住第一个球的底部。
  const first = balls[0];
  const anchor: Vec2 = first
    ? { x: opts.anchorKnotX ?? first.layoutX, y: ANCHOR_KNOT_Y }
    : { x: opts.width / 2, y: ANCHOR_KNOT_Y };
  if (first) {
    createRope(anchor, null, first, "__anchor");
  }
  // 球间绳:前球底部 → 后球底部。
  for (let i = 0; i < balls.length - 1; i++) {
    const a = balls[i]!;
    const b = balls[i + 1]!;
    createRope(attachOf(a), a.body, b, a.nodeId);
  }
  // 考试球绳:末球是考试球且给了下一段挂点 → 系往下一段路牌上缘(随机挂点)。
  const last = balls[balls.length - 1];
  const nextKnot = opts.nextKnot && last?.isExam ? opts.nextKnot : undefined;
  if (nextKnot && last) {
    createRope(nextKnot, null, last, "__next");
  }

  // 浮力(扛住自重 + 实际挂的绳重)+ 风 + 雨滴冲击 + 雪载增重。
  // 彩旗串是整体平衡:任何一个球净上浮都会经绳提起邻居,总浮力>总重就整串
  // 顶到天花板(v3 实测堆顶)。校准必须按每球**实际挂的绳质量**精确中性:
  // lift = (1 + 绳重占比) × (0.96~1.04) → 整体严格中性,只剩 ±4% 球间再分布,
  // 有的微垂有的微顶,静止时绳有松有紧且串不整体漂移。
  const lifts = new Map<string, number>();
  for (const b of balls) {
    let ropeMass = 0;
    for (const l of links) {
      if (l.from === b.nodeId || l.to === b.nodeId) {
        // 每端只计**半条**绳:一条绳两端各补一半 → 总量恰好补一次。
        // (两端各计全绳会把绳重补偿翻倍 → 整串净上浮堆顶,v4 实测踩过)
        for (const particle of l.particles) ropeMass += particle.mass * 0.5;
      }
    }
    const share = Math.min(0.25, ropeMass / b.body.mass);
    lifts.set(b.nodeId, (1 + share) * (0.96 + hash01(b.nodeId) * 0.08));
  }
  let gustNow = 0;
  let gustDir = 1;
  Events.on(engine, "beforeUpdate", () => {
    const t = engine.timing.timestamp;
    // 阵风包络:随机触发 + 指数衰减(balloons.html 手法)
    gustNow *= 0.97;
    if (env.gust > 0 && Math.random() < 0.0025 * env.gust) {
      gustNow = env.gust * (0.6 + Math.random() * 0.4);
      gustDir = Math.random() < 0.5 ? -1 : 1;
    }
    for (const b of balls) {
      const m = b.body.mass;
      const g = engine.gravity.y * engine.gravity.scale;
      const fx = swirlAt(b.body.position.x, b.body.position.y, t) * env.wind * WIND_STRENGTH * m + gustDir * gustNow * GUST_STRENGTH * m;
      let fy = -m * g * (lifts.get(b.nodeId) ?? 1);
      // 雨滴:小概率砸一下(向下的瞬时冲量 + 随机横向)
      if (env.rainRate > 0 && Math.random() < env.rainRate) {
        fy += m * g * 0.35;
        Body.applyForce(b.body, b.body.position, { x: (Math.random() - 0.5) * m * g * 0.3, y: 0 });
      }
      Body.applyForce(b.body, b.body.position, { x: fx, y: fy });
    }
  });

  // 碰撞:squash 形变 + 脉冲事件(命中点统一用支撑点——球-墙的中心连线中点会飞到容器外)。
  // 雪屑事件池(渲染层 drain;碰撞/快速移动/拖拽都会填)
  const flakes: FlakeEvent[] = [];

  /**
   * 从球顶半球甩雪:位置随机取上半球面,初速度 = 球速×0.75 + 沿方向散布(向外+微上)。
   * 同步扣减 b.snow(球变轻 → 微微上浮,物理耦合)。
   */
  const shedSnow = (b: IslandBall, dir: Vec2, speed: number, count: number) => {
    if (b.snow <= SHED_FLOOR) return;
    const cnt = Math.max(1, Math.min(count, Math.round(b.snow * count) + 1));
    for (let i = 0; i < cnt; i++) {
      const theta = -(0.35 + Math.random() * 1.9); // 上半球随机角
      const rr = r * (0.55 + Math.random() * 0.45);
      flakes.push({
        x: b.body.position.x + Math.cos(theta) * rr,
        y: b.body.position.y + Math.sin(theta) * rr,
        vx: b.body.velocity.x * 0.75 + dir.x * (0.5 + Math.random() * 1.8) + (Math.random() - 0.5) * 1.2,
        vy: b.body.velocity.y * 0.75 + dir.y * (0.5 + Math.random() * 1.8) - 0.6 - Math.random() * 0.8,
        amount: 0.02 + Math.min(0.05, speed * 0.004),
      });
    }
    b.snow = Math.max(SHED_FLOOR * 0.5, b.snow - cnt * (0.03 + Math.min(0.07, speed * 0.005)));
    if (flakes.length > 96) flakes.splice(0, flakes.length - 96);
  };

  const impacts: ImpactEvent[] = [];
  Events.on(engine, "collisionStart", (e) => {
    for (const pair of e.pairs) {
      const { bodyA, bodyB } = pair;
      const a = balls.find((b) => b.body === bodyA);
      const b2 = balls.find((b) => b.body === bodyB);
      if (!a && !b2) continue;
      const rv = { x: bodyA.velocity.x - bodyB.velocity.x, y: bodyA.velocity.y - bodyB.velocity.y };
      const speed = Math.hypot(rv.x, rv.y);
      if (speed < IMPACT_MIN_SPEED) continue;
      const n = pair.collision.normal;
      const s0 = pair.collision.supports?.[0];
      impacts.push(s0 ? { x: s0.x, y: s0.y, speed } : {
        x: (bodyA.position.x + bodyB.position.x) / 2,
        y: (bodyA.position.y + bodyB.position.y) / 2,
        speed,
      });
      if (impacts.length > 64) impacts.shift();
      const amount = Math.min(0.32, speed * 0.028);
      if (a && amount > a.squash) { a.squash = amount; a.squashAngle = Math.atan2(n.y, n.x); }
      if (b2 && amount > b2.squash) { b2.squash = amount; b2.squashAngle = Math.atan2(-n.y, -n.x); }
      // 雪天:撞一下甩出一簇带冲击速度的雪屑(shedSnow 里同步扣雪载)
      if (a) shedSnow(a, { x: n.x, y: n.y }, speed, 5);
      if (b2) shedSnow(b2, { x: -n.x, y: -n.y }, speed, 5);
    }
  });

  // 雪天:雪载缓涨(封顶 1;满载约 45 秒 —— 肉眼可见的"越挂越沉")
  Events.on(engine, "afterUpdate", () => {
    if (env.snowRate <= 0) return;
    for (const b of balls) b.snow = Math.min(1, b.snow + env.snowRate);
  });

  // 软抓取:拖拽 = 指针点与球心之间的一条临时弹簧约束。
  let drag: { constraint: MatterConstraint; nodeId: string } | null = null;

  return {
    balls,
    links,
    anchor,
    nextKnot,
    ball(nodeId) {
      return balls.find((b) => b.nodeId === nodeId);
    },
    step(dtMs) {
      // dt 钳制:掉帧时最多按 33ms 步进,防止约束爆炸
      Engine.update(engine, Math.min(33, Math.max(8, dtMs)));
      // 力场:球对之间平方衰减的斥力(磁悬浮垫)。等大反向(牛顿第三定律)→
      // 内力相消,整串质心不动;static(锁定)球只当场源不受力。
      // near 按**接触圆之外的间隙**标定(接触=1,场缘=0):原中心距标定在接触距离
      // (2r≈56px)处 near² 只剩 ~4%,静止贴着的球几乎不受斥力 —— 长时间不拖动时
      // 微风同向漂移 + 阻尼沉降把它们慢慢聚成堆(实测反馈)。间隙标定后,贴着的球
      // 被温和推到场缘(~2.45r)自然散开,拖拽手感不变(力很小)。
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i]!;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j]!;
          const dx = b.body.position.x - a.body.position.x;
          const dy = b.body.position.y - a.body.position.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= FIELD_RANGE * FIELD_RANGE || d2 < 0.01) continue;
          const d = Math.sqrt(d2);
          const gapN = (d - 2 * r) / (FIELD_RANGE - 2 * r); // 0(接触)→1(场缘)
          const near = gapN <= 0 ? 1 : gapN >= 1 ? 0 : 1 - gapN;
          // 相对速度门控:慢速贴近(<1.2px/step)才垫开(静置分散);快速接近放行
          // —— 球-球仍能真实相撞(碰撞事件/雪震落不丢)。撞完弹开减速后垫子重新接手。
          const relV = Math.hypot(a.body.velocity.x - b.body.velocity.x, a.body.velocity.y - b.body.velocity.y);
          const accel = relV < 1.2 ? FIELD_MAX_ACCEL * near * near : 0;
          const nx = dx / d;
          const ny = dy / d;
          if (!a.body.isStatic) Body.applyForce(a.body, a.body.position, { x: -nx * accel * a.body.mass, y: -ny * accel * a.body.mass });
          if (!b.body.isStatic) Body.applyForce(b.body, b.body.position, { x: nx * accel * b.body.mass, y: ny * accel * b.body.mass });
          a.field = Math.max(a.field, near);
          b.field = Math.max(b.field, near);
        }
      }
      // 力场激活度渐隐(无邻居在范围内时光环淡出)
      for (const b of balls) b.field *= 0.88;

      // 速度钳制 + 球对最小间距硬不变量:视觉上球永不吃进球。
      // 求解器允许少量穿透(slop)且拖拽弹簧会持续压实接触 —— 这层兜底
      // 每步把圆心距强制回 ≥ 2r(static 球不动,只推动态球)。
      for (const b of balls) {
        if (b.body.isStatic) continue;
        const v = b.body.velocity;
        const sp = Math.hypot(v.x, v.y);
        if (sp > MAX_ORB_SPEED) Body.setVelocity(b.body, { x: (v.x / sp) * MAX_ORB_SPEED, y: (v.y / sp) * MAX_ORB_SPEED });
      }
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i]!;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j]!;
          let dx = b.body.position.x - a.body.position.x;
          let dy = b.body.position.y - a.body.position.y;
          let d = Math.hypot(dx, dy);
          if (d >= r * 2) continue;
          if (d < 0.01) { dx = 1; dy = 0; d = 1; }
          const push = (r * 2 - d) + 0.05;
          const nx = dx / d;
          const ny = dy / d;
          if (a.body.isStatic && b.body.isStatic) continue;
          if (a.body.isStatic) {
            Body.setPosition(b.body, { x: b.body.position.x + nx * push, y: b.body.position.y + ny * push });
          } else if (b.body.isStatic) {
            Body.setPosition(a.body, { x: a.body.position.x - nx * push, y: a.body.position.y - ny * push });
          } else {
            Body.setPosition(a.body, { x: a.body.position.x - nx * push / 2, y: a.body.position.y - ny * push / 2 });
            Body.setPosition(b.body, { x: b.body.position.x + nx * push / 2, y: b.body.position.y + ny * push / 2 });
          }
        }
      }

      // 快速移动甩雪:拖拽/被甩/晃动时球顶积雪持续飞离(慢移不掉)
      for (const b of balls) {
        const sp = Math.hypot(b.body.velocity.x, b.body.velocity.y);
        if (b.snow > SHED_FLOOR && sp > FLAKE_MIN_SPEED) {
          shedSnow(b, { x: b.body.velocity.x / sp, y: b.body.velocity.y / sp }, sp, 2);
        }
      }
      // 硬钳制(物理不变量:球永不出盒)。墙负责正常速度的反弹;
      // 蛮力拖拽/极端冲量挤过求解器时,这里兜底拉回 + 切掉向外速度。
      for (const b of balls) {
        if (b.body.isStatic) continue;
        const x = b.body.position.x;
        const y = b.body.position.y;
        const cx = Math.min(opts.width - r, Math.max(r, x));
        const cy = Math.min(opts.height - r, Math.max(r, y));
        if (cx !== x || cy !== y) {
          Body.setPosition(b.body, { x: cx, y: cy });
          Body.setVelocity(b.body, {
            x: x < r || x > opts.width - r ? 0 : b.body.velocity.x,
            y: y < r || y > opts.height - r ? 0 : b.body.velocity.y,
          });
        }
      }
    },
    beginDrag(nodeId, px, py) {
      this.endDrag();
      const b = this.ball(nodeId);
      if (!b) return;
      const constraint = Constraint.create({
        pointA: clampPoint(px, py),
        bodyB: b.body,
        length: 0,
        stiffness: DRAG_STIFFNESS,
        damping: 0.12,
      });
      Composite.add(engine.world, constraint);
      drag = { constraint, nodeId };
    },
    moveDrag(px, py) {
      if (!drag) return;
      const c = clampPoint(px, py);
      drag.constraint.pointA = c;
    },
    endDrag() {
      if (!drag) return;
      Composite.remove(engine.world, drag.constraint);
      drag = null;
    },
    isDragging() {
      return drag !== null;
    },
    drainImpacts() {
      const out = impacts.slice();
      impacts.length = 0;
      return out;
    },
    drainFlakes() {
      const out = flakes.slice();
      flakes.length = 0;
      return out;
    },
    dispose() {
      this.endDrag();
      Events.off(engine, "beforeUpdate");
      Events.off(engine, "afterUpdate");
      Events.off(engine, "collisionStart");
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    },
  };
}

/** 路牌绳结的 y(岛坐标:容器上缘上方 12px = 路牌 mb-3 间隙 = 牌子下缘)。 */
export const ANCHOR_KNOT_Y = -12;
/** 路牌上下缘绳结的随机挂点 x:确定性哈希(同 seed 永远同位,渲染稳定),
 *  在 [inset, width-inset] 内取值 —— 每段绳的 rigging 各不相同,不呆板。 */
export function knotX(seed: string, width: number, inset = 20): number {
  if (width <= inset * 2) return width / 2;
  return inset + hash01(seed) * (width - inset * 2);
}

/** 栏宽变化后重映射续接坐标:球按新旧宽度比例**横向重排**(y 不动,高度与栏宽无关),
 *  钳进新墙内。没有它,跨档(284↔全宽)重建岛时球带着旧绝对 x,首尾两根绳
 *  (挂点已按新宽度随机)被拉得老长。 */
export function remapSpawnX(
  sp: { x: number; y: number; vx?: number; vy?: number },
  fromW: number,
  toW: number,
  margin = BALL_RADIUS,
): { x: number; y: number; vx?: number; vy?: number } {
  if (fromW <= 0 || Math.abs(fromW - toW) <= 1) return sp;
  const k = toW / fromW;
  const out: { x: number; y: number; vx?: number; vy?: number } = {
    x: Math.min(toW - margin, Math.max(margin, sp.x * k)),
    y: sp.y,
    vy: sp.vy,
  };
  if (sp.vx !== undefined) out.vx = sp.vx * k;
  return out;
}
