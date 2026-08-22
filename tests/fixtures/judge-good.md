# fixture: a transcript that satisfies every frozen criterion (skip branch of C5)

## study_import_markdown

```json
{ "markdown": "# GraphQL Basics\n## Core Concepts\n### Queries\nClient selects exactly the fields it needs; nothing unasked is returned.\n### Mutations\nA mutation writes data and returns the changed fields; runs one at a time.\n## Advanced\n### Fragments\nA fragment is a reusable named selection set." }
```

result:

```json
{ "courseId": "graphql-basics-fx", "title": "GraphQL Basics", "sections": 2, "lessons": 3, "firstLessonId": "graphql-basics-fx:0:0", "firstLessonTitle": "Queries" }
```

---

## study_define_concepts

```json
{ "lessonId": "graphql-basics-fx:0:0", "concepts": [ { "title": "Selection", "description": "The client lists exactly the fields it wants; the server returns only those." }, { "title": "Overfetch", "description": "Nothing unasked is returned, which avoids over-fetching." } ] }
```

result:

```json
{ "lessonId": "graphql-basics-fx:0:0", "concepts": [ { "title": "Selection", "masteryPct": 50 }, { "title": "Overfetch", "masteryPct": 50 } ] }
```

---

## study_lesson

```json
{ "lessonId": "graphql-basics-fx:0:0" }
```

result:

```json
{ "lessonId": "graphql-basics-fx:0:0", "title": "Queries", "status": "in_progress", "masteryPct": 50 }
```

---

## study_record_answer

```json
{ "lessonId": "graphql-basics-fx:0:0", "correct": true, "concept": "Selection", "question": "Who decides which fields a GraphQL response contains?", "givenAnswer": "The client — the query lists exactly the fields it wants.", "rationale": "Correctly identifies the client as the selecting side." }
```

result:

```json
{ "newMasteryPct": 70, "correct": true }
```

---

## study_record_answer

```json
{ "lessonId": "graphql-basics-fx:0:0", "correct": true, "concept": "Overfetch", "question": "What is over-fetching?", "givenAnswer": "Receiving unasked data; GraphQL avoids it because the query lists exactly the wanted fields.", "rationale": "Correctly ties avoidance to field selection." }
```

result:

```json
{ "newMasteryPct": 75, "correct": true }
```

---

## study_record_answer

```json
{ "lessonId": "graphql-basics-fx:0:0", "correct": false, "concept": "Selection", "question": "Can the server add extra fields the client did not ask for?", "givenAnswer": "Yes, the server may enrich responses with extra fields.", "rationale": "Wrong: nothing unasked is returned — the answer reverses the selection rule." }
```

result:

```json
{ "newMasteryPct": 20, "correct": false }
```

---

## Step 5 gate

lesson mastery after the three answers: **20%** (threshold 85%)

Mastery below 85% — step 5 skipped per the task.

---

## study_due_reviews

```json
{}
```

result:

```json
{ "total": 0, "due": [] }
```

---

## study_courses

```json
{}
```

result:

```json
{ "total": 1, "courses": [ { "courseId": "graphql-basics-fx", "title": "GraphQL Basics", "source": "markdown", "total": 3, "completed": 0, "avgMasteryPct": 20, "currentLessonId": "graphql-basics-fx:0:0" } ] }
```

---
