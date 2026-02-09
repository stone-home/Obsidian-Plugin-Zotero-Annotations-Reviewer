# CFP Context Simplification in Assistant View

## Overview

This document describes the simplified CFP (Call For Papers) context display feature in the `zotero-assistant` code block. The feature reads the `conference-acronym` frontmatter key and displays relevant conference series and event information.

## Requirements

### Input Source

The CFP context is derived from the `conference-acronym` (or `Conference acronym`) frontmatter key in the current note. The value can be:

1. **Plain string** - e.g., `OSDI`
2. **Obsidian link** - e.g., `[[CFP/OSDI/OSDI 2024]]` or `[[CFP/OSDI/OSDI Series]]`

### Display Behavior

#### Case 1: Plain String

When the value is a plain string (e.g., `OSDI`):

1. Search for a matching series in the CFP note folder
2. Display:
   - Series name with link to series note
   - Latest event in the series (by submission deadline, most recent first)
   - Latest event details: acronym, submission deadline (DDL), and location

**Example output:**
```
CFP Context
• OSDI Series
• Latest: OSDI 2024 (DDL: 2024-05-15, Santa Clara, CA)
```

#### Case 2: Obsidian Link

When the value is an Obsidian link:

1. Resolve the link to determine if it points to:
   - A **series note** (e.g., `OSDI Series.md`)
   - A **specific event note** (e.g., `OSDI 2024.md`)

##### Case 2.1: Link to Series Note

Display the same content as Case 1 (plain string).

##### Case 2.2: Link to Specific Event

Display:
- Event name with link
- Event date range and location
- Latest event in the series (if different from the linked event)

**Example output:**
```
CFP Context
• OSDI 2024 (2024-07-10 ~ 2024-07-12, Santa Clara, CA)
• Latest in series: OSDI 2025 (DDL: 2025-05-01, Boston, MA)
```

### "Latest Event" Definition

The "latest event" is defined as the event with the **most recent submission deadline** (`submission-ddl` frontmatter field) in the series, sorted by date descending.

This differs from "next upcoming event" which would only consider future deadlines. The "latest" approach ensures:
- Historical data is always shown even when all deadlines have passed
- Users can see the most recent conference in a series regardless of current date

### Error Handling

- If no matching series/event is found: Display "No matching CFP found for: [value]"
- If CFP service is unavailable: Display "CFP service not available"
- If frontmatter key is missing: Skip CFP context section entirely

## Implementation Details

### Files Modified

- `src/ui/assistant.ts` - `renderCFPContext`, `renderSeriesBlock`, `renderEventBlock` methods
- `src/services/cfp.ts` - `getSeriesInfoByAcronym`, `getCFPNoteInfoByPath`, `findLatestInSeries` methods

### Key Methods

#### `getSeriesInfoByAcronym(acronym: string)`

Returns series information for a given acronym string:
- `seriesName`: Name of the series
- `seriesNotePath`: Path to the series note
- `latestEvent`: The event with the most recent submission deadline

#### `getCFPNoteInfoByPath(path: string)`

Returns information about a CFP note at the given path:
- `isSeries`: Whether the note is a series note
- `seriesName`: Name of the series
- `seriesNotePath`: Path to the series note
- `event`: Event details (if not a series note)
- `latestEvent`: The latest event in the series

#### `findLatestInSeries(events: CFPItemWithPath[], seriesName: string)`

Finds the event with the most recent submission deadline in a series.

## Data Model

### CFPItem

```typescript
interface CFPItem {
  acronym: string;
  series?: string;
  fullName: string;
  location: string;
  start?: string;
  end?: string;
  submissionDdl: string;
  source: 'wikicfp' | 'ccfddl' | 'easychair' | 'openresearch' | 'manual';
  url?: string;
}
```

### CFPItemWithPath

```typescript
interface CFPItemWithPath {
  item: CFPItem;
  path: string;
}
```

## UI Components

### Series Block

Displays:
- Title: "CFP Context"
- List item: Series name (clickable link)
- List item: "Latest: [ACRONYM] (DDL: [DATE], [LOCATION])" (clickable link)

### Event Block

Displays:
- Title: "CFP Context"
- List item: Event name (clickable link)
- Sub-info: Date range and location
- List item (if applicable): "Latest in series: [ACRONYM] (DDL: [DATE], [LOCATION])"

## Related Documentation

- `docs/requirements/requirements-cfp-wikicfp-series-and-notes.md` - CFP data model and WikiCFP integration
- `docs/requirements/requirements-assistant-cfp-link-and-year-alignment.md` - Previous CFP matching requirements (superseded by this document)
