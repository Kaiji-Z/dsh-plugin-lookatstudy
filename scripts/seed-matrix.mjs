import { readFileSync, writeFileSync } from 'node:fs'
const P = 'C:/Users/kaiji/.dsh/lookatstudy-plugin/state.json'
const s = JSON.parse(readFileSync(P, 'utf8'))
const c = s.courses.find(x => x.id === 'artificial-intelligence-for-beginners-a-curriculum')
const l = c.sections[0].lessons[0]
const id = 'note-matrix-locate'
if (!l.notes.some(n => n.id === id)) {
  l.notes.push({
    id,
    zone: 'understand',
    title: 'matrix 回到原文探针',
    text: '定位闪烁断言用笔记。',
    source: 'learner',
    quote: 'Make sure you have Python installed',
    at: new Date().toISOString(),
    pinned: false,
  })
}
writeFileSync(P, JSON.stringify(s, null, 2))
console.log('note seeded on 0:0, quote anchored to lesson body')
