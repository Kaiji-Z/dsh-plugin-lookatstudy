import { readFileSync, writeFileSync } from 'node:fs'
const P = 'C:/Users/kaiji/.dsh/lookatstudy-plugin/state.json'
const s = JSON.parse(readFileSync(P, 'utf8'))
const c = s.courses.find(x => x.id === 'artificial-intelligence-for-beginners-a-curriculum')
for (const idx of [0, 1]) {
  const l = c.sections[0].lessons[idx]
  l.status = 'mastered'
  // Sm2State field names: easeFactor/intervalDays/repetitions (NOT ease/interval/reps)
  l.sm2 = { easeFactor: 2.5, intervalDays: 1, repetitions: 1 }
  l.dueAt = new Date(Date.now() - 3600_000).toISOString()
}
writeFileSync(P, JSON.stringify(s, null, 2))
console.log('due reseeded on 0:0 + 0:1 (mastered + sm2 + dueAt past) — p13 consumes one each')
