# Zotero Annotation Reviewer

**Zotero Annotation Reviewer** is an Obsidian plugin that enhances the workflow with Zotero Integration by providing tools to review, organize, and send annotation data directly from Obsidian notes.

## Project Description

A companion plugin for the official [Zotero Integration](https://github.com/mgmeyers/obsidian-zotero-integration) plugin. While Zotero Integration handles pulling data from Zotero, this plugin focuses on *reviewing*, *organising* and *sending* that data from inside Obsidian, making it easier to work with academic annotations, manage conference CFPs, and integrate with external systems via webhooks.

---

## ✨ Main features

- **Highlight & image review dashboard**
  - A markdown code block (` ```zotero-assistant```) renders an interactive panel inside your literature note.
  - Lists all annotations from Zotero Integration (text, images, ink, notes).
  - Shows metadata (title, authors, venue, year) at the top.
  - Provides one-click actions to convert any highlight / image into an atomic fleeting note.

- **Robust image resolution**
  - Uses a JSON map between annotation IDs and image relative paths to avoid broken image links.
  - Works with a stable `zotero-image-path` convention (`Attachments/{{citekey}}`) so all assets for a paper live in one folder.

- **Atomic notes & fleeting notes**
  - Each annotation can be turned into a separate note in a configurable “Fleeting Notes” folder.
  - Frontmatter for generated notes includes citation key, links back to the source paper, and other metadata configured in settings.

- **Project linker**
  - A `project-picker` code block renders a small UI to link the current note to one or more “project” notes.
  - Linked projects are stored in frontmatter under a configurable key (e.g. `projects`), and displayed as clickable pills.
  - A “Projects Folder” setting defines where project notes live; project labels can be taken from a custom frontmatter key (e.g. `project_id`).

- **Modular webhook system**
  - Configure multiple webhooks, each with:
    - Name, icon and visibility flag (“Show in Assistant”).
    - HTTP method (`GET/POST/PUT/DELETE`), body template and headers.
    - Optional **input variables** that prompt the user before sending (e.g. `{{label}}`, `{{id}}`).
  - Body templates can be JSON, text or form-encoded and support placeholders:
    - `{{filename}}`, `{{path}}`, `{{content}}`, `{{timestamp}}`.
    - `{{frontmatter.KEY}}` for any frontmatter field.
    - Custom `{{name}}` variables from the webhook’s input variable list.
  - Webhooks can be triggered:
    - From the Assistant view.
    - From a command palette command.
    - From a ribbon icon (optional setting).

- **CFP (Call For Papers) management**
  - Dedicated “CFP” settings tab to manage:
    - URL-based sources (WikiCFP, CCFDDL, EasyChair, OpenResearch).
    - WikiCFP Conference Series (A–Z) index.
    - CFP note folder, default tags and refresh intervals.
  - Each CFP is stored as a single note under a `CFP` folder, optionally grouped by *series* (e.g. `CFP/WAIFI/WAIFI 2016.md`).
  - Frontmatter schema designed for Dataview:
    - `acronym`, `full-name`, `location`, `series`, `start`, `end`, `submission_ddl`, `cfp-source`, `url`, `tags`.
    - `start`, `end` and `submission_ddl` are normalised to `YYYY-MM-DD` when possible.
  - WikiCFP Series integration:
    - Scans Series index pages A–Z (letters selectable in settings) and creates **Series notes** like `CFP/WAIFI/WAIFI Series.md`.
    - Each Series note stores `series-url` (programUrl), a consistent tag set, and a Dataview table of all events in that series.
    - A DataviewJS button in each Series note calls back into the plugin via `window.__ZoteroAnnotationReviewerCFP.refreshSeries(programUrl, seriesAcronym)` to refresh events on demand.
    - A daily job refreshes 10–20 oldest series with at least a 30-minute gap between requests to reduce crawler risk.

---

## ⚙️ Prerequisites

- **Obsidian** v0.15.0 or higher
- **Node.js** v18+ (for development)
- **Dataview** plugin installed and enabled
- **Zotero Integration** plugin installed and enabled
- **Zotero** desktop application with Better BibTeX extension
- Zotero Integration must:
  - Export notes using a template that:
    - Writes `citation-key` and `zotero-image-path` to frontmatter.
    - Embeds a `zotero-assistant` code block containing a JSON map `{ annotationId: imageRelativePath }`.
  - Use a consistent **Image Output Path**, for example: `Attachments/{{citekey}}`.

> **Important**  
> `zotero-image-path` in your import template must match the “Image Output Path” you configure in Zotero Integration (e.g. `Attachments/{{citekey}}`).

## 🛠️ Tech Stack

- **Language:** TypeScript (ES6+)
- **Framework:** Obsidian Plugin API
- **Build Tool:** esbuild
- **Testing:** Jest with ts-jest, jsdom environment
- **Code Quality:** ESLint, Prettier
- **Key Libraries:**
  - `obsidian` - Obsidian plugin API
  - `@codemirror/*` - Code editor components for settings UI
  - `date-fns` - Date manipulation and formatting
  - `js-yaml` - YAML parsing for CFP sources
  - `markdown-note-orm` - Markdown note manipulation
  - `winston` - Logging (if enabled)

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
   
   # Build the plugin
   npm run build
   
   # Copy to your Obsidian plugins folder
   # On macOS: ~/Library/Application Support/obsidian/plugins/zotero-annotation-reviewer/
   # On Windows: %APPDATA%\Obsidian\plugins\zotero-annotation-reviewer\
   # On Linux: ~/.config/obsidian/plugins/zotero-annotation-reviewer/
   ```

### Basic setup workflow

1. **Configure Zotero Integration**
   - In Zotero Integration settings:
     - Set **Image Output Path** to something like `Attachments/{{citekey}}`.
     - In your import format’s **Note Content** template:
       - Add frontmatter fields including `citation-key` and `zotero-image-path`.
       - Add a `zotero-assistant` code block that maps annotation IDs to image paths.
    - **Copy and Paste** the following template into the **Note Content** area
`````jinja2
---
citation-key: {{citekey}}
zotero-image-path: "{{imageOutputPath}}"
title: "{{ title | replace('"', '\\"') }}"
type: literature
aliases:
authors:
{%- set authorList = authors.split(",") -%}
{%- if authorList.length > 0 %}  
	{%- for author in authorList -%}  
		{% set loopIndex = loop.index | string %}  
   - {{author | trim | replace(" ", "-") | replace(".", "")}}  
	{%- endfor -%}  
{%- endif %}
date: {{date | format("YYYY-MM-DD")}}
year: {{date | format("YYYY")}}
publication: "{{publicationTitle or proceedingsTitle or conferenceName}}"
doi: "{{DOI}}"
url: "{{url}}"
tags:
  - source/📜Zotero
  - type/source
icon: {% if itemType == "conferencePaper" -%}
 LiNewspaper
{%- elif itemType == "journalArticle" -%}
 FasBookJournalWhills
{%- else -%}
 TiArticle
{%- endif %}
---

```zotero-assistant 
{ 
{%- set comma = joiner() -%} {%- for annotation in annotations -%} {%- if annotation.imageRelativePath -%} {{ comma() }} "{{annotation.id}}": "{{ annotation.imageRelativePath | replace('\\', '\\\\') }}" {%- endif -%} {%- endfor -%} 
}

```

## 📰 Abstract

{{abstractNote}}


# 🧱 Appendix
## 🔖 Tags in Zotero
{%- for t in tags %}
  - {{t.tag}}
{%- endfor %}
`````

2. **Enable Zotero Assistant**
   - Install and enable the plugin.
   - Open Obsidian settings → **Zotero Assistant** tab.
   - Configure:
     - Fleeting note folder.
     - Citation key name / annotation key name.
     - Project settings (projects folder + keys).
     - Webhook profiles (optional).
     - CFP settings (optional).

3. **Import a paper from Zotero**
   - Use Zotero Integration (`Ctrl/Cmd + P` → `Zotero Integration: Create Note`) to generate a literature note.
   - The note frontmatter and `zotero-assistant` block will be created by your template.

4. **Use the Assistant view**
   - Open the imported note.
   - The `zotero-assistant` code block will render as a dashboard:
     - Fetch and display highlights/images.
     - Let you sort and filter annotations.
     - Provide buttons to create fleeting notes and trigger webhooks.

---

## 📡 Webhook quick start

1. Open **Settings → Zotero Assistant → Modular Webhooks**.
2. Click **“+ Create Webhook”**:
   - Fill in `Name`, `Icon`, URL, HTTP method and content type.
   - Add headers as needed (supports plain text and Obsidian `secretStorage` backed secrets).
   - Define input variables if you want the user to be prompted (e.g. `custom`, `id`).
3. Use placeholders in the body template:
   - `{{filename}}`, `{{path}}`, `{{content}}`, `{{timestamp}}`.
   - `{{frontmatter.status}}`, `{{frontmatter.project_id}}`, etc.
   - `{{custom}}`, `{{id}}` for your defined input variables.
4. Trigger the webhook:
   - From the Assistant dashboard.
   - From the “Trigger Webhook…” command.
   - From the optional ribbon icon (toggle in settings).

---

## 📅 CFP usage overview

- Configure **CFP** settings:
  - Set CFP note folder (`CFP` by default) and default tags (`cfp`).
  - Add WikiCFP / CCFDDL / EasyChair / OpenResearch URLs.
  - Choose Series index letters and intervals.
- Use the commands or settings buttons:
  - `Refresh CFP from websites` / `Refresh All Sources`.
  - `Refresh CFP from WikiCFP Conf Series (A–Z)`.
  - `Refresh CFP for this series` (from a Series note).
  - `Add manual CFP` to create a one-off item.
  - `Show CFP list` to see upcoming and past CFPs by `submission_ddl`.

CFP notes and Series notes are designed to work well with Dataview tables and date queries out of the box.

---

## 🔍 Troubleshooting

### Images not displaying in Assistant view

**Symptoms:** Images appear broken or missing in the `zotero-assistant` dashboard.

**Solutions:**
1. **Verify image path configuration:**
   - Check that `zotero-image-path` in your note's frontmatter matches the "Image Output Path" setting in Zotero Integration.
   - Both should use the same pattern (e.g. `Attachments/{{citekey}}`).

2. **Check the JSON map:**
   - Open your literature note and verify the `zotero-assistant` code block contains a valid JSON map: `{ "annotation-id": "relative/path/to/image.png" }`.
   - Ensure paths use forward slashes (`/`) and are relative to the vault root.

3. **Verify image files exist:**
   - Check that image files actually exist at the expected paths in your vault.
   - Use Obsidian's file explorer to navigate to the attachment folder.

### Webhook not triggering

**Symptoms:** Webhook button does nothing, or error appears when triggering.

**Solutions:**
1. **Check webhook configuration:**
   - Verify URL is correct and accessible.
   - Ensure HTTP method matches your endpoint's expectations.
   - Check headers are properly formatted (especially Authorization headers).

2. **Verify input variables:**
   - If webhook has input variables, ensure you're providing values when prompted.
   - Check that variable names in template match those defined in webhook settings.

3. **Check console for errors:**
   - Open Obsidian Developer Console (`Ctrl/Cmd + Shift + I`).
   - Look for error messages when triggering webhook.
   - Check network tab for HTTP response details.

### CFP refresh not working

**Symptoms:** CFP notes not updating, or refresh commands do nothing.

**Solutions:**
1. **Check source URLs:**
   - Verify WikiCFP/CCFDDL/EasyChair/OpenResearch URLs in settings are valid and accessible.
   - Some sources may require authentication or have rate limits.

2. **Verify folder permissions:**
   - Ensure the CFP folder exists and Obsidian has write permissions.
   - Check that folder path in settings is correct (relative to vault root).

3. **Check refresh intervals:**
   - Automatic refreshes respect the configured interval (default 5 days for URLs, 30 days for Series).
   - Use manual refresh commands if you need immediate updates.

4. **Series refresh issues:**
   - If Series notes aren't updating, check that `series-url` frontmatter is present and valid.
   - Verify the DataviewJS refresh button code matches your settings.

### Project linker not finding projects

**Symptoms:** Project picker shows empty list or can't find project notes.

**Solutions:**
1. **Check projects folder setting:**
   - Verify "Projects Folder" path in settings matches where your project notes are stored.
   - Path should be relative to vault root (e.g. `Projects` or `Areas/Projects`).

2. **Verify project ID key:**
   - If using custom project labels, ensure the "Project ID Key" setting matches the frontmatter key in your project notes.
   - Check that project notes have the expected frontmatter structure.

3. **Refresh project cache:**
   - Project list is cached; try reloading Obsidian if projects were recently added.

### Assistant view not rendering

**Symptoms:** `zotero-assistant` code block shows as plain code instead of interactive dashboard.

**Solutions:**
1. **Verify code block syntax:**
   - Ensure code block uses exactly three backticks: ` ```zotero-assistant `
   - Check that JSON map inside is valid JSON (no trailing commas, proper quotes).

2. **Check plugin is enabled:**
   - Go to Settings → Community plugins and verify "Zotero Annotation Reviewer" is enabled.
   - Try disabling and re-enabling the plugin.

3. **Verify Zotero Integration:**
   - Ensure Zotero Integration plugin is installed and enabled.
   - Check that Zotero is running and accessible (if using local Zotero connector).

### General debugging tips

- **Enable debug mode:** Check plugin settings for debug/logging options.
- **Check console:** Open Developer Console (`Ctrl/Cmd + Shift + I`) for detailed error messages.
- **Verify dependencies:** Ensure Dataview plugin is installed and enabled (required for some features).
- **Check Obsidian version:** Plugin requires Obsidian 0.15.0+; update if needed.
- **Review logs:** Check `%APPDATA%/Obsidian/obsidian.log` (Windows) or `~/Library/Application Support/obsidian/obsidian.log` (Mac) for errors.

---

## 📚 Further documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** – System architecture, code structure, and data flow diagrams.
- **[DEBUGGING.md](docs/DEBUGGING.md)** – Debugging guide, common issues, and testing instructions.
- `docs/requirements-project-id-key.md` – Project linker behaviour and configuration.
- `docs/requirements-webhook-quick-access-and-input-variables.md` – Detailed webhook requirements.
- `docs/requirements-cfp-wikicfp-series-and-notes.md` – CFP WikiCFP/Series/Dataview requirements.
- `docs/requirements-assistant-cfp-link-and-year-alignment.md` – CFP matching and linking in Assistant view.
- `docs/DOCUMENTATION_REVIEW.md` – Comprehensive documentation review and improvement plan.

