# Zotero Annotation Reviewer

**Zotero Annotation Reviewer** is an Obsidian plugin that enhances academic literature workflows with Zotero Integration by providing tools to triage incoming papers, manage a structured Paper Workspace, synthesize and link atomic Zettelkasten notes, review PDF highlights, track conference CFPs, and trigger external webhooks directly from Obsidian.

## Project Description

A companion plugin for Zotero, Better BibTeX, and the [Zotero Integration](https://github.com/mgmeyers/obsidian-zotero-integration) plugin. While Zotero Integration pulls bibliographic notes and PDF annotations into Obsidian, this plugin powers end-to-end research workflows inside your Vault: screening incoming papers in **Paper House**, organizing per-paper analysis reports and takeaways in **Paper Workspace**, connecting candidate claims to permanent atomic notes via the **Vault Knowledge Connector**, managing **Call For Papers (CFP)** series with CCF/CORE rankings, and automating external pipelines via **modular webhooks**.

---

## ✨ Main features

- **Paper House (`[Digest | Library]` popout window)**
  - Desktop popout workspace (`Open Paper House` and `Open Paper House (Library)` commands, plus an optional ribbon icon) combining incoming paper triage with a searchable Vault Literature Library.
  - **Digest tab:** Ingests daily `*.jsonl` drops from a configurable Vault folder (`Digest/Incoming` by default) or imported `.bib` BibTeX files, resolves metadata via Zotero Translation Server, and lets you accept papers into local Zotero (assigning fixed research direction tags and Zotero collections via Zotero Local API) or reject them with structured reasons stored in `digest-store.json`.
  - **Library tab:** Indexes primary Literature notes across your Vault (`002-Literature/` by default) with weighted full-text and metadata search, venue/Core Note/Takeaway quick filters, inline Core Note editing, and one-click Vault Connector access. A note tagged `source/📜Zotero` always counts as a paper. Notes tagged `source/🤖AI`, companion notes (reports, takeaways, Core Notes, or any note with `linked-notes`), and `fleeting` / `atom` / `permanent` notes are left out, even though the companions also use `type: literature`.

- **Paper Workspace & Vault-backed Templates & Prompts**
  - Organizes each paper around a citekey-driven workspace: Literature Note (`002-Literature/{{citekey}}.md`), Deep Research Report 1, External Landscape Report 2 (with automatic `code_url` extraction into frontmatter), synthesized Takeaway note, and Core Note (`linked-notes`, `projects`, and synthesis notes).
  - Built-in templates follow a 4-type Vault taxonomy: `fleeting` (highlight notes), `literature` (the Zotero note and its Report 1, Report 2, Takeaway, and Core Note companions), `atom`, and `permanent` (atomic Zettels). AI-generated companions are tagged `source/🤖AI` and link back with short basename wiki-links (for example `[[citekey]]`, `[[Deep Research-citekey]]`) instead of full paths.
  - Stores built-in and custom **Templates & Prompts** as editable Markdown files in `900-Templates/` (including the Zotero Integration import template, Report 1 / Report 2 / Takeaway / Core Note / Atomic Note templates, and LLM synthesis prompts), automatically materializing missing built-in files when the Vault loads. Existing files are never overwritten; see [Note template placeholders](#-note-template-placeholders) for the variables they accept.

- **Vault Knowledge Connector (`ConnectorModal`) & Atomic Zettels**
  - Parses `### Candidate` atomic note proposals and cited references from a paper's Takeaway and Report files, matching them against existing permanent notes (`003-Permanent/A - ...`) and Literature notes in the Vault by exact title, concept token overlap, citekey, or DOI.
  - Lets you create new permanent atomic notes from `900-Templates/atomic-note-template.md` or link/relink existing Vault notes, optionally appending structured `Evidence from [[citekey]]` sections and syncing `linked-notes` on the paper's Core Note.

- **Highlight & image review dashboard (`zotero-assistant`)**
  - A markdown code block (` ```zotero-assistant `) renders an interactive Paper Workspace and annotation dashboard inside your literature note.
  - Displays paper metadata, DOI/code links, same-venue Vault papers, CFP conference context, linked projects, workspace tabs (Takeaway, Report 1, Report 2, Core Note, Highlights), and Zotero PDF annotations (highlights, images, ink, notes).
  - Uses a JSON map between annotation IDs and image relative paths (plus coordinate fallback) with a stable `zotero-image-path` convention (`Attachments/{{citekey}}`) to prevent broken image embeds and convert annotations into Fleeting Notes.

- **Highlight notes**
  - Fleeting notes for a paper are found by citekey in the highlight notes folder (`001-Fleeting` by default). The paper's own Report 1, Report 2, Takeaway, and Core Note files are excluded even when they sit in that folder.

- **Project linker (`project-picker`)**
  - A `project-picker` code block renders an inline UI to link the current note to project `Dashboard.md` notes under a configurable Projects folder.
  - Linked projects are stored in frontmatter under a configurable key (e.g. `projects`) using an optional custom label key (`project_id` / `project_name`) and displayed as clickable pills.

- **Modular webhook system**
  - Configure multiple HTTP webhooks (`GET`, `POST`, `PUT`, `DELETE`) with JSON, form-encoded, or plain-text body templates, custom headers backed by plain text or Obsidian `secretStorage`, and optional runtime **input variables** (`{{name}}`).
  - Supports rich placeholders including `{{filename}}`, `{{path}}`, `{{content}}`, `{{timestamp}}`, `{{frontmatter.KEY}}`, Paper Workspace paths (`{{citekey}}`, `{{path.zotero_note}}`, `{{path.report1}}`, `{{path.report2}}`, `{{path.takeaway}}`, `{{path.core_note}}`), and Vault prompt contents (`{{prompt.ID}}`, `{{path.prompt.ID}}`).
  - Trigger webhooks from the `zotero-assistant` view, `ConnectorModal`, command palette (`Trigger Webhook...`), or an optional sidebar ribbon icon.

- **CFP (Call For Papers) management & CCF/CORE rankings**
  - Fetches and normalizes CFP events from WikiCFP, CCFDDL (`allconf.yml`), EasyChair, OpenResearch, and WikiCFP Conference Series (A–Z) index pages into structured Vault notes under `CFP/`.
  - Enriches Conference Series notes with **CORE** ranks (from a local Vault `CORE.csv`) and **CCF** ranks (from remote or local `allconf.yml`), surfacing compact rank badges (`CORE: A* | CCF: A`) and upcoming deadlines inside `zotero-assistant`.
  - A `cfp-list` code block renders the upcoming and past CFP list inline in any note.
  - Provides DataviewJS on-demand series refresh via `window.__ZoteroAnnotationReviewerCFP.refreshSeries(programUrl, seriesAcronym)` and staggered daily background refreshes.

---

## ⚙️ Prerequisites

- **Obsidian** v0.15.0 or higher
- **Node.js** v18+ (for development)
- **Zotero** desktop application with the **Better BibTeX** extension installed
- **Zotero Integration** plugin installed and enabled in Obsidian (for literature note & image import)
- **Dataview** plugin installed and enabled in Obsidian (optional; used for custom DataviewJS scripts and CFP Series tables)
- **Zotero Translation Server** (optional; used by Paper House Digest on `http://127.0.0.1:1969` when resolving incoming DOIs/URLs before writing to Zotero Local API)
- Zotero Integration import configuration:
  - Write `citation-key` and `zotero-image-path` to frontmatter, and embed a `zotero-assistant` code block containing a JSON map `{ annotationId: imageRelativePath }`.
  - Use a consistent **Image Output Path**, for example `Attachments/{{citekey}}`.

> **Important:** `zotero-image-path` in your import template must match the “Image Output Path” you configure in Zotero Integration (e.g. `Attachments/{{citekey}}`).

## 🛠️ Tech Stack

- **Language:** TypeScript (strict mode, ES6+)
- **Framework:** Obsidian Plugin API
- **Build Tool:** esbuild
- **Testing:** Jest with `ts-jest` and `jsdom` environment (`tests/`)
- **Code Quality:** ESLint (flat config), Prettier, TypeScript `tsc --noEmit`
- **Key Libraries:**
  - `obsidian` - Obsidian plugin API
  - `@codemirror/*` - CodeMirror 6 editor components for settings UI
  - `date-fns` - Date manipulation and formatting
  - `js-yaml` - YAML parsing and serialization for Core Notes and CFP sources
  - `markdown-note-orm` - Structured Markdown note and frontmatter manipulation

---

## 🚀 Getting Started

### Installation

1. **Install from Obsidian Community Plugins:**
   - Open Obsidian Settings → Community Plugins
   - Browse and search for "Zotero Annotation Reviewer"
   - Click Install, then Enable

2. **Manual Installation (Development):**
   ```bash
   # Clone the repository
   git clone https://github.com/stone-home/Obsidian-Plugin-Zotero-Annotations-Reviewer.git
   cd Obsidian-Plugin-Zotero-Annotations-Reviewer

   # Install dependencies
   npm install

   # Build the plugin (runs typecheck + esbuild production bundle)
   npm run build

   # Copy manifest.json, main.js, and styles.css to your Obsidian plugins folder
   # On macOS: ~/Library/Application Support/obsidian/plugins/zotero-annotation-reviewer/
   # On Windows: %APPDATA%\Obsidian\plugins\zotero-annotation-reviewer\
   # On Linux: ~/.config/obsidian/plugins/zotero-annotation-reviewer/
   ```

3. **Development commands:**
   ```bash
   npm run dev           # esbuild watch build
   npm test              # Jest suites under tests/ (unit + integration)
   npm run lint          # ESLint
   npm run typecheck     # tsc --noEmit
   npm run format:check  # Prettier check for src/ and tests/
   ```

### Basic setup workflow

1. **Configure Zotero Integration**
   - Open **Settings → Zotero Annotation Reviewer → Templates** to inspect or customize the built-in Zotero note template saved in `900-Templates/zotero-note-template.md`, and point Zotero Integration's **Note Content** template at that file with **Image Output Path** set to `Attachments/{{citekey}}`. The current built-in template is reproduced below. It tags imports `source/📜Zotero` (which the Library tab uses to find papers), writes `venue` as a wiki-link, and fills `code`, `deep-report`, and `external-report` from Zotero attachments with those titles:
`````jinja2
---
citation-key: {{citekey}}
zotero-image-path: "{{imageOutputPath}}"
title: "{{ title | replace('"', '\\"') }}"
type: literature
aliases:
  - "{{ title | replace('"', '\\"') }}"
  {%- if shortTitle.length > 0 %}
  - "{{shortTitle}}"
  {%- endif %}
short-name: "{{shortTitle}}"
authors:
{%- if authors %}
{%- for author in authors.split(",") %}
  - {{author | trim | replace(" ", "-") | replace(".", "")}}
{%- endfor %}
{%- endif %}
create: {{date | format("YYYY-MM-DD")}}
year: {{date | format("YYYY")}}
publication: "{{publicationTitle or proceedingsTitle or conferenceName}}"
doi: "{{DOI}}"
url: "{{url}}"
publish-type: "{{itemType}}"
tags:
  - source/📜Zotero
  - type/📰source
  - status/inbox
icon: {% if itemType == "conferencePaper" -%}
 LiNewspaper
{%- elif itemType == "journalArticle" -%}
 FasBookJournalWhills
{%- else -%}
 TiArticle
{%- endif %}
key: {{itemKey}}
code: "{% for att in attachments %}{% if att.title == 'code' %}{{ att.url | replace('"', '\\"') }}{% endif %}{% endfor %}"
venue: "{% set currentVenue = publicationTitle if itemType == 'journalArticle' else ((conferenceName or proceedingsTitle) if itemType == 'conferencePaper' else '') %}{% if currentVenue and currentVenue | trim %}[[{{ currentVenue | trim | replace('\"', '\\\"') }}]]{% endif %}"
deep-report: "{% for att in attachments %}{% if att.title == 'deep-report' %}{{ att.url | replace('"', '\\"') }}{% endif %}{% endfor %}"
external-report: "{% for att in attachments %}{% if att.title == 'external-report' %}{{ att.url | replace('"', '\\"') }}{% endif %}{% endfor %}"
---

```zotero-assistant
{
{%- set comma = joiner() -%}{%- for annotation in annotations -%}{%- if annotation.imageRelativePath -%}{{ comma() }} "{{annotation.id}}": "{{ annotation.imageRelativePath | replace('\\', '\\\\') }}"{%- endif -%}{%- endfor -%}
}
```

## 📰 Abstract

{{abstractNote}}

# 🧱 Appendix
## 🔖 Tags in Zotero
{%- for t in tags %}
  - {{t.tag}}
{%- endfor %}

## 💾 Persistent Data
{% persist "properties" %}{%- if isFirstImport %}
code::
tags::
{% endif %}{% endpersist %}
`````

2. **Configure Plugin Settings**
   - Open Obsidian **Settings → Zotero Annotation Reviewer**. The settings are split into six tabs:
     - **General:** Paper Workspace layout (Literature notes `002-Literature/{{citekey}}.md`, Report 1, Report 2, Takeaway, Core Note, Fleeting/Highlight notes `001-Fleeting`, Permanent Atomic notes `003-Permanent`), Zotero port and citation/annotation keys, and the Project Linker folder and keys.
     - **Highlights:** Default annotation sort, metadata verification mapping, and the optional legacy DataviewJS section.
     - **Templates:** Templates folder (`900-Templates`), the Zotero note template, the Report 1 / Report 2 / Takeaway / Core Note / Atomic Note templates, and the synthesis prompts. Each file can be opened, snapshotted, restored, or **Reset** to the factory default.
     - **Webhooks:** Modular webhook profiles, the sidebar icon toggle, and debug mode.
     - **CFP:** Note folder, tags, refresh intervals, WikiCFP Series letters, URL sources, and optional local `CORE.csv` / `allconf.yml` ranking paths.
     - **Digest:** Incoming JSONL folder (`Digest/Incoming`), Zotero Translation Server URL, research direction tags, and reject reasons.

   > **Upgrading from an earlier version:** template files already in `900-Templates/` are kept as they are. To switch to the 4-type taxonomy templates, click **Reset** on each template in the **Templates** tab (take a snapshot first if you have edits to keep).

3. **Triage & Import Papers**
   - Run **Open Paper House** (or click the inbox ribbon icon) to screen incoming papers on the **Digest** tab or browse existing Vault papers on the **Library** tab.
   - Use Zotero Integration (`Ctrl/Cmd + P` → `Zotero Integration: Create Note`) or the Assistant's Zotero import trigger to create a Literature note in your Vault.

4. **Review, Synthesize & Connect**
   - Open any Literature note containing a `zotero-assistant` block to manage Report 1, Report 2, Takeaway, Core Note, and PDF highlights, then click **Connect to Vault** (`ConnectorModal`) to link or create permanent atomic Zettels.

---

## 🧩 Note template placeholders

The Report 1, Report 2, Takeaway, Core Note, and Atomic Note templates in `900-Templates/` are filled with these placeholders when the plugin creates a note. Paper metadata is read from the Literature note's frontmatter.

| Placeholder | Value |
| --- | --- |
| `{{citekey}}` | Paper citekey, with any leading `@` removed |
| `{{id}}` | Random 16-character note id |
| `{{title}}` | Literature note `title` (falls back to the citekey) |
| `{{date}}` | Today's date, `YYYY-MM-DD` |
| `{{source_path}}` | Vault path of the Literature note, without `.md` |
| `{{source_name}}` | Basename of the Literature note, for short wiki-links |
| `{{report1_name}}` / `{{report2_name}}` | Basenames of Report 1 and Report 2 (default `Deep Research-{{citekey}}` / `External Research-{{citekey}}`) |
| `{{doi_or_url}}` | `doi`, or `url` if there is no DOI |
| `{{short_name}}` | `short-name` (or `shortName`) |
| `{{authors_yaml}}` | `authors` (or `author`) as a YAML list, or `[]` |
| `{{venue}}` | `publication`, or `venue` with `[[ ]]` removed |
| `{{paper_type}}` | `publish-type` (or `paper-type`) |
| `{{atomic_title}}` | Title of the atomic note being created (Atomic Note template only) |

The citekey is read from the configured citation key (`citation-key` by default), then `citation-key`, `citekey`, or `zotero-key`.

---

## 📡 Webhook quick start

1. Open **Settings → Zotero Annotation Reviewer → Modular Webhooks**.
2. Click **“+ Create Webhook”**:
   - Fill in `Name`, `Icon`, URL, HTTP method, and content type (`json`, `form`, or `text`).
   - Add headers as needed (supports plain text and Obsidian `secretStorage` secrets).
   - Define input variables if you want to be prompted at trigger time (e.g. `custom`, `id`).
3. Use placeholders in the body template:
   - `{{filename}}`, `{{path}}`, `{{content}}`, `{{timestamp}}`, and `{{frontmatter.KEY}}`.
   - `{{citekey}}`, `{{path.zotero_note}}`, `{{path.report1}}`, `{{path.report2}}`, `{{path.takeaway}}`, `{{path.core_note}}`, `{{prompt.ID}}`, and `{{path.prompt.ID}}`.
   - `{{custom}}`, `{{id}}` for your defined runtime input variables.
4. Trigger the webhook from the Assistant dashboard, `ConnectorModal`, the `Trigger Webhook...` command, or the optional sidebar ribbon icon.

---

## 📅 CFP usage overview

- Configure **CFP** settings:
  - Set the CFP note folder (`CFP` by default), default tags (`cfp`), and optional `cfpCoreCsvPath` / `cfpCcfddlLocalPath` ranking files.
  - Add WikiCFP, CCFDDL, EasyChair, and OpenResearch URLs, and choose WikiCFP Series index letters and refresh intervals.
- Use the commands or settings buttons:
  - `Refresh CFP from websites` / `Refresh All Sources`.
  - `Refresh CFP from WikiCFP Conf Series (A–Z)`.
  - `Refresh CFP for this series` (from an active Series note).
  - `Add manual CFP` to create a one-off item.
  - `Show CFP list (next & history)` to browse upcoming and past CFPs by `submission_ddl`.

CFP notes and Series notes are designed to work seamlessly with Dataview tables and date queries out of the box.

---

## 🔍 Troubleshooting

### Images not displaying in Assistant view

**Symptoms:** Images appear broken or missing in the `zotero-assistant` dashboard.

**Solutions:**
1. **Verify image path configuration:**
   - Check that `zotero-image-path` in your note's frontmatter matches the "Image Output Path" setting in Zotero Integration (e.g. `Attachments/{{citekey}}`).
2. **Check the JSON map:**
   - Open your literature note and verify the `zotero-assistant` code block contains a valid JSON map `{ "annotation-id": "relative/path/to/image.png" }` using Vault-relative paths.
3. **Verify image files exist:**
   - Check that image files exist at the expected paths in your Vault attachment folder.

### Webhook not triggering

**Symptoms:** Webhook button does nothing, or an error notice appears when triggering.

**Solutions:**
1. **Check webhook configuration:**
   - Verify the URL, HTTP method, and headers (especially `secretStorage`-backed `Authorization` headers).
2. **Verify input variables:**
   - Ensure variable names in your template match those configured on the webhook profile.
3. **Enable Webhook Debug Mode:**
   - Toggle `webhookDebugMode` in settings and inspect request URL, headers, and body in the Obsidian Developer Console (`Ctrl/Cmd + Shift + I`).

### CFP refresh not working

**Symptoms:** CFP notes are not updating, or refresh commands produce no changes.

**Solutions:**
1. **Check source URLs and ranking files:**
   - Verify WikiCFP/CCFDDL/EasyChair/OpenResearch URLs and any configured Vault-relative `CORE.csv` / `allconf.yml` paths.
2. **Check refresh intervals and Series frontmatter:**
   - Automatic refreshes respect configured intervals (default 5 days for URLs, 30 days for Series); Series notes require a valid `series-url` frontmatter field for single-series refresh.

### Project linker not finding projects

**Symptoms:** Project picker shows an empty list or cannot find project notes.

**Solutions:**
1. **Check projects folder and Dashboard layout:**
   - Verify the "Projects Folder" setting is Vault-relative and each project subfolder contains `<ProjectsFolder>/<ProjectDir>/Dashboard.md` (or markdown notes under that folder when using the Assistant project picker).
2. **Verify project ID key:**
   - Ensure `projectIdKey` / `project_name` matches the frontmatter key in your project notes.

### Paper House Library lists the wrong notes

**Symptoms:** Reports, Takeaways, or Core Notes appear as papers in the Library tab, or an imported paper is missing.

**Solutions:**
1. **Check the source tags:**
   - Zotero imports should carry the `source/📜Zotero` tag (the built-in Zotero template adds it). AI-generated companions should carry `source/🤖AI`.
2. **Check custom companion notes:**
   - Without the `source/📜Zotero` tag, a note is also skipped when its `type` is a companion type (`paper-note`, `deep-report`, `external-report`, `takeaway`), when it has `linked-notes`, or when its file name starts with `Takeaway-`, `Deep Research-`, or `External Research-`. A custom companion note that matches none of these and sits under the Literature folder will show up as a paper; add `source/🤖AI` to it.

### Assistant view not rendering

**Symptoms:** `zotero-assistant` code block displays as plain code instead of an interactive dashboard.

**Solutions:**
1. **Verify code block syntax and plugin state:**
   - Ensure the block uses ` ```zotero-assistant ` with valid JSON inside, and verify **Zotero Annotation Reviewer** is enabled in **Settings → Community Plugins**.
2. **Verify Zotero & Better BibTeX:**
   - Ensure Zotero Desktop with Better BibTeX is running on the configured port (`23119` by default) when fetching live annotations.

### DOMException: removeChild error

**Symptoms:** Console shows `DOMException: Failed to execute 'removeChild' on 'Node': The node to be removed is no longer a child of this node. Perhaps it was moved in a 'blur' event handler?`

**Explanation:** This error originates from **Obsidian's internal property editor** (specifically the link autocomplete feature) inside Obsidian's core code (`app.js`, `enhance.js`), not from this plugin.

**Impact:** **None.** All plugin features continue to work normally, and this cosmetic Obsidian core warning can be safely ignored.

### General debugging tips

- **Check console:** Open Obsidian Developer Console (`Ctrl/Cmd + Shift + I`) and filter by `[ZoteroService]`, `[CFP]`, `[Paper Hub]`, `[Paper Digest]`, or `[Webhook Debug]`.
- **Check Obsidian version:** Plugin requires Obsidian 0.15.0 or newer.

---

## 📚 Further documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** – System architecture, module map, typed data structures, and Mermaid data flows.
- **[DEBUGGING.md](docs/DEBUGGING.md)** – Debugging guide, diagnostics, and `tests/` execution instructions.
- **[pkm/project-brief.md](pkm/project-brief.md)** – Project brief, engineering objectives, module map, and repository layout notes.
- **[pkm/feat - paper digest triage window.md](pkm/feat%20-%20paper%20digest%20triage%20window.md)** – Paper House Digest triage window specification.
- **[pkm/requirements-project-id-key.md](pkm/requirements-project-id-key.md)** – Project linker `projectIdKey` behavior and configuration.
- **[pkm/requirements-project-picker-dashboard-and-display.md](pkm/requirements-project-picker-dashboard-and-display.md)** – Project picker `Dashboard.md` discovery and display-name rules.
- **[pkm/requirements-webhook-quick-access-and-input-variables.md](pkm/requirements-webhook-quick-access-and-input-variables.md)** – Modular webhook quick access and runtime input variable requirements.
- **[pkm/requirements-cfp-wikicfp-series-and-notes.md](pkm/requirements-cfp-wikicfp-series-and-notes.md)** – CFP WikiCFP Conference Series and Dataview requirements.
- **[pkm/requirements-cfp-ranking-ccf-core.md](pkm/requirements-cfp-ranking-ccf-core.md)** – CCF and CORE conference series ranking specification.
- **[pkm/requirements-assistant-cfp-link-and-year-alignment.md](pkm/requirements-assistant-cfp-link-and-year-alignment.md)** – CFP matching and year alignment in Assistant view.
- **[pkm/requirements-assistant-cfp-context-simplification.md](pkm/requirements-assistant-cfp-context-simplification.md)** – Simplified CFP context display in Assistant view.
