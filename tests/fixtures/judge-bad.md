# fixture: a transcript that violates C2 (filler concept), C4 (two answers, one misgraded), C6 (inconsistent readout)

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
{ "lessonId": "graphql-basics-fx:0:0", "concepts": [ { "title": "Knowledge", "description": "Understanding of things in general." } ] }
```

result:

```json
{ "lessonId": "graphql-basics-fx:0:0", "concepts": [ { "title": "Knowledge", "masteryPct": 50 } ] }
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
{ "lessonId": "graphql-basics-fx:0:0", "correct": true, "concept": "Knowledge", "question": "Does the server decide which fields a response contains?", "givenAnswer": "Yes, the server decides and may add extra fields.", "rationale": "Graded correct." }
```

result:

```json
{ "newMasteryPct": 60, "correct": true }
```

---

## study_record_answer

```json
{ "lessonId": "graphql-basics-fx:0:0", "correct": false, "concept": "Knowledge", "question": "What is a fragment?", "givenAnswer": "A reusable named selection set shared between queries.", "rationale": "Graded incorrect." }
```

result:

```json
{ "newMasteryPct": 45, "correct": false }
```

---

## Step 5 gate

lesson mastery after the answers: **45%** (threshold 85%)

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
{ "total": 2, "courses": [ { "courseId": "graphql-basics-fx", "title": "GraphQL Basics", "source": "markdown", "total": 3, "completed": 3, "avgMasteryPct": 100, "currentLessonId": "graphql-basics-fx:0:2" } ] }
```

---
