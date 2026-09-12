/**
 * The tutor-driven course-design stage of GitHub import — ported from
 * LookatStudy's LLM import pipeline (structure-design prompt in
 * import-llm-service.ts + anchor slicing in import-pipeline.ts, upstream
 * 2026-08). The plugin has no model client of its own — the tutor IS the LLM —
 * so the "LLM step" is a two-tool protocol: study_import_github returns a
 * design brief (files, outlines, per-heading sizes, design rules) and
 * study_apply_design validates + applies the tutor's structure JSON. The
 * deterministic parts stay deterministic: fetch, outlines, char counts,
 * anchor slicing, and anti-hallucination validation. Upstream's JSON-salvage
 * and bisection machinery is deliberately not ported: a rejected design
 * returns to the tutor as a tool error and the agent loop self-heals.
 * @module dsh-plugin-lookatstudy/import-design
 */

import type { ParsedCourse, ParsedLesson, ParsedSection } from './vendor/markdown-course.ts'
import { extractOutlineWithCharCounts } from './vendor/repo-fetcher.ts'
import type { FileOutline, RepoInventory } from './vendor/repo-fetcher.ts'
import type { ScannedDoc, ScannedImage } from './vendor/local-folder-scanner.ts'
import { estimateTokens } from './vendor/token-estimate.ts'

/** One file entry of the design brief, as rendered to the tutor. */
export interface DesignFile {
  path: string
  /** Deterministic role hint derived from discovery (ipynb → practice). */
  role: 'original' | 'practice'
  outline: FileOutline
}

/** In-memory state between an import tool and study_apply_design. */
export interface PendingDesign {
  /** What the import ran over; apply uses it for sourceRef. */
  source: 'github' | 'folder' | 'url'
  url: string
  owner: string
  repo: string
  branch: string
  courseTitle: string
  readmeExcerpt: string
  files: DesignFile[]
  fullTreeCount: number
  /** Folder imports carry their file contents inline — apply never hits the network. */
  localContents?: ReadonlyMap<string, string>
  /** Context-budget brief part this pending design was rendered for (import v2
   *  batching): part N > 1 imports as its own course with this title suffix. */
  part?: number
  partCount?: number
  /** Translations keyed by original file path (translations/{lang}/{path}). */
  translations?: ReadonlyMap<string, { lang: string; content: string }>
  /** Inline-able local images keyed by repository-relative path → data: URL (capped). */
  localImages?: ReadonlyMap<string, string>
}

/** The tutor's JSON as declared by study_apply_design's parameters. */
export interface DesignLessonJson {
  title: string
  file: string
  anchor?: string
  world?: string
}

export interface DesignSectionJson {
  title: string
  lessons: DesignLessonJson[]
}

/** The design after validation/cleaning; unknown files dropped, worlds coerced. */
export interface ValidatedDesign {
  sections: Array<{
    title: string
    lessons: Array<{ title: string; file: string; anchor: string | null; world: 'study' | 'practice' }>
  }>
  /** Lessons removed because their `file` was not in the brief (anti-hallucination). */
  droppedLessons: number
}

/** Cap that keeps one design turn's JSON within a sane output size. */
export const COARSE_DESIGN_FILE_THRESHOLD = 80

/**
 * Build the pending design from Step 1 (inventory) + Step 3 (outlines).
 * @param url - the GitHub URL the learner asked to import.
 * @param owner - repo owner.
 * @param repo - repo name.
 * @param inventory - fetchRepoInventory output (README, file list, tree).
 * @param outlines - fetchFileOutlines output, keyed by path.
 * @returns the pending design the brief renders from.
 */
export function buildPendingDesign(url: string, owner: string, repo: string, inventory: RepoInventory, outlines: Map<string, FileOutline>): PendingDesign {
  const files: DesignFile[] = []
  for (const discovered of inventory.fileList) {
    const outline = outlines.get(discovered.path)
    if (outline === undefined) continue
    files.push({
      path: discovered.path,
      role: discovered.kind === 'ipynb' ? 'practice' : 'original',
      outline,
    })
  }
  const courseTitle = inventory.readmeMd.match(/^#\s+(.+)$/m)?.[1]?.trim() || repo
  return {
    source: 'github',
    url,
    owner,
    repo,
    branch: inventory.branch,
    courseTitle,
    readmeExcerpt: inventory.readmeMd.slice(0, 4000),
    files,
    fullTreeCount: inventory.fullTree.length,
  }
}

/**
 * Build the pending design from a local folder scan — the same brief, but the
 * bodies ride along (localContents), so apply is fully offline.
 * @param path - the absolute folder path (becomes sourceRef).
 * @param title - fallback course title (the folder's name).
 * @param docs - scanFolder output (relative paths + content).
 * @returns the pending design.
 */
export function buildPendingDesignFromFolder(path: string, title: string, docs: ScannedDoc[], extra?: { translations?: ScannedDoc[]; images?: ScannedImage[] }): PendingDesign {
  const files: DesignFile[] = docs.map(doc => ({
    path: doc.path,
    role: doc.kind === 'ipynb' ? 'practice' : 'original',
    outline: extractOutlineWithCharCounts(doc.content, doc.path),
  }))
  const readme = docs.find(doc => /^readme\.md$/i.test(doc.path.split('/').pop() ?? ''))?.content ?? ''
  const courseTitle = readme.match(/^#\s+(.+)$/m)?.[1]?.trim() || title
  const localContents = new Map(docs.map(doc => [doc.path, doc.content]))
  return {
    source: 'folder',
    url: path,
    owner: '',
    repo: title,
    branch: 'local',
    courseTitle,
    readmeExcerpt: readme.slice(0, 4000),
    files,
    fullTreeCount: docs.length,
    localContents,
    ...(extra?.translations !== undefined && extra.translations.length > 0 ? { translations: collectTranslations(extra.translations) } : {}),
    ...(extra?.images !== undefined && extra.images.length > 0 ? { localImages: new Map<string, string>() } : {}),
  }
}

/** Rewrite ![alt](relRef) refs in one file's content to the inlined data URLs
 *  (refs resolve relative to the markdown file's own directory). */
export function inlineLocalImages(content: string, filePath: string, images: ReadonlyMap<string, string>): string {
  if (images.size === 0) return content
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
  const resolve = (ref: string): string => {
    const parts = `${dir}/${ref.replace(/^\.\//, '')}`.split('/')
    const stack: string[] = []
    for (const p of parts) {
      if (p === '..') stack.pop()
      else if (p !== '.' && p !== '') stack.push(p)
    }
    return stack.join('/')
  }
  return content.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (m, open: string, ref: string, close: string) => {
    if (/^(https?:|data:)/i.test(ref)) return m
    const data = images.get(resolve(ref))
    return data === undefined ? m : `${open}${data}${close}`
  })
}

/** translations/{lang}/{originalPath} → Map<originalPath, {lang, content}> (upstream translation pairing). */
export function collectTranslations(translations: ReadonlyArray<{ path: string; content: string }>): Map<string, { lang: string; content: string }> {
  const out = new Map<string, { lang: string; content: string }>()
  for (const t of translations) {
    const m = t.path.match(/^translations\/([^/]+)\/(.+)$/)
    if (m === null) continue
    out.set(m[2]!, { lang: m[1]!, content: t.content })
  }
  return out
}

/** Rewrite relative image refs to jsDelivr raw URLs (GitHub imports keep
 *  referencing the CDN — no download, upstream image-refs semantics). */
export function rewriteGithubImageRefs(content: string, filePath: string, owner: string, repo: string, branch: string): string {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
  const resolve = (ref: string): string => {
    const parts = `${dir}/${ref.replace(/^\.\//, '')}`.split('/')
    const stack: string[] = []
    for (const p of parts) {
      if (p === '..') stack.pop()
      else if (p !== '.' && p !== '') stack.push(p)
    }
    return stack.join('/')
  }
  return content.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (m, open: string, ref: string, close: string) => {
    if (/^(https?:|data:)/i.test(ref)) return m
    return `${open}https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${resolve(ref)}${close}`
  })
}

/**
 * Build the pending design from URL-sourced docs (arXiv PDF text / web article
 * markdown, already chunked by prepareSingleDoc) — bodies ride along so apply
 * is fully offline, same as folder imports.
 * @param url - the normalized source URL (becomes sourceRef).
 * @param title - the fetched title (article title / arXiv id label).
 * @param docs - virtual docs ({stem}-01.md parts or one whole file).
 * @returns the pending design.
 */
export function buildPendingDesignFromUrl(url: string, title: string, docs: { path: string; content: string }[]): PendingDesign {
  const files: DesignFile[] = docs.map(doc => ({
    path: doc.path,
    role: 'original',
    outline: extractOutlineWithCharCounts(doc.content, doc.path),
  }))
  const localContents = new Map(docs.map(doc => [doc.path, doc.content]))
  return {
    source: 'url',
    url,
    owner: '',
    repo: title,
    branch: 'web',
    courseTitle: title,
    readmeExcerpt: docs[0]?.content.slice(0, 4000) ?? '',
    files,
    fullTreeCount: docs.length,
    localContents,
  }
}

/**
 * Render the design brief — the ONLY channel into the tutor's context
 * (dsh models see tool results through output.render alone). Carries the
 * upstream design rules: study/practice/attached classification, the
 * 3000-8000 chars lesson pacing, sub-1000 merging, attached absorption, and
 * the strict JSON contract study_apply_design expects.
 * @param pending - the pending design to present.
 * @returns the full brief text.
 */
export function renderDesignBrief(pending: PendingDesign, part = 1): string {
  const parts = planBriefParts(pending.files)
  const shown = parts[Math.min(Math.max(part, 1), parts.length) - 1]!
  const lines: string[] = []
  lines.push(`## Course design brief: ${pending.courseTitle}`)
  lines.push(pending.source === 'folder'
    ? `Folder import (${pending.fullTreeCount} files; ${shown.length} of ${pending.files.length} course files below).`
    : pending.source === 'url'
      ? `Web import from ${pending.url} (${pending.fullTreeCount} document parts; ${shown.length} of ${pending.files.length} course files below).`
      : `Repo ${pending.owner}/${pending.repo}@${pending.branch} (${pending.fullTreeCount} paths in tree; ${shown.length} of ${pending.files.length} course files below).`)
  if (parts.length > 1) {
    lines.push('')
    lines.push(`**Brief part ${Math.min(Math.max(part, 1), parts.length)} of ${parts.length}** (context-budget split, ~${Math.round(BRIEF_PART_TOKEN_BUDGET / 1000)}k tokens per part).`
      + ` Design lessons ONLY from the files in this part, apply, then call the same import tool again with \`part\` = ${Math.min(Math.max(part, 1), parts.length) + 1 <= parts.length ? Math.min(Math.max(part, 1), parts.length) + 1 : 'done'}`
      + ` — each part imports as its own course. File paths from other parts are valid but invisible to you; do not guess them.`)
  }
  lines.push('')
  lines.push('### Repository README (first 4000 chars)')
  lines.push(pending.readmeExcerpt.trim() === '' ? '(empty)' : pending.readmeExcerpt)
  lines.push('')
  lines.push('### Files (role hint · h1 · totalChars · H2/H3 outline with per-heading chars)')
  for (const file of shown) {
    lines.push(`- ${file.path} (role hint: ${file.role}, total ${file.outline.totalChars} chars, h1: ${file.outline.h1})`)
    const headings = file.outline.headings.slice(0, 40)
    for (const heading of headings) {
      lines.push(`  ${'#'.repeat(heading.level)} ${heading.title} [${heading.chars}]`)
    }
    if (file.outline.headings.length > headings.length) {
      lines.push(`  (+${file.outline.headings.length - headings.length} more headings)`)
    }
  }
  lines.push('')
  lines.push('### Design rules (from the LookatStudy import pipeline)')
  lines.push('Classify every lesson as exactly one of:')
  lines.push('- **study**: explanation/theory/tutorial content — the learning-world spine, its own lesson.')
  lines.push('- **practice**: Exercise / Lab / notebook — its own lesson.')
  lines.push('- **attached** (NOT its own lesson): quiz links, Conclusion, Challenge, Review references. Do not drop them — let the previous study lesson\'s anchor range naturally include them (omit their heading from the lesson list).')
  lines.push('Pacing by char counts (target 3000-8000 chars per lesson):')
  lines.push('- file totalChars < 3000 → one whole-file study lesson, no anchor.')
  lines.push('- an explanatory H2 (with its H3 children) under 8000 chars → one lesson, anchor = that H2\'s full title.')
  lines.push('- an explanatory H2 over 8000 chars with H3s → split into one lesson per H3, anchor = each H3\'s full title.')
  lines.push('- an explanatory H2 over 8000 chars without H3s → accept one long lesson.')
  lines.push('- after splitting, merge any lesson under 1000 chars into the adjacent same-world lesson to avoid fragmentation.')
  lines.push('Other rules:')
  lines.push('- role hints are references, not verdicts — README tables usually mark real roles (Lesson link = study, Notebook/Lab = practice).')
  lines.push('- if the directory layout is already clear (e.g. lessons/N-Topic/), keep its sections; do not over-reorganize.')
  lines.push(`- anchor is the full heading text used to slice the body; omit it for whole-file lessons.${shown.length > COARSE_DESIGN_FILE_THRESHOLD ? ' This part is large: design at file granularity (omit anchors, one lesson per file) to keep the JSON manageable.' : ''}`)
  lines.push('')
  lines.push('### Language-course check (decide while designing)')
  lines.push('Is this course teaching a language ITSELF (vocabulary, grammar, reading/writing/listening of English/Japanese/Korean/Chinese/…),'
    + ' rather than a knowledge/tech course that merely happens to be written in some language? Typical tells: vocab lists, grammar-point'
    + ' explanations, dialogues/readings, sentence-translation pairs, level markers (N5/N1, TOEFL/IELTS, HSK, JLPT), pronunciation content.')
  lines.push('- Yes → add "languageTarget": "<BCP-47 of the TAUGHT language>" (teaching English → "en", Japanese → "ja").'
    + ' The writing language is NOT the taught language — a Chinese-written English-textbook repo has languageTarget "en".')
  lines.push('- No, or unsure → omit it entirely (a normal course misflagged as a language course is worse than the reverse).')
  lines.push('')
  lines.push('Now design the course and call study_apply_design with:')
  lines.push('{ "languageTarget": "<only for language courses>", "sections": [ { "title": "...", "lessons": [ { "title": "...", "file": "<exact path from this brief>", "anchor": "<optional full heading text>", "world": "study" | "practice" } ] } ] }')
  lines.push('Use ONLY file paths that appear in this brief — anything else is dropped. Apply directly, then walk the learner through the course map.')
  return lines.join('\n')
}

/** Context-budget per brief part (upstream import v2 batching semantics, dsh-adapted:
 *  the brief is the plugin's classification input, so the split rides the brief). */
export const BRIEF_PART_TOKEN_BUDGET = 48_000

/** Greedily pack brief files into token-budgeted parts (upstream Step-2 batching).
 *  A single file larger than the budget gets its own part (never dropped). */
export function planBriefParts(files: readonly DesignFile[], budgetTokens = BRIEF_PART_TOKEN_BUDGET): DesignFile[][] {
  const parts: DesignFile[][] = []
  let current: DesignFile[] = []
  let used = 0
  for (const file of files) {
    const cost = estimateTokens(briefFileBlock(file))
    if (current.length > 0 && used + cost > budgetTokens) {
      parts.push(current)
      current = []
      used = 0
    }
    current.push(file)
    used += cost
  }
  if (current.length > 0) parts.push(current)
  return parts.length > 0 ? parts : [[]]
}

/** The rendered brief block for one file (the unit the token budget packs). */
function briefFileBlock(file: DesignFile): string {
  const lines = [`${file.path} (role hint: ${file.role}, total ${file.outline.totalChars} chars, h1: ${file.outline.h1})`]
  for (const heading of file.outline.headings.slice(0, 40)) {
    lines.push(`${'#'.repeat(heading.level)} ${heading.title} [${heading.chars}]`)
  }
  return lines.join('\n')
}

/** One H2/H3 heading with its line number (code-fence aware). */
export interface HeadingLine {
  level: 2 | 3
  title: string
  line: number
}

/**
 * Extract H2/H3 headings with line numbers; headings inside ``` / ~~~ fences
 * are body text (upstream import-pipeline.ts extractHeadings).
 * @param content - the file's markdown text.
 * @returns headings in document order.
 */
export function extractHeadings(content: string): HeadingLine[] {
  const lines = content.split(/\r?\n/)
  const headings: HeadingLine[] = []
  let inCodeFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence) continue
    const h2 = line.match(/^##\s+(.+)$/)
    if (h2) {
      headings.push({ level: 2, title: h2[1]!.trim(), line: i })
      continue
    }
    const h3 = line.match(/^###\s+(.+)$/)
    if (h3) headings.push({ level: 3, title: h3[1]!.trim(), line: i })
  }
  return headings
}

/**
 * Locate an anchor among the file's headings by bidirectional substring
 * match (case-insensitive, leading #'s stripped) — upstream
 * import-pipeline.ts findTitleIndex.
 * @param headings - the file's headings.
 * @param anchor - the anchor text from the design.
 * @returns the heading index, or -1 when nothing matches.
 */
export function findTitleIndex(headings: readonly HeadingLine[], anchor: string): number {
  const anchorClean = anchor.replace(/^#{1,3}\s+/, '').toLowerCase().trim()
  if (anchorClean === '') return -1
  for (let i = 0; i < headings.length; i++) {
    const titleLower = headings[i]!.title.toLowerCase()
    if (titleLower.includes(anchorClean) || anchorClean.includes(titleLower)) return i
  }
  return -1
}

/**
 * Slice one lesson's body out of a file (upstream import-pipeline.ts
 * extractSectionByIndex semantics, locked by upstream's
 * verify-section-extract suite):
 * - the file's FIRST lesson starts at line 0, absorbing the H1, preface
 *   prose, and any leading attached H2 (e.g. a pre-lecture quiz);
 * - an H2 anchor runs until the next H2/H1, swallowing its H3 subsections;
 * - an H3 anchor runs until the very next H2/H3/H1;
 * - no matching heading → the whole file.
 * @param content - the file's text.
 * @param headings - the file's headings.
 * @param titleIndex - findTitleIndex result, or -1 for whole-file.
 * @param isFirstOfFile - whether this is the first designed lesson of the file.
 * @returns the sliced, trimmed body.
 */
export function sliceLessonBody(content: string, headings: readonly HeadingLine[], titleIndex: number, isFirstOfFile: boolean): string {
  const lines = content.split(/\r?\n/)
  if (titleIndex < 0) return content.trim()
  const anchor = headings[titleIndex]!
  const startLine = isFirstOfFile ? 0 : anchor.line
  let endLine = lines.length
  for (let i = titleIndex + 1; i < headings.length; i++) {
    if (headings[i]!.level <= anchor.level) {
      endLine = headings[i]!.line
      break
    }
  }
  return lines.slice(startLine, endLine).join('\n').trim()
}

/**
 * Validate and clean the tutor's design JSON (upstream
 * parseStructureDesignResult rules): lessons pointing at files outside the
 * brief are dropped (anti-hallucination), worlds other than exactly
 * "practice" coerce to study, empty titles get a fallback, sections with no
 * surviving lessons are dropped.
 * @param design - the tutor's JSON (shape already enforced by the parameters schema).
 * @param validFiles - the pending design's file set.
 * @returns the cleaned design plus the dropped-lesson count.
 */
export function validateDesign(design: { sections: DesignSectionJson[] }, validFiles: ReadonlySet<string>): ValidatedDesign {
  const sections: ValidatedDesign['sections'] = []
  let droppedLessons = 0
  for (const section of design.sections) {
    const lessons: ValidatedDesign['sections'][number]['lessons'] = []
    for (const lesson of section.lessons ?? []) {
      if (typeof lesson.file !== 'string' || !validFiles.has(lesson.file)) {
        droppedLessons++
        continue
      }
      const anchor = typeof lesson.anchor === 'string' && lesson.anchor.trim() !== '' ? lesson.anchor : null
      lessons.push({
        title: typeof lesson.title === 'string' && lesson.title.trim() !== '' ? lesson.title.trim() : 'Untitled lesson',
        file: lesson.file,
        anchor,
        world: lesson.world === 'practice' ? 'practice' : 'study',
      })
    }
    if (lessons.length > 0) {
      sections.push({
        title: typeof section.title === 'string' && section.title.trim() !== '' ? section.title.trim() : 'Untitled section',
        lessons,
      })
    }
  }
  const total = sections.reduce((n, s) => n + s.lessons.length, 0)
  if (total === 0) {
    throw new Error(`lookatstudy-plugin: design produced 0 usable lessons (dropped ${droppedLessons} — every lesson's file must come from the design brief; call study_import_github again to re-read it)`)
  }
  return { sections, droppedLessons }
}

/** GitHub-style anchor slug for ParsedLesson/ParsedSection anchors. */
function slugAnchor(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug === '' ? 'section' : slug
}

/**
 * Assemble the final ParsedCourse from a validated design and the fetched
 * file contents: per-file heading extraction + anchor slicing with the
 * first-lesson-absorbs-the-header rule, practice worlds per lesson, and
 * all-practice sections marked so importCourse skips their exam nodes.
 * @param courseTitle - title from the brief.
 * @param validated - validateDesign output.
 * @param contents - fetched body text per designed file (missing key = loud failure).
 * @returns the parsed course ready for importCourse.
 */
export function buildCourseFromDesign(courseTitle: string, validated: ValidatedDesign, contents: ReadonlyMap<string, string>, translations?: ReadonlyMap<string, { lang: string; content: string }>): ParsedCourse {
  const headingsCache = new Map<string, HeadingLine[]>()
  const headingsOf = (file: string): HeadingLine[] => {
    const cached = headingsCache.get(file)
    if (cached === undefined) {
      const extracted = extractHeadings(contents.get(file) ?? '')
      headingsCache.set(file, extracted)
      return extracted
    }
    return cached
  }
  const firstLessonSeen = new Set<string>()
  const sections: ParsedSection[] = validated.sections.map(section => {
    const lessons: ParsedLesson[] = section.lessons.map(lesson => {
      const content = contents.get(lesson.file)
      if (content === undefined) {
        throw new Error(`lookatstudy-plugin: no fetched content for designed file ${JSON.stringify(lesson.file)} — fetch failed earlier; retry study_apply_design`)
      }
      const headings = headingsOf(lesson.file)
      const titleIndex = lesson.anchor === null ? -1 : findTitleIndex(headings, lesson.anchor)
      const isFirst = !firstLessonSeen.has(lesson.file)
      firstLessonSeen.add(lesson.file)
      const pair = translations?.get(lesson.file)
      let translation: string | undefined
      if (pair !== undefined) {
        // Slice the translation by the SAME anchor (upstream translation pairing:
        // headings are translated too, so the anchor match is bidirectional-substring).
        const tHeadings = extractHeadings(pair.content)
        const tIndex = lesson.anchor === null ? -1 : findTitleIndex(tHeadings, lesson.anchor)
        translation = sliceLessonBody(pair.content, tHeadings, tIndex, isFirst)
      }
      return {
        title: lesson.title,
        anchor: slugAnchor(lesson.title),
        body: sliceLessonBody(content, headings, titleIndex, isFirst),
        sourceFilePath: lesson.file,
        world: lesson.world,
        ...(translation !== undefined ? { translation, translationLang: pair!.lang } : {}),
      }
    })
    return {
      title: section.title,
      anchor: slugAnchor(section.title),
      world: lessons.every(l => l.world === 'practice') ? 'practice' : 'study',
      lessons,
    }
  })
  return { title: courseTitle, sections }
}
