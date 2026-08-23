// Vendored from LookatStudy src/main/services/pure/streak-transition.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Unmodified except this provenance header.
/**
 * Streak 状态转移 —— 纯函数，零依赖。
 *
 * 与 sm2.ts 同理：streak.ts 顶层 import electron + DB，纯 Node 测试环境加载即崩。
 * 把"纯状态机逻辑"抽到这里，streak.ts 调用它 + 负责读写 DB。
 *
 * 语义（streak freeze 通用语义）：
 * - lastActiveDate == today: 不变（同日幂等）
 * - lastActiveDate == yesterday: currentStreak++
 * - gap=2（前天打、昨天漏、今天回）+ freeze>0: 消耗一个 freeze，currentStreak++
 * - 其他（gap>=3 或 freeze 用完）: 重置为 1
 *
 * 这里的 freeze 语义是项目的留存杠杆，off-by-one 曾造成 bug（见 BUILD-NOTES），
 * 所以这一段必须被真实源码测试覆盖。
 */

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  /** ISO date YYYY-MM-DD, or null if never active */
  lastActiveDate: string | null;
  freezeCount: number;
}

function todayStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function yesterdayStr(now: Date = new Date()): string {
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return todayStr(y);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db.getTime() - da.getTime()) / (24 * 60 * 60 * 1000));
}

export function computeStreakTransition(
  state: StreakState,
  now: Date = new Date(),
): StreakState {
  const today = todayStr(now);
  const yesterday = yesterdayStr(now);

  if (state.lastActiveDate === today) {
    return state; // 幂等
  }

  let newCurrent: number;
  let newFreeze = state.freezeCount;

  if (state.lastActiveDate === yesterday) {
    newCurrent = state.currentStreak + 1;
  } else if (state.lastActiveDate === null) {
    newCurrent = 1;
  } else {
    const gap = daysBetween(state.lastActiveDate, today);
    if (gap === 2 && state.freezeCount > 0) {
      newFreeze = state.freezeCount - 1;
      newCurrent = state.currentStreak + 1;
    } else {
      newCurrent = 1;
    }
  }

  const newLongest = Math.max(state.longestStreak, newCurrent);

  return {
    currentStreak: newCurrent,
    longestStreak: newLongest,
    lastActiveDate: today,
    freezeCount: newFreeze,
  };
}
