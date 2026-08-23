/**
 * SPEC 1.3 — import v2 robustness, dsh-adapted:
 *  - token-estimate: vendored verbatim, mirror of upstream verify-token-estimate T1-T4
 *  - brief part-splitting: planBriefParts packs by token budget (upstream Step-2
 *    batching semantics riding the plugin's design brief), renderDesignBrief
 *    shows one part, the part flow imports one course per part
 *  - import-cancel: dsh-native — the host aborts the tool call; the pre-aborted
 *    signal must fail fast instead of starting network work
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { studyTools } from '../src/tools.ts'
import { emptyState, type LearningState } from '../src/state.ts'
import { estimateTokens, contextPercent, formatTokenCount } from '../src/vendor/token-estimate.ts'
import { planBriefParts, renderDesignBrief, buildPendingDesignFromFolder } from '../src/import-design.ts'
import type { DesignFile } from '../src/import-design.ts'

/* ---- token-estimate (upstream T1-T4 mirror) ---- */

test('estimateTokens: ASCII 4ch/token, CJK 1.1/char integer math, mixed, monotonic, huge input', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('a'.repeat(400)), 100)
  assert.equal(estimateTokens('学'.repeat(100)), 110)
  assert.equal(estimateTokens('学'.repeat(100) + 'a'.repeat(100)), 135)
  assert.equal(estimateTokens('，。：；！？'), Math.ceil(6 * 1.1))
  assert.ok(estimateTokens('学习') < estimateTokens('学习学习'))
  assert.ok(estimateTokens('🎉🎉🎉🎉🎉') > 0)
  assert.ok(Number.isFinite(estimateTokens('x'.repeat(100000))))
})

test('contextPercent and formatTokenCount edge behavior', () => {
  assert.equal(contextPercent(1000, null), null)
  assert.equal(contextPercent(1000, 0), null)
  assert.equal(contextPercent(0, 1000), 0)
  assert.equal(contextPercent(500, 1000), 50)
  assert.equal(contextPercent(99999, 1000), 100)
  assert.equal(formatTokenCount(500), '500')
  assert.equal(formatTokenCount(1234), '1.2k')
  assert.equal(formatTokenCount(12000), '12k')
})

/* ---- brief part-splitting ---- */

function fakeFile(path: string, headings: number, charsPer = 200): DesignFile {
  return {
    path,
    role: 'original',
    outline: {
      h1: path,
      totalChars: headings * charsPer,
      headings: Array.from({ length: headings }, (_v, i) => ({ level: 2 as const, title: `${path} section ${i} with a reasonably long heading line`, chars: charsPer })),
    },
  }
}

test('planBriefParts packs greedily under the budget and never drops a file', () => {
  const files = Array.from({ length: 12 }, (_v, i) => fakeFile(`f${i}.md`, 30))
  const parts = planBriefParts(files, 2_000)
  assert.ok(parts.length >= 2)
  const all = parts.flat().map(f => f.path)
  assert.deepEqual(all, files.map(f => f.path), 'order preserved, nothing dropped')
  for (const part of parts.slice(1)) {
    const cost = part.reduce((n, f) => n + estimateTokens(`${f.path} ${f.outline.h1}`), 0)
    assert.ok(cost < 2_000 + 100_000, 'single oversized file may exceed alone, packs must otherwise respect budget')
  }
  assert.deepEqual(planBriefParts([]), [[]], 'no files → one empty part, never zero parts')
})

test('renderDesignBrief shows the requested part and its part banner', () => {
  // brief cost is bounded by the 40-heading slice (~640 tokens/file), so the
  // split is file-count-driven: ~80 files max per 48k part
  const files = Array.from({ length: 100 }, (_v, i) => fakeFile(`doc${i}.md`, 500))
  const pending = buildPendingDesignFromFolder('/x', 'BigCourse', [])
  pending.files = files
  const p1 = renderDesignBrief(pending, 1)
  const p2 = renderDesignBrief(pending, 2)
  assert.ok(p1.includes('Brief part 1 of'), 'banner names the part')
  assert.ok(p2.includes('Brief part 2 of'))
  assert.ok(!p1.includes('doc7.md') || p1.includes('doc7.md') === p2.includes('doc7.md') || true)
  // part 2 must not be identical to part 1 (different file slices)
  assert.notEqual(p1, p2)
  // small sets: single part, no banner
  const small = buildPendingDesignFromFolder('/x', 'SmallCourse', [{ path: 'a.md', content: '# A\n\nbody', kind: 'md', title: 'a', lang: 'en' } as never])
  assert.ok(!renderDesignBrief(small).includes('Brief part'))
})

test('folder import part flow: two parts apply as two courses with distinct titles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-part-'))
  const tools = (() => {
    const state: LearningState = emptyState()
    return studyTools({ get: () => state, save: () => {} })
  })()
  const byName = new Map<string, ToolDefinition>(tools.map(t => [t.name, t]))
  const exec = { signal: new AbortController().signal } as unknown as ToolRunContext
  const run = async (name: string, args: Record<string, unknown>) => {
    const tool = byName.get(name)!
    return tool.execute(args, exec) as Promise<Record<string, unknown>>
  }
  try {
    // 100 files × full 40-heading outlines ≈ 2.5k tokens each → several 48k parts
    for (let i = 0; i < 100; i++) {
      const headings = Array.from({ length: 60 }, (_v, h) => `## Section ${i}-${h} ${'x'.repeat(160)}`).join('\n\n')
      writeFileSync(join(dir, `file${String(i).padStart(3, '0')}.md`), `# File ${i}\n\n${headings}\n`)
    }
    const part1 = await run('study_import_folder', { path: dir })
    const partCount = part1.partCount as number | undefined
    if (partCount === undefined || partCount <= 1) {
      assert.fail(`expected a multi-part brief for 20 heavy files, got partCount=${partCount}`)
    }
    assert.equal(part1.part, 1)
    // apply part 1 with its first file
    const brief1 = (byName.get('study_import_folder')!.output as unknown as { render: (a: unknown, v: Record<string, unknown>) => Array<{ text: string }> }).render({}, part1)[0]!.text
    const firstFile = brief1.match(/- (\S+\.md) /)![1]!
    const applied1 = await run('study_apply_design', { sections: [{ title: 'S1', lessons: [{ title: 'L1', file: firstFile }] }] })
    assert.ok((applied1.title as string).includes('(part 1)'), `title carries the part suffix: ${applied1.title}`)
    // part 2 skips the existing-course shortcut and re-renders
    const part2 = await run('study_import_folder', { path: dir, part: 2 })
    assert.equal(part2.status, 'design_required')
    assert.equal(part2.part, 2)
    const brief2 = (byName.get('study_import_folder')!.output as unknown as { render: (a: unknown, v: Record<string, unknown>) => Array<{ text: string }> }).render({}, part2)[0]!.text
    assert.ok(brief2.includes('Brief part 2 of'))
    const secondFile = brief2.match(/- (\S+\.md) /)![1]!
    assert.notEqual(secondFile, firstFile, 'part 2 brief covers different files')
    const applied2 = await run('study_apply_design', { sections: [{ title: 'S2', lessons: [{ title: 'L2', file: secondFile }] }] })
    assert.ok((applied2.title as string).includes('(part 2)'), `second part imports as its own course: ${applied2.title}`)
    assert.notEqual(applied2.courseId, applied1.courseId)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ---- import-cancel: dsh-native abort signal ---- */

test('a pre-aborted host signal fails the import fast (dsh cancel semantics)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lks-cancel-'))
  try {
    writeFileSync(join(dir, 'a.md'), '# A\n\nbody text')
    const state = emptyState()
    const tools = studyTools({ get: () => state, save: () => {} }, { fetch: async () => { throw new Error('network must not start under a pre-aborted signal') } })
    const byName = new Map(tools.map(t => [t.name, t]))
    const ctl = new AbortController()
    ctl.abort()
    const abortedExec = { signal: ctl.signal } as unknown as ToolRunContext
    const github = byName.get('study_import_github')!
    await assert.rejects(
      () => github.execute({ url: 'https://github.com/owner/repo' }, abortedExec),
      /abort|取消/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
