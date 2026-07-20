---
name: pkm-objective
description: PKM tier-1 — turn a discussed experiment idea into a structured Obsidian "Objective" note under docs/papers/pkm/ (flat; filename-managed). One Objective = one experiment = one paper claim. Folds in ML-systems experiment-design rigor (>=3 baselines, micro + e2e, one independent variable, controlled confounders) as the success criteria. Reads the claim registry (docs/papers/README.md + docs/papers/eval/ZAR - Eval - 00 - captures.md) for claim_id/target_section; never invents claim numbers. Manual trigger only. Use when the user says "create/write an objective" after a scope has been discussed.
---

# PKM Objective Note (tier-1: goal + experiment claim)

**Trigger:** Manual only. The user explicitly asks to create / write an Objective note, **after** you and the user have already talked through the boundary and scope in this session. Never auto-fire; the AI cannot define the boundary of an experiment on its own — the user sets it in conversation first, then invokes this skill.

**Role:** Two-tier Obsidian PKM assistant with ML-systems experiment-design expertise (GPU memory, PyTorch internals, distributed training). An Objective note is the top tier: it pins one falsifiable claim, states what success looks like in measurable terms, and scaffolds the Todos and Runs that will validate it.

**Priority:** For Objective-note tasks this guide overrides conflicting writing-style guidance, except the no-fabrication rule on claim ids and the **pkm-note-wording** check (notebook wording, not academic readability).

**Output language:** Note artifact is **English** (global rule). Conversation matches the user.

**Repo is staging, not the vault.** These notes are copy material shipped to the user's Obsidian vault by n8n. Keep the filename and `type: objective` frontmatter stable so the downstream filter is reliable. Do not try to manage the vault's folder layout or the Canvas files from here.

## Claim registry — read before naming (no invented claim ids)

`claim_id` and `target_section` are **not** yours to invent. Before writing:

1. Read `docs/papers/README.md` (the claim register: `C1 — Closure (§…)`, `C2 — Self-consistency`, …) and `docs/papers/eval/ZAR - Eval - 00 - captures.md` (claim → experiment-folder map).
2. Match the discussed scope to an existing `C<n>` and its `§` section. Use those verbatim.
3. If nothing matches, this may be a **new** claim. Stop and ask the user whether to register a new `C<n>`. Only after the user confirms, append the new row to `docs/papers/README.md`'s claim register — do not silently edit the paper's claim list.
4. Deduplicate: scan `docs/papers/pkm/ZAR - Objective - *.md` for an existing note with the same `claim_id`. If one exists, offer to extend it instead of creating a second file.

## Experiment-design rigor (the success criteria must be real)

An Objective without a falsifiable, measurable acceptance bar is just a wish. Section 1 of the note MUST carry an experiment-design block with this discipline (fold, do not water down):

- **>= 3 baseline comparisons** — strongest reasonable alternatives or SOTA; justify each (why fair, why strong).
- **Microbenchmark AND end-to-end** coverage — say which of the note's runs are which.
- **One independent variable per run**; state what is held fixed.
- **Confounders named explicitly** — memory fragmentation, multi-tenant / shared-cluster, cold vs warm cache, single-GPU → multi-node scaling. Do not assume the claim is true.
- **Reproducibility** — seeds, GPU model + driver/CUDA versions, config files, iteration counts. Never invent hardware the user did not specify; use `[TBD: …]`.
- **Measurable acceptance bar** — "success" is a number with a direction and a threshold (e.g. "peak-memory estimate within ±3% of measured on all 4 configs"), not "better performance".

Embed this as the design table inside Section 1 with **exactly** these columns:

`| Experiment ID | Hypothesis | Metric | Baseline | Expected (acceptance) | Confounders to control |`

If the full matrix is large, also name the **minimum viable subset** (the 3–5 runs that are must-have for a top venue) and the **risks / show-stoppers** (what would falsify the claim).

## File location & naming

- **Directory (locked, flat):** `docs/papers/pkm/` — no type/component subfolders.
- **Project abbrev:** `ZAR` (Zotero Annotation Reviewer). If any `ZAR - …` note already exists in `pkm/`, reuse that abbrev — never invent a second one.
- **Filename:** `ZAR - Objective - <Claim_ID> - <concise English title>.md`
  - e.g. `ZAR - Objective - C1 - Lifetime Vocabulary Closure.md`
- Design companions in the same folder: `ZAR - Design - <Claim_ID> - <title>.md` (link from §2).
- No date suffix on Objective / Design (dates are only for Eval / Run result logs).
- Title: keyword-first, no colons/slashes/quotes, ASCII hyphens only.

## Required note structure

Reproduce this shape exactly. Replace every `<...>` and replace `<THIS-FILE>` with the actual filename (without `.md` in wikilinks) everywhere it appears.

    ---
    type: objective
    claim_id: <C# from the registry>
    target_section: "<§ from the registry, e.g. §6.4>"
    status: active
    hypothesis: <one-sentence falsifiable claim, precise>
    ---

    # <Claim_ID>: <Objective title>

    ## 1. Hypothesis & Goal

    **Core hypothesis.** <the claim under test, in plain language>

    **What success looks like (acceptance).** <the measurable pass condition, stated before any run: a number, a direction, a threshold>

    **Experiment design.**

    | Experiment ID | Hypothesis | Metric | Baseline | Expected (acceptance) | Confounders to control |
    |---|---|---|---|---|---|
    | <id> (<micro|e2e>) | … | … | … | … | … |

    **Baselines (why fair, why strong).**
    - <baseline 1>: <1–2 sentences>
    - <baseline 2>: <…>
    - <baseline 3>: <…>

    **Minimum viable subset.** <the 3–5 must-have runs>

    **Risks / show-stoppers.** <what would fail the claim; confounders that could look like the effect>

    ## 2. Context & Canvas Links

    - [[<project-canvas>.canvas]]
    - <add other canvas / design-note wikilinks discussed in-session>

    ## 3. Active Todos

    - [ ] <first task to validate this claim> [obj:: [[<THIS-FILE>]]]

Notes on the template:
- The Canvas wikilink defaults to `<project-canvas>.canvas`; the user may override or add more. Do not create or edit Canvas files from the repo.
- **Do not** add a Linked Runs / Dataview section — Obsidian owns run tracking in the vault. `pkm-eval` still sets `claim_linked` on Run notes for the vault join.
- Section 3 seeds one Todo. Further quick captures are appended by **pkm-task**, never a second file.

## Execution protocol

1. **Confirm scope was discussed.** If the boundary was not talked through in-session, ask for it before writing — do not infer the experiment's edges.
2. **Resolve claim_id / target_section** from the registry (read the two files). New claim → ask, then register on confirmation.
3. **Deduplicate** against `docs/papers/pkm/ZAR - Objective - *.md`.
4. **Draft** the note with a real, measurable acceptance bar and the design table; use `[TBD: …]` for any hardware/config the user has not fixed.
5. **Wording check (automatic).** Always run **pkm-note-wording** on Hypothesis & Goal and Risks prose before finishing. Do not wait for the user to ask. Do **not** run `global-prose-readability-gate` / `academic-review-readability` here.
6. **Preview then write** to `docs/papers/pkm/`. Report `PKM wording: PASS` (or fixes) in the reply.

## Tone

- **Everyday English + field terms only.** Write like a lab notebook, not a paper draft. Short sentences. Keep professional terms that the project already uses (`AMIR`, `peak error`, `MemoryPattern`, `JDI`, claim ids). Do **not** mix in academic review voice (no "falsifies", "venue", "load-bearing", "masquerade as", "information-preserving" when a plain phrase works).
- Skeptical on numbers: every acceptance bar needs a metric, a direction, and a threshold. Do not invent hardware. No AI-fluff (*leverage/showcase/delve into*; no 「赋能」「至关重要」).
- The formal paper voice belongs in `academic-writing-paper` / eval-recorder — not in Objective / Task / Run notes.
