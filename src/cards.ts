/**
 * Pure UI projections for the study tools: human-readable display lines
 * derived from canonical tool values. Shared by `output.render` text and
 * `presentationMeta`/`presentResult` cards; no IO, no clock, no randomness.
 * @module dsh-plugin-lookatstudy/cards
 */

/** Canonical value of the three import tools. */
export interface ImportValue {
  courseId: string
  title: string
  sections: number
  lessons: number
  firstLessonId: string | null
  firstLessonTitle: string | null
}

/** Canonical value of `study_map`. */
export interface MapValue {
  courseId: string
  title: string
  counts: { total: number; completed: number; available: number }
  tree: Array<{
    title: string
    lessons: Array<{
      id: string
      title: string
      status: string
      masteryPct: number | null
      crown: number
      weakConcepts: number
      frictionCount: number
    }>
  }>
}

/** Canonical value of `study_record_answer`. */
export interface AnswerValue {
  lessonTitle: string
  correct: boolean
  prevMasteryPct: number
  newMasteryPct: number
  crown: number
  mastered: boolean
}

/** Canonical value of `study_due_reviews`. */
export interface DueValue {
  total: number
  due: Array<{ lessonId: string; courseTitle: string; lessonTitle: string; dueAt: string; overdueDays: number }>
}

/** Canonical value of `study_record_review`. */
export interface ReviewValue {
  lessonTitle: string
  quality: number
  intervalDays: number
  repetitions: number
  dueAt: string
}

/** Canonical value of `study_complete_lesson`. */
export interface CompleteValue {
  lessonTitle: string
  unlockedLessonTitle: string | null
  reviewDueAt: string
  courseComplete: boolean
}

/**
 * Status glyph for one lesson line on the map.
 * @param status - lesson status.
 * @returns the glyph prefix.
 */
function statusGlyph(status: string): string {
  if (status === 'completed') return '✅'
  if (status === 'available') return '▶️'
  return '🔒'
}

/**
 * Display lines for an import result.
 * @param value - import tool value.
 * @returns card lines.
 */
export function importLines(value: ImportValue): string[] {
  const lines = [
    `📘 ${value.title}`,
    `${value.sections} sections · ${value.lessons} lessons · id ${value.courseId}`,
  ]
  if (value.firstLessonId !== null) {
    lines.push(`Start at “${value.firstLessonTitle}” (${value.firstLessonId})`)
  }
  return lines
}

/**
 * Display lines for the skill-tree map.
 * @param value - map tool value.
 * @returns card lines.
 */
export function mapLines(value: MapValue): string[] {
  const lines = [
    `🗺 ${value.title} — ${value.counts.completed}/${value.counts.total} done`,
  ]
  for (const section of value.tree) {
    lines.push(`▍${section.title}`)
    for (const lesson of section.lessons) {
      const mastery = lesson.masteryPct === null ? '' : ` · ${lesson.masteryPct}%${lesson.crown >= 4 ? ' 👑' : ''}`
      const weak = lesson.weakConcepts > 0 ? ` · ⚡${lesson.weakConcepts}` : ''
      const friction = lesson.frictionCount > 0 ? ` · 😣${lesson.frictionCount}` : ''
      lines.push(`  ${statusGlyph(lesson.status)} ${lesson.title}${mastery}${weak}${friction}`)
    }
  }
  return lines
}

/**
 * Display line for a graded answer.
 * @param value - answer tool value.
 * @returns single feedback line.
 */
export function answerLine(value: AnswerValue): string {
  const mark = value.correct ? '✓ correct' : '✗ incorrect'
  const crown = value.mastered ? ' · 👑 mastered' : ''
  return `${mark} — mastery ${value.prevMasteryPct}% → ${value.newMasteryPct}% (crown ${value.crown})${crown}`
}

/**
 * Display lines for the due-review list.
 * @param value - due tool value.
 * @returns card lines.
 */
export function dueLines(value: DueValue): string[] {
  if (value.total === 0) return ['🎉 No reviews due — everything is scheduled ahead.']
  const lines = [`🔁 ${value.total} due`]
  for (const item of value.due) {
    const overdue = item.overdueDays > 0 ? ` · ${item.overdueDays}d overdue` : ''
    lines.push(`  ⏰ ${item.lessonTitle} — ${item.courseTitle}${overdue}`)
  }
  return lines
}

/**
 * Display line for a recorded review grade.
 * @param value - review tool value.
 * @returns single schedule line.
 */
export function reviewLine(value: ReviewValue): string {
  return `🔁 quality ${value.quality}/5 — next review in ${value.intervalDays}d (${value.repetitions} in a row), due ${value.dueAt.slice(0, 10)}`
}

/**
 * Display lines for a completed lesson.
 * @param value - complete tool value.
 * @returns card lines.
 */
export function completeLines(value: CompleteValue): string[] {
  const lines = [`🎓 Completed “${value.lessonTitle}”`]
  if (value.unlockedLessonTitle !== null) {
    lines.push(`🔓 Unlocked “${value.unlockedLessonTitle}”`)
  }
  lines.push(`🔁 First review due ${value.reviewDueAt.slice(0, 10)}`)
  if (value.courseComplete) lines.push('🏁 Course complete!')
  return lines
}
