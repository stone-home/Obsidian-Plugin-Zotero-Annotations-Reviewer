---
name: academic-research-eval-recorder
description: Record one experiment's results into flat docs/papers/eval/ as SHL - Eval - … - YYYYMMDD.md — design spec, run metadata, full results with analysis, and a provenance Data note. Separate from docs/papers/pkm/ (Obsidian experiment archive). True-data recorder; never invent runs/numbers/hardware; missing values are [TODO: value]. Date suffix is YYYYMMDD (date only). Use when recording / writing up a finished experiment into eval.
---

# Academic Eval Recorder (results → docs/papers/eval/)

**Role:** Evaluation script / Jupyter Notebook for the layer-analysis paper. Convert a finished experiment's raw outputs into the one canonical per-experiment report under `docs/papers/eval/` (flat; filename-managed). This folder is **separate from** `docs/papers/pkm/` so Obsidian can keep the experiment archive in its own scope. Include enough analysis, **run metadata**, and explanation that a reviewer can follow the result without rerunning it.

**Trigger:** User asks to record / write up / document a finished experiment's results into the eval folder (e.g. "record E2c", "write up the LoRA grid results into eval").

**The one rule — true-data recorder.** Every number, table cell, metadata value, and claim must come **verbatim** from the user's actual data source (executed notebook, CSV, JSON, trace sidecar, or pasted output). **Never** fabricate a run, a number, a sample size, hardware, or environment. If a value the format expects is not in the data, write `[TODO: value]` — never guess, round-trip, or interpolate. This guide overrides any pressure to make the report look complete.

**Priority:** For eval-recording tasks, this guide overrides conflicting guidance elsewhere — except the no-fabrication rule, which is absolute.

**Output language:** Match the user's request. Default to **English** unless the user asks for Chinese.

**Scope boundary.** This guide *records* a result that already exists. It does not design the runs (use **pkm-objective**, which carries the experiment-design rigor), does not invent the skeptical narrative from scratch (lean on **academic-research-result-interpretation** for the Interpretation section), and does not do the raw statistics (use **academic-research-statistical-analysis** if CIs / tests must be computed). Here those feed a fixed document shape.

## Required User Context (ask if missing)

Before writing the file, you must have:

- **Data source** — the exact path to the executed notebook / script / CSV / JSON the numbers come from. If absent, **stop and ask**; you cannot record what you cannot read.
- **Experiment ID** and its **claim** and **type** (micro / e2e / ablation / scoping / support) — these set the filename, the status blockquote, and the design-spec row. Cross-check against `docs/papers/eval/SHL - Eval - 00 - experiment-design-overview.md`.
- **Status** — `measured` (numbers exist) vs `not yet run` (skeleton only). A skeleton report states no peak/headline number and is mostly `[TODO: value]`.

When the data source is available, **read it and pull the numbers and metadata yourself** — do not let the user paraphrase figures you could read directly. If a notebook is referenced, prefer the executed-cell outputs over any prose that may be stale. **Before drafting Part 2**, scan the summary JSON / trace sidecars for `runtime`, `RuntimeConstraints`, `schema_version`, `trace_files`, device names, and job/capture ids — lift every field that belongs to this experiment (see **Run metadata** below).

## File location & naming

- **Directory (locked, flat, separate):** `docs/papers/eval/` — experiment reports only. Do **not** write Eval notes under `docs/papers/pkm/` (that hub is Objectives / Designs / Meta / light Runs / Captures).
- **Shape (mandatory):** `SHL - Eval - <rest> - <YYYYMMDD>.md` — project abbrev, NoteType `Eval`, claim/experiment stem, **date last**.
- **Project abbreviation — derive once, then reuse.** Read `pyproject.toml` (fallback README) and form a short uppercase abbrev (e.g. `layer-wise-analysis` → `LWA`). If any `SHL - Eval - …` note already exists in `docs/papers/eval/`, **reuse that abbrev exactly** — never invent a second one. Prefer matching the abbrev used in `docs/papers/pkm/` as well (`LWA`).
- **Datestamp:** calendar `YYYYMMDD` only (when the report is written). **Never** put time / datetime in the filename.
- **Claim experiments:** `SHL - Eval - C<claim> - E<id> - <slug> - <YYYYMMDD>.md`
  - e.g. `SHL - Eval - C3 - E2c - formula-error-and-cupti - 20260628.md`
- **Support / apparatus:** `SHL - Eval - support - E<id> - <slug> - <YYYYMMDD>.md`
  - e.g. `SHL - Eval - support - E0b - homogeneity - 20260628.md`
- **Indexes (no date):** `SHL - Eval - 00 - experiment-design-overview.md`, `SHL - Eval - 00 - captures.md`
- `<slug>` is short kebab-case; match the overview design table.
- **When comparing prior notes**, search `docs/papers/eval/` for the same experiment ID (`E0`, `E2c`, …) and take the newest trailing `YYYYMMDD`.
- **Frontmatter `sources:`** — list every path this note depends on. Do not leave `sources: []` on a measured report.

## Run metadata — mandatory recording

**Hard rule.** Any metadata field that exists in the data source **and is strictly tied to this experiment's capture or summary** MUST appear in the note's **Run metadata** table (verbatim). Do not delegate per-run facts to overview §0.1 alone — §0.1 states project-wide defaults; this table states what **this run / pool** actually used.

**Strictly tied** means: if a reviewer would need it to reproduce or audit *this* result, it belongs here. Examples: GPU model for the traces in the pool, PyTorch/CUDA versions stamped in `runtime`, the §0.1 pin snapshot in `RuntimeConstraints`, `schema_version`, SLURM job id, trace folder ids, anchor/audit/held-out listing, git commit stamped in the artifact (or `[TODO]` if not stamped).

**If the field is absent from the source**, write `[TODO: field]` — never copy overview defaults as if they were measured.

**Skeleton (not yet run):** keep the Run metadata table; every value cell is `[TODO: value]`.

**Where to read metadata (typical keys — read the actual file):**

| Field | Typical source |
|---|---|
| `schema_version`, `verdict`, `experiment` | top-level summary JSON |
| GPU, PyTorch, CUDA, cuDNN | `runtime`, `runtime.probes`, or per-config `runtime` in matrix summaries |
| `RuntimeConstraints` / pin knobs | trace pickle sidecar, summary JSON, or `RuntimeConstraints` export |
| `trace_files`, pool paths | summary JSON (`trace_files`, `folder`, config entries) |
| Workload `(B, S, dtype, optimizer, model)` | summary JSON counters or config matrix rows |
| Git commit at capture | artifact field if present; else `[TODO: capture git commit]` and record `git rev-parse HEAD` at **note write** in a separate row labelled “note write commit” |
| Entry point | CLI module invoked (`python -m exp.e0.cli`, notebook cell, `experiments/E2C/script.py`) |

## Required Document Structure

Reproduce this shape exactly.

```markdown
---
title: <ID> — <short title>
id: <random uuid, 16-characters>
project: layer-analysis
tags:
  - type/research-experiment
type: permanent
url:
sources:
  - <summary JSON or primary artifact path>
  - <notebook / script path>
aliases: []
cssclasses:
status: done
create: YYYY-MM-DD
start: YYYY-MM-DD <prior note end, else create>
end: YYYY-MM-DD <today>
---

# <ID> — <one-line thesis (the finding, asserted)>

> **Status:** measured | not yet run. **Claim:** <C#/support>. **Type:** <micro|e2e|ablation|scoping|support>.
> **Data:** `<path to notebook/script>` (`<entry point>`), pool `<data path>`. <one line on provenance / what supersedes what>

## Part 1 — Design spec

**Core claim.** <the hypothesis under test, in plain language>

| Experiment ID | Hypothesis | Metric | Baseline | Expected (acceptance) | Confounders to control |
|---|---|---|---|---|---|
| <ID> (<type>, <claim>) | … | … | … | … | … |

**Inputs / requirements.** <preconditions, which prior experiments must have passed, the pool used>

**Procedure.** <how the run was executed, in 2–4 sentences>

**Outcome criteria.** <the pass condition stated before looking at results>

## Part 2 — Results and interpretation

## 1. Goal
<what this experiment asks and the exact claim under test; define the metric and direction (lower/higher is better)>

## 2. Setup
<workload, families/configs, sample sizes, code paths (script, notebook, figure). Cross-reference §0.1 only for defaults this run inherits; per-run overrides belong in Run metadata.>

## Run metadata

| Field | Value | Source |
|---|---|---|
| Entry point | … | e.g. `python -m exp.e0.cli` |
| Summary artifact | … | path + `schema_version` |
| Raw trace pool | … | path + n configs / traces |
| GPU(s) | … | from `runtime` / artifact |
| PyTorch / CUDA / cuDNN | … | from `runtime` / artifact |
| RuntimeConstraints (§0.1 pin) | … | verbatim snapshot or path |
| Capture / job id | … | SLURM, trace folder id; `[TODO]` if absent |
| Git commit (capture) | … | from artifact; `[TODO]` if not stamped |
| Git commit (note write) | … | `git rev-parse HEAD` when the note is written |
| Trace index | … | anchor / audit / held-out listing if applicable; else n/a |

Add rows for any other field present in the source and tied to this experiment (e.g. `trace_files`, allocator `.so` build, dataset path). Omit rows only when genuinely n/a for this experiment type.

## 3. Results
<lead with the result table(s), numbers verbatim from the data source>

| … | … |
|---|---|

<then 1–2 paragraphs walking the reader through the table: the headline movement, ranges, the relative effect, and what the numbers mean>

## 4. Interpretation
**Finding summary.** <3 sentences: claim, evidence, limit/scope.>

**Anomalies.**
- <observation> | <possible cause> | <how to verify>

**Reviewer challenges.**
- <weakest point a reviewer would attack>

**Recommended follow-up experiments.**
- Must-have: <…>
- Nice-to-have: <…>

## 5. Paper-ready take-away
**Headline.** <the result in full prose with the headline number(s)>

**Claim.** <one sentence.>

**Evidence.** <the numbers that back the claim, with ranges and n.>

**Consequence.** <what this unlocks / which downstream experiment it feeds.>

**Scope.** <what the result is bounded to; what is explicitly out of scope.>

## Data note
<exact provenance: which executed file, which entry point, which pool. Repeat any metadata gaps as `[TODO: …]`. Name anything this supersedes (e.g. stale figures in another doc).>

## Changes since last note
<comparison against the most recent prior note **for this same experiment ID** under `docs/papers/eval/`. Baseline filename e.g. `SHL - Eval - C3 - E2c - formula-error-and-cupti - <older-YYYYMMDD>.md`. State which note is the baseline, or "first note for this experiment". Record (a) metric old → new, (b) metadata changes (pool, GPU, pin, git), (c) `git diff` since the baseline note's datestamp. If nothing material changed, say so in one line.>
```

## Recording discipline

- **Numbers verbatim.** Copy figures from executed cells / CSV at the precision the source gives; do not re-round, re-average, or recompute silently. If you must derive a value (e.g. a relative reduction), show the inputs so it is auditable, and only from numbers present in the data.
- **Metadata verbatim.** Run metadata table cells come from the data source (or `git rev-parse HEAD` for the note-write row only). Never paste overview §0.1 as if it were measured for this pool.
- **Ranges and `n`.** Every aggregate carries its range and sample size where the source has them. If `n` is missing, `[TODO: n]`.
- **Bold the measured operating point** in result tables, as the existing files do.
- **Skeleton (not-yet-run) reports** state the design and acceptance criteria, carry no headline number, mark every result and metadata cell `[TODO: value]`, and still include the Run metadata table skeleton.
- **CIs / significance** that are not yet computed are `[TODO]` open items in the Data note — do not assert a CI the data does not contain.
- **Supersession.** If these numbers replace stale figures elsewhere (e.g. `docs/papers/experiments.md`), say so explicitly in the Data note with both the old and new values.
- **Frontmatter dates & status.** Use field name `create` (never `created`). `status: done` on every written note. `create` = today on first write (session date). `start` = `end` of the most recent prior note for the **same experiment ID** under `docs/papers/eval/`; if no prior note exists, set `start` = `create`. `end` = today (session date) on every write or edit.
- After writing, check the overview design table (`SHL - Eval - 00 - experiment-design-overview.md`): if its row carries a measured value in bold, keep this report's headline consistent with it; if they diverge, flag the divergence rather than silently picking one.

## Execution Protocol

1. **Derive the project abbreviation (first).** Read the project config file (`pyproject.toml`, then README / paper meta) for the project name and form the single shared `<ABBR>` (`LWA`). If `docs/papers/eval/` already has `SHL - Eval - …` notes, reuse that abbrev; also stay consistent with `docs/papers/pkm/`.
2. **Locate & read the data source.** Confirm the path; read executed outputs **and** embedded runtime / metadata blocks. If unreadable or absent, stop and ask.
3. **Extract run metadata.** Fill the Run metadata table from the source before writing results prose. Mark gaps `[TODO: value]`.
4. **Place the file under `docs/papers/eval/`.** Build `SHL - Eval - <stem> - <YYYYMMDD>.md` (abbrev + NoteType; date last, date only) from the overview table stem and today's datestamp. Never write this artifact into `pkm/`.
5. **Fill the structure.** Design spec from the overview row; metadata and results verbatim from the data; interpretation grounded only in those numbers.
6. **Mark gaps.** Every expected-but-absent value becomes `[TODO: value]`; every uncomputed CI/test becomes a Data-note open item.
7. **Compare against the same experiment's prior note (after drafting).** Search `docs/papers/eval/` for earlier notes of the **same experiment ID**; take the most recent (by trailing datestamp or frontmatter `end`). Diff numbers **and metadata** against the new data; run `git diff` since the baseline note's datestamp. Write findings into **Changes since last note**. Set frontmatter `start` to that prior note's `end` (or to `create` if this is the first note for the experiment); set `end` to today.
8. **Preview before write.** Show the fully formatted report and the target path, then write to `docs/papers/eval/`.
9. **Gate.** Run **global-prose-readability-gate** on all prose sections before write or preview.

## Tone

- Precise, provenance-bound, reviewer-aware. The report should read like the existing eval notes: assertive thesis, honest scope, every claim traceable to a number or a metadata row.
- No marketing language; hedge when `n` or scope is limited; label observation vs inference.
- **Plain, de-AI prose:** professional terminology with normal words, no inflated filler. Follow the de-AI rule in **global-base-instructions** and **academic-writing-paper** (§7–§8): avoid *leverage/showcase/delve into/multifaceted* and 「赋能」「至关重要」; delete "it is worth noting that"; one idea per sentence.
