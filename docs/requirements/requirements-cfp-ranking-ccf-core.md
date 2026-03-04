# CFP Ranking (CCF & CORE)

## Overview

This document describes the **ranking metadata** feature for CFP (Call For Papers) data in the Zotero Annotation Reviewer plugin. The feature enriches conference series with **CCF** (China Computer Federation) and **CORE** (Computing Research and Education Association of Australasia) rankings, using configurable local and remote data sources. Ranking information is stored only on **Series notes** and displayed in the Assistant CFP context panel.

## Goals

- Provide users with CCF and CORE rank information for conference series without relying on a single external API.
- Use **CORE.csv** as the sole source of truth for CORE ranks (A*, A, B, C).
- Use **allconf.yml** (remote or local fallback) as the source for CCF ranks.
- Display a single, compact rank string (e.g. `CORE: A | CCF: B`) in the CFP Context panel when a CFP event or series is available.
- Refresh rank data when the user clicks **Refresh events** on a Series note.

---

## 1. Data sources

### 1.1 CORE ranking

- **Source:** A single **local CSV file** in the vault.
- **Setting:** `cfpCoreCsvPath` (vault-relative path, e.g. `CFP Data/CORE.csv`).
- **Behaviour:**
  - When the path is set, the plugin loads and parses this file to build an in-memory index.
  - CORE ranks are **never** taken from `allconf.yml`; the CSV is the only source for CORE.
- **CSV format (expected columns):**
  - Column 0: id  
  - Column 1: Conference name  
  - Column 2: Acronym  
  - Column 3: Collection (e.g. ICORE2026)  
  - Column 4: Rank (A*, A, B, C, or raw status like "Unranked", "journal published", "National: USA")  
  - Remaining columns are ignored.
- **Matching:** Series name is matched to the index by normalised acronym and by normalised full name; trailing years (e.g. `AAAI 2026` → `AAAI`) are stripped for lookup.

### 1.2 CCF ranking

- **Primary source:** Remote **allconf.yml** from configured CCFDDL URLs (same URLs used for CFP event data).
- **Fallback:** Optional **local allconf.yml** in the vault when the remote fetch fails or returns no data.
- **Settings:**
  - CCFDDL URLs: existing CFP URL list for CCFDDL.
  - `cfpCcfddlLocalPath`: vault-relative path to a local copy of `allconf.yml` (e.g. `CFP/CCF/allconf.yml`).
- **Behaviour:**
  - The plugin first tries to fetch from the configured HTTPS URL(s).
  - If the network fails or the response yields no items, it attempts to read the local file at `cfpCcfddlLocalPath`.
  - Parsed CCF fields (e.g. `rank.ccf`, `rank.thcpl`, `sub`) are cached in memory and used for series title lookup.

---

## 2. Where ranking appears

### 2.1 Storage (Series notes only)

- Ranking data is **only** written to **Series note** frontmatter, not to individual event notes.
- Frontmatter keys (all optional):
  - `rank_ccf`: CCF rank (e.g. A, B, C).
  - `rank_thcpl`: THCPL rank if present in CCF data.
  - `rank_sub`: CCF subject area (e.g. AI, DB, SE).
  - `rank_core`: CORE letter (A*, A, B, C) when applicable.
  - `rank_core_status`: Raw CORE status when not a simple letter (e.g. "Unranked").
  - `rank_core_collection`: CORE collection identifier when available.

### 2.2 Display (Assistant CFP Context)

- **Location:** The "CFP context" section inside the `zotero-assistant` code block.
- **When:** Shown when the current note has a conference acronym (plain string or link) and a matching series or event is found.
- **Format:** A single line: `CORE: &lt;letter&gt; | CCF: &lt;letter&gt;` (e.g. `CORE: A | CCF: B`).
  - Only non-empty values are included; if only CORE is present, the line is `CORE: A`; if only CCF, `CCF: B`.
- **Source of truth for display:** Ranks are always read from the **Series note** frontmatter:
  - When showing a **series** block: use that series note’s frontmatter.
  - When showing an **event** block: resolve the event’s series folder, then read the corresponding Series note’s frontmatter.

---

## 3. When ranking is updated

- **On Series note creation:** When a new Series note is created during CFP sync, the plugin computes CCF and CORE ranks and writes them to frontmatter.
- **On "Refresh events":** When the user clicks the **Refresh events** button on a Series note (or the equivalent command), after syncing events the plugin **recomputes and updates** that Series note’s rank frontmatter from the current CORE CSV and allconf.yml (remote or local) data.
- **On "Check ranking sources":** This is a diagnostics action only; it does not write ranks. It checks that the configured CORE CSV path and local allconf.yml path (if set) resolve to existing files in the vault and shows a short notice with the result.

---

## 4. Settings UI

- **Section:** CFP settings tab → **Ranking Sources** card.
- **Fields:**
  - **CORE CSV path**  
    Vault-relative path to CORE.csv. When set, this is the only source used for CORE ranks (A*, A, B, C).  
    Placeholder example: `CFP/CORE/CORE-ICORE2026.csv`
  - **Local allconf.yml path**  
    Optional vault-relative path to a local copy of allconf.yml. Used as a fallback when CCFDDL URLs are unreachable, and for deriving CCF ranks for Series notes.  
    Placeholder example: `CFP/CCF/allconf.yml`
- **Action:** **Check ranking sources** button — verifies that the configured paths exist in the vault and shows a notice (e.g. "CORE CSV: found at …" / "not found at …").

---

## 5. Data model (types)

### CFPRank

```typescript
interface CFPRank {
  ccf?: string;
  thcpl?: string;
  sub?: string;
  coreLetter?: 'A*' | 'A' | 'B' | 'C';
  coreStatus?: string;
  sources?: {
    ccfTitle?: string;
    coreAcronym?: string;
    coreName?: string;
    coreCollection?: string;
  };
}
```

### CFPItem

- `CFPItem` may optionally include `rank?: CFPRank`; in practice, rank is persisted only on Series notes via frontmatter, not on individual CFP items in memory.

---

## 6. Implementation notes

### Key files

- `src/types.ts` — `CFPRank`, `MyPluginSettings.cfpCoreCsvPath`, `cfpCcfddlLocalPath`.
- `src/services/cfp-core.ts` — CORE CSV parsing, index build, `getCoreRankForSeries(index, seriesName)`.
- `src/services/cfp-ccfddl.ts` — CCF parsing from allconf.yml, `getCcfRankForSeriesTitle(title)`, local cache.
- `src/services/cfp.ts` — `getOrLoadCoreIndex()`, `getCcfRankForSeries()`, `fetchCcfddlWithFallback()`, `updateSeriesNoteRank()`, `ensureSeriesNote()` (writes rank frontmatter), `refreshSeriesByUrl()` (calls `updateSeriesNoteRank` after sync).
- `src/ui/assistant.ts` — `renderSeriesBlock()` and `renderEventBlock()` read `rank_core` and `rank_ccf` from the Series note and render `CORE: X | CCF: Y`.
- `src/settings.ts` — Ranking Sources card and "Check ranking sources" button.
- `src/utils/paths.ts` — `normalizePath()` for vault-relative path handling (used when resolving CORE CSV and allconf paths).

### Path handling

- All vault-relative paths (CORE CSV, local allconf.yml) are normalised with the project’s `normalizePath()` so that slashes and leading `./` or `/` are consistent before calling `vault.getAbstractFileByPath()`.

---

## 7. Acceptance criteria (summary)

- [ ] With a valid **CORE CSV path** set, CORE ranks (A*, A, B, C or status) are derived only from that file and written to Series note frontmatter.
- [ ] With **CCFDDL URLs** and/or **local allconf.yml** configured, CCF rank is resolved (remote first, local fallback) and written to Series note frontmatter.
- [ ] Ranking line appears in the **CFP Context** panel as a single string `CORE: X | CCF: Y` (or only one part if the other is missing), for both series and event blocks, using the Series note as the source.
- [ ] Clicking **Refresh events** on a Series note updates that Series note’s rank frontmatter from the current sources.
- [ ] **Check ranking sources** reports whether the configured CORE CSV and local allconf.yml paths exist in the vault.
- [ ] Ranking is stored and displayed only for **Series notes**; individual event notes do not store rank frontmatter.

---

## 8. Related documentation

- `requirements-assistant-cfp-context-simplification.md` — CFP context panel behaviour and acronym/link handling.
- `requirements-cfp-wikicfp-series-and-notes.md` — CFP data model, Series notes, and Refresh events flow.
