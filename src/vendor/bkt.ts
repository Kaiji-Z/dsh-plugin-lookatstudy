// Vendored from LookatStudy src/main/services/pure/bkt.ts (MIT License, https://github.com/kaiji/LookatStudy).
// Unmodified except this provenance header. PDF/PPTX branches resolve unavailable optional libs and are skipped per upstream try/catch.
/**
 * Bayesian Knowledge Tracing (BKT) —— 掌握度概率的贝叶斯更新。
 *
 * 这是差异化护城河之一（多数 AI 家教停留在检索增强,无显式掌握度建模）。
 * 经典 BKT 四参数（文献默认，R1 风险项已定）：
 *   P(L0)  初始已掌握概率  = 0.5   （无先验信息时五五开）
 *   P(T)   每次学习后 未掌握→掌握 = 0.1 （单次学习能转化的概率）
 *   P(S)   已掌握但答错（slip）   = 0.1
 *   P(G)   未掌握但答对（guess）   = 0.2
 *
 * 更新公式（观察到观测 correct 后）：
 *   先按当前 P(L) 算"答对/答错的似然"
 *   后验 P(L|obs) = P(obs|L)·P(L) / P(obs)
 *   再乘 (1 + P(T)·(1-P(L))/P(L)) 做"学习迁移"
 *
 * 纯函数零依赖，测试直接 import 真实源码（VERIFICATION §3.1）。
 */

export interface BktParams {
  /** 初始掌握概率 [0,1] */
  pInit: number;
  /** transit 未掌握→掌握 [0,1] */
  pTransit: number;
  /** slip 已掌握答错 [0,1] */
  pSlip: number;
  /** guess 未掌握答对 [0,1] */
  pGuess: number;
}

/** 文献默认参数（ROADMAP R1：先验用文献默认，数据多后再调） */
export const BKT_DEFAULTS: BktParams = {
  pInit: 0.5,
  pTransit: 0.1,
  pSlip: 0.1,
  pGuess: 0.2,
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * 单次观测后的掌握度更新。
 *
 * @param prev   更新前的 P(L)。null/undefined → 用 params.pInit
 * @param correct 这次观测是否答对
 * @param params BKT 四参数（默认文献值）
 * @returns 新的 P(L)，已 clamp 到 [0,1]
 */
export function updateMastery(
  prev: number | null | undefined,
  correct: boolean,
  params: BktParams = BKT_DEFAULTS,
): number {
  const pL = clamp01(prev ?? params.pInit);
  const { pTransit, pSlip, pGuess } = params;

  // 1. 后验（不做 transit）：P(L|obs)
  //    P(obs=correct | L) = 1 - P(slip)
  //    P(obs=wrong   | L) = P(slip)
  //    P(obs=correct | ¬L) = P(guess)
  //    P(obs=wrong   | ¬L) = 1 - P(guess)
  const pObsGivenL = correct ? 1 - pSlip : pSlip;
  const pObsGivenNotL = correct ? pGuess : 1 - pGuess;
  const pObs = pObsGivenL * pL + pObsGivenNotL * (1 - pL);
  if (pObs === 0) return pL; // 数值退化兜底
  const pLGivenObs = (pObsGivenL * pL) / pObs;

  // 2. 学习迁移：这次观测后，未掌握者可能 transit 到掌握
  //    P(L)' = P(L|obs) + P(T)·(1 - P(L|obs))
  const pLAfterTransit = pLGivenObs + pTransit * (1 - pLGivenObs);

  return clamp01(pLAfterTransit);
}

/**
 * 把 mastery 概率映射成 crown level（1-5）给 UI 用。
 * < 0.3 → 1, <0.5 → 2, <0.7 → 3, <0.9 → 4, ≥0.9 → 5。null → 0。
 */
export function masteryToCrown(mastery: number | null | undefined): number {
  if (mastery == null) return 0;
  if (mastery < 0.3) return 1;
  if (mastery < 0.5) return 2;
  if (mastery < 0.7) return 3;
  if (mastery < 0.9) return 4;
  return 5;
}
