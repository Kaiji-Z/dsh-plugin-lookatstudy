/**
 * Plugin configuration schema (Schemastery) for dsh-plugin-lookatstudy.
 * @module dsh-plugin-lookatstudy/config
 */

import z from '@deepseek-ai/schemastery'

/** Tutoring soul injected into the system prompt (LookatStudy's three builtin souls). */
export type TutorMode = 'direct' | 'guide' | 'practice'

/** Resolved plugin configuration. */
export interface Config {
  /**
   * Initial tutoring soul: `guide` asks questions and hands over steps
   * (default), `direct` explains first then verifies, `practice` teaches
   * inside real messy problems. The learner can switch at any time and the
   * choice persists in the learning state.
   */
  mode: TutorMode
  /**
   * Absolute path of the JSON learning-state file. Empty resolves to
   * `$DSH_HOME/lookatstudy-plugin/state.json` (`~/.dsh` when `DSH_HOME` is unset).
   */
  statePath: string
}

/** Schemastery configuration validated at plugin load. */
export const Config: z<Config> = z.object({
  mode: z.union(['direct', 'guide', 'practice'] as const).default('guide'),
  statePath: z.string().default(''),
})
