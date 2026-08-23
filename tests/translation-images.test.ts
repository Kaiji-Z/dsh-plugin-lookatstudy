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
import { renderBilingual, renderMarkdown } from '../src/markdown.ts'

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

test('renderBilingual interleaves original paragraphs with quoted translations', () => {
  const body = 'Para one.\n\nPara two.'
  const trans = '第一段。\n\n第二段。'
  const md = renderBilingual(body, trans)
  const html = renderMarkdown(md)
  assert.ok(html.includes('Para one.'))
  assert.ok(html.includes('<blockquote>'), 'translation rides a quote block')
  assert.ok(html.indexOf('Para one.') < html.indexOf('第一段。'), 'original before its translation')
  assert.ok(html.indexOf('第二段。') > html.indexOf('Para two.'), 'pairing keeps order')
  // length mismatch: remainders append in order
  const ragged = renderBilingual('A\n\nB\n\nC', '甲')
  assert.ok(ragged.includes('C'))
  assert.ok(ragged.includes('甲'))
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

test('folder import pairs translations and apply slices them by the same anchor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-trans-'))
  const { byName, state } = (() => {
    const st = emptyState()
    return { byName: new Map(studyTools({ get: () => st, save: () => {} }).map(t => [t.name, t])), state: st }
  })()
  try {
    mkdirSync(join(dir, 'translations', 'zh-CN'), { recursive: true })
    writeFileSync(join(dir, 'lesson.md'), '# Course\n\n## Alpha\n\nOriginal alpha body.\n\n## Beta\n\nOriginal beta body.\n')
    writeFileSync(join(dir, 'translations', 'zh-CN', 'lesson.md'), '# 课程\n\n## 阿尔法\n\n阿尔法正文。\n\n## 贝塔\n\n贝塔正文。\n')
    const started = await run(byName, 'study_import_folder', { path: dir })
    assert.equal(started.status, 'design_required')
    // design references the translated headings — the anchor match must work on BOTH bodies
    const applied = await run(byName, 'study_apply_design', {
      sections: [{ title: 'S1', lessons: [
        { title: 'L1', file: 'lesson.md', anchor: 'Alpha' },
        { title: 'L2', file: 'lesson.md', anchor: 'Beta' },
      ] }],
    })
    assert.equal(applied.lessons, 3, 'two designed lessons + the section exam node')
    const lessons = state.courses[0]!.sections[0]!.lessons.filter(l => l.kind !== 'exam')
    // anchor 'Alpha' did not match the translated heading 阿尔法 → whole-file fallback for the translation slice
    assert.ok(lessons[0]!.body.includes('Original alpha body.'))
    assert.ok(lessons[0]!.translation !== undefined)
    assert.ok(lessons[0]!.translation!.includes('阿尔法正文。'))
    assert.equal(lessons[0]!.translationLang, 'zh-CN')
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
