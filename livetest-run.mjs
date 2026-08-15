/**
 * Live self-test driver for the LookatStudy study tool surface, executing the
 * steps in livetest-task.txt against the real tool implementations and the
 * overlay's isolated state file (cordis.livetest.yml's statePath). Tutor-side
 * and learner-side content is supplied by the driving agent; every state
 * transition is the plugin's own code.
 */
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { studyTools } from './src/tools.ts'
import { emptyState, saveState } from './src/state.ts'

const statePath = fileURLToPath(new URL('./livetest-state.json', import.meta.url))
rmSync(statePath, { force: true })
const state = emptyState()
state.mode = 'guide'
const store = { get: () => state, save: () => saveState(statePath, state) }
const agentRef = { current: undefined }
const tools = new Map(studyTools(store, agentRef).map(t => [t.name, t]))

const transcript = ['# LookatStudy livetest transcript', '']

async function call(name, args) {
  const tool = tools.get(name)
  if (tool === undefined) throw new Error(`tool not registered: ${name}`)
  const result = await tool.execute(args, { signal: new AbortController().signal })
  let rendered = ''
  try {
    rendered = tool.output?.render?.(args, result)?.map(b => b.text).join('\n') ?? ''
  } catch { rendered = '(render unavailable)' }
  transcript.push(`## ${name}`, '', '```json\n' + JSON.stringify(args, null, 2) + '\n```', '',
    'result:', '', '```json\n' + JSON.stringify(result, null, 2) + '\n```', '',
    ...(rendered === '' ? [] : ['rendered:', '', '```', rendered, '```', '']),
    '---', '')
  return result
}

// --- Step 1: import the verbatim markdown course --------------------------------
const MARKDOWN = `# GraphQL Basics
## Core Concepts
### Queries
A GraphQL query reads fields from a graph of types. The client selects exactly the fields it needs in a nested shape that mirrors the response. Nothing is returned that was not asked for, which avoids over-fetching.
### Mutations
A mutation writes data and returns a selection of the changed fields. Mutations run one at a time in order, while queries in the same document may run in parallel. A mutation can fail partially, so it should return an errors field.
## Advanced
### Fragments
A fragment is a reusable named selection set shared between queries. Fragments keep field lists in one place when a type appears in many queries. Colocating fragments next to their type definition is the recommended style.`

const imported = await call('study_import_markdown', { markdown: MARKDOWN })
const lessonId = imported.firstLessonId

// --- Step 2: define 3 concepts on the first lesson ------------------------------
await call('study_define_concepts', {
  lessonId,
  concepts: [
    { title: 'Selection', description: 'The client lists exactly the fields it wants; the server returns only those.' },
    { title: 'Nesting', description: 'A query\'s nested shape mirrors the shape of the response it produces.' },
    { title: 'Overfetch', description: 'Nothing unasked is returned, which avoids over-fetching extra data.' },
  ],
})

// --- Step 3: open the lesson -----------------------------------------------------
await call('study_lesson', { lessonId })

// --- Step 4: three graded answers (correct, correct, incorrect) ------------------
await call('study_record_answer', {
  lessonId,
  correct: true,
  concept: 'Selection',
  rationale: 'Correctly identifies the client as the side that picks fields.',
  question: 'In a GraphQL query, who decides which fields the response contains — the server or the client?',
  givenAnswer: 'The client does — the query lists exactly the fields it wants, nothing more.',
})
await call('study_record_answer', {
  lessonId,
  correct: true,
  concept: 'Nesting',
  rationale: 'Correctly ties the query\'s nested shape to the response shape.',
  question: 'Why does a GraphQL query\'s nested shape matter for the response?',
  givenAnswer: 'Because the response mirrors the nested shape of the query — the shapes correspond.',
})
const a3 = await call('study_record_answer', {
  lessonId,
  correct: false,
  concept: 'Overfetch',
  rationale: 'Reversed the direction: over-fetching is the client receiving unasked data, not the server asking for extra data.',
  question: 'What is over-fetching, and how does a GraphQL query avoid it?',
  givenAnswer: 'Over-fetching is when the server asks the client to send extra data; GraphQL avoids it by letting the server trim responses.',
})

// --- Step 5: mastery proposal only if lesson mastery >= 85% ----------------------
const mastery = a3.newMasteryPct
transcript.push('## Step 5 gate', '', `lesson mastery after the three answers: **${mastery}%** (threshold 85%)`, '', '---', '')
if (mastery >= 85) {
  const proposal = await call('study_propose_mastery', {
    lessonId,
    rationale: 'Two clean correct answers and a precise self-correction on the third concept — understanding looks solid.',
  })
  await call('study_resolve_proposal', { proposalId: proposal.proposalId, accept: true })
} else {
  transcript.push('Mastery below 85% — step 5 skipped per the task.', '', '---', '')
}

// --- Step 6: due reviews + course list -------------------------------------------
await call('study_due_reviews', {})
await call('study_courses', {})

writeFileSync(fileURLToPath(new URL('./livetest-output.md', import.meta.url)), transcript.join('\n') + '\n')
console.log(`livetest complete; final lesson mastery: ${mastery}%`)
