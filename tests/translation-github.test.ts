/**
 * 0.24.0 — GitHub import translation integration: the README's translation
 * links surface in the pending design + brief, and study_apply_design pulls
 * the interface-language mirror (translations/<code>/<path>) and slices it by
 * the SAME anchor so lessons land bilingual. Mirrors that 404 stay
 * original-only; a recorded interface language with no matching family never
 * fetches anything.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { studyTools } from '../src/tools.ts'
import { emptyState, type LearningState } from '../src/state.ts'
import { setHttpsGetOverride } from '../src/vendor/repo-fetcher.ts'

const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

const README = [
  '# Translated Course',
  '',
  'Multi-language: [中文](./translations/zh-cn/README.md) · [English is the original](./README.md)',
  '',
  '- [Lesson A](lessons/a.md)',
  '- [Lesson B](lessons/b.md)',
  '',
].join('\n')
const FILE_A = '# File A\npreface\n## Setup\nsetup body\n### Detail\ndetail body\n## Deep\ndeep body\n'
const FILE_A_ZH = '# 文件甲\n前言\n## 准备\n准备正文\n### 细节\n细节正文\n## 深入\n深入正文\n'
const FILE_B = '# File B\n\nlab body\n'

function githubFetch(files: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const at = url.indexOf('@main/')
    if (url.startsWith('https://cdn.jsdelivr.net/gh/') && at !== -1) {
      const text = files[url.slice(at + '@main/'.length)]
      if (text !== undefined) return new Response(text, { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

function makeTools(fetchImpl: typeof fetch): { byName: Map<string, ToolDefinition>; state: LearningState } {
  const state = emptyState()
  const tools = studyTools({ get: () => state, save: () => {} }, { fetch: fetchImpl })
  return { byName: new Map(tools.map(t => [t.name, t])), state }
}

async function run(map: Map<string, ToolDefinition>, name: string, args: Record<string, unknown>): Promise<any> {
  const tool = map.get(name)
  assert.ok(tool, `tool ${name} registered`)
  return tool.execute(args, exec)
}

test('github import: README translation links surface in the brief; apply pulls the zh-cn mirror by interface language', async () => {
  setHttpsGetOverride(async () => ({ ok: false, error: 'offline test' }))
  try {
    const { byName, state } = makeTools(githubFetch({
      'README.md': README,
      'lessons/a.md': FILE_A,
      'lessons/b.md': FILE_B,
      'translations/zh-cn/README.md': '# 翻译版课程\n',
      'translations/zh-cn/lessons/a.md': FILE_A_ZH,
      // lessons/b.md deliberately has NO zh-cn mirror — 404 keeps it original
    }))
    state.interfaceLang = 'zh-CN'

    const brief = await run(byName, 'study_import_github', { url: 'https://github.com/o/r' })
    assert.equal(brief.status, 'design_required')
    assert.ok(Array.isArray(brief.availableLangs) && brief.availableLangs.some((l: { code: string }) => l.code === 'zh-cn'),
      'the brief value carries the README-declared translation languages')
    const rendered = (byName.get('study_import_github')!.output as unknown as { render: (a: unknown, v: Record<string, unknown>) => Array<{ text: string }> }).render({}, brief)[0]!.text
    assert.ok(rendered.includes('zh-cn'), 'the rendered brief tells the tutor which translations exist')

    const applied = await run(byName, 'study_apply_design', { sections: [
      { title: 'S', lessons: [
        { title: 'Setup', file: 'lessons/a.md', anchor: '## Setup' },
        { title: 'B lab', file: 'lessons/b.md', world: 'practice' },
      ] },
    ] })
    assert.equal(applied.translations, 1, 'exactly one lesson found its mirror (a.md translated, b.md mirror 404s)')

    const lessons = state.courses[0]!.sections[0]!.lessons
    const setup = lessons.find(l => l.title === 'Setup')!
    assert.ok(setup.translation !== undefined && setup.translation.includes('准备正文'), 'the zh mirror was sliced by the SAME anchor (translated Setup heading range)')
    assert.equal(setup.translationLang, 'zh-cn')
    assert.ok(setup.body.includes('setup body'), 'the original body stays intact')
    const lab = lessons.find(l => l.title === 'B lab')!
    assert.equal(lab.translation, undefined, 'no mirror → original-only, no error')
  } finally {
    setHttpsGetOverride(null)
  }
})

test('github import: no matching translation family fetches nothing and stays original-only', async () => {
  setHttpsGetOverride(async () => ({ ok: false, error: 'offline test' }))
  let mirrorHits = 0
  try {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('translations/')) mirrorHits++
      return githubFetch({ 'README.md': README, 'lessons/a.md': FILE_A, 'lessons/b.md': FILE_B, 'translations/zh-cn/README.md': '# 翻译版课程\n' })(input)
    }) as unknown as typeof fetch
    const { byName, state } = makeTools(fetchImpl)
    state.interfaceLang = 'ja' // the repo has zh-cn only — no family match
    await run(byName, 'study_import_github', { url: 'https://github.com/o/r' })
    const applied = await run(byName, 'study_apply_design', { sections: [{ title: 'S', lessons: [{ title: 'Setup', file: 'lessons/a.md', anchor: '## Setup' }] }] })
    assert.equal(applied.translations, 0)
    assert.equal(mirrorHits, 0, 'a non-matching family never probes the translations/ path at all')
    assert.equal(state.courses[0]!.sections[0]!.lessons[0]!.translation, undefined)
  } finally {
    setHttpsGetOverride(null)
  }
})

test('brief nudge: with NO recorded interface language the tutor is told to pass translationLang explicitly', async () => {
  setHttpsGetOverride(async () => ({ ok: false, error: 'offline test' }))
  try {
    const { byName } = makeTools(githubFetch({
      'README.md': README,
      'lessons/a.md': FILE_A,
      'lessons/b.md': FILE_B,
      'translations/zh-cn/README.md': '# 翻译版课程\n',
    }))
    // interfaceLang deliberately UNSET (the desktop html-lang gap)
    const brief = await run(byName, 'study_import_github', { url: 'https://github.com/o/r' })
    const rendered = (byName.get('study_import_github')!.output as unknown as { render: (a: unknown, v: Record<string, unknown>) => Array<{ text: string }> }).render({}, brief)[0]!.text
    assert.ok(rendered.includes('translationLang'), 'the nudge tells the tutor to pass the language explicitly')
  } finally {
    setHttpsGetOverride(null)
  }
})
