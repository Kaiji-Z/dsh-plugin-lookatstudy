import { readFileSync, writeFileSync } from 'node:fs'
const P = 'C:/Users/kaiji/.dsh/lookatstudy-plugin/state.json'
const s = JSON.parse(readFileSync(P, 'utf8'))
const c = s.courses.find(x => x.id === 'artificial-intelligence-for-beginners-a-curriculum')
const l = c.sections[0].lessons[2]
const kcs = ['Python环境', '基础语法', '数据类型']
const qs = []
for (let i = 0; i < 5; i++) {
  const kc = kcs[i % 3]
  qs.push({
    id: `seed-q${i + 1}`,
    prompt: `p12 第 ${i + 1} 题：下列哪项是对的？`,
    options: ['正确项', '干扰一', '干扰二', '干扰三'],
    answer: 0,
    kcTitle: kc,
    explanation: `第 ${i + 1} 题解析：正确项是唯一正确答案。`,
  })
}
l.examBank = { status: 'ready', questions: qs, generatedAt: new Date().toISOString() }
// reset any stale attempt view state so the probe lands on a clean stage
delete l.examAttempts
writeFileSync(P, JSON.stringify(s, null, 2))
console.log('bank reseeded:', l.examBank.questions.length, 'questions, KCs:', kcs.join('/'))
