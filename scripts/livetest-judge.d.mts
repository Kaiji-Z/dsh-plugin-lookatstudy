/**
 * Type surface for livetest-judge.mjs (the Layer-2 judge runner) so the
 * structural purity test can import it under tsc --noEmit without JS
 * allowJs noise. Signatures mirror the mjs exactly — keep in sync when the
 * runner's exports change.
 */

export declare const PASS_SCORE: number

export interface JudgeCriterion {
  id: string
  text: string
}

export interface Judgement {
  criteria: Array<{ id: string; score: number; deductions: string }>
  summary: string
}

export interface Verdict {
  pass: boolean
  minScore: number
  meanScore: number
}

export declare function parseCriteria(criteriaMd: string): JudgeCriterion[]
export declare function buildPrompt(criteriaMd: string, transcript: string): string
export declare function parseJudgement(raw: string, criteria: JudgeCriterion[]): Judgement
export declare function evaluateVerdict(judgement: Judgement): Verdict
