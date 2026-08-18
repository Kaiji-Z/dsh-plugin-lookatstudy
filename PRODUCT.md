# Product

## Register

product

## Users

Developers and lifelong learners already living inside DeepSeek Harness (dsh), a chat-based coding agent UI. They import learning repositories (e.g. microsoft/AI-For-Beginners), local folders, or pasted markdown, then work through a tutor-guided course in short sessions between (or during) coding tasks. Chinese-first copy today; international users expected via the npm/dsh plugin community.

## Product Purpose

dsh-plugin-lookatstudy turns any markdown/GitHub learning repo into a guided course inside the harness: a 学习 (Study) conversation tab in three columns (课程 skill tree | 导师 tutor | 黑板 blackboard), gated skill-tree progression, BKT mastery tracking, SM-2 spaced review, and a tutor persona that designs the course structure at import. Success = a learner opens dsh, clicks 开始学习, and finishes a 5-minute lesson without leaving their tool.

## Brand Personality

Restrained study-desk. Calm, encouraging, precise. The tutor persona carries the warmth; the chrome stays quiet — dense learning data (mastery bars, due badges, friction tags) rendered with small, legible affordances that never shout.

## Anti-references

- Upstream LookatStudy's playful physics skill-map (Matter.js orbs, snow) — deliberately NOT ported; this is a work tool, not a game.
- Generic AI-plugin aesthetics: identical card grids, emoji-as-icon buttons, gradient accents, uppercase tracked eyebrows, glassmorphism.
- Duolingo-style streak pressure and confetti — earned joy only, no spam.

## Design Principles

1. **Host-native, not guest**: read the harness's `--dsw-*` tokens; the tab must look like dsh grew it, not like a skinned iframe.
2. **Data earns its pixels**: every glyph on a lesson row (mastery %, 🔁 due, ⚡weak, 😣friction) is actionable learning state, never decoration.
3. **One decision at a time**: the tutor asks one question per reply; the rail shows one focus; the activation bar is one button.
4. **Dormant by default, visible when alive**: the plugin sleeps until 开始学习 — the UI must make both states legible without a manual.
5. **Show the machinery honestly**: mastery is the weakest concept, exam gating is real — tooltips explain the numbers where they appear.

## Accessibility & Inclusion

Inherits the host's token system and focus conventions. Interactive lesson rows, quiz options, and pane buttons are real buttons with hover/focus states; quiz options carry `:focus-visible`. Color-coded states are doubled with text/icons where feasible. WCAG AA contrast via the host palette is the baseline; the plugin adds no custom color constants.
