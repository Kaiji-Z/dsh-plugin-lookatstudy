// Vendored from LookatStudy src/main/services/xp-service.ts (MIT License, https://github.com/Kaiji-Z/LookatStudy).
// Only the pure half (constants + level curve + status math); the DB-backed
// ledger becomes plugin state fields (state.xp), advanced by noteXpActivity.

/** XP awards (upstream T1). */
export const XP_CORRECT = 10;
export const XP_WRONG = 1;
export const XP_MASTERED = 50;
/** Default daily XP goal (upstream DEFAULT_DAILY_GOAL). */
export const DEFAULT_DAILY_GOAL = 30;

/** Level curve (upstream): level = floor(sqrt(total/50)) — quadratic spans. */
export function levelFromTotalXp(totalXp: number): {
  level: number;
  pct: number;
  intoLevel: number;
  levelSpan: number;
} {
  const safe = Math.max(0, Math.floor(totalXp));
  const level = Math.floor(Math.sqrt(safe / 50));
  const curStart = 50 * level * level;
  const nextStart = 50 * (level + 1) * (level + 1);
  const span = nextStart - curStart;
  const into = safe - curStart;
  const pct = span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 0;
  return { level, pct, intoLevel: into, levelSpan: span };
}

/** Local calendar-day key (upstream dailyXpKey semantics, local timezone). */
export function dailyXpKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
