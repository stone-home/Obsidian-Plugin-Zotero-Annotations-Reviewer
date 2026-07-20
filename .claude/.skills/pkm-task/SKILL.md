---
name: pkm-task
description: PKM tier-2 — capture a quick todo as a Dataview-linked checklist line inside an existing Objective note's "## 3. Active Todos", bound with the obj:: inline field. No new file, no frontmatter, no academic readability gate — it is a fast capture so coding is not interrupted. Optional light pkm-note-wording on the todo line. Fuzzy-matches the target Objective by claim_id/title; asks when the match is ambiguous rather than guessing. Manual trigger. Use when the user says "todo: ..." / "add a task to <objective>".
---

# PKM Task Capture (tier-2: todo into an Objective)

**Trigger:** Manual. The user drops a quick task, e.g. "todo: verify k/v optimizer rescale on gemma2-9B", "add a task to C3", "记一下 todo …". The whole point is speed: no file to open, no frontmatter to write.

**Role:** Append one Dataview-linked checklist line to the right Objective note so the two-tier system stays a single source of truth — the Todo lives inside the Objective, not in a separate file. This keeps `obj::` back-references and the Objective's own todo view consistent.

**Repo is staging.** Same as pkm-objective: the edited note is copy material for the Obsidian vault. Only the line format matters downstream.

## What it writes

A single line appended to the target Objective note's `## 3. Active Todos` section:

    - [ ] <task description> [obj:: [[<Objective filename without .md>]]]

- `[obj:: [[…]]]` is the Dataview inline field binding the task back to its Objective. The wikilink target is the Objective note's filename without the `.md` extension.
- Append after the last existing todo under `## 3. Active Todos`. Never create a second todo file; never duplicate a task already present (scan the section first).
- Do not touch any other section of the note.

## Target resolution (never guess the Objective)

1. List `docs/papers/pkm/SHL - Objective - *.md`. Match the user's cue to a note by `claim_id` (e.g. "C3") and/or title keywords.
2. **Exactly one match** → append there.
3. **Ambiguous or zero matches** → ask the user which Objective (show the candidate filenames). Do not invent an Objective and do not create one here — if none exists, tell the user to run **pkm-objective** first.
4. If the user names the Objective explicitly, trust that over fuzzy matching.

## Discipline

- **No academic readability gate, no frontmatter, no preview ceremony** — this is a capture, not a deliverable. Confirm the target note and the line, then edit.
- Keep the task description short and imperative; English (global artifact rule). Optional: one quick pass of **pkm-note-wording** on the new line only (plain verb, no reviewer voice); skip the formal report.
- One invocation may add several todos to the **same** Objective; batch them under the one section.
- If the user's task clearly belongs to a different claim than the one they named, say so in one line before writing.

## Execution protocol

1. Resolve the target Objective (rules above); ask if ambiguous.
2. Read the note's `## 3. Active Todos` section; skip duplicates.
3. Append the `- [ ] … [obj:: [[…]]]` line(s).
4. Report which note and line(s) were added — no gate, no long summary.
