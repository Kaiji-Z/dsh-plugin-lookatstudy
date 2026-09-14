/**
 * The thread-owner key derivation (0.23.0, issue #11 follow-up) — the single
 * funnel every thread-group access goes through, on both the host side
 * (state machine, dashboard) and the client (panel send/chip resolution).
 * Lesson scope keeps the legacy lessonId keys; course scope namespaces the
 * course (`course:<id>`). The key shapes are structurally distinct — course
 * ids are title slugs with no colon (titleToAnchor strips punctuation), so a
 * course key carries exactly one colon where a lesson id carries exactly two
 * — a lesson-scoped group can never collide with a course-scoped one.
 * Zero-dependency and browser-safe by design (state.ts pulls in node:fs, so
 * this lives apart).
 * @module dsh-plugin-lookatstudy/thread-key
 */

/** Thread-group granularity for one course (CourseState.threadScope). */
export type ThreadScope = 'lesson' | 'course'

/** Resolve the thread-group map key for a send from `lessonId`. Absent scope
 *  is legacy lesson behavior — old files never move. */
export function threadOwnerKey(scope: ThreadScope | undefined, courseId: string, lessonId: string): string {
  return scope === 'course' ? `course:${courseId}` : lessonId
}

/** True when a thread-group key names a course-scoped group. Disambiguated
 *  by COLON COUNT, not by prefix alone: a course titled "Course" slugs to
 *  `course`, and its lesson keys (`course:0:0`) live inside the naive
 *  `course:` prefix space (caught live by the B7 trash test). Lesson ids are
 *  always `<slug>:<si>:<li>` — three segments, since slugs strip the colon —
 *  while a course key is exactly `course:<slug>`, two segments. */
export function isCourseOwnerKey(key: string): boolean {
  if (!key.startsWith('course:')) return false
  return !key.slice('course:'.length).includes(':')
}
