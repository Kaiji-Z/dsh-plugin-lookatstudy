/**
 * The artifact channel — the upstream artifacts system port (0.15.0 P1):
 * tools that produce display-worthy learning objects return them tagged with
 * an `artifactType` (quiz / guess / compare_table / code_walkthrough /
 * concept_map / diagram), the state records them idempotently per lesson
 * (upstream's canvas_items equivalent — content-hashed, because the lesson
 * there was burned by message-id keys duplicating saves), and the panel
 * renders them as interactive cards. Host-side pure logic + node:crypto.
 * @module dsh-plugin-lookatstudy/artifacts
 */

import { createHash } from 'node:crypto'

export type ArtifactType = 'quiz' | 'guess' | 'compare_table' | 'code_walkthrough' | 'concept_map' | 'diagram'

/** One recorded artifact (state.json's canvas row). */
export interface StudyArtifact {
  id: string
  artifactType: ArtifactType
  title: string
  createdAt: string
  /** Content hash — the idempotency key's input. */
  hash: string
  /** The sanitized payload the panel renders. */
  data: Record<string, unknown>
}

/** Deterministic stringify (sorted object keys at every depth). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Short stable content hash (the dedup key — never a message id). */
export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export interface SanitizeResult {
  data: Record<string, unknown>
  warnings: string[]
}

/** The quiz payload after sanitization (structural mirror of upstream QuizData). */
export interface QuizArtifactData {
  artifactType: 'quiz'
  title: string
  questions: Array<{ prompt: string; options: string[]; answer: number; explanation: string }>
  warnings?: string[]
}

const MAX_QUESTIONS = 20

/**
 * Sanitize a tutor-produced quiz: coerce strings, drop structurally invalid
 * questions (collecting a warning each), fail loud when nothing usable
 * remains. Mirrors upstream sanitizeArtifact('quiz') intent — the card never
 * renders a question it cannot judge.
 */
export function sanitizeQuiz(raw: unknown): SanitizeResult {
  const warnings: string[] = []
  const input = (raw ?? {}) as { title?: unknown; questions?: unknown }
  const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : '练习'
  const questions: QuizArtifactData['questions'] = []
  const list = Array.isArray(input.questions) ? input.questions : []
  list.slice(0, MAX_QUESTIONS).forEach((q, index) => {
    const item = (q ?? {}) as { prompt?: unknown; options?: unknown; answer?: unknown; explanation?: unknown }
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
    const options = Array.isArray(item.options)
      ? item.options.map(o => (typeof o === 'string' ? o.trim() : '')).filter(o => o !== '')
      : []
    const answer = typeof item.answer === 'number' && Number.isInteger(item.answer) ? item.answer : -1
    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : ''
    if (prompt === '') {
      warnings.push(`question ${index + 1}: empty prompt dropped`)
      return
    }
    if (options.length < 2) {
      warnings.push(`question ${index + 1}: fewer than 2 usable options dropped`)
      return
    }
    if (answer < 0 || answer >= options.length) {
      warnings.push(`question ${index + 1}: answer index out of range dropped`)
      return
    }
    questions.push({ prompt, options, answer, explanation })
  })
  if (questions.length === 0) {
    throw new Error(`lookatstudy-plugin: quiz artifact has no usable questions${warnings.length > 0 ? ` (${warnings.join('; ')})` : ''}`)
  }
  if (list.length > MAX_QUESTIONS) warnings.push(`truncated to ${MAX_QUESTIONS} questions`)
  const data: Record<string, unknown> = { artifactType: 'quiz', title, questions }
  if (warnings.length > 0) data.warnings = warnings
  return { data, warnings }
}

/** The artifact id derived from type + content (stable across re-imports). */
export function artifactId(artifactType: string, data: Record<string, unknown>): string {
  return `${artifactType}-${contentHash(stableStringify(data))}`
}

/** Coerce one string field, dropping empty. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Sanitize a guess (the opening two-option hook; unscored, revealed next turn). */
export function sanitizeGuess(raw: unknown): SanitizeResult {
  const warnings: string[] = []
  const input = (raw ?? {}) as { prompt?: unknown; options?: unknown }
  const prompt = str(input.prompt)
  if (prompt === null) throw new Error('lookatstudy-plugin: guess artifact needs a prompt')
  const list = Array.isArray(input.options) ? input.options : []
  const options: Array<{ id: string; label: string }> = []
  list.slice(0, 2).forEach((o, index) => {
    const item = (o ?? {}) as { id?: unknown; label?: unknown }
    const id = str(item.id) ?? String.fromCharCode(97 + index)
    const label = str(item.label)
    if (label === null) {
      warnings.push(`option ${index + 1}: empty label dropped`)
      return
    }
    options.push({ id, label })
  })
  if (options.length !== 2) throw new Error(`lookatstudy-plugin: guess artifact needs exactly 2 options (${warnings.join('; ')})`)
  return { data: { artifactType: 'guess', prompt, options }, warnings }
}

/** Sanitize a compare table (headers ≥2; every row matches the header width). */
export function sanitizeCompareTable(raw: unknown): SanitizeResult {
  const warnings: string[] = []
  const input = (raw ?? {}) as { title?: unknown; headers?: unknown; rows?: unknown }
  const title = str(input.title) ?? '对比'
  const headers = (Array.isArray(input.headers) ? input.headers : []).map(h => str(h)).filter((h): h is string => h !== null)
  if (headers.length < 2) throw new Error('lookatstudy-plugin: compare_table needs at least 2 headers')
  const rows: string[][] = []
  for (const row of Array.isArray(input.rows) ? input.rows : []) {
    const cells = (Array.isArray(row) ? row : []).map(c => (typeof c === 'string' ? c.trim() : ''))
    if (cells.length === headers.length) rows.push(cells)
    else warnings.push(`row dropped (${cells.length} cells ≠ ${headers.length} headers)`)
  }
  if (rows.length === 0) throw new Error(`lookatstudy-plugin: compare_table has no usable rows (${warnings.join('; ')})`)
  return { data: { artifactType: 'compare_table', title, headers, rows }, warnings }
}

/** Sanitize a mermaid diagram (type + non-empty code). */
export function sanitizeDiagram(raw: unknown): SanitizeResult {
  const input = (raw ?? {}) as { title?: unknown; diagramType?: unknown; mermaid?: unknown }
  const title = str(input.title) ?? '图示'
  const diagramType = input.diagramType === 'sequence' || input.diagramType === 'state' ? input.diagramType : 'flowchart'
  const mermaid = str(input.mermaid)
  if (mermaid === null) throw new Error('lookatstudy-plugin: diagram artifact needs mermaid code')
  return { data: { artifactType: 'diagram', title, diagramType, mermaid }, warnings: [] }
}

/** Sanitize a code walkthrough (annotations reference real 1-based line ranges). */
export function sanitizeCodeWalkthrough(raw: unknown): SanitizeResult {
  const warnings: string[] = []
  const input = (raw ?? {}) as { title?: unknown; language?: unknown; code?: unknown; annotations?: unknown }
  const title = str(input.title) ?? '代码讲解'
  const language = str(input.language) ?? 'text'
  const code = str(input.code)
  if (code === null) throw new Error('lookatstudy-plugin: code_walkthrough artifact needs code')
  const lineCount = code.split('\n').length
  const annotations: Array<{ lineStart: number; lineEnd: number; note: string }> = []
  for (const a of Array.isArray(input.annotations) ? input.annotations : []) {
    const item = (a ?? {}) as { lineStart?: unknown; lineEnd?: unknown; note?: unknown }
    const note = str(item.note)
    const lineStart = typeof item.lineStart === 'number' && Number.isInteger(item.lineStart) ? item.lineStart : -1
    const lineEnd = typeof item.lineEnd === 'number' && Number.isInteger(item.lineEnd) ? item.lineEnd : lineStart
    if (note === null || lineStart < 1 || lineEnd < lineStart || lineEnd > lineCount) {
      warnings.push(`annotation dropped (line ${String(lineStart)}-${String(lineEnd)} of ${String(lineCount)})`)
      continue
    }
    annotations.push({ lineStart, lineEnd, note })
  }
  if (annotations.length === 0) throw new Error(`lookatstudy-plugin: code_walkthrough has no usable annotations (${warnings.join('; ')})`)
  return { data: { artifactType: 'code_walkthrough', title, language, code, annotations }, warnings }
}
