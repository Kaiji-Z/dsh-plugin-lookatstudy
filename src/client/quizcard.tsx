/**
 * The interactive practice card (0.15.0 P1, upstream QuizArtifact port):
 * local judging, per-artifact progress in localStorage, the completion score,
 * and the post-quiz action set — the deterministic half of "what next after
 * answering" (never fewer than two exits; upstream post-quiz-actions.ts).
 * Pure logic + one React card; thresholds mirror state.ts (0.9 graduation /
 * 0.85 near — the client bundle cannot import the host-side state module).
 * @module dsh-plugin-lookatstudy/client/quizcard
 */

import { createElement, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { IconBoltFill16, IconBookFill16, IconCrownFill16, IconRefreshOutline16, IconStarFill16 } from './icons.tsx'
import { tr } from './locale.ts'

/** Mirror of state.ts MASTERED_THRESHOLD (graduation). */
export const MASTERED = 0.9
/** Mirror of state.ts NEAR_MASTERED_THRESHOLD (proposal zone). */
export const NEAR_MASTERED = 0.85

export type PostQuizActionId = 'explain-wrong' | 'retry' | 'go-deeper' | 'mark-mastered' | 'next-topic'

export interface PostQuizAction {
  id: PostQuizActionId
  /** true = the action asks the tutor to test/graduate (mark-mastered only). */
  advancesMastery: boolean
}

/**
 * The exits after one finished card — never fewer than two (the anti-dead-end
 * promise). Wrong answers → patch the hole first; perfect + near-mastered →
 * offer the mastery exit; perfect + already graduated → move on.
 * Pure port of upstream getPostQuizActions.
 */
export function getPostQuizActions(score: { correct: number; total: number }, mastery: number | null): PostQuizAction[] {
  const { correct, total } = score
  const allCorrect = total > 0 && correct === total
  const hasWrong = total > 0 && correct < total
  const alreadyMastered = mastery !== null && mastery >= MASTERED
  const nearMastered = mastery !== null && mastery >= NEAR_MASTERED
  if (hasWrong) return [{ id: 'explain-wrong', advancesMastery: false }, { id: 'retry', advancesMastery: false }]
  if (allCorrect && alreadyMastered) return [{ id: 'next-topic', advancesMastery: false }, { id: 'go-deeper', advancesMastery: false }]
  if (allCorrect && nearMastered) return [{ id: 'mark-mastered', advancesMastery: true }, { id: 'go-deeper', advancesMastery: false }]
  if (allCorrect) return [{ id: 'go-deeper', advancesMastery: false }, { id: 'retry', advancesMastery: false }]
  return [{ id: 'explain-wrong', advancesMastery: false }, { id: 'retry', advancesMastery: false }]
}

/** The quiz payload shape (structural slice of the sanitized artifact data). */
export interface QuizData {
  readonly questions: ReadonlyArray<{ readonly prompt: string; readonly options: readonly string[]; readonly answer: number; readonly explanation: string }>
  readonly title?: string
  readonly warnings?: readonly string[]
}

/** Progress under localStorage: chosen option per question (-1 unanswered). */
export interface QuizProgress {
  readonly answers: number[]
  readonly done: boolean
}

/** localStorage key (upstream quizProgressKey semantics: per artifact). */
export function quizProgressKey(lessonId: string, artifactId: string): string {
  return `dsh-plugin-lookatstudy:quiz:${lessonId}:${artifactId}`
}

export function loadQuizProgress(lessonId: string, artifactId: string, questionCount: number, storage: Pick<Storage, 'getItem'> = localStorage): QuizProgress {
  try {
    const raw = storage.getItem(quizProgressKey(lessonId, artifactId))
    if (raw === null) return { answers: Array<number>(questionCount).fill(-1), done: false }
    const parsed = JSON.parse(raw) as { answers?: unknown; done?: unknown }
    const answers = Array.isArray(parsed.answers)
      ? parsed.answers.map(a => (typeof a === 'number' ? a : -1))
      : []
    const padded = Array<number>(questionCount).fill(-1)
    for (let i = 0; i < Math.min(answers.length, questionCount); i += 1) padded[i] = answers[i]!
    return { answers: padded, done: parsed.done === true }
  } catch {
    return { answers: Array<number>(questionCount).fill(-1), done: false }
  }
}

export function saveQuizProgress(lessonId: string, artifactId: string, progress: QuizProgress, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(quizProgressKey(lessonId, artifactId), JSON.stringify(progress))
  } catch { /* storage unavailable — progress degrades to in-memory */ }
}

/** The score over recorded answers (pure). */
export function quizScore(data: QuizData, answers: readonly number[]): { correct: number; total: number } {
  let correct = 0
  let total = 0
  data.questions.forEach((q, i) => {
    const choice = answers[i]
    if (choice === undefined || choice < 0) return
    total += 1
    if (choice === q.answer) correct += 1
  })
  return { correct, total }
}

const ACTION_ICONS: Record<PostQuizActionId, (props: { size?: number }) => ReactNode> = {
  'explain-wrong': IconBookFill16,
  'retry': IconRefreshOutline16,
  'go-deeper': IconBoltFill16,
  'mark-mastered': IconCrownFill16,
  'next-topic': IconStarFill16,
}

/**
 * The card: one question at a time, click-to-answer (instant local judge +
 * explanation reveal — the cursor is explicit, so the reveal is never skipped),
 * progress persisted per artifact; the score screen is an explicit step, and
 * on first arrival its completion hook goes to the tutor exactly once.
 */
export function QuizCard({ lessonId, artifactId, data, masteryPct, send, onFinished }: {
  lessonId: string
  artifactId: string
  data: QuizData
  masteryPct: number | null
  send: (text: string) => void
  /** Fired once when the score screen lands; carries allCorrect. */
  onFinished?: (allCorrect: boolean) => void
}): ReactNode {
  const questions = data.questions
  const [progress, setProgress] = useState<QuizProgress>(() => loadQuizProgress(lessonId, artifactId, questions.length))
  const [cursor, setCursor] = useState(0)
  const [showScore, setShowScore] = useState(false)
  const [hookSent, setHookSent] = useState(false)

  // (Re)load when the artifact identity changes (lesson switch).
  useEffect(() => {
    const next = loadQuizProgress(lessonId, artifactId, questions.length)
    setProgress(next)
    setShowScore(next.done)
    const firstUnanswered = next.answers.findIndex(a => a < 0)
    setCursor(firstUnanswered === -1 ? questions.length - 1 : firstUnanswered)
    setHookSent(false)
  }, [lessonId, artifactId, questions.length])

  const allAnswered = progress.answers.every(a => a >= 0)
  const score = quizScore(data, progress.answers)
  const mastery = masteryPct === null ? null : masteryPct / 100

  // The completion hook: once, when the score screen first shows with a full card.
  useEffect(() => {
    if (!showScore || !allAnswered || hookSent) return
    setHookSent(true)
    onFinished?.(score.correct === score.total)
    const next = { answers: [...progress.answers], done: true }
    setProgress(next)
    saveQuizProgress(lessonId, artifactId, next)
    send(tr('quiz.hook', { correct: score.correct, total: score.total }))
  }, [showScore, allAnswered, hookSent, lessonId, artifactId, progress.answers, score.correct, score.total, send])

  const answer = (choice: number): void => {
    const next = { answers: [...progress.answers], done: progress.done }
    next.answers[cursor] = choice
    setProgress(next)
    saveQuizProgress(lessonId, artifactId, next)
  }

  if (showScore && allAnswered) {
    const actions = getPostQuizActions(score, mastery)
    return createElement('div', { className: 'lks-qcard', 'data-lks-quiz': artifactId },
      createElement('div', { className: 'lks-qcard-head' },
        createElement(IconStarFill16, { size: 14 }),
        tr('quiz.score', { correct: score.correct, total: score.total })),
      createElement('div', { className: 'lks-qcard-review' },
        ...questions.map((q, i) => {
          const choice = progress.answers[i] ?? -1
          const right = choice === q.answer
          return createElement('div', { key: i, className: `lks-qcard-q review${right ? '' : ' wrong'}` },
            createElement('div', { className: 'lks-qcard-prompt' }, `${i + 1}. ${q.prompt}`),
            createElement('div', { className: 'lks-qcard-ans' },
              right ? '' : `${tr('quiz.youChose')}：${q.options[choice] ?? '—'} · `,
              `${tr('quiz.answer')}：${q.options[q.answer] ?? '—'}`),
            createElement('div', { className: 'lks-qcard-expl' }, q.explanation))
        })),
      createElement('div', { className: 'lks-qcard-actions' },
        ...actions.map(a => createElement('button', {
          key: a.id,
          className: 'lks-qcard-action',
          title: a.advancesMastery ? tr('quiz.action.markMastered.hint') : undefined,
          onClick: () => { send(tr(`quiz.msg.${a.id}`)) },
        }, createElement(ACTION_ICONS[a.id]!, { size: 13 }), tr(`quiz.action.${a.id}`)))),
    )
  }

  const q = questions[cursor]!
  const chosen = progress.answers[cursor] ?? -1
  const options = q.options.map((opt, i) => {
    const picked = chosen === i
    const isRight = i === q.answer
    const tone = chosen < 0 ? '' : picked ? (isRight ? ' right' : ' wrong') : isRight ? ' right dim' : ''
    return createElement('button', {
      key: i,
      className: `lks-qcard-opt${tone}`,
      disabled: chosen >= 0,
      onClick: () => { answer(i) },
    }, opt)
  })
  const explanation = chosen < 0 ? null : createElement('div', { className: 'lks-qcard-expl' },
    `${chosen === q.answer ? tr('quiz.right') : tr('quiz.wrong')} — ${q.explanation}`,
    createElement('div', { style: { marginTop: '6px' } },
      createElement('button', {
        className: 'lks-qcard-next',
        onClick: () => {
          if (cursor + 1 < questions.length) setCursor(cursor + 1)
          else setShowScore(true)
        },
      }, cursor + 1 < questions.length ? tr('quiz.next') : tr('quiz.finish'))))
  return createElement('div', { className: 'lks-qcard', 'data-lks-quiz': artifactId },
    createElement('div', { className: 'lks-qcard-head' },
      createElement(IconBookFill16, { size: 14 }),
      data.title ?? tr('quiz.card.title'),
      createElement('span', { className: 'lks-qcard-count' }, tr('quiz.progress', { cur: cursor + 1, total: questions.length }))),
    createElement('div', { className: 'lks-qcard-q' },
      createElement('div', { className: 'lks-qcard-prompt' }, q.prompt),
      createElement('div', { className: 'lks-qcard-opts' }, ...options),
      explanation,
    ),
  )
}
