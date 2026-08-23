// Vendored from LookatStudy shared/exam-logic.ts + src/main/services/exam-service.ts
// (accuracyToStars) + src/renderer/lib/post-quiz-actions.ts (MIT License,
// https://github.com/Kaiji-Z/LookatStudy). Pure exam semantics, verbatim where
// possible; the DB-backed attempt lifecycle stays upstream-only (the plugin's
// exam attempts are conversational — the tutor grades through study_record_answer,
// and study_exam_result consumes these pure functions for stars/actions).

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
