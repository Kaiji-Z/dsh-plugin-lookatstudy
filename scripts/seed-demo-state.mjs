/** Seed a demo state for README screenshots — every transition rides the plugin's
 *  real code paths (importCourse / defineConcepts / recordAnswer / recordExamResult
 *  / setMemory / addNote), then two honest visual tweaks (an overdue review, a
 *  translation) written directly. Usage: npx tsx scripts/seed-demo-state.mjs <statePath>. */
import { emptyState, saveState, importCourse, defineConcepts, recordAnswer, recordExamResult, setMemory, attemptLesson } from '../src/state.ts'
import { parseMarkdownToCourse } from '../src/vendor/markdown-course.ts'
import { readFileSync, rmSync } from 'node:fs'

const statePath = process.argv[2]
if (statePath === undefined) throw new Error('usage: seed-demo-state.mjs <statePath>')
rmSync(statePath, { force: true })

const MARKDOWN = `# 深度学习入门

## 神经网络基础

### 线性与非线性

一层神经网络做两件事:先把输入乘上权重矩阵并加偏置,再套一个非线性激活函数。

前半步是线性变换:

$$z = Wx + b$$

其中 $W \\in \\mathbb{R}^{m \\times n}$ 是该层的权重矩阵,$b$ 是偏置向量。如果省掉非线性,
多层线性变换的复合仍是一个线性变换 —— 深度网络的表达力将不复存在,所以激活函数不可省。

常见的激活函数:

\`\`\`python
import torch.nn as nn

activations = {
    "relu":   nn.ReLU(),      # max(0, x)          —— 最常用的默认选择
    "gelu":   nn.GELU(),      # x * Phi(x)         —— Transformer 系的标配
    "sigmoid": nn.Sigmoid(),  # 1 / (1 + e^-x)     —— 门控与二分类输出
}
\`\`\`

数据在一层内的流动:

\`\`\`mermaid
flowchart LR
  X[输入 x] --> L[线性变换 Wx + b]
  L --> A[非线性激活 sigma]
  A --> Y[输出 y]
\`\`\`

### 反向传播

反向传播用链式法则,把损失对输出的梯度逐层回传成对每个参数的梯度。每个中间结果都被复用,整趟回传的开销与一次前向传播相当。

### 优化器

动量法累积历史梯度的速度,Adam 为每个参数维护梯度的一阶与二阶滑动均值并据此重标步长。学习率通常在训练中按余弦或阶梯衰减。

## 训练实践

### 过拟合与正则

当模型记住了训练集的噪声而非规律,验证损失便会掉头向上。权重衰减、Dropout、数据增广与早停是最常用的四道防线。
`

const state = emptyState()
state.active = true
const parsed = parseMarkdownToCourse(MARKDOWN)
importCourse(state, parsed, 'markdown', 'README demo')

const lessons = state.courses[0].sections.flatMap(sec => sec.lessons)
const byTitle = (kw) => lessons.find(l => l.title.includes(kw))
const now = new Date()

// — 线性与非线性:概念 + 部分掌握(in_progress,弱概念可见)—
const l1 = byTitle('线性')
attemptLesson(state, l1.id, now)
defineConcepts(state, l1.id, [
  { title: '权重矩阵', description: '理解 W 如何把输入投影到输出空间' },
  { title: '激活函数', description: '理解非线性为何是深度表达力的来源' },
  { title: '链式法则', description: '理解梯度如何逐层回传' },
], '一层 = 线性变换 + 非线性激活;两者缺一不可。')
for (const [correct, concept] of [[true, '权重矩阵'], [true, '权重矩阵'], [true, '激活函数'], [false, '链式法则'], [true, '激活函数']]) {
  recordAnswer(state, l1.id, correct, concept, now)
}
// 双语对照:黑板把原文与英文译文逐段交错
l1.translation = `A neural-network layer does two things: multiply the input by a weight matrix with a bias, then apply a nonlinear activation.

The first half is a linear transform: $z = Wx + b$, where $W$ is the layer's weight matrix and $b$ the bias vector. Dropping the nonlinearity collapses any stack of layers into one linear map — the depth would buy nothing, which is why activations cannot be skipped.

Common activations: ReLU as the default, GELU in Transformers, sigmoid for gates and binary outputs.

Data flows through a layer as input → linear transform → activation → output.`
l1.translationLang = 'en'

// — 反向传播:in_progress 中途状态(先答一题解锁后续)—
const l2 = byTitle('反向传播')
attemptLesson(state, l2.id, now)
recordAnswer(state, l2.id, true, undefined, now)

// — 优化器:概念 + 毕业/mastered(给进度条与 due box)—
const l3 = byTitle('优化器')
attemptLesson(state, l3.id, now)
defineConcepts(state, l3.id, [
  { title: '动量', description: '速度累积与峡谷穿越' },
  { title: '自适应步长', description: '按参数历史梯度重标学习率' },
], '动量累积速度,Adam 自适应重标步长。')
for (const concept of ['动量', '动量', '自适应步长', '自适应步长', '动量', '自适应步长', '动量', '自适应步长']) {
  recordAnswer(state, l3.id, true, concept, now)
}
// 毕业后把复习排到昨天 → 左栏出现待复习
if (l3.dueAt !== null) {
  l3.dueAt = new Date(now.getTime() - 36 * 3600_000).toISOString()
}

// — 章节考试:一次 4/5 → 2★(考后动作在导师侧)—
const exam = state.courses[0].sections[0].lessons.find(l => l.kind === 'exam')
attemptLesson(state, exam.id, now)
recordExamResult(state, exam.id, 4, 5)

// — 记忆与笔记(黑板笔记区 + 导师记忆)—
setMemory(state, 'global', '偏好类比和图示,不喜欢长公式推导。')
setMemory(state, 'lesson', '链式法则还分不清 dL/dy 如何变成 dL/dx,下次从计算图讲。', l1.id)

state.focus = { lessonId: l1.id }
state.mode = 'guide'
saveState(statePath, state)
console.log(`demo state at ${statePath}: ${state.courses[0].sections.length} sections, ${lessons.length} lessons, xp=${state.xp.total}, streak=${state.streak.currentStreak}`)
