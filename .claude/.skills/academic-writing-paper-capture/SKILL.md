---
name: academic-writing-paper-capture
description: Capture valuable project information (experiment results, design decisions, debugging findings, conversation notes, JSON/IR outputs) and convert it into paste-ready academic content — sentences and paragraphs that drop straight into the paper. Use when the user says "capture this for the paper", "turn this into paper text", "write this up", or wants results/findings converted into submission content.
---

# Academic Paper Capture

Turn raw project material into content the user can paste into their paper with no further editing. The job is two steps: **extract what is paper-worthy**, then **write it in the project's academic voice**.

## Style is non-negotiable

All output content MUST follow the **academic-writing-paper** skill — it is the source of truth for tone, sentence structure, hedging, transitions, and the AI-voice word blacklist. Apply that skill to every sentence before returning; do not work from a remembered copy of its rules, since they may have changed.

Two capture-specific reminders on top of that skill:
- Keep project notation exactly: AbsModel, fold, replay, IR, CMAE, byte-binder, bid, cross-audit.
- **Never fabricate** a number, citation, dataset, or result. If a number is needed but not in the source, leave `[TODO: value]` and say so.

## Workflow

1. **Find the source.** The user may paste notes, point at a file (experiment JSON under `experiments/E*/output/`, a notebook, an IR dump, a memory file), or refer to something earlier in the conversation. If the source is a file, read it and pull the actual numbers — do not invent them. If unclear what to capture, ask.

2. **Extract only paper-worthy items.** Keep:
   - Claims backed by a number, setting, or comparison (e.g. "435/477, 91.2%", "CMAE 1.56%").
   - Mechanisms — what the method actually does, in one mechanism per item.
   - Design decisions and trade-offs (why greedy not LCS; why key on bid not uuid).
   - Failure cases, debugging surprises, what did not work — these are valuable, not noise.
   - Scope limits and open problems.
   Drop: restated background, vague praise, anything with no evidence behind it.

3. **Convert each item to content.** Write it as final paper text, not a summary of the finding. For each captured item produce:
   - The **paste-ready sentence(s) or paragraph**, in the academic-writing-paper voice.
   - A one-line tag: likely **section** (Intro / Method / Results / Limitations / Related Work) and the **evidence** it rests on (file path, number, or "needs citation").
   Follow the default paragraph shape when an item is paragraph-sized: claim/gap → mechanism → evidence → limit.

4. **Save the capture.** Append to `docs/papers/pkm/SHL - Captures.md` (create it if absent) under a dated `## YYYY-MM-DD — <topic>` heading (date only in the heading). Each entry: the content block, then an italic provenance line (`_Source: <file/conversation>; Section: <X>; Evidence: <Y>_`). This file is a running pool of vetted snippets in the flat PKM hub; newest-first is fine. Show the user the content in chat too, so they can copy it immediately. Do **not** write under the obsolete `docs/papers-c/` path.

## Output contract

- Default language: English (submission default). Switch to Chinese only if the user asks.
- Return copy-paste-clean content — no meta-commentary inside the content block itself.
- After the content, list any `[TODO: ...]` gaps you left and how to fill them (which file or run produces the number).
- If the user supplied their own draft sentence, polish it and preserve their voice rather than rewriting from scratch.

## Self-check before returning

Run the §8 checklist from the **academic-writing-paper** skill. In particular: no AI-fluff words, every claim scoped to its evidence, no sentence over ~30 words that should be split, no fabricated number.
