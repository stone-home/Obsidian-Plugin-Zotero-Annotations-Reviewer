# Assistant CFP Link & Year-Aligned Matching

## 1. CFP context section in Zotero Assistant

- In the **Zotero Assistant** panel (code block `zotero-assistant`), a **CFP context** section is rendered for the current note.
- The section uses **existing CFP notes** in the vault (under the configured CFP folder). It does not call Zotero Integration or change import templates.
- **Inputs** (from the current note’s frontmatter):
  - Conference / proceedings identifiers: `conferenceName`, `proceedingsTitle` (or `publication`), `place`, `year` (or parsed from `date`).
  - Optional **conference acronym** for direct match: read from a configurable key (`cfpAcronymKey`, default `conference-acronym`), with fallbacks to `acronym`, `conference_acronym`, `conferenceAbbrev` if the configured key is empty.

## 2. Matching behaviour

- **Exact-match path (when note has acronym)**  
  If the note has a non-empty acronym (from the configured key or fallbacks):
  - Events are filtered by acronym/series equality or “acronym starts with note acronym” (e.g. note `OSDI` matches CFP `OSDI 2026`).
  - **Year rules:**
    - If the note **has a year**: only events whose year matches (acronym or `start` date) are considered. If at least one exists, that event is returned with series info. If **none** match the year, the result is **series-only** (no specific event).
    - If the note **has no year**: no specific event is ever returned. If the Series note exists for that acronym, the result is **series-only** (link to Series + latest series submission deadline).
  - If there are no acronym/series matches at all, the code tries a **series-only fallback**: if a Series note exists for the given acronym (e.g. `CFP/OSDI/OSDI Series.md`), return `event: null`, `seriesNotePath`, and `latestSeriesDdl`. Otherwise return no match.

- **Heuristic path (when note has no acronym)**  
  Matching uses conference/proceedings title and optional place/year:
  - A series token is taken from the start of the title (e.g. `SCA/HPCAsia` from `SCA/HPCAsia 2026`). Single-letter tokens (e.g. `P` from “Proceedings”) do not get series bonus.
  - Scoring uses series/acronym alignment, year alignment, meaningful token overlap (stopwords excluded), and location.
  - **Year rule:** If the note has a year, the **chosen event’s year must equal** that year (from acronym or `start`). If the best-scoring event has a different year, it is discarded and the result is no event (so we never show e.g. OSDI 2026 for an OSDI 2010 paper).
  - Minimum score threshold (100) is required to show any match.

## 3. UI behaviour

- **When a specific event is matched:**  
  Show event acronym, full name, dates, location, a clickable link to the Series note, and (if available) latest submission deadline in that series.

- **When only the Series is matched (series-only):**  
  Show a “Series overview” line with the series name and a clickable link to the Series note, plus latest series submission deadline if available. No specific event is shown.

- **When nothing matches:**  
  Show a short message (e.g. “No related CFP found in your CFP folder”) with an optional hint (e.g. suggest setting `conference-acronym` or checking the console for `[CFP]` logs).

## 4. Conference acronym key (workaround)

- **Setting:** “Conference acronym key (for CFP link)” in the CFP settings tab. Default: `conference-acronym`.
- **Purpose:** For notes whose title does not start with the acronym (e.g. “Proceedings of the 16th USENIX Symposium on Operating Systems Design and Implementation”), the user can set in frontmatter e.g. `conference-acronym: OSDI`. The Assistant then uses exact match by acronym and the year rules above (no year → series-only; year 2010 → only OSDI 2010 if it exists).

## 5. Series note: full name from WikiCFP

- When refreshing from **WikiCFP Conference Series (A–Z)**, each created/updated **Series note** can store a **series full name**.
  - The WikiCFP index provides `fullName` (e.g. “OSDI: Operating Systems Design and Implementation”).
  - The plugin writes a frontmatter property **`series-full-name`**:
    - If `fullName` contains `:`, the value is the part **after** the first colon, trimmed (e.g. “Operating Systems Design and Implementation”).
    - Otherwise the full string is used.
  - This allows Series notes to display or reference the long name without duplicating the acronym in the title.

## 6. Files touched

- **Types:** `cfpAcronymKey` in settings; `CFPItemWithPath`, `CFPConferenceMatch`; `findBestMatchingCFPForConference` meta includes `acronymFromNote`.
- **Service:** `src/services/cfp.ts` — exact-match path with year filter and series-only fallback; heuristic path with year check; `ensureSeriesNote(..., seriesFullName?)` and `series-full-name`; `refreshWikiCFPSeries` passes `entry.fullName` to `ensureSeriesNote`.
- **UI:** `src/ui/assistant.ts` — CFP context section; reads acronym key and fallbacks; passes `acronymFromNote` to the matcher; renders event match vs series-only vs no match.
- **Settings:** CFP tab exposes “Conference acronym key (for CFP link)”.
- **Tests:** `src/services/cfp-match.test.ts` — tests for no notes, heuristic match with year, acronymFromNote with/without year, series-only fallback, heuristic year mismatch, no series note.
