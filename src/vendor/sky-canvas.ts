// Vendored from LookatStudy src/renderer/lib/skyCanvas.ts (MIT License,
// https://github.com/Kaiji-Z/LookatStudy) — verbatim (P15); zero dependencies.
/**
 * skyCanvas —— 滚动叙事天空(canvas 版,参照 A Day in One Scroll)。
 *
 * 核心思想:天空画在一个 sticky canvas 上(不随内容滚动,只随滚动进度重绘),
 * 每帧根据 scrollProgress(0..1)重画整张天:渐变 + 星 + 日/月弧线 + 云 + 地平线。
 * 纯函数 + 闭包,不依赖 React;调用方只需 attach 一个 scroll 容器 + 一个 canvas。
 *
 * 与 CSS 渐变版的区别:
 *   - CSS 渐变随内容滚动,只在第一章可见(用户反馈的 bug)
 *   - canvas sticky 在视口,全程铺满 → 滚到底也是天空
 *   - canvas 每帧重绘 → 云飘、星闪、日轨运动,丝滑
 */

/* ---- math helpers ---- */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
type RGB = [number, number, number];
function mix3(c0: RGB, c1: RGB, t: number): RGB {
  return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
}
const rgbStr = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const rgbaStr = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/* ---- 季节×天气预设 ----
   季节 = 天空色板(改色温/饱和度);天气 = 粒子层(雨/雪/雾)+ 云量 + 闪电。
   两层正交:滚动叙事(一日时间结构)保留,季节只改色,天气只加粒子。 */
interface SkyStop { t: number; top: RGB; mid: RGB; hor: RGB; }

export type Season = "spring" | "summer" | "autumn" | "winter";
export type Weather = "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog";

/** 季节性地面配色:远山色 + 近地色 + 山顶积雪色(仅 winter 用)。 */
export interface GroundColors {
  /** 远处丘陵剪影色(较暗、融入天空)。 */
  far: RGB;
  /** 近处地面色(季节主色:春嫩绿、夏深绿、秋金棕、冬雪白)。 */
  near: RGB;
  /** 是否在丘陵顶部画积雪(仅 winter)。 */
  snowy: boolean;
}

export interface SkyPreset {
  season: Season;
  weather: Weather;
  /** 该季节的天空色关键帧(覆盖默认)。t 必须单调递增且首尾同色(无缝循环)。 */
  sky: SkyStop[];
  /** 云量曲线(p=0..1 → 0..1),天气驱动(晴少云、阴多云、雨/雪更密)。 */
  cloudCover: (p: number) => number;
  /** 粒子类型:none/rain/snow。雨/雷暴用 rain,雪用 snow。 */
  particles: "none" | "rain" | "snow";
  /** 是否有闪电(仅 storm)。 */
  lightning: boolean;
  /** 雾层 alpha(0=无雾,0.2-0.5=轻雾)。snow/fog 天气 >0。 */
  fogAlpha: number;
  /** 季节性地面配色(远山 + 近地 + 是否积雪)。区分季节的关键视觉。 */
  ground: GroundColors;
  /** 太阳染色(秋日偏红橙、冬日偏冷白),可选;不传用默认金色。 */
  sunTint?: RGB;
}

/* 默认天空(基线,各季节在此基础上偏色)。深夜→拂晓→日出→清晨→正午→云起→黄金→日落→深夜 */
function defaultSky(): SkyStop[] {
  return [
    { t: 0.0,  top: [8, 10, 26],     mid: [16, 20, 44],    hor: [34, 30, 58] },
    { t: 0.12, top: [30, 32, 72],    mid: [78, 56, 104],   hor: [158, 100, 116] },
    { t: 0.22, top: [124, 156, 214], mid: [232, 152, 120], hor: [250, 196, 128] },
    { t: 0.36, top: [80, 142, 196],  mid: [132, 186, 226], hor: [188, 214, 232] },
    { t: 0.5,  top: [60, 120, 178],  mid: [108, 168, 212], hor: [168, 200, 226] },
    { t: 0.62, top: [120, 132, 152], mid: [150, 150, 160], hor: [180, 178, 182] },
    { t: 0.74, top: [70, 60, 88],    mid: [108, 78, 110],  hor: [180, 110, 100] },
    { t: 0.86, top: [40, 30, 60],    mid: [88, 44, 76],    hor: [168, 72, 72] },
    { t: 1.0,  top: [8, 10, 26],     mid: [16, 20, 44],    hor: [34, 30, 58] },
  ];
}

/* 4 季节色板偏色函数:在基线上整体偏色(春嫩绿、夏明蓝、秋金红、冬冷灰白)。 */
function tintSky(base: SkyStop[], fn: (c: RGB) => RGB): SkyStop[] {
  return base.map((s) => ({ t: s.t, top: fn(s.top), mid: fn(s.mid), hor: fn(s.hor) }));
}
// 春:整体偏嫩绿(加一点绿,降一点蓝)
// 季节偏色:幅度加大到一眼可辨(互相色差 ≥100)。
// 春=嫩绿(压蓝提绿)、夏=青蓝(压红提蓝)、秋=金橙(提红压绿蓝)、冬=冷紫灰(降饱和偏紫)
const springSky = () => tintSky(defaultSky(), (c) => [c[0] * 1.0, c[1] * 1.15, c[2] * 0.7]);
const summerSky = () => tintSky(defaultSky(), (c) => [c[0] * 0.75, c[1] * 1.0, Math.min(255, c[2] * 1.25)]);
const autumnSky = () => tintSky(defaultSky(), (c) => [Math.min(255, c[0] * 1.35), c[1] * 0.8, c[2] * 0.55]);
const winterSky = () => tintSky(defaultSky(), (c) => {
  const g = (c[0] + c[1] + c[2]) / 3;
  return [g * 0.7 + c[0] * 0.1, g * 0.7 + c[1] * 0.1, g * 0.95 + c[2] * 0.15];
});

/* 4 季节地面配色(远山 + 近地 + 积雪标记)。远山较暗融入天空,近地是季节主色。
   春=嫩绿草地、夏=深绿茂盛、秋=金棕落叶、冬=雪白(山顶积雪)。 */
const GROUND_SPRING: GroundColors = { far: [28, 50, 36], near: [56, 110, 52], snowy: false };
const GROUND_SUMMER: GroundColors = { far: [20, 48, 30], near: [34, 82, 40], snowy: false };
const GROUND_AUTUMN: GroundColors = { far: [54, 36, 24], near: [128, 78, 36], snowy: false };
const GROUND_WINTER: GroundColors = { far: [60, 66, 82], near: [232, 236, 244], snowy: true };

/* 云量曲线工厂:base 是日均云量,weather 调峰值。晴=0.1、多云=0.5、雨/雪=0.85、雷暴=1、雾=0.4 */
function cloudCurve(base: number) {
  return (p: number) => {
    let cover = base;
    // 白天 buildup(正午前后云更多)
    if (p > 0.3 && p < 0.5) cover = lerp(cover, Math.min(1, cover + 0.2), smooth((p - 0.3) / 0.2));
    else if (p >= 0.5 && p < 0.74) cover = Math.min(1, cover + 0.15);
    else if (p >= 0.74 && p < 0.84) cover = lerp(cover, Math.max(0, cover - 0.3), smooth((p - 0.74) / 0.1));
    return clamp(cover, 0, 1);
  };
}

/* 12 个预设(季节×天气组合,排除冲突:春雪/夏雪/秋雪无,冬雨少见) */
export const PRESETS: Record<string, SkyPreset> = {
  "spring|clear":  { season: "spring", weather: "clear",  sky: springSky(), cloudCover: cloudCurve(0.1),  particles: "none", lightning: false, fogAlpha: 0, ground: GROUND_SPRING },
  "spring|cloudy": { season: "spring", weather: "cloudy", sky: springSky(), cloudCover: cloudCurve(0.5),  particles: "none", lightning: false, fogAlpha: 0, ground: GROUND_SPRING },
  "spring|rain":   { season: "spring", weather: "rain",   sky: springSky(), cloudCover: cloudCurve(0.85), particles: "rain", lightning: false, fogAlpha: 0, ground: GROUND_SPRING },
  "summer|clear":  { season: "summer", weather: "clear",  sky: summerSky(), cloudCover: cloudCurve(0.1),  particles: "none", lightning: false, fogAlpha: 0, ground: GROUND_SUMMER },
  "summer|cloudy": { season: "summer", weather: "cloudy", sky: summerSky(), cloudCover: cloudCurve(0.5),  particles: "none", lightning: false, fogAlpha: 0, ground: GROUND_SUMMER },
  "summer|rain":   { season: "summer", weather: "rain",   sky: summerSky(), cloudCover: cloudCurve(0.85), particles: "rain", lightning: false, fogAlpha: 0, ground: GROUND_SUMMER },
  "summer|storm":  { season: "summer", weather: "storm",  sky: summerSky(), cloudCover: cloudCurve(1.0),  particles: "rain", lightning: true,  fogAlpha: 0, ground: GROUND_SUMMER },
  "autumn|clear":  { season: "autumn", weather: "clear",  sky: autumnSky(), cloudCover: cloudCurve(0.15), particles: "none", lightning: false, fogAlpha: 0, ground: GROUND_AUTUMN, sunTint: [255, 180, 110] },
  "autumn|cloudy": { season: "autumn", weather: "cloudy", sky: autumnSky(), cloudCover: cloudCurve(0.55), particles: "none", lightning: false, fogAlpha: 0, ground: GROUND_AUTUMN },
  "autumn|storm":  { season: "autumn", weather: "storm",  sky: autumnSky(), cloudCover: cloudCurve(1.0),  particles: "rain", lightning: true,  fogAlpha: 0, ground: GROUND_AUTUMN },
  "winter|clear":  { season: "winter", weather: "clear",  sky: winterSky(), cloudCover: cloudCurve(0.2),  particles: "none", lightning: false, fogAlpha: 0, ground: GROUND_WINTER, sunTint: [220, 230, 245] },
  "winter|snow":   { season: "winter", weather: "snow",   sky: winterSky(), cloudCover: cloudCurve(0.9),  particles: "snow", lightning: false, fogAlpha: 0.2, ground: GROUND_WINTER },
};
export const PRESET_KEYS = Object.keys(PRESETS);

/** 确定性哈希(与 mapLayout.ts 的 hashStr 同语义,各自独立避免循环依赖)。 */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** 从 courseId + 时间种子随机抽一个预设 key。每次调用都可能不同(真随机,不持久化)。 */
export function pickPreset(courseId: string | null): string {
  // 用 courseId 哈希 + 当前时间戳 → 每次切课/启动都换
  const seed = `${courseId ?? "none"}:${Math.floor(performance.now() / 1000)}`;
  return PRESET_KEYS[hashStr(seed) % PRESET_KEYS.length]!;
}

function skyAt(p: number, sky: SkyStop[]): { top: RGB; mid: RGB; hor: RGB } {
  let i = 0;
  while (i < sky.length - 1 && p > sky[i + 1]!.t) i++;
  const a = sky[i]!;
  const b = sky[Math.min(i + 1, sky.length - 1)]!;
  const t = smooth(clamp((p - a.t) / ((b.t - a.t) || 1), 0, 1));
  return { top: mix3(a.top, b.top, t), mid: mix3(a.mid, b.mid, t), hor: mix3(a.hor, b.hor, t) };
}

/* ---- 日/月弧线 ----
   p=0 与 p=1 是同一个深夜(循环)。陆地剪影已移除,底部边缘即地平线 →
   天体从底部边缘升起、在天顶附近达到最高、再落回底部边缘。
   太阳:单段日间弧 升 p≈0.16 → 落 p≈0.88。
   月亮:单段夜间弧 跨 p=0/1 边界(晚升 p≈0.92 → 凌晨过中天 → 黎明落 p≈0.08)。 */
interface Body { x: number; y: number; peakness: number; }
function dayArc(p: number, W: number, H: number, rise: number, set: number): Body | null {
  if (p < rise || p > set) return null;
  const u = (p - rise) / (set - rise);
  const x = lerp(0.1, 0.9, u);
  // 至高点留在 header 下方(顶部留 26%,约 header 高度 + 余量,防被遮);地平线贴底
  const zenith = H * 0.26;
  const horizon = H * 0.98;
  const y = horizon - Math.sin(u * Math.PI) * (horizon - zenith);
  return { x: x * W, y, peakness: Math.sin(u * Math.PI) };
}
function nightArc(p: number, W: number, H: number, rise: number, set: number): Body | null {
  let u: number;
  if (p >= rise) u = (p - rise) / (1 - rise + set);
  else if (p <= set) u = (1 - rise + p) / (1 - rise + set);
  else return null;
  const x = lerp(0.12, 0.88, u);
  const zenith = H * 0.26;
  const horizon = H * 0.98;
  const y = horizon - Math.sin(u * Math.PI) * (horizon - zenith);
  return { x: x * W, y, peakness: Math.sin(u * Math.PI) };
}

/* ---- 静态层(尺寸变化时重建)---- */
interface Star { x: number; y: number; r: number; tw: number; sp: number; big: boolean; }
interface Cloud { x: number; y: number; s: number; speed: number; seed: number; drift: number; }

/** 确定性伪随机(种子),让星/云每次同位置 */
function mulberry(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStars(W: number, H: number): Star[] {
  const rand = mulberry(20260809);
  const N = Math.max(28, Math.round((W * H) / 7000));
  const out: Star[] = [];
  for (let i = 0; i < N; i++) {
    out.push({
      x: rand(),
      y: rand() * 0.7,
      r: rand() * 1.2 + 0.3,
      tw: rand() * Math.PI * 2,
      sp: 0.6 + rand() * 1.4,
      big: rand() < 0.06,
    });
  }
  return out;
}
function buildClouds(): Cloud[] {
  const rand = mulberry(7);
  const out: Cloud[] = [];
  for (let i = 0; i < 6; i++) {
    out.push({
      x: rand(),
      y: 0.12 + rand() * 0.4,
      s: 0.55 + rand() * 1.2,
      speed: 0.000018 + rand() * 0.000035,
      seed: rand() * 1000,
      drift: rand() * 0.035 + 0.008,
    });
  }
  return out;
}

/* ---- 绘制函数 ---- */
function drawSky(ctx: CanvasRenderingContext2D, c: { top: RGB; mid: RGB; hor: RGB }, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgbStr(c.top));
  g.addColorStop(0.55, rgbStr(c.mid));
  g.addColorStop(1, rgbStr(c.hor));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawStars(ctx: CanvasRenderingContext2D, p: number, stars: Star[], W: number, H: number, t: number) {
  let vis = 0;
  if (p < 0.22) vis = smooth(1 - p / 0.22);
  else if (p > 0.8) vis = smooth((p - 0.8) / 0.2);
  if (vis <= 0.01) return;
  for (const s of stars) {
    const tw = 0.55 + 0.45 * Math.sin(t * s.sp + s.tw);
    const a = vis * tw;
    if (a < 0.02) continue;
    ctx.fillStyle = `rgba(255,248,228,${a})`;
    const r = s.big ? s.r * 1.8 : s.r;
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H, r, 0, Math.PI * 2);
    ctx.fill();
    if (s.big) {
      ctx.fillStyle = `rgba(255,240,210,${a * 0.35})`;
      ctx.fillRect(s.x * W - r * 4, s.y * H - 0.4, r * 8, 0.8);
      ctx.fillRect(s.x * W - 0.4, s.y * H - r * 4, 0.8, r * 8);
    }
  }
}

function drawSun(ctx: CanvasRenderingContext2D, body: Body | null, tint?: RGB) {
  if (!body) return;
  const { x, y, peakness } = body;
  const R = 28 + peakness * 8;
  const halo = ctx.createRadialGradient(x, y, R * 0.4, x, y, R * 5);
  halo.addColorStop(0, "rgba(255,236,190,0.55)");
  halo.addColorStop(0.4, "rgba(255,210,150,0.16)");
  halo.addColorStop(1, "rgba(255,200,140,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - R * 5, y - R * 5, R * 10, R * 10);
  const disc = ctx.createRadialGradient(x, y, 0, x, y, R);
  // 季节染色(秋偏红橙、冬偏冷白);无 tint 用默认金黄
  const mid: RGB = tint ?? [255, 236, 180];
  const edge: RGB = tint ? mix3(tint, [255, 214, 150], 0.5) : [255, 214, 150];
  disc.addColorStop(0, "rgba(255,252,238,1)");
  disc.addColorStop(0.7, rgbaStr(mid, 1));
  disc.addColorStop(1, rgbaStr(edge, 0.9));
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
}

function drawMoon(ctx: CanvasRenderingContext2D, body: Body | null) {
  if (!body) return;
  const { x, y } = body;
  const R = 24;
  const halo = ctx.createRadialGradient(x, y, R * 0.8, x, y, R * 5);
  halo.addColorStop(0, "rgba(220,232,255,0.38)");
  halo.addColorStop(0.5, "rgba(220,232,255,0.1)");
  halo.addColorStop(1, "rgba(220,232,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - R * 5, y - R * 5, R * 10, R * 10);
  const disc = ctx.createRadialGradient(x - R * 0.25, y - R * 0.3, R * 0.2, x, y, R);
  disc.addColorStop(0, "rgba(255,254,247,1)");
  disc.addColorStop(0.7, "rgba(244,242,232,1)");
  disc.addColorStop(1, "rgba(214,222,236,1)");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(150,160,180,0.16)";
  const craters = [[-10, -6, 4], [5, 3, 5], [-3, 9, 3], [11, -8, 3]];
  for (const [dx, dy, r] of craters) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, tint: RGB, alpha: number) {
  const R = 18 * scale;
  const puffs = [[0, 0, 1], [-1.1, 0.1, 0.8], [1.1, 0.1, 0.8], [-0.5, -0.5, 0.7], [0.6, -0.45, 0.75], [-1.8, 0.3, 0.6], [1.8, 0.3, 0.6]];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = rgbaStr([tint[0] * 0.7, tint[1] * 0.7, tint[2] * 0.78], alpha * 0.9);
  for (const [dx, dy, s] of puffs) {
    ctx.beginPath();
    ctx.arc(dx * R, dy * R * 1.1 + R * 0.45, R * s * 1.05, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = rgbaStr(tint, alpha);
  for (const [dx, dy, s] of puffs) {
    ctx.beginPath();
    ctx.arc(dx * R, dy * R, R * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawClouds(ctx: CanvasRenderingContext2D, p: number, clouds: Cloud[], W: number, H: number, now: number, coverFn: (p: number) => number, sky: { top: RGB; mid: RGB; hor: RGB }, stormy: boolean) {
  const cover = coverFn(p);
  if (cover < 0.02) return;
  const lit = mix3(sky.hor, [255, 255, 255], 0.35);
  const dark = mix3(sky.mid, [20, 20, 30], 0.45);
  const tint = stormy ? dark : lit;
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    const x = (c.x + now * c.speed) % 1.2 - 0.1;
    const y = c.y + Math.sin(now * 0.0001 + c.seed) * c.drift;
    if (!(i / clouds.length < cover)) continue;
    drawCloud(ctx, x * W, y * H, c.s, tint, clamp(cover * 0.92, 0, 0.92));
  }
}

/* ---- 雨/雪/雾/闪电 ---- */
interface Drop { x: number; y: number; len: number; v: number; }
interface Flake { x: number; y: number; r: number; v: number; phase: number; }

/* 节点球天气装饰层(画在球上方的 canvas)。
   球位置由 getOrbs() 每帧提供(相对 canvas 坐标,含 balloon-bob 动画位移)。 */
export interface OrbPos { x: number; y: number; r: number; /** 物理雪载 0..1(传了则雪盖从动于此,不再自累积)。 */ snow?: number; }

/* 水流痕状态:每颗球独立的水流列表(雨球用)。key = 球 id(用 x,y 稳定时做 key 不可靠,
   所以用 orb 索引在 getOrbs 返回顺序稳定时可行;这里用 数组索引 i 做 key)。 */
interface OrbStreak {
  theta: number;   // 球面经度(哪一侧)
  prog: number;    // 沿球面往下的进度(0=顶, π=底)
  speed: number;
  len: number;
  thick: number;
  life: number;
}
const orbStreaks: OrbStreak[][] = []; // [球索引][] 每球的水流列表
let orbStreakTimer: number[] = [];

/* 雨滴溅起:雨滴击中球顶时飞溅的小水珠(带重力抛物线 + 生命衰减)。 */
interface Splash { x: number; y: number; vx: number; vy: number; life: number; }
const orbSplashes: Splash[][] = [];   // [球索引][] 每球的溅起水珠
let orbSplashTimer: number[] = [];    // 下次溅起的倒计时
/** 物理碰撞溅起(雨天水珠/雪天白屑),位置相对 sizeEl。 */
const impactBursts: Splash[] = [];

interface Snowflake {
  x: number; y: number; vx: number; vy: number;
  life: number;      // 剩余帧
  maxLife: number;
  r: number;
}
/** 球顶甩出的雪屑(物理 FlakeEvent 驱动):弹道下坠 + 渐隐消逝,不落地堆积。 */
const shedFlakes: Snowflake[] = [];

/* 雪堆状态:每颗球的积雪厚度(0..1),随雪花堆积增长。 */
let orbCaps: number[] = [];

/* ---- 雪 dome(参照 weather-orb):4 段贝塞尔画圆顶,凸出球顶 ---- */
/* 雪盖:覆盖球顶一定比例,边缘用贝塞尔贴合球面弧线自然下垂收边,顶部微隆起。
   cov 控制覆盖比例(0.5 = 球顶 1/2),用宽度比例定义区域,避免角度参数化
   在 90° 时端点塌缩到中线的 bug。 */
function drawSnowDome(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cap: number, _now: number) {
  if (cap < 0.04) return; // 残雪过薄不画(物理地板 6% → 只留一线小盖)
  const lift = r * (0.02 + cap * 0.07);  // 隆起随厚度:薄雪贴着球面,厚雪微凸
  const cov = 0.12 + cap * 0.73;          // 覆盖全量映射:12%..85%(薄雪只盖一点;
  // 原 0.7+cap*0.15 的映射雪载掉一半雪盖几乎不变,实测被用户抓过)
  // 雪线端点:按宽度比例定
  const lx = cx - r * cov;
  const rx = cx + r * cov;
  const edgeY = cy - Math.sqrt(Math.max(0, r * r - (r * cov) * (r * cov)));
  const peakY = cy - r - lift;            // 顶部最高点(微隆起)
  // 贝塞尔控制点(满足切线方向约束):
  //   端点处切线竖直 → 控制点与端点同 x(竖直方向上)
  //   顶点处切线水平 → 控制点与顶点同 y(peakY)
  //   控制点在端点和顶点之间,纵向居中 → 雪堆边缘圆润有厚度
  const ctrlY = (edgeY + peakY) / 2;      // 控制点 y = 端点和顶点的中点
  // 端点 x 处的控制点(竖直切线):左 ctrlX=lx,右 ctrlX=rx
  // 顶点 x=cx 处的控制点(水平切线):y=peakY
  // 用两段 cubic(3次贝塞尔)精确控制两端切线:
  //   左段:端点(lx,edgeY) → ctrl1(lx,ctrlY) 竖直 + ctrl2(cx±,peakY) 水平 → 顶点
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(lx, edgeY);
  // 左段 cubic:起点切线竖直(ctrl1 与起点同 x)、终点(顶点)切线水平(ctrl2 与顶点同 y)
  ctx.bezierCurveTo(lx, ctrlY, cx - r * 0.3, peakY, cx, peakY);
  // 右段 cubic:顶点切线水平(ctrl1 与顶点同 y)、终点切线竖直(ctrl2 与终点同 x)
  ctx.bezierCurveTo(cx + r * 0.3, peakY, rx, ctrlY, rx, edgeY);
  // 下轮廓(雪线,贴合球面):贝塞尔回左端,控制点沿球面弧下垂 → 自然收边
  ctx.quadraticCurveTo(cx, cy - r * 0.78, lx, edgeY);
  ctx.closePath();
  // 渐变:顶部纯白 → 雪线偏蓝灰(球面弧度立体感)
  const g = ctx.createLinearGradient(0, peakY, 0, edgeY);
  g.addColorStop(0, "rgba(255,255,255,0.98)");
  g.addColorStop(0.65, "rgba(245,250,255,0.95)");
  g.addColorStop(1, "rgba(218,230,246,0.9)");
  ctx.fillStyle = g;
  ctx.fill();
  // 雪线暗影(雪堆压在球面过渡,柔和弧)
  ctx.strokeStyle = "rgba(168,192,225,0.28)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(lx, edgeY);
  ctx.quadraticCurveTo(cx, cy - r * 0.78, rx, edgeY);
  ctx.stroke();
  ctx.restore();
}

/* ---- 水流痕(参照 weather-orb drawWet):沿球面弧线往下淌 ---- */
function surfPoint(cx: number, cy: number, r: number, a: number, th: number) {
  // a=纬度进度(0=顶..π=底), th=经度(球面哪一侧)
  const sa = Math.sin(a), ca = Math.cos(a);
  return { x: cx + Math.sin(th) * sa * r, y: cy - ca * r };
}
/* 湿润光泽:雨天球的表面被水膜覆盖,高光扩散成大面积柔光(不像干球是聚焦小亮点)。
   画法:左上方一个大面积、柔和高亮的径向渐变(水面漫反射),
   + 一道锐利镜面反光带(顶部细亮线,水膜的光泽反射)。
   clip 到球内,不溢出。 */
function drawWetGloss(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.99, 0, Math.PI * 2);
  ctx.clip();
  // 1. 大面积柔和高光(左上扩散,水面漫反射)—— 比干球的高光更大更柔
  const gloss = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 0, cx - r * 0.35, cy - r * 0.4, r * 0.8);
  gloss.addColorStop(0, "rgba(255,255,255,0.4)");
  gloss.addColorStop(0.5, "rgba(255,255,255,0.12)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // 2. 顶部锐利镜面反光带(水膜光泽,一道细亮弧)
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, Math.PI * 1.15, Math.PI * 1.5);
  ctx.stroke();
  ctx.restore();
}

/* 雨滴溅起:雨滴击中球顶时飞溅的小水珠。每个水珠带初速度(向外散+向上)
   + 重力(vy 递减)+ 生命衰减,画成渐淡的小圆点。模拟真实雨打水面的飞溅。 */
function drawShedFlakes(ctx: CanvasRenderingContext2D, flakes: Snowflake[]) {
  if (flakes.length === 0) return;
  ctx.save();
  for (let i = flakes.length - 1; i >= 0; i--) {
    const f = flakes[i]!;
    f.x += f.vx;
    f.y += f.vy;
    f.vy += 0.14;            // 重力(轻,雪屑飘)
    f.vx *= 0.985;           // 空气阻力
    f.vy *= 0.99;
    f.life--;
    if (f.life <= 0) { flakes.splice(i, 1); continue; }
    const k = f.life / f.maxLife; // 1→0:渐隐 + 微缩
    ctx.fillStyle = `rgba(248,250,255,${(0.9 * k).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * (0.5 + 0.5 * k), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSplashes(ctx: CanvasRenderingContext2D, splashes: Splash[]) {
  ctx.save();
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i]!;
    s.x += s.vx;
    s.y += s.vy;
    s.vy += 0.18;            // 重力
    s.life--;
    if (s.life <= 0) { splashes.splice(i, 1); continue; }
    const alpha = Math.min(1, s.life / 20) * 0.8;
    ctx.fillStyle = `rgba(215,238,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRainStreaks(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, streaks: OrbStreak[], _now: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.99, 0, Math.PI * 2);
  ctx.clip();
  for (let i = streaks.length - 1; i >= 0; i--) {
    const s = streaks[i]!;
    s.prog += s.speed;
    s.life--;
    if (s.prog > Math.PI * 1.05 || s.life <= 0) { streaks.splice(i, 1); continue; }
    // 画 7 段渐淡的弧线,贴合球面(通透:低 alpha,能透出球面色)
    const steps = 7;
    for (let k = 0; k < steps; k++) {
      const a1 = s.prog - s.len * (k / steps);
      const a2 = s.prog - s.len * ((k + 1) / steps);
      const p1 = surfPoint(cx, cy, r, a1, s.theta);
      const p2 = surfPoint(cx, cy, r, a2, s.theta);
      const alpha = (1 - k / steps) * 0.42;  // 降通透:0.7→0.42
      ctx.strokeStyle = `rgba(200,228,250,${alpha})`;
      ctx.lineWidth = s.thick * (1 - (k / steps) * 0.7);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    // 头部 3D 水珠(通透:半透青蓝水膜 + 中心亮折射点)
    const head = surfPoint(cx, cy, r, s.prog, s.theta);
    const dg = ctx.createRadialGradient(head.x - 1.2, head.y - 1.2, 0, head.x, head.y, s.thick * 1.3);
    dg.addColorStop(0, "rgba(255,255,255,0.85)");    // 中心折射高光(亮但小)
    dg.addColorStop(0.4, "rgba(180,215,240,0.5)");   // 水膜主体(半透青蓝)
    dg.addColorStop(1, "rgba(120,165,205,0.25)");    // 边缘(更透,融入球面)
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(head.x, head.y, s.thick * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* 在所有球上画天气装饰(雪 dome / 水流痕)。每帧调用。 */
function drawOrbWeather(
  ctx: CanvasRenderingContext2D,
  orbs: OrbPos[],
  preset: SkyPreset,
  now: number,
) {
  // 扩容状态数组(球数可能变化)
  while (orbStreaks.length < orbs.length) orbStreaks.push([]);
  while (orbStreakTimer.length < orbs.length) orbStreakTimer.push(0);
  while (orbCaps.length < orbs.length) orbCaps.push(0.3);
  while (orbSplashes.length < orbs.length) orbSplashes.push([]);
  while (orbSplashTimer.length < orbs.length) orbSplashTimer.push(0);

  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i]!;
    if (preset.particles === "snow") {
      // 雪盖唯一真值 = 物理雪载(拖动/碰撞甩掉、天气缓涨、封顶 1 全在物理层);
      // 物理没接进来(理论不发生)时退回自累积兜底。
      const cap = o.snow !== undefined ? o.snow : Math.min(1, (orbCaps[i] ?? 0.3) + 0.0008);
      orbCaps[i] = cap;
      drawSnowDome(ctx, o.x, o.y, o.r, cap, now);
    } else if (preset.particles === "rain") {
      // 湿润光泽(球面水膜反光)
      drawWetGloss(ctx, o.x, o.y, o.r);
      // 水流痕:定时生成新流(每球最多 3 条)
      orbStreakTimer[i] = (orbStreakTimer[i]! - 1);
      if (orbStreakTimer[i]! <= 0 && orbStreaks[i]!.length < 3) {
        const side = Math.random() < 0.5 ? -1 : 1;
        orbStreaks[i]!.push({
          theta: side * (0.2 + Math.random() * 0.3),
          prog: 0.1 + Math.random() * 0.2,
          speed: 0.012 + Math.random() * 0.012,
          len: 0.3 + Math.random() * 0.3,
          thick: 1.6 + Math.random() * 1.4,
          life: 250 + Math.random() * 200,
        });
        orbStreakTimer[i] = 40 + Math.random() * 60;
      }
      drawRainStreaks(ctx, o.x, o.y, o.r, orbStreaks[i]!, now);
      // 雨滴溅起:定时在球顶随机点击中,生成飞溅水珠
      orbSplashTimer[i] = (orbSplashTimer[i]! - 1);
      if (orbSplashTimer[i]! <= 0) {
        // 击中点:球顶上方随机 x(用圆方程算球面 y)
        const hx = o.x + (Math.random() - 0.5) * o.r * 1.2;
        const dx = hx - o.x;
        const hy = o.y - Math.sqrt(Math.max(0, o.r * o.r - dx * dx));
        // 生成 4-6 个飞溅水珠(向外散 + 向上)
        const n = 4 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const dir = dx < 0 ? -1 : 1;
          orbSplashes[i]!.push({
            x: hx,
            y: hy,
            vx: dir * (0.5 + Math.random() * 2) * (Math.random() < 0.5 ? -1 : 1),
            vy: -(1.5 + Math.random() * 2.5),
            life: 18 + Math.floor(Math.random() * 14),
          });
        }
        orbSplashTimer[i] = 30 + Math.floor(Math.random() * 50);
      }
      drawSplashes(ctx, orbSplashes[i]!);
    }
  }
}

function drawRain(ctx: CanvasRenderingContext2D, W: number, H: number, rain: Drop[], storm: boolean) {
  // 雨:垂直雨线(不斜飘)。常雨 = 细淡慢;暴风雨 = 更密更长更亮更急(雨势大)。
  ctx.save();
  ctx.strokeStyle = storm ? "rgba(205,224,244,0.42)" : "rgba(210,224,238,0.3)";
  ctx.lineWidth = storm ? 1.0 : 0.7;
  ctx.lineCap = "round";
  const speed = storm ? 0.013 : 0.007;
  for (const d of rain) {
    d.y += d.v * speed;
    if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
    const x = d.x * W, y = d.y * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + d.len); // 垂直
    ctx.stroke();
  }
  ctx.restore();
}

function drawSnow(ctx: CanvasRenderingContext2D, W: number, H: number, flakes: Flake[], now: number) {
  ctx.save();
  ctx.fillStyle = "rgba(250,250,255,0.85)";
  for (const f of flakes) {
    f.y += f.v * 0.004;
    const x = (f.x + Math.sin(now * 0.0005 + f.phase) * 0.02) * W;
    const y = f.y * H;
    if (f.y > 1) { f.y -= 1; }
    ctx.beginPath();
    ctx.arc(x, y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFog(ctx: CanvasRenderingContext2D, W: number, H: number, alpha: number, sky: { hor: RGB }) {
  const g = ctx.createLinearGradient(0, H * 0.4, 0, H);
  const c = mix3(sky.hor, [255, 255, 255], 0.3);
  g.addColorStop(0, rgbaStr(c, 0));
  g.addColorStop(1, rgbaStr(c, alpha));
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.4, W, H * 0.6);
}

let flash = 0;
let nextStrike = 0;
function drawLightning(ctx: CanvasRenderingContext2D, W: number, H: number, active: boolean, now: number) {
  if (!active) { flash = 0; return; }
  if (now > nextStrike) {
    flash = 1;
    nextStrike = now + 1400 + Math.random() * 2600;
  }
  flash *= 0.86;
  if (flash < 0.02) { flash = 0; return; }
  ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`;
  ctx.fillRect(0, 0, W, H);
  if (flash > 0.6) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = "rgba(220,230,255,0.9)";
    ctx.shadowBlur = 22;
    let x = W * (0.3 + Math.random() * 0.4), y = 0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (y < H * 0.6) {
      x += (Math.random() - 0.5) * 60;
      y += 24 + Math.random() * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/* ---- 主入口:attach 返回 detach ----
   用法:const detach = attachSky(canvasEl, scrollEl, sizeEl, preset); return detach;
   canvas 铺满 sizeEl(整个左栏,含 header),滚动进度读 scrollEl(map-path)。
   preset 决定季节色板 + 天气粒子层(雨/雪/雾/闪电)。 */
export function attachSky(
  canvas: HTMLCanvasElement,
  scroll: HTMLElement,
  sizeEl: HTMLElement,
  preset: SkyPreset,
): () => void {
  const ctx0 = canvas.getContext("2d");
  if (!ctx0) return () => {};
  // 下方 function 声明(hoist)捕获 ctx,TS 不对 const 做 hoist 收窄 → 显式非空类型固化。
  const ctx: CanvasRenderingContext2D = ctx0;
  const sizeTarget = sizeEl;
  // 天空 canvas 永远是深色(夜空感)——浅色模式下也保留深色天空,不提亮。
  // 浅色模式的其他 UI(token/prose/组件)正常切浅色,但天空是沉浸场景保持深色。

  let W = 0, H = 0, DPR = 1;
  let stars = buildStars(1, 1);
  const clouds = buildClouds();
  let rain: Drop[] = [];
  let flakes: Flake[] = [];
  let scrollP = 0;
  let rafId = 0;
  let running = true;
  const T0 = performance.now();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const rect = sizeTarget.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    stars = buildStars(W, H);
    // 按预设重建粒子池
    if (preset.particles === "rain" && rain.length === 0) {
      // 暴风雨:雨滴数翻倍、线更长、落更急(雨势大的三个维度)
      const stormRain = preset.weather === "storm";
      const count = stormRain ? 140 : 70;
      for (let i = 0; i < count; i++) {
        rain.push({
          x: Math.random(),
          y: Math.random(),
          len: stormRain ? 12 + Math.random() * 14 : 6 + Math.random() * 8,
          v: stormRain ? 0.9 + Math.random() * 0.4 : 0.5 + Math.random() * 0.3,
        });
      }
    }
    if (preset.particles === "snow" && flakes.length === 0) {
      for (let i = 0; i < 120; i++) flakes.push({ x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 1.6, v: 0.5 + Math.random() * 0.8, phase: Math.random() * Math.PI * 2 });
    }
  }

  function readScroll() {
    const max = scroll.scrollHeight - scroll.clientHeight;
    scrollP = max > 0 ? clamp(scroll.scrollTop / max, 0, 1) : 0;
  }

  function frame(now: number) {
    if (!running) return;
    const p = scrollP;
    const t = reduced ? 0 : (now - T0) / 1000;
    const sky = skyAt(p, preset.sky);
    drawSky(ctx, sky, W, H);
    drawStars(ctx, p, stars, W, H, t);
    drawMoon(ctx, nightArc(p, W, H, 0.92, 0.08));
    drawSun(ctx, dayArc(p, W, H, 0.16, 0.88), preset.sunTint);
    drawClouds(ctx, p, clouds, W, H, now, preset.cloudCover, sky, preset.weather === "storm");
    if (preset.particles === "rain") drawRain(ctx, W, H, rain, preset.weather === "storm");
    if (preset.particles === "snow") drawSnow(ctx, W, H, flakes, now);
    if (preset.fogAlpha > 0) drawFog(ctx, W, H, preset.fogAlpha, sky);
    if (preset.lightning) drawLightning(ctx, W, H, true, now);
    // reduced-motion: 不连续排程,只画单帧(配合下方 reduced 双轨降级)
    if (!reduced) rafId = requestAnimationFrame(frame);
  }

  const onScroll = () => readScroll();
  const ro = new ResizeObserver(() => { resize(); readScroll(); });
  ro.observe(sizeTarget);

  resize();
  readScroll();
  // reduced-motion 双轨:reduced 时不跑连续 rAF,scroll 时用 rAF coalesce 重绘单帧
  // (原 bug:frame() 无条件 self-reschedule,reduced 路径反而连续动画 + 每事件重绘)
  let onScrollHandler: (e: Event) => void;
  if (reduced) {
    let pending = false;
    onScrollHandler = () => {
      readScroll();
      if (!pending) {
        pending = true;
        requestAnimationFrame(() => { pending = false; frame(performance.now()); });
      }
    };
    scroll.addEventListener("scroll", onScrollHandler, { passive: true });
    frame(performance.now()); // 初始单帧
  } else {
    onScrollHandler = onScroll;
    scroll.addEventListener("scroll", onScrollHandler, { passive: true });
    rafId = requestAnimationFrame(frame);
  }

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    ro.disconnect();
    scroll.removeEventListener("scroll", onScrollHandler);
  };
}

/* ---- 球天气装饰层 attach ----
   独立 canvas(z-20,盖在球 DOM 之上),只画球上的雪 dome / 水流痕。
   getOrbs() 每帧返回球相对 canvas 的坐标(含 balloon-bob 动画位移)。
   与 attachSky 共享同一 rAF 节奏(这里单独起一个,因为画在不同 canvas)。 */
export function attachOrbWeather(
  canvas: HTMLCanvasElement,
  sizeEl: HTMLElement,
  preset: SkyPreset,
  getOrbs: () => OrbPos[],
  getImpacts?: () => { x: number; y: number; speed: number }[],
  getFlakes?: () => { x: number; y: number; vx: number; vy: number; amount: number }[],
): () => void {
  // 切换 preset 时总是清空上一个天气的残留状态 + 清 canvas(修 bug:
  // rain→clear 时旧水流痕残留;晴/多云早返回但不清状态导致画面卡住)
  const resetState = () => {
    orbStreaks.length = 0;
    orbCaps.length = 0;
    orbStreakTimer.length = 0;
    orbSplashes.length = 0;
    orbSplashTimer.length = 0;
    impactBursts.length = 0;
    shedFlakes.length = 0;
    const c = canvas.getContext("2d");
    if (c) c.clearRect(0, 0, canvas.width, canvas.height);
  };
  resetState();

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // reduced-motion: 球天气装饰(雪堆积/水流痕)是纯装饰动画,reduced 时不画(静态降级,
  // 修原 bug:attachOrbWeather 完全无视 reduced 标志,总是启动 rAF)
  if (reduced) return () => {};

  // 雪天/雨天之外不画(晴/多云:清完状态 + canvas 后早返回)
  if (preset.particles !== "rain" && preset.particles !== "snow") return () => {};

  const ctx0 = canvas.getContext("2d");
  if (!ctx0) return () => {};
  // 下方 function 声明(hoist)捕获 ctx,TS 不对 const 做 hoist 收窄 → 显式非空类型固化。
  const ctx: CanvasRenderingContext2D = ctx0;

  let W = 0, H = 0, DPR = 1;
  let rafId = 0;
  let running = true;

  function resize() {
    const rect = sizeEl.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function frame(now: number) {
    if (!running) return;
    ctx.clearRect(0, 0, W, H); // 透明 canvas,每帧清空重画
    const orbs = getOrbs();
    drawOrbWeather(ctx, orbs, preset, now);
    // 物理碰撞 → 天气反馈(坐标同 getOrbs,相对 sizeEl):
    //   雨:命中点溅起水珠(速度越大越多);雪:震落命中球附近雪顶(掉厚度 + 白屑)
    if (getImpacts) {
      for (const im of getImpacts()) {
        const n = 3 + Math.min(5, Math.floor(im.speed / 3));
        for (let k = 0; k < n; k++) {
          impactBursts.push({
            x: im.x,
            y: im.y,
            vx: (Math.random() - 0.5) * 3.2,
            vy: -(1.5 + Math.random() * 2.5),
            life: 16 + Math.floor(Math.random() * 12),
          });
        }
        // 雪盖消减不再在此做:物理碰撞已 shedSnow 减 b.snow,雪盖从动渲染
      }
      if (impactBursts.length > 0) drawSplashes(ctx, impactBursts);
    }
    // 球顶甩雪(物理事件):每个事件生成 1-3 片可见雪屑,弹道 + 渐隐;
    // 同时把来源球的视觉雪盖按量削掉(物理 b.snow 已同步扣,这里只管观感对齐)
    if (getFlakes) {
      for (const f of getFlakes()) {
        const cnt = 1 + Math.min(2, Math.round(f.amount * 40));
        for (let k = 0; k < cnt; k++) {
          const maxLife = 55 + Math.floor(Math.random() * 40); // ~1-1.6s 消逝
          shedFlakes.push({
            x: f.x + (Math.random() - 0.5) * 8,
            y: f.y + (Math.random() - 0.5) * 6,
            vx: f.vx * 0.6 + (Math.random() - 0.5) * 0.8,
            vy: f.vy * 0.6 - Math.random() * 0.5,
            life: maxLife,
            maxLife,
            r: 1.2 + Math.random() * 2.2,
          });
        }
        // (雪盖消减由物理 b.snow 从动,这里只生成可见雪屑粒子)
      }
      while (shedFlakes.length > 240) shedFlakes.shift();
      drawShedFlakes(ctx, shedFlakes);
    }
    rafId = requestAnimationFrame(frame);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(sizeEl);
  resize();
  rafId = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    ro.disconnect();
    resetState();
  };
}
