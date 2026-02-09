## CFP: WikiCFP Series, Events & Notes

### 1. Data sources and refresh behaviour

- **URL sources**
  - The plugin supports four CFP URL sources: **WikiCFP**, **CCFDDL (YAML)**, **EasyChair**, and **OpenResearch**.
  - Each source type has:
    - Its own input list of URLs in the settings tab.
    - Its own `Refresh` button that only refreshes that source.
  - A global `Refresh All Sources` action/command runs all URL sources together.
  - A global refresh interval (`cfpRefreshDays`, default **5** days) controls when URL sources are automatically refreshed in the background.

- **WikiCFP Conference Series (A–Z)**
  - There is a dedicated scan job for **WikiCFP Conference Series (A–Z)** that:
    - Loads the *series index* pages and records each `(seriesAcronym, programUrl)`.
    - Creates or updates a dedicated **Series note** for each series.
    - Does **not** fetch individual events during the index scan; events are fetched on demand or via the daily job.
  - The series index scan uses its own interval (`cfpSeriesRefreshDays`, default **30** days) and is independent from URL-source refresh.
  - The settings tab exposes an A–Z **letter selector**:
    - Users choose which index letters to scan (e.g. only `A` or `A,B,C`).
    - `Select All` / `Deselect All` helper buttons.
    - When no letters are selected, the scan falls back to **A–Z**.

- **Daily staggered refresh (anti-crawl)**
  - The plugin keeps a `cfpSeriesMap` with:
    - `programUrl`
    - `lastUpdate` timestamp per series.
  - A daily background job:
    - Picks **10–20** series with the **oldest** `lastUpdate`.
    - For each selected series, schedules a refresh of its events (`refreshSeriesByUrl`).
    - Ensures at least **30 minutes** between two series refreshes.
  - All network calls to WikiCFP use delays (5–10 seconds between index pages, 800ms between event pages) to reduce crawler detection risk.

---

### 2. WikiCFP Series page parsing (programUrl)

When the user clicks “Refresh events” on a Series note or runs the `cfp-refresh-this-series` command, the plugin calls:

```ts
refreshSeriesByUrl(programUrl: string, seriesAcronym: string)
```

which calls:

```ts
fetchSeriesEvents(programUrl, seriesAcronym)
```

Requirements for `fetchSeriesEvents`:

- **Primary source: “All CFPs on WikiCFP” table**
  - The parser must treat the **“All CFPs on WikiCFP”** table on the program page as the **primary, low-noise source** for events.
  - It has 4 logical columns: **Event | When | Where | Deadline**, but many series (e.g. WAIFI, ZEUS, XP) use `rowspan=2` and split the row:
    - Row 1: `Event` + description (workshop name) with `rowspan=2`.
    - Row 2: `When` (dates), `Where`, `Deadline`.
  - Parser must:
    - Merge these two physical rows into one logical event row.
    - Extract:
      - `acronym`: from the `<a>` link text (e.g. `WAIFI 2016`).
      - `fullName`: from the description text in the “When/description” area (e.g. `International Workshop on the Arithmetic of Finite Fields 2016`).
      - `location`: from the “Where” cell (e.g. `Ghent University, Ghent, Belgium`).
      - `start` / `end`: from the date range (e.g. `Jul 13, 2016 - Jul 15, 2016`).
      - `submissionDdl`: from the “Deadline” cell (e.g. `May 1, 2016`).
      - `url`: set to `programUrl` (the series program page).
      - `series`: **must** be set to the passed `seriesAcronym` (e.g. `WAIFI`).
    - Use a `Set` keyed by lowercase `acronym` to deduplicate events coming from a single series table.

- **Fallback behaviour**
  - If the Series table cannot be parsed or yields **0** items:
    - Try to find event detail URLs (e.g. `/cfp/servlet/event.showcfp?eventid=...` or `/cfp/call?cid=...`) and call the generic `fetchWikiCFP` parser for those URLs, attaching `seriesAcronym` as `series`.
    - If there are still 0 results, treat the entire program page as a generic WikiCFP table and pass it through `fetchWikiCFP([programUrl])`.

---

### 3. CFP note storage model

- **Directory structure**
  - All CFP notes live under a configured base folder `cfpNoteDir` (default `CFP`).
  - For items with a `series`:
    - Path: `CFP/<SeriesName>/<Acronym>.md`
    - Example: `CFP/WAIFI/WAIFI 2016.md`.
  - For items without a `series`:
    - Path: `CFP/<Acronym>.md`.

- **CFP note frontmatter**
  - Every CFP note created or updated by the service must have:
    - `acronym`: event identifier, typically `<SERIES> <YEAR>` (e.g. `WAIFI 2016`).
    - `full-name`: full event name.
    - `location`: human readable location/place.
    - `series`: when applicable, stored as `[[<SeriesName> Series]]` so users can navigate to the Series note.
    - `start`: ISO date string (`YYYY-MM-DD`) for start date, if available.
    - `end`: ISO date string (`YYYY-MM-DD`) for end date, if available.
    - `submission_ddl`: ISO date string (`YYYY-MM-DD`) for the submission deadline.
    - `cfp-source`: one of `wikicfp`, `ccfddl`, `easychair`, `openresearch`, `manual`.
    - `url`: canonical CFP URL (series program URL for Series-derived events, or event page URL for generic sources).
    - `tags`: array including at least `cfp` plus any user-configured defaults.
  - The normalization function:
    - Accepts common English date strings (e.g. `Jul 13, 2016`, `April 18th, 2016`) and converts them to `YYYY-MM-DD`.
    - If a date cannot be parsed, the original string is preserved.

- **File creation guarantees**
  - Folder creation uses `ensureFolder`, which:
    - Avoids throwing on “Folder already exists”.
  - File creation uses `createOrOverwriteFile`, which:
    - Overwrites existing Markdown files at the same path instead of failing on “File already exists”.
    - Ensures idempotent reruns of sync jobs do not break the plugin.

---

### 4. Series notes & Dataview integration

- **Series note frontmatter**
  - One Series note per series under `CFP/<SeriesName>/<SeriesName> Series.md`.
  - Required fields:
    - `title`: `"<SeriesName> Series"`.
    - `cfp-series: true`.
    - `series-url`: the programUrl used for this series (used by the refresh button and for future migrations).
    - `tags`: includes user-configured default CFP tags.

- **DataviewJS refresh button**
  - Each Series note contains a `dataviewjs` block defined by a setting `cfpSeriesDataviewJSCode` (with a safe default).
  - The default script:
    - Uses `dv.current()` to get the current page and its `series-url`.
    - Infers `seriesAcronym` from `cur.file.name` by stripping the trailing `" Series"` suffix.
    - Calls `dv.el("button", "Refresh events")` to render a button.
    - On click, calls `window.__ZoteroAnnotationReviewerCFP.refreshSeries(programUrl, seriesAcronym)`.
  - The plugin exposes `window.__ZoteroAnnotationReviewerCFP.refreshSeries` from `onload` so DataviewJS can directly trigger the internal `refreshSeriesByUrl` method.
  - When the user edits `cfpSeriesDataviewJSCode` in settings:
    - `updateAllSeriesNotesDataviewJS()` must update the `dataviewjs` block in every existing Series note (`cfp-series: true`), inserting it if missing.

- **Series Dataview table**
  - Series notes include a `dataview` block that shows all CFP notes under that Series:
    - Columns:
      - `file.link as "Event"`
      - `acronym as "Acronym"`
      - `"full-name" as "Full Name"`
      - `location as "Location"`
      - `submission_ddl as "Deadline"` (must use the underscore version).
      - `start as "Start"`
      - `end as "End"`
      - `cfp-source as "Source"`
      - `url as "URL"`
    - Source: `FROM [[<SeriesName> Series]]`.
    - Sorted by file name descending (newest events first).

---

### 5. User-facing settings & UX

- **CFP settings tab**
  - Organised as cards:
    - **Basic Settings**: CFP base folder, default tags, URL auto-refresh interval, series index refresh interval.
    - **WikiCFP Conference Series**:
      - A–Z letter selector grid with `Select All` / `Deselect All`.
      - `Refresh Series` button to trigger index scan manually.
    - **Series Note DataviewJS Code**:
      - Code editor for `cfpSeriesDataviewJSCode`.
      - “Update All Series Notes” button to re-apply the script to all existing Series notes.
    - **URL Sources**: four sections (WikiCFP, CCFDDL, EasyChair, OpenResearch), each with:
      - URL list management (add/remove).
      - Individual `Refresh` button.
    - **Actions**:
      - `Refresh All Sources` button.
      - `Add Manual CFP` button that opens a modal to create a single CFP item by hand.

- **Commands**
  - `cfp-refresh`: Refresh all URL sources (same as `Refresh All Sources`).
  - `cfp-add-manual`: Open the manual CFP creation modal.
  - `cfp-show-list`: Show a modal listing upcoming and past CFPs, based on `submission_ddl` dates.
  - `cfp-refresh-wikicfp-series`: Manually trigger a full Series index scan (respecting selected letters and delays).
  - `cfp-refresh-this-series`: From the active Series note, refresh only that series’ events using its `series-url`.

