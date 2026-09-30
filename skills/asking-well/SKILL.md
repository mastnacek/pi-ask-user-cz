---
name: asking-well
description: Crafting effective, high-signal questions for ask_user_question. Use when clarifying ambiguous requirements, presenting architectural trade-offs, or requesting user decisions.
---

# Asking Well

The runtime enforces schema constraints. This skill governs question signal, ergonomics, and decision velocity.

## 1. Facts vs. Decisions

Never ask the user a question the codebase can answer.

- **Bad:** "Which database library are you using?" (Factual unknown → read `package.json`).
- **Bad:** "Does this function accept null?" (Factual unknown → run LSP or read source).
- **Good:** "Migrate to Drizzle or stay on Prisma?" (Executive decision → trade-off).

If a tool call can answer the question, invoke the tool instead of the user.

## 2. The Frontier Round Concept

A round contains all questions whose prerequisites are already satisfied.

- **The Frontier:** Every question answerable right now without speculating on open answers.
- **Dependent Questions:** If Question B depends on the choice made in Question A, Question B is outside the current frontier. Defer it to the next round.
- **Batching:** Group independent questions into a single round (up to 4 questions). Avoid back-to-back single-question calls when questions are mutually independent.

## 3. Options are Concrete Commitments

Every option must represent a decidable choice with distinct consequences.

- **One idea per question:** If an option requires choosing both an engine and a caching strategy, split into two questions within the same round.
- **Outcome over category:** Label the concrete destination, not the abstract topic:
  - *Weak:* "Pragmatic approach" vs. "Strict approach"
  - *Strong:* "Ship SQLite with file lock" vs. "Setup Postgres with Docker"
- **Descriptions carry the trade-off:** Explain what choosing this option costs, not just what it is.
- **Commit to a recommendation:** Lead with the option you recommend, suffixed with `(Recommended)` — and back it up in its description.

## 4. Previews (When & How)

`preview` splits the TUI into a side-by-side view (options left, monospace markdown right).

- **Use for artifacts:** Code snippets, config files, ASCII diagrams, CLI syntax comparisons.
- **Omit for pure preferences:** Simple decisions ("Yes/No", license selection) do not need previews; labels and descriptions suffice.
- **Width budget:** Keep diagram and code lines within **40–60 characters**. Content wider than the preview column wraps or clips in side-by-side view.
- **Unicode box-drawing standard:** Avoid crude `+---+` / `|   |`. Always use standard box-drawing characters:
  - Corners: `┌ ┐ └ ┘`
  - Edges: `│ ─`
  - Junctions: `├ ┤ ┬ ┴ ┼`
  - Pointers: `► ▲ ▼`

### Diagram Templates

#### A. Architecture & Data Flow
```text
┌──────────────┐       HTTP        ┌──────────────┐
│    Client    ├──────────────────►│   Gateway    │
└──────────────┘                   └──────┬───────┘
                                          ▼
                                   ┌──────────────┐
                                   │   Database   │
                                   └──────────────┘
```

#### B. UI & Component Wireframe
```text
┌─ Dashboard ─────────────────────────┐
│ [Overview]   [Settings]             │
│ ─────────────────────────────────── │
│ ❯ Active service           Online   │
│   Worker pool              Idle     │
└─────────────────────────────────────┘
```

#### C. Code / Config Comparison
Use fenced language blocks (`ts`, `json`, `diff`):
```diff
- config.legacyPolling = true
+ config.useWebSockets = true
```

## 5. Session Memory

Decisions settled earlier in the session are invariants. Never re-ask what the user has already approved; treat prior answers as architectural constraints.
