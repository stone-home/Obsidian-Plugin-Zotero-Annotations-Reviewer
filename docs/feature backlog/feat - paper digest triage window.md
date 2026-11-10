---
title: feat - paper digest triage window
id: pd7k2m9x4q
create: 2026-11-09
tags:
  - type/code-requirement
aliases: []
sources: []
type: permanent
url:
cssclasses: []
project: ""
status: done
priority: medium
release: v0.0.0
---
# Commit Message
`feat(digest): add paper digest triage window`

# PR Description
**Title:** `feat(digest): add paper digest triage window`
**Summary:** Adds a popout window that shows incoming papers one at a time. The user accepts a paper into Zotero with fixed direction tags and a collection, or rejects it with a fixed reason. Papers arrive as JSONL files in a vault folder or through a BibTeX import. Existing features are not changed.

---
# Paper Digest triage window

## 1. Requirements & Context

Candidate papers arrive every day from an n8n workflow, and survey work adds several hundred more from BibTeX files. There was no place to screen them, so they either piled up as notes in the vault or were lost. This feature adds a window that shows one paper at a time and records one decision per paper.

### 1.1 States and storage

A paper is only useful to the digest until it has been decided, so the store is kept small and temporary. Each paper has one of three states: `unchecked`, `accepted` or `rejected`. All papers live in one file, `digest-store.json`, in the plugin folder. Decided papers are deleted after the retention period (30 days by default). Unchecked papers are never deleted automatically.

Retention has one consequence. The duplicate check only sees papers that are still in the store. A paper decided before the retention period can therefore appear again as unchecked.

### 1.2 Input format

External tools need one agreed format, otherwise each source would need its own parser in the plugin. Writers drop `*.jsonl` files into the incoming folder (default `Digest/Incoming`), with one paper per line. The plugin checks each value and never converts it.

```json
{"key":"10.48550/arXiv.2401.12345","title":"Paper title","doi":"10.48550/arXiv.2401.12345","url":"https://arxiv.org/abs/2401.12345","year":2024,"venue":"arXiv","abstract":"…","item_type":"preprint"}
```

| Field | Required | Check |
|---|---|---|
| `key` | yes | non-empty string |
| `title` | yes | non-empty string |
| `doi` | no | bare DOI such as `10.1234/abc`, without a URL prefix |
| `url` | no | absolute http(s) URL |
| `year` | no | integer |
| `venue`, `abstract`, `item_type` | no | string |

- The writer chooses the key: the DOI when there is one, otherwise the URL, otherwise another stable identifier.
- A line is a duplicate when its key or its DOI matches a stored paper. The comparison ignores case.
- A file is removed after its lines are saved. A line that fails a check is kept in the store with its reason, and the window lists it until the user clears it.
- Writers should write a `*.tmp` file and rename it to `*.jsonl`, because only `*.jsonl` files are read.

### 1.3 BibTeX import

A survey often starts from a `.bib` file, and that format carries the same identifiers under different field names. The window therefore has an Import .bib action that converts each entry to the input format and adds it to the store directly. No file is written to the vault. The `doi` field loses any URL prefix, and an arXiv `eprint` becomes the arXiv DOI. An entry without a DOI, an arXiv identifier or a URL is skipped and counted. Each import gets a batch name, and Withdraw import removes the papers of that batch that are still unchecked.

### 1.4 Accepting a paper

The metadata in Zotero should come from Zotero's own translators, because the input only carries a few display fields. Accept therefore runs two requests. The first sends the DOI to a Zotero translation-server, which returns the full item. The second writes that item through the local API of the running Zotero.

- The tags returned by the translator are replaced with the chosen direction tags, written as `<prefix><direction id>`.
- The item is placed in the one collection chosen in the window, by collection key. The collection selected inside Zotero has no effect.
- When a paper has no DOI, or the lookup finds nothing, nothing is added to Zotero. The window then offers Accept, import manually. This marks the paper as accepted in the digest, and the user adds it to Zotero by hand.
- Zotero's API does not download PDFs. Use Find Full Text in Zotero afterwards.

### 1.5 The window

Triage is a short task, so the window is a separate popout that is opened, used and closed. It opens from the command Open Paper Digest or the sidebar icon. Opening it this way, or choosing Refresh, imports the incoming folder and then removes expired papers. A window that Obsidian restores at startup only displays the store and does no file work.

The window has two parts, so that the user can see all papers and still read one in full. The left part is a scrollable list of every paper with its status. The right part shows the selected paper and its actions.

- The list shows unchecked papers first, then decided papers with the most recent decision on top. A filter narrows it to one status or one import.
- Each decided paper has an Undo button in its row, which returns it to unchecked. An accepted item stays in Zotero when its decision is undone.
- Clicking a row, or pressing `↑` and `↓`, selects a paper.
- The header shows whether Zotero and the translation server answer. When either does not, Accept and Reject are disabled, and the window states what to start.
- Accept opens a panel with the direction list and the collection list. Exactly one collection, or the library root, is chosen. A direction is required only when directions are defined in the settings.
- Reject opens the reason list. One click stores the reason.
- After a decision the next unchecked paper is selected.
- Keys: `←` reject, `→` accept, `↑` `↓` move, digits choose a direction or reason, `Enter` confirms, `Esc` cancels.
- The menu holds Refresh, Import .bib, Invalid lines and Withdraw import.

### 1.6 Settings

Directions and reject reasons are fixed lists, so that tags in Zotero stay consistent. The Digest settings tab holds both lists, the translation server endpoint (default `http://127.0.0.1:1969`) with a Test action, the incoming folder, the tag prefix, the retention period and the sidebar icon toggle. Collections are not configured. They are read from Zotero each time the window opens.

### 1.7 Prerequisites

Two services must run on the machine. Zotero must be open with the local API enabled under Settings → Advanced. A translation-server must be reachable at the configured endpoint:

```bash
docker run -d --name zotero-translation --restart unless-stopped \
  -p 127.0.0.1:1969:1969 zotero/translation-server
```

## 2. Execution Plan

- [x] Step 1: Add digest types, the store, JSONL import and cleanup under `src/services/digest-*.ts`.
- [x] Step 2: Add the translation-server client and the Zotero local API client.
- [x] Step 3: Add the popout window and the Digest settings tab under `src/ui/digest-*.ts`.
- [x] Step 4: Add the BibTeX import.
- [x] Step 5: Register the feature with additive edits to `main.ts`, `settings.ts`, `types.ts` and `styles.css`.
- [ ] Step 6: Verify the translation-server and Zotero local API responses on the Zotero machine.
- [ ] Step 7: Add tests for the five services in a separate task.
