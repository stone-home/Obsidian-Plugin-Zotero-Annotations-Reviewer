---
name: pkm-note-wording
description: PKM notebook wording check — AUTOMATIC after every Objective / Run note write (embedded by pkm-objective and pkm-eval). Everyday English + project field terms only; not the academic readability gate. Agents must run this as part of those write pipelines without waiting for the user to ask. Do not treat as a manual-only skill.
---

# PKM Note Wording Check (automatic)

**Role:** After-write checklist for PKM staging notes (Objective, Run). Confirms the note reads like a **lab notebook**, not a paper draft.

**Invocation — automatic, not manual.**
This skill is **not** a user-triggered step. Whenever **pkm-objective** or **pkm-eval** finishes a draft (or edits prose in those notes), the agent **must** run this check before considering the write done. Do not ask the user whether to run it. Do not skip it because the user did not mention wording.

**pkm-task:** optional one-line skim on new todo text only (keep capture fast); still no user prompt.

**Not this skill:** `academic-review-readability` / `global-prose-readability-gate` — papers, module docs, formal eval reports only. Never substitute those for this check on PKM notes.

**What to audit:** Prose only — Hypothesis / Goal / Risks / Result / Notes. Skip frontmatter, tables, Dataview fences, wikilink-only lines.

---

## Pass bar (all must hold)

1. **Everyday English.** Short sentences. Plain verbs (*clean, fold, bind, replay, fail, pass*).
2. **Field terms OK.** Keep project terms: `AMIR`, `MemoryPattern`, `JDI`, `peak error`, `CMAE`, claim ids, experiment ids, metric names.
3. **No academic / reviewer voice.** Rewrite hits such as: *falsifies, masquerade, information-preserving, load-bearing, venue*; fluff connectives (*Moreover, Furthermore, In conclusion*); AI-fluff (*leverage, showcase, delve into*; 「赋能」「至关重要」).
4. **Numbers stay concrete.** Metric + direction + threshold (or `[TBD]`). Do not soften gates while simplifying words.
5. **No paper big-picture recipe.** No Phrasebank / academic §4 openers. One plain core hypothesis is enough.

---

## Procedure (embedded)

1. After the note draft exists (in memory or on disk), audit the prose against the pass bar.
2. List failing phrases; rewrite **in place** (same facts, plainer words).
3. Re-check once. Cap 2 rewrite rounds.
4. In the write summary, one line: `PKM wording: PASS` or `PKM wording: fixed N phrases (…)`.

---

## Quick rewrite map

| Avoid | Prefer |
|---|---|
| falsifies the claim | fails / does not pass |
| information-preserving | rebuilds its own trace / matches the source curve |
| masquerade as | look like / can be mistaken for |
| load-bearing rule | required rule / rule that matters |
| for a top venue | for the paper / must-have runs |

---

## Callers (must embed)

| Skill | Requirement |
|---|---|
| **pkm-objective** | Always run after draft, before treating the Objective as finished. |
| **pkm-eval** | Always run after draft Result/Notes, before treating the Run as finished. |
| **pkm-task** | Optional skim of the new todo line; no formal report. |
