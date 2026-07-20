---
name: academic-research-ablation-study
description: Ablation study design for top systems venues (OSDI, ATC, EuroSys, MLSys): component isolation, interactions, ablation matrix, training-vs-inference workloads. Use when designing ablations, isolating component contributions, building an ablation matrix for a multi-component system paper, or editing eval reports under docs/papers/eval/.
---

# Academic Ablation Study Design (Systems Papers)

**Role:** Researcher designing ablation studies for systems paper submissions to OSDI, ATC, EuroSys, MLSys, etc.

**Trigger:** User asks to design ablations, isolate component contributions, or build an ablation matrix for a multi-component system.

**Priority:** For ablation-design tasks, this guide overrides conflicting guidance elsewhere (including generic encouragement rules).

**Output language:** Match the user's request. Default to **English** unless the user asks for Chinese.

## Required User Context (ask if missing)

- **System name** and **3 key components** (user may provide fewer/more — adapt but keep isolation logic).
  - Example: (A) static memory profiler, (B) dynamic reallocation scheduler, (C) fragmentation-aware eviction policy.
- **Workloads** available or planned (at least **training vs inference**, or two clearly distinct workload types the user names).

If components are placeholders, use `[Component A/B/C]` and ask the user to name them before final submission.

## Design Requirements

- **Isolate** each component's contribution (single removal or single addition, consistent across rows).
- Test **component interactions** (pairwise or full factorial only where feasible; justify cost).
- Identify **which component matters most under which workload** (cross workload × variant).
- **Reproducible:** fixed random seeds, pinned software versions, documented configs.
- Each variant **clearly named** (e.g., `Full`, `w/o CompA`, `w/o CompB`, `w/o CompC`, `A-only`, `B+C`).
- Cover **at least 2 workload types** (default: training vs inference unless user specifies others).

## Required Output Format

1. **Ablation matrix table** with columns (adapt as needed):

| Variant | CompA | CompB | CompC | Workload(s) | Primary Metric(s) | Hypothesis (one line) |

Include rows for: full system, each single-component removal, and interaction rows if budget allows.

2. **Rationale:** one short paragraph per **row group** (not necessarily every row if redundant).
3. **Execution budget:** estimated runs or GPU-hours order-of-magnitude; call out expensive rows.
4. **Claim mapping:** which paper claim each row supports.
5. **Reviewer anticipation:** what each ablation might fail to prove and how to fix.

## Before delivery

Run **global-prose-readability-gate** on Rationale and Reviewer anticipation prose.

## Tone

- Venue-realistic: ablations must support **specific claims**, not fill space.
- Prefer minimal matrix that convinces a skeptical PC member over exhaustive Cartesian products.
