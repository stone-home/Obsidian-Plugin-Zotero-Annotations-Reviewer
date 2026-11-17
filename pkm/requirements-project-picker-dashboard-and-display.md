# Feature requirement: Project picker — Dashboard-only list and display name

## Summary

The `project-picker` code block shows “Linked Projects” and an “Add Project” (+) button. When the user clicks “+”, the suggest list SHALL show only one entry per project: the `Dashboard.md` file inside each project subdirectory. Each entry SHALL display a meaningful name from that file’s frontmatter (`project_name` or `title`), not the filename. Clicking a linked project pill SHALL open the correct project note by path.

## User need

- Projects are organized as folders under a configured projects folder; each project folder contains exactly one `Dashboard.md` that represents that project.
- “Dashboard” as a filename is not meaningful in the list; users want to see the project’s real name (e.g. from frontmatter).
- Clicking a linked project must open the project note, not a wrong target (e.g. alias text or malformed path).

## Requirements

### REQ-1: Only list Dashboard.md per project directory

1. When the user clicks “Add Project”, the suggest list SHALL include only files that:
   - Are located at `<projectsFolder>/<projectDir>/Dashboard.md` (exactly one level of subdirectory under the configured projects folder).
   - Have extension `.md` and basename `Dashboard`.
2. No other markdown or non-markdown files under the projects folder SHALL appear in the list (e.g. no `Projects/MyProject/Other.md` or `Projects/MyProject/readme.pdf`).

### REQ-2: Display name from frontmatter

1. For each listed `Dashboard.md`, the label shown in the suggest list SHALL be:
   - The value of frontmatter key **`project_name`** if present and non-empty; else
   - The value of frontmatter key **`title`** if present and non-empty; else
   - The **project directory name** (the parent folder of `Dashboard.md`); never the literal “Dashboard”.
2. Search/filter when typing in the modal SHALL match against this display name and the file path.

### REQ-3: Linked project click opens correct note

1. Stored values in frontmatter remain full wikilinks: `[[path]]` or `[[path|alias]]`.
2. When the user clicks a linked project pill, the plugin SHALL open the note using only the **path** part of the link (content inside `[[...]]`, and the part before `|` if present). It SHALL NOT pass the full wikilink string or the alias part to the app’s open API, so that the correct file is opened.

## Acceptance criteria

- [ ] Clicking “Add Project” shows only one entry per project subfolder: the file `Dashboard.md` in that folder.
- [ ] Each entry shows the project name from `project_name` or `title` in that `Dashboard.md`, or the project dir name if both are missing.
- [ ] Adding a project and storing the link (path and optional alias) works as before; only the list source and display text change.
- [ ] Clicking a linked project pill opens the correct project note (by path); no wrong target (e.g. “alias]]” or “path|alias” as filename).

## Implementation notes

- **File:** `src/ui/project-selector.ts`
- **Project list:** Filter vault files to those at `<projectsFolder>/<dirname>/Dashboard.md` (one level down); exclude all other files.
- **Display name:** `metadataCache.getFileCache(file).frontmatter['project_name']` or `['title']`, else parent folder name from path.
- **Click navigation:** Before calling `workspace.openLinkText(linkText, sourcePath)`, strip `[[` and `]]` from the stored value and use only the path (split by `|` and take the first part).
