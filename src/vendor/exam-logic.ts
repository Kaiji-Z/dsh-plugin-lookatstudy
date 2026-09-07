// Vendored from LookatStudy shared/exam-logic.ts + src/main/services/exam-service.ts
// (accuracyToStars) + src/renderer/lib/post-quiz-actions.ts (MIT License,
// https://github.com/Kaiji-Z/LookatStudy). Pure exam semantics, verbatim where
// possible. Since P12 (exam-v2) the attempt lifecycle also lives in the plugin's
// state (bank + attempts in state.json); study_exam_result remains for
// conversational grading and shares the same star thresholds.

/** 每场考试的题量上限/下限。 */
export const EXAM_MIN_QUESTIONS = 5;
export const EXAM_MAX_QUESTIONS = 15;

/**
 * 题量规划:目标题数 = clamp(ceil(KC数 × 1.5), 5, 15),round-robin 分配到各 KC。
 * 返回与 kcTitles 等长的数组,每项 = 该 KC 出几题。
 * 例:4 KC → 6 题 [2,2,1,1];8 KC → 12 题 [2,2,2,2,1,1,1,1];12 KC → 15 题。
 */
export function planExamQuota(kcTitles: string[]): number[] {
  const n = kcTitles.length;
  if (n === 0) return [];
  const target = Math.min(
    EXAM_MAX_QUESTIONS,
    Math.max(EXAM_MIN_QUESTIONS, Math.ceil((n * 3) / 2)),
  );
  const quotas = Array.from({ length: n }, () => 0);
  for (let i = 0; i < target; i++) {
    quotas[i % n]!++;
  }
  return quotas;
}

/**
 * 每题答题限时(秒,v0.19 动态宽松):45 基础 + 中文/全角字数÷5 + 英文词数÷3
 * + 选项数×8 + 围栏代码块 25 + 行内/行间公式 25,clamp(60, 300)。
 */
export function questionTimeLimitSec(prompt: string, optionCount = 4): number {
  const cjk = (prompt.match(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g) ?? []).length;
  const words = (prompt.match(/[A-Za-z]+/g) ?? []).length;
  let s = 45 + Math.ceil(cjk / 5) + Math.ceil(words / 3) + Math.max(0, optionCount) * 8;
  if (prompt.includes("```")) s += 25;
  if (/\$\$?[^$\n]+\$\$?/.test(prompt)) s += 25;
  return Math.max(60, Math.min(300, Math.round(s)));
}

/** 正确率 → 星数(1-3)。低于 60% 得 0 星(但会记录尝试)。 */
export function accuracyToStars(accuracy: number): number {
  if (accuracy >= 0.95) return 3;
  if (accuracy >= 0.8) return 2;
  if (accuracy >= 0.6) return 1;
  return 0;
}

/* ---- post-quiz actions (upstream renderer/lib/post-quiz-actions.ts) ---- */

const MASTERED_MASTERY_THRESHOLD = 0.9;
const NEAR_MASTERED_THRESHOLD = 0.85;

export interface PostQuizAction {
  id: "explain-wrong" | "retry" | "go-deeper" | "mark-mastered" | "next-topic";
  /** mark-mastered advances mastery (maps to study_propose_mastery in this plugin). */
  advancesMastery?: boolean;
}

/**
 * 答完题后的"下一步"动作集合。永远 >= 2 个动作(消灭死胡同)。
 * mark-mastered 只在"全对 + 高掌握度"时出现(避免误判掌握)。
 */
export function getPostQuizActions(
  score: { correct: number; total: number },
  mastery: number | null,
): PostQuizAction[] {
  const { correct, total } = score;
  const allCorrect = total > 0 && correct === total;
  const hasWrong = total > 0 && correct < total;
  const alreadyMastered = mastery != null && mastery >= MASTERED_MASTERY_THRESHOLD;
  const nearMastered = mastery != null && mastery >= NEAR_MASTERED_THRESHOLD;

  if (hasWrong) {
    return [{ id: "explain-wrong" }, { id: "retry" }];
  }
  if (allCorrect && alreadyMastered) {
    return [{ id: "next-topic" }, { id: "go-deeper" }];
  }
  if (allCorrect && nearMastered) {
    return [
      { id: "mark-mastered", advancesMastery: true },
      { id: "next-topic" },
      { id: "go-deeper" },
    ];
  }
  return [{ id: "go-deeper" }, { id: "retry" }];
}

/** 一次考试的重排:题序 + 每题选项序(重新考试时两者都变)。 (upstream verbatim) */
export interface AttemptShuffle {
  /** 题目显示顺序:显示位置 i → 原 items 数组下标 */
  questionOrder: number[];
  /** 每题选项排列:显示选项位 j → 原选项下标 */
  optionPerms: Record<string, number[]>;
}

/** FNV-1a 字符串哈希 → 32 位种子(与 mapLayout.hashStr 同族,独立实现避免跨层 import)。 */
function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32:小而稳的可种子 PRNG(重排可复现,测试可断言)。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗 [0, n) 的排列。 */
function shuffledIndices(n: number, rand: () => number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** 用 attemptId 作种子构建一次考试的重排(同种子确定,不同 attempt 两序皆变)。 */
export function buildAttemptShuffle(
  items: Array<{ id: string; optionCount: number }>,
  seed: string,
): AttemptShuffle {
  const rand = mulberry32(hashSeed(seed));
  const questionOrder = shuffledIndices(items.length, rand);
  const optionPerms: Record<string, number[]> = {};
  for (const it of items) {
    optionPerms[it.id] = shuffledIndices(Math.max(1, it.optionCount), rand);
  }
  return { questionOrder, optionPerms };
}

/** 显示选项位 → 原始选项下标(字符串;渲染端第 j 位显示 options[perm[j]],与此配对)。 */
export function displayAnswerToOriginal(perm: number[], displayIdx: number): string {
  return perm[displayIdx] !== undefined ? String(perm[displayIdx]) : String(displayIdx);
}
