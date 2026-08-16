// Vendored from LookatStudy src/main/services/pure/sm2.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header. PDF/PPTX branches resolve unavailable optional libs and are skipped per upstream try/catch.
/**
 * SM-2 间隔重复算法 —— 纯函数，零依赖（不 import DB / electron / @shared）。
 *
 * 为什么单独一个 pure/ 文件：
 * 测试（scripts/verify-srs.mjs）需要 import 真实源码而非副本（VERIFICATION §3.1），
 * 但 srs.ts 顶层 import electron + DB，纯 Node 环境加载即崩。
 * 把纯算法抽到这里，srs.ts re-export，测试只 import 这个文件 —— 既能测真实源码，又不引入运行时副作用。
 *
 * 算法参考：https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method
 *
 * quality: 0-5
 *   0-2: 答错，重置 repetitions=0，interval=1
 *   3: 勉强对
 *   4-5: 答对，推进 repetitions
 * easeFactor: 1.3 ~ 3.0，初始 2.5
 */

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

export interface Sm2State {
  easeFactor: number; // 1.3 ~ 3.0
  intervalDays: number;
  repetitions: number;
}

export interface Sm2Result extends Sm2State {
  dueAt: string; // ISO date
}

export function computeSm2(
  prev: Sm2State,
  quality: ReviewQuality,
  now: Date = new Date(),
): Sm2Result {
  let { easeFactor, intervalDays, repetitions } = prev;

  if (quality < 3) {
    // 答错：重置
    repetitions = 0;
    intervalDays = 1;
  } else {
    // 答对：推进
    repetitions += 1;
    if (repetitions === 1) {
      intervalDays = 1;
    } else if (repetitions === 2) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
  }

  // 更新 EF：EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  const q = quality;
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  easeFactor = Math.max(1.3, Math.min(3.0, easeFactor + delta));

  const dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return { easeFactor, intervalDays, repetitions, dueAt: dueAt.toISOString() };
}
