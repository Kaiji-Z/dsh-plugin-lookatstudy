/**
 * ExamView v2 (P12, upstream ExamView.tsx port): the section-exam answering
 * surface — five states (generating → ready → answering → submitting →
 * result, + failed), per-question time limits with timeout auto-advance,
 * attempt shuffle (question + option order, seeded by attempt id), the
 * leave-guard session contract, and the settlement page (stars + KC
 * breakdown + per-question review + retry/regenerate).
 *
 * Upstream deltas kept 1:1: unanswered = wrong on terminate/timeout; bank
 * generation runs "in the background" (here: the tutor session — the panel
 * sends the bank prompt and this view polls the state feed); dangling
 * attempts are graded dead on read (dashboard GET settles them).
 * @module dsh-plugin-lookatstudy/client/examview
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { buildAttemptShuffle, displayAnswerToOriginal, questionTimeLimitSec, type AttemptShuffle } from '../vendor/exam-logic.ts'
import type { ExamPerQuestionResult, ExamQuestionView, ExamStatusView, ExamSubmitResult } from './data.ts'
import { useStudy } from './data.ts'
import { tr } from './locale.ts'
import { ConfirmCard } from './confirmcard.tsx'
import { IconGoalOutline16, IconRefreshOutline16, IconStarFill16, IconThinkOutline16, IconWarningOutline16 } from './icons.tsx'

type Phase = 'loading' | 'generating' | 'ready' | 'failed' | 'answering' | 'submitting' | 'result'

/** The settlement page's unified data source (fresh submit or history projection). */
interface ResultData {
  correctCount: number
  totalCount: number
  stars: number
  bestStars: number
  terminated: boolean
  perQuestion: readonly ExamPerQuestionResult[]
}

export interface ExamSession {
  active: boolean
  terminate: (() => Promise<void>) | null
}

export function ExamView({ lessonId, sectionTitle, paused, onSessionChange }: {
  lessonId: string
  sectionTitle: string
  /** Leave-guard modal open: the timer must not eat answering time. */
  paused: boolean
  onSessionChange: (session: ExamSession) => void
}): ReactNode {
  const { examStatus, examPrepare, examStart, examRecord, examSubmit, examRegenerate } = useStudy()
  const [phase, setPhase] = useState<Phase>('loading')
  const [statusView, setStatusView] = useState<ExamStatusView | null>(null)
  const [exercises, setExercises] = useState<readonly ExamQuestionView[]>([])
  const [shuffle, setShuffle] = useState<AttemptShuffle | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [result, setResult] = useState<ResultData | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  // regenerate confirm anchor (shared by ready/result)
  const [regenRect, setRegenRect] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null)
  // answers mirror (the terminate callback reads the latest values, not a stale closure)
  const answersRef = useRef<Record<string, string>>({})
  const attemptIdRef = useRef<string | null>(null)
  // single-question consume guard (「下一题」 vs the 0s timeout race)
  const consumedQRef = useRef<string | null>(null)
  const answerScrollRef = useRef<HTMLDivElement | null>(null)

  const currentQ: ExamQuestionView | null = shuffle !== null
    ? exercises[shuffle.questionOrder[currentIdx] ?? -1] ?? null
    : null
  const rawPerm = currentQ !== null && shuffle !== null ? shuffle.optionPerms[currentQ.id] ?? [] : []
  const opts = currentQ?.options ?? []
  // display position d shows options[perm[d]] — paired with displayAnswerToOriginal on the grading side
  const perm = rawPerm.length === opts.length ? rawPerm : opts.map((_, i) => i)

  /* ── mount / node switch: fetch status, auto-trigger generation on idle ── */
  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    setErrorMsg('')
    setResult(null)
    setStatusView(null)
    setShuffle(null)
    attemptIdRef.current = null
    void (async () => {
      try {
        const sv = await examStatus(lessonId)
        if (cancelled) return
        setStatusView(sv)
        setExercises(sv.questions)
        if (sv.status === 'generating') {
          setPhase('generating')
        } else if (sv.status === 'failed') {
          setErrorMsg(sv.error ?? tr('exam.errorEmpty'))
          setPhase('failed')
        } else if (sv.status === 'ready') {
          if (sv.latestAttempt !== null && sv.latestAttempt.finishedAt !== null) {
            setResult({
              correctCount: sv.latestAttempt.correctCount ?? 0,
              totalCount: sv.latestAttempt.totalCount ?? 0,
              stars: sv.latestAttempt.stars ?? 0,
              bestStars: sv.bestStars,
              terminated: sv.latestAttempt.terminated,
              perQuestion: sv.latestAttempt.perQuestion,
            })
            setPhase('result')
          } else {
            setPhase('ready')
          }
        } else {
          // idle → auto-trigger the background generation (tutor prompt)
          setPhase('generating')
          void examPrepare(lessonId).then(() => {
            window.dispatchEvent(new CustomEvent('lookatstudy-exam-generate', { detail: { lessonId, sectionTitle } }))
          }).catch(() => { /* the retry path re-fires */ })
        }
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e))
          setPhase('failed')
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId])

  /* ── poll the state feed's exam summary while generating (idle→ready flip) ── */
  const bankStatus = statusView?.status
  useEffect(() => {
    if (phase !== 'generating' && phase !== 'loading') return
    const iv = setInterval(() => {
      void examStatus(lessonId).then(sv => {
        if (sv.status === 'ready') {
          setStatusView(sv)
          setExercises(sv.questions)
          setPhase(p => (p === 'generating' || p === 'loading') ? (sv.latestAttempt !== null && sv.latestAttempt.finishedAt !== null ? 'result' : 'ready') : p)
        } else if (sv.status === 'failed') {
          setErrorMsg(sv.error ?? tr('exam.errorEmpty'))
          setPhase('failed')
        }
      }).catch(() => { /* transient poll failure */ })
    }, 2500)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, lessonId, bankStatus])

  /* ── start / retry ── */
  const startAttempt = useCallback(() => {
    void (async () => {
      try {
        const r = await examStart(lessonId)
        const sh = buildAttemptShuffle(
          r.questions.map(q => ({ id: q.id, optionCount: q.options.length })),
          r.attemptId,
        )
        setExercises(r.questions)
        attemptIdRef.current = r.attemptId
        setShuffle(sh)
        answersRef.current = {}
        setCurrentIdx(0)
        setSelected(null)
        setResult(null)
        consumedQRef.current = null
        setPhase('answering')
        const first = r.questions[sh.questionOrder[0] ?? 0]
        setTimeLeft(questionTimeLimitSec(first?.prompt ?? '', first?.options.length ?? 4))
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e))
        setPhase('failed')
      }
    })()
  }, [lessonId, examStart])

  /* ── regenerate: drop the bank, walk the background generation again ── */
  const startRegenerate = useCallback(() => {
    setRegenRect(null)
    setResult(null)
    setPhase('generating')
    setStatusView(prev => prev === null ? prev : { ...prev, status: 'generating' })
    void examRegenerate(lessonId).then(() => examPrepare(lessonId)).then(() => {
      window.dispatchEvent(new CustomEvent('lookatstudy-exam-generate', { detail: { lessonId, sectionTitle } }))
    }).catch(e => {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setPhase('failed')
    })
  }, [lessonId, sectionTitle, examRegenerate, examPrepare])

  const regenButton = createElement('span', { className: 'lks14-exam-regen' },
    createElement('button', {
      className: 'lks-btn ghost',
      'data-tooltip': tr('exam.regenerate.confirmMsg'),
      onClick: (e: { currentTarget: HTMLButtonElement }) => { setRegenRect((() => { const r = e.currentTarget.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })()) },
    }, createElement(IconRefreshOutline16, { size: 13 }), tr('exam.regenerate')),
    regenRect !== null
      ? createElement(ConfirmCard, {
        anchor: regenRect,
        message: tr('exam.regenerate.confirmMsg'),
        confirmLabel: tr('exam.regenerate'),
        onConfirm: () => { void startRegenerate() },
        onCancel: () => { setRegenRect(null) },
      })
      : null,
  )

  /* ── question switch: reset timer + selection; long questions scroll back to top ── */
  useEffect(() => {
    if (phase !== 'answering' || currentQ === null) return
    if (consumedQRef.current !== currentQ.id) {
      setTimeLeft(questionTimeLimitSec(currentQ.prompt, currentQ.options.length))
      setSelected(null)
      answerScrollRef.current?.scrollTo({ top: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, phase])

  /* ── timer (paused while the leave modal is open) ── */
  useEffect(() => {
    if (phase !== 'answering' || paused) return
    const iv = setInterval(() => { setTimeLeft(v => (v > 0 ? v - 1 : 0)) }, 1000)
    return () => clearInterval(iv)
  }, [phase, paused])

  /* ── advance: record (display → original index) and move on / submit ── */
  const advance = useCallback((displayIdx: number | null) => {
    const ex = currentQ
    if (ex === null || phase !== 'answering') return
    if (consumedQRef.current === ex.id) return
    consumedQRef.current = ex.id
    const original = displayIdx === null ? '' : displayAnswerToOriginal(perm, displayIdx)
    const next = { ...answersRef.current, [ex.id]: original }
    answersRef.current = next
    if (attemptIdRef.current !== null) void examRecord(lessonId, attemptIdRef.current, ex.id, original).catch(() => { /* incremental persist is best-effort */ })
    if (currentIdx + 1 < exercises.length) {
      setCurrentIdx(currentIdx + 1)
    } else {
      setPhase('submitting')
      void (async () => {
        try {
          const r: ExamSubmitResult = await examSubmit(lessonId, attemptIdRef.current!, false)
          setResult({ correctCount: r.correctCount, totalCount: r.totalCount, stars: r.stars, bestStars: r.bestStars, terminated: r.terminated, perQuestion: r.perQuestion })
          setPhase('result')
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : String(e))
          setPhase('failed')
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQ, phase, perm, currentIdx, exercises.length, lessonId, examRecord, examSubmit])

  /* ── timeout: auto-record the current pick (none = unanswered = wrong) ── */
  useEffect(() => {
    if (phase !== 'answering' || timeLeft > 0 || paused) return
    advance(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase, paused])

  /* ── session contract + terminate (the leave guard consumes this) ── */
  useEffect(() => {
    const terminate = async (): Promise<void> => {
      if (attemptIdRef.current === null) return
      try {
        await examSubmit(lessonId, attemptIdRef.current, true)
      } catch { /* navigation must not block on a failed settle */ }
    }
    const active = phase === 'answering' || phase === 'submitting'
    onSessionChange(active ? { active: true, terminate } : { active: false, terminate: null })
    // unmount clears the session — a stale active:true would trip the guard on every later nav
    return () => onSessionChange({ active: false, terminate: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, lessonId, onSessionChange])

  /* ── render ── */

  if (phase === 'loading' || phase === 'generating') {
    return createElement('div', { className: 'lks14-examstage', 'data-testid': 'exam-generating' },
      createElement(IconGoalOutline16, { size: 44, className: 'lks14-exam-glyph' }),
      createElement('div', { className: 'lks14-exam-h1' }, tr('exam.generating.title')),
      createElement('div', { className: 'lks14-exam-sub' }, tr('exam.generating.stage')),
      createElement('div', { className: 'lks14-exam-dots' },
        createElement('i', null), createElement('i', null), createElement('i', null)),
      createElement('div', { className: 'lks14-exam-hint' }, tr('exam.generating.canLeave')),
    )
  }

  if (phase === 'failed') {
    return createElement('div', { className: 'lks14-examstage', 'data-testid': 'exam-error' },
      createElement(IconWarningOutline16, { size: 34, className: 'lks14-exam-glyph warn' }),
      createElement('div', { className: 'lks14-exam-h1' }, tr('exam.errorTitle')),
      createElement('div', { className: 'lks14-exam-sub' }, errorMsg === '' ? tr('exam.errorEmpty') : errorMsg),
      createElement('button', {
        className: 'lks-btn primary',
        onClick: () => {
          setPhase('generating')
          void examPrepare(lessonId).then(() => {
            window.dispatchEvent(new CustomEvent('lookatstudy-exam-generate', { detail: { lessonId, sectionTitle } }))
          }).catch(() => { /* stays generating; the retry re-fires */ })
        },
      }, createElement(IconRefreshOutline16, { size: 13 }), tr('exam.failed.retry')),
    )
  }

  if (phase === 'ready' && statusView !== null) {
    const estSec = statusView.questions.reduce((a, q) => a + questionTimeLimitSec(q.prompt, q.options.length), 0)
    const estMin = Math.max(1, Math.round(estSec / 60))
    return createElement('div', { className: 'lks14-examstage', 'data-testid': 'exam-ready' },
      createElement('span', { className: 'lks14-exam-badge' }, createElement(IconGoalOutline16, { size: 26 })),
      createElement('div', { className: 'lks14-exam-hero' }, tr('exam.ready.title')),
      createElement('div', { className: 'lks14-exam-sub' }, sectionTitle),
      createElement('div', { className: 'lks14-exam-meta' }, tr('exam.ready.meta', { q: statusView.questionCount, kc: statusView.kcCount, min: estMin })),
      createElement('div', { className: 'lks14-exam-ctas' },
        createElement('button', { className: 'lks-btn primary big', 'data-testid': 'exam-start-btn', onClick: startAttempt }, tr('exam.start'), createElement('span', { className: 'lks14-exam-arrow' }, '→')),
        regenButton,
      ),
    )
  }

  if (phase === 'answering' || phase === 'submitting') {
    if (currentQ === null) return null
    const timeWarn = timeLeft <= 10
    return createElement('div', { className: 'lks14-examans', 'data-testid': 'exam-answering' },
      createElement('div', { className: 'lks14-exam-top' },
        createElement('div', { className: 'lks14-exam-qno' }, tr('exam.q.progress', { i: currentIdx + 1, n: exercises.length })),
        createElement('div', { className: `lks14-exam-timer${timeWarn ? ' warn' : ''}`, 'data-testid': 'exam-timer' },
          `${String(Math.floor(timeLeft / 60))}:${String(timeLeft % 60).padStart(2, '0')}`),
      ),
      createElement('div', { className: 'lks14-exam-track' },
        createElement('i', { style: { width: `${String(Math.round((currentIdx / Math.max(1, exercises.length)) * 100))}%` } })),
      createElement('div', { className: 'lks14-exam-scroll', ref: answerScrollRef },
        currentQ.kcTitle !== null
          ? createElement('span', { className: 'lks14-exam-kc' }, createElement(IconThinkOutline16, { size: 13 }), currentQ.kcTitle)
          : null,
        createElement('div', { className: 'lks14-exam-prompt' }, currentQ.prompt),
        createElement('div', { className: 'lks14-exam-opts' },
          perm.map((origIdx, d) => createElement('button', {
            key: origIdx,
            'data-testid': `exam-option-${String(d)}`,
            className: `lks14-exam-opt${selected === d ? ' picked' : ''}`,
            onClick: () => { setSelected(d) },
          }, opts[origIdx] ?? '')),
        ),
        createElement('div', { className: 'lks14-exam-nextrow' },
          phase === 'submitting'
            ? createElement('span', { className: 'lks14-exam-sub' }, tr('exam.submitting'))
            : createElement('button', {
              className: 'lks-btn primary',
              'data-testid': 'exam-next-btn',
              disabled: selected === null,
              onClick: () => { if (selected !== null) advance(selected) },
            }, currentIdx + 1 < exercises.length ? tr('exam.q.next') : tr('exam.q.submit'), createElement('span', { className: 'lks14-exam-arrow' }, '→')),
        ),
      ),
    )
  }

  if (phase === 'result' && result !== null) {
    const pct = result.totalCount > 0 ? Math.round((result.correctCount / result.totalCount) * 100) : 0
    const kcGroups = new Map<string, { correct: number; total: number }>()
    for (const pq of result.perQuestion) {
      const key = pq.kcTitle ?? ''
      if (key === '') continue
      const g = kcGroups.get(key) ?? { correct: 0, total: 0 }
      g.total++
      if (pq.correct) g.correct++
      kcGroups.set(key, g)
    }
    const exById = new Map(exercises.map(q => [q.id, q] as const))
    return createElement('div', { className: 'lks14-examresult', 'data-testid': 'exam-result' },
      createElement('div', { className: 'lks14-exam-scorehead' },
        createElement('div', { className: 'lks14-exam-stars', 'aria-label': `${String(result.stars)} stars` },
          [1, 2, 3].map(i => createElement(IconStarFill16, { key: i, size: 26, className: i <= result.stars ? 'lit' : 'dim' }))),
        createElement('div', { className: 'lks14-exam-hero' }, tr('exam.result.score', { correct: result.correctCount, total: result.totalCount })),
        createElement('div', { className: 'lks14-exam-sub' }, tr('exam.result.accuracy', { pct })),
        statusView !== null
          ? createElement('div', { className: 'lks14-exam-meta' },
            tr('exam.result.best', { stars: result.bestStars }),
            statusView.attemptCount > 1 ? ` · ${tr('exam.result.attempts', { n: statusView.attemptCount })}` : '')
          : null,
      ),
      result.terminated
        ? createElement('div', { className: 'lks14-exam-term' }, createElement(IconWarningOutline16, { size: 15 }), tr('exam.terminated.banner'))
        : null,
      kcGroups.size > 0
        ? createElement('div', { className: 'lks14-exam-kcblock' },
          createElement('div', { className: 'lks14-exam-h2' }, tr('exam.result.kcBreakdown')),
          ...[...kcGroups.entries()].map(([kc, g]) => createElement('div', { key: kc, className: 'lks14-exam-kcrow', 'data-testid': 'exam-kc-row' },
            createElement('span', { className: 'lks14-exam-kcname' }, createElement(IconThinkOutline16, { size: 13 }), kc),
            createElement('span', { className: 'lks14-exam-kcstat' },
              g.correct / g.total < 0.6 ? createElement('em', { className: 'lks14-exam-weak' }, tr('exam.result.weakKc')) : null,
              `${String(g.correct)}/${String(g.total)}`))))
        : null,
      createElement('div', { className: 'lks14-exam-kcblock' },
        createElement('div', { className: 'lks14-exam-h2' }, tr('exam.result.review')),
        ...result.perQuestion.map((pq, i) => {
          const ex = exById.get(pq.exerciseId)
          const optsR = pq.options ?? ex?.options ?? null
          const promptText = pq.prompt ?? ex?.prompt ?? `#${String(i + 1)}`
          const label = (v: string): string => (optsR !== null && v !== '' && optsR[Number(v)] !== undefined ? optsR[Number(v)]! : v)
          return createElement('div', { key: pq.exerciseId, className: 'lks14-exam-revrow', 'data-testid': 'exam-review-row' },
            createElement('span', { className: `lks14-exam-mark ${pq.correct ? 'ok' : pq.answered ? 'bad' : 'skip'}` }, pq.correct ? '✓' : '✕'),
            createElement('div', { className: 'lks14-exam-revbody' },
              createElement('div', { className: 'lks14-exam-revprompt' }, promptText),
              createElement('div', { className: 'lks14-exam-revmeta' },
                !pq.answered
                  ? tr('exam.result.unanswered')
                  : pq.correct
                    ? createElement('span', { className: 'lks14-exam-ok' }, tr('exam.result.correctLabel'))
                    : `${tr('exam.result.yourAnswer')}:${label(pq.userAnswer)} · ${tr('exam.result.correctAnswer')}:${label(pq.correctAnswer)}`),
              pq.explanation !== null ? createElement('div', { className: 'lks14-exam-revexp' }, pq.explanation) : null))
        }),
      ),
      createElement('div', { className: 'lks14-exam-ctas' },
        createElement('button', { className: 'lks-btn primary', 'data-testid': 'exam-retry-btn', onClick: startAttempt }, createElement(IconRefreshOutline16, { size: 13 }), tr('exam.retryExam')),
        regenButton,
      ),
    )
  }

  return null
}
