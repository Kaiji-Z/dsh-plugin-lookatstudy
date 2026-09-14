/**
 * Course-pack export (upstream exportPack alignment): serialize one course
 * into a self-contained, re-importable artifact. Two shapes from one pass:
 *
 *   - the JSON pack — machine-readable, the exact round-trip vehicle: it
 *     carries everything markdown cannot (languageTarget, exam kinds), and
 *     `packToParsedCourse` rebuilds a ParsedCourse that importCourse accepts,
 *     restoring the course (title tree + verbatim bodies) deterministically.
 *   - the markdown rendering — `# course / ## section / ### lesson` + bodies,
 *     the zero-LLM parser's own format: paste-importable everywhere (this
 *     panel's md/pack tabs, upstream LookatStudy, any markdown tool).
 *
 * Upstream refuses to export folder-imported courses (their plan store embeds
 * private machine paths); this plugin keeps every lesson body in state.json,
 * so ALL sources export. Lesson bodies cannot contain H1-H3 by construction
 * (they were parsed from between heading markers), so the markdown tree never
 * corrupts; code fences ride the parser's fence state machine verbatim.
 * @module dsh-plugin-lookatstudy/export-pack
 */

import type { CourseState, LearningState } from './state.ts'
import type { ParsedCourse, ParsedSection } from './vendor/markdown-course.ts'
import { titleToAnchor } from './vendor/markdown-course.ts'

export interface CoursePack {
  kind: 'lookatstudy-course-pack'
  version: 1
  exportedAt: string
  course: {
    title: string
    languageTarget: string | null
    sections: Array<{ title: string; lessons: Array<{ title: string; kind: string; body: string }> }>
  }
}

/** Find the course for export; null when the id is unknown. */
export function findCourseForPack(state: LearningState, courseId: string): CourseState | null {
  return state.courses.find(c => c.id === courseId) ?? null
}

/** The machine-readable pack: everything needed to restore the course. */
export function coursePackOf(course: CourseState, now: Date = new Date()): CoursePack {
  return {
    kind: 'lookatstudy-course-pack',
    version: 1,
    exportedAt: now.toISOString(),
    course: {
      title: course.title,
      languageTarget: course.languageTarget ?? null,
      // exam nodes are DERIVED structure — importCourse re-injects one per
      // section on re-import, so packing them would duplicate on the way back
      sections: course.sections.map(s => ({
        title: s.title,
        lessons: s.lessons.filter(l => l.kind !== 'exam').map(l => ({ title: l.title, kind: l.kind, body: l.body })),
      })),
    },
  }
}

/** The markdown rendering — the zero-LLM parser's own format. */
export function coursePackMarkdown(course: CourseState): string {
  const out: string[] = [`# ${course.title}`, '']
  for (const section of course.sections) {
    out.push(`## ${section.title}`, '')
    for (const lesson of section.lessons) {
      if (lesson.kind === 'exam') continue
      out.push(`### ${lesson.title}`, '')
      // Audit B12: design-imported bodies BEGIN at their anchor heading and
      // carry their own H2/H3 lines — escape those so the pack re-parses into
      // the SAME tree instead of spawning phantom sections (and silently
      // dropping the prose before the first phantom ###). The parser's heading
      // match requires the line to open with #, so a leading backslash defuses
      // it; readers un-escape with the documented ^\\(#{1,3}) form.
      const body = lesson.body
        .replace(/\s+$/, '')
        .split('\n')
        .map(line => (/^#{1,3}(\s|$)/.test(line) ? `\\${line}` : line))
        .join('\n')
      if (body !== '') out.push(body, '')
    }
  }
  return `${out.join('\n')}\n`
}

/** Pack → ParsedCourse for importCourse: the exact round-trip path. */
export function packToParsedCourse(pack: CoursePack): ParsedCourse {
  const sections: ParsedSection[] = pack.course.sections.map(s => ({
    title: s.title,
    anchor: titleToAnchor(s.title),
    lessons: s.lessons.map(l => ({ title: l.title, anchor: titleToAnchor(l.title), body: l.body })),
  }))
  return { title: pack.course.title, sections }
}

/** Upstream's naming: sanitized title, `.lookatstudy-pack.md` suffix. */
export function packFileName(course: CourseState): string {
  const base = course.title.replace(/[/\\:*?"<>|#\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${base !== '' ? base : 'course'}.lookatstudy-pack.md`
}
