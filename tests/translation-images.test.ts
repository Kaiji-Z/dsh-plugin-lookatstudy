/**
 * SPEC Phase 3 — translation system + image inlining:
 *  - collectTranslations: translations/{lang}/{path} pairing
 *  - renderBilingual: microsoft-layout paragraph interleave (original, then quoted translation)
 *  - apply pairs a designed lesson with its translation and slices it by the same anchor
 *  - study_translate_lesson: the tutor-protocol translation write
 *  - inlineLocalImages: relative refs → data: URLs (dir-aware), foreign refs untouched
 *  - rewriteGithubImageRefs: relative refs → jsDelivr gh URLs (dir + .. resolution)
 *  - folder-import images inline end-to-end with the 200KB cap
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { studyTools } from '../src/tools.ts'
import { emptyState, type LearningState } from '../src/state.ts'
import { collectTranslations, inlineLocalImages, rewriteGithubImageRefs } from '../src/import-design.ts'
import { renderMarkdown } from '../src/markdown.ts'

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

function setup(): { byName: Map<string, ToolDefinition>; state: LearningState } {
  const state = emptyState()
  const tools = studyTools({ get: () => state, save: () => {} })
  return { byName: new Map(tools.map(t => [t.name, t])), state }
}

async function run(map: Map<string, ToolDefinition>, name: string, args: Record<string, unknown>): Promise<any> {
  const tool = map.get(name)!
  assert.ok(tool, `tool ${name} registered`)
  return tool.execute(args, exec)
}

test('collectTranslations pairs translations/{lang}/{originalPath}', () => {
  const map = collectTranslations([
    { path: 'translations/zh-CN/lessons/one.md', content: '# 一' },
    { path: 'translations/ja/lessons/one.md', content: '# 一つ' },
    { path: 'stray.md', content: 'not in a lang dir' },
  ])
  assert.equal(map.size, 1, 'one translation per original file (last lang wins deterministically)')
  assert.equal(map.get('lessons/one.md')!.lang, 'ja')
  assert.ok(!map.has('stray.md'), 'files outside a lang dir are not translations')
})

test('study_translate_lesson stores the translation; empty markdown refused', async () => {
  const { byName, state } = setup()
  const imported = await run(byName, 'study_import_markdown', { markdown: '# T\n\n## S\n\n### L1\n\nbody' })
  const lessonId = imported.firstLessonId as string
  await run(byName, 'study_lesson', { lessonId })
  await assert.rejects(() => run(byName, 'study_translate_lesson', { lessonId, markdown: '  ', lang: 'zh' }), /empty/)
  const r = await run(byName, 'study_translate_lesson', { lessonId, markdown: '第一段正文。', lang: 'zh-CN' })
  assert.equal(r.lang, 'zh-CN')
  assert.equal(state.courses[0]!.sections[0]!.lessons[0]!.translation, '第一段正文。')
})

test('folder import pairs translations and apply slices them by the SAME ORDINAL (upstream method)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-trans-'))
  const { byName, state } = (() => {
    const st = emptyState()
    return { byName: new Map(studyTools({ get: () => st, save: () => {} }).map(t => [t.name, t])), state: st }
  })()
  try {
    mkdirSync(join(dir, 'translations', 'zh-CN'), { recursive: true })
    writeFileSync(join(dir, 'lesson.md'), '# Course\n\n## Alpha\n\nOriginal alpha body with ![fig](alpha.png).\n\n## Beta\n\nOriginal beta body.\n')
    writeFileSync(join(dir, 'alpha.png'), Buffer.from('tiny-alpha'))
    writeFileSync(join(dir, 'translations', 'zh-CN', 'lesson.md'),
      '# 课程\n\n## 阿尔法\n\n阿尔法正文，配图 ![译文图](../translated_images/whatever.png) 和多余图 ![多](extra.png)。\n\n## 贝塔\n\n贝塔正文。\n')
    const started = await run(byName, 'study_import_folder', { path: dir })
    assert.equal(started.status, 'design_required')
    // design titles come in the LEARNER's language (zh here) so the F16
    // misalignment guard can compare them against the translated headings
    const applied = await run(byName, 'study_apply_design', {
      sections: [{ title: 'S1', lessons: [
        { title: '阿尔法', file: 'lesson.md', anchor: 'Alpha' },
        { title: '贝塔', file: 'lesson.md', anchor: 'Beta' },
      ] }],
    })
    assert.equal(applied.lessons, 3, 'two designed lessons + the section exam node')
    const lessons = state.courses[0]!.sections[0]!.lessons.filter(l => l.kind !== 'exam')
    assert.ok(lessons[0]!.body.includes('Original alpha body'))
    // 0.25.0: the translation slices by the SAME heading ordinal — the other
    // section's text must NOT ride along (the old whole-file fallback did)
    assert.ok(lessons[0]!.translation !== undefined)
    assert.ok(lessons[0]!.translation!.includes('阿尔法正文'))
    assert.ok(!lessons[0]!.translation!.includes('贝塔正文'), 'ordinal alignment keeps the other section out')
    // images map BY POSITION onto the original's (inlined data URL here);
    // translation-file refs never survive, extras drop
    assert.ok(lessons[0]!.translation!.includes('data:image/png;base64,'), 'the translated figure uses the original image')
    assert.ok(!lessons[0]!.translation!.includes('translated_images'), 'relative translation-file refs are gone')
    assert.ok(!lessons[0]!.translation!.includes('![多]'), 'extra translated figures beyond the original count drop')
    assert.equal(lessons[0]!.translationLang, 'zh-CN')
    assert.ok(lessons[1]!.translation !== undefined && lessons[1]!.translation!.includes('贝塔正文'), 'the second lesson pairs its own section')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inlineLocalImages resolves refs relative to the file dir; foreign refs untouched', () => {
  const images = new Map([
    ['img/a.png', 'data:image/png;base64,QQ=='],
    ['root.png', 'data:image/png;base64,Qg=='],
  ])
  const md = '![one](a.png) ![two](./sub/../img/a.png) ![skip](missing.png) ![web](https://x/y.png)'
  const out = inlineLocalImages(md, 'img/doc.md', images)
  assert.ok(out.includes('data:image/png;base64,QQ=='), 'same-dir ref resolves')
  assert.ok(!out.includes('missing.png)') || out.includes('![skip](missing.png)'), 'unresolved ref kept verbatim')
  assert.ok(out.includes('https://x/y.png'), 'absolute URLs untouched')
})

test('rewriteGithubImageRefs points relative refs at jsDelivr gh URLs', () => {
  const md = '![local](images/diagram.png) ![up](../assets/up.svg) ![abs](https://cdn.example/x.png)'
  const out = rewriteGithubImageRefs(md, 'lessons/01-intro/README.md', 'owner', 'repo', 'main')
  assert.ok(out.includes('https://cdn.jsdelivr.net/gh/owner/repo@main/lessons/01-intro/images/diagram.png'))
  assert.ok(out.includes('https://cdn.jsdelivr.net/gh/owner/repo@main/lessons/assets/up.svg'), '.. resolves above the file dir')
  assert.ok(out.includes('https://cdn.example/x.png'), 'already-absolute refs untouched')
})

test('folder import inlines small local images as data: URLs (200KB cap enforced)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-img-'))
  const { byName, state } = (() => {
    const st = emptyState()
    return { byName: new Map(studyTools({ get: () => st, save: () => {} }).map(t => [t.name, t])), state: st }
  })()
  try {
    writeFileSync(join(dir, 'lesson.md'), '# Course\n\nBody with ![pic](small.png) and ![big](big.png).\n')
    writeFileSync(join(dir, 'small.png'), Buffer.from('tiny-png-bytes'))
    writeFileSync(join(dir, 'big.png'), Buffer.alloc(250_000, 7))
    await run(byName, 'study_import_folder', { path: dir })
    await run(byName, 'study_apply_design', { sections: [{ title: 'S1', lessons: [{ title: 'L1', file: 'lesson.md' }] }] })
    const lesson = state.courses[0]!.sections[0]!.lessons[0]!
    assert.ok(lesson.body.includes('data:image/png;base64,'), 'small image inlined')
    assert.ok(!lesson.body.includes('](big.png)') === false || lesson.body.includes('![big](big.png)'), 'over-cap image stays a plain ref')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('markdown image rendering allowlists https and data:image only', () => {
  const html = renderMarkdown('![ok](data:image/png;base64,QQ==) and ![web](https://x/a.png) and ![bad](javascript:alert(1)) and ![rel](./x.png)')
  assert.ok(html.includes('<img src="data:image/png;base64,QQ=="'))
  assert.ok(html.includes('<img src="https://x/a.png"'))
  assert.ok(!html.includes('<img src="javascript:'), 'javascript: never becomes an img src')
  assert.ok(!html.includes('<img src="./x.png"'), 'relative refs stay literal (folder inlining rewrites them before this)')
})

// ——— 0.25.2: structural drift protection (owner real-import catch) ———
// 35/35 mirror files of the owner's import preserved the heading skeleton
// 1:1, yet the wording guard skipped 49/69 anchored segments (zh titles are
// one whitespace token; translated headings are generic). A mirrored
// skeleton now trusts the ordinal outright; only a mismatched skeleton falls
// back to the wording guard.
test('translation pairing: a mirrored heading skeleton trusts the ordinal (paraphrased titles pair); a drifted skeleton still needs wording', async () => {
  const { buildCourseFromDesign, validateDesign } = await import('../src/import-design.ts')
  const orig = '# File\n\n## Alpha\n\nAlpha body with ![a](https://cdn/x.png).\n\n## Beta\n\nBeta body.\n'
  const zhMirrored = '# 文件\n\n## 阿尔法\n\n阿尔法正文。\n\n## 贝塔\n\n贝塔正文。\n'
  const validated = validateDesign({ sections: [{ title: 'S', lessons: [
    { title: '环境搭建全流程指南', file: 'f.md', anchor: '## Alpha' }, // paraphrase — nothing like 阿尔法
    { title: '贝塔', file: 'f.md', anchor: '## Beta' },
  ] }] }, new Set(['f.md']))
  const parsed = buildCourseFromDesign('T', validated, new Map([['f.md', orig]]), new Map([['f.md', { lang: 'zh-CN', content: zhMirrored }]]))
  const [a, b] = parsed.sections[0]!.lessons
  assert.ok(a.translation !== undefined && a.translation.includes('阿尔法正文'), 'the mirrored skeleton trusts the ordinal — the paraphrased title still pairs')
  assert.ok(!a.translation.includes('贝塔正文'))
  assert.ok(b.translation !== undefined && b.translation.includes('贝塔正文'))

  // drifted skeleton (one heading dropped in translation) + unlike wording → skip (宁缺毋错)
  const zhDrifted = '# 文件\n\n## 贝塔\n\n贝塔正文。\n'
  const parsed2 = buildCourseFromDesign('T', validated, new Map([['f.md', orig]]), new Map([['f.md', { lang: 'zh-CN', content: zhDrifted }]]))
  assert.equal(parsed2.sections[0]!.lessons[0]!.translation, undefined, 'a drifted skeleton with unlike wording skips the segment')
})
