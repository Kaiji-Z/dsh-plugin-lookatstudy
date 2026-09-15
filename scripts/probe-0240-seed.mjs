/** Seed the 0.24.0 probe fixtures: a two-lesson course whose FIRST lesson
 * carries a paired translation (原文/对照/译文 switcher target) and whose
 * second lesson is translation-free (control). ADDITIVE over the live shared
 * state; statePath is backed up to <statePath>.p0240-bak on first run and
 * --restore puts it back verbatim.
 * Usage: npx tsx scripts/probe-0240-seed.mjs <statePath> [--restore] */
import { loadState, saveState, importCourse } from '../src/state.ts'
import { copyFileSync, existsSync, rmSync } from 'node:fs'

const statePath = process.argv[2]
if (statePath === undefined || statePath === '') throw new Error('usage: probe-0240-seed.mjs <statePath> [--restore]')
const bak = `${statePath}.p0240-bak`

if (process.argv.includes('--restore')) {
  if (!existsSync(bak)) throw new Error(`no backup at ${bak} — nothing to restore`)
  copyFileSync(bak, statePath)
  rmSync(bak)
  console.log(`restored ${statePath} from ${bak} (round closed)`)
  process.exit(0)
}
if (existsSync(statePath)) {
  if (existsSync(bak)) throw new Error('backup already exists — run --restore first (no nesting)')
  copyFileSync(statePath, bak)
  console.log(`backup written: ${bak}`)
}

const parsed = {
  title: '双语探针课',
  sections: [{
    title: '首节',
    anchor: 'shou-jie',
    world: 'study',
    lessons: [
      {
        title: '带译文的一课',
        anchor: 'dai-yi-wen',
        body: '# Original\n\n## Core idea\n\nThe original prose paragraph explains the core idea in English, dense enough to render as real teach content.\n',
        sourceFilePath: 'lesson.md',
        world: 'study',
        translation: '# 译文版\n\n## 核心观点\n\n译文段落把核心观点用中文完整讲一遍，作为对照排版的素材。\n',
        translationLang: 'zh-cn',
      },
      {
        title: '无译文的一课',
        anchor: 'wu-yi-wen',
        body: '# No translation here\n\nThis lesson has no paired translation and must render exactly as before.\n',
        sourceFilePath: 'lesson2.md',
        world: 'study',
      },
    ],
  }],
}
const state = loadState(statePath)
const course = importCourse(state, parsed, 'folder', 'probe-0240')
state.focus = { lessonId: `${course.id}:0:0` }
saveState(statePath, state)
console.log(`seeded course ${course.id}: ${course.sections.flatMap(s => s.lessons).map(l => `${l.id}(${l.kind},translation=${l.translation !== undefined})`).join(' ')}`)
