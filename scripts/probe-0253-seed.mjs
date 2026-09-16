/** Seed the 0.25.3 read-aloud probe fixtures: a one-lesson course whose
 * lesson carries several read-aloud-friendly sentences in BOTH the original
 * (English) and a paired zh translation. ADDITIVE over the live shared
 * state; backed up to <statePath>.p0253-bak, --restore puts it back.
 * Usage: npx tsx scripts/probe-0253-seed.mjs <statePath> [--restore] */
import { loadState, saveState, importCourse } from '../src/state.ts'
import { copyFileSync, existsSync, rmSync } from 'node:fs'

const statePath = process.argv[2]
if (statePath === undefined || statePath === '') throw new Error('usage: probe-0253-seed.mjs <statePath> [--restore]')
const bak = `${statePath}.p0253-bak`

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

const longEn = Array.from({ length: 24 }, (_v, i) => `Paragraph ${i + 1} of the reading probe carries enough prose to push the notebook well past the viewport height, so the sticky tab bar has real scrolling to prove it stays pinned. `).join('\n\n')
const longZh = Array.from({ length: 24 }, (_v, i) => `第${i + 1}段译文把右栏撑到足够高，让粘顶标签条有真实滚动可证明它钉在顶部。`).join('\n\n')
const parsed = {
  title: '朗读探针课',
  sections: [{
    title: '首节',
    anchor: 'shou-jie',
    world: 'study',
    lessons: [
      {
        title: '带译文的一课',
        anchor: 'dai-yi-wen',
        body: `# Reading probe\n\n## Core idea\n\nThe first sentence introduces read-aloud in plain language. The second sentence explains that the translation view reads the translation.\n\n${longEn}\n`,
        sourceFilePath: 'lesson.md',
        world: 'study',
        translation: `# 朗读探针\n\n## 核心观点\n\n第一句话把朗读跟随讲清楚。第二句话说明译文视图要读译文。\n\n${longZh}\n`,
        translationLang: 'zh-cn',
      },
    ],
  }],
}
const state = loadState(statePath)
const course = importCourse(state, parsed, 'folder', 'probe-0253')
state.focus = { lessonId: `${course.id}:0:0` }
saveState(statePath, state)
console.log(`seeded course ${course.id}`)
