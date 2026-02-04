# Zotero Assistant for Obsidian

**Zotero Assistant** is a companion plugin for the official [Zotero Integration](https://github.com/mgmeyers/obsidian-zotero-integration) plugin.  
Zotero Integration is responsible for pulling data out of Zotero; Zotero Assistant focuses on *reviewing*, *organising* and *sending* that data from inside Obsidian.

---

## ✨ Main features

- **Highlight & image review dashboard**
  - A markdown code block (` ```zotero-assistant `) renders an interactive panel inside your literature note.
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

## ⚙️ Requirements

- **Obsidian** with Dataview and the official **Zotero Integration** plugin installed.
- Zotero Integration must:
  - Export notes using a template that:
    - Writes `citation-key` and `zotero-image-path` to frontmatter.
    - Embeds a `zotero-assistant` code block containing a JSON map `{ annotationId: imageRelativePath }`.
  - Use a consistent **Image Output Path**, for example: `Attachments/{{citekey}}`.

> **Important**  
> `zotero-image-path` in your import template must match the “Image Output Path” you configure in Zotero Integration (e.g. `Attachments/{{citekey}}`).

---

## 🔧 Basic setup workflow

1. **Configure Zotero Integration**
   - In Zotero Integration settings:
     - Set **Image Output Path** to something like `Attachments/{{citekey}}`.
     - In your import format’s **Note Content** template:
       - Add frontmatter fields including `citation-key` and `zotero-image-path`.
       - Add a `zotero-assistant` code block that maps annotation IDs to image paths.
   - (The exact template can vary; see the `docs/` requirements files in this repo for up-to-date examples.)

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

## 📚 Further documentation

- `docs/requirements-project-id-key.md` – Project linker behaviour and configuration.
- `docs/requirements-webhook-quick-access-and-input-variables.md` – Detailed webhook requirements.
- `docs/requirements-cfp-wikicfp-series-and-notes.md` – CFP WikiCFP/Series/Dataview requirements.

