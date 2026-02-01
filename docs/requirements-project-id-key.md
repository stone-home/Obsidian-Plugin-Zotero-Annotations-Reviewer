# Feature requirement: Project ID key (link label property)

## Summary

Allow the user to specify which frontmatter property on **project notes** is used to fetch the project ID (or display label). When adding a project link, that property’s value is used as the link text instead of the note’s filename.

## User need

- Project notes may use a canonical ID in frontmatter (e.g. `project_id`, `uuid`, `alias`, `project_code`).
- Users want links to show that ID as the visible text (e.g. `[[My Project Note|PRJ-001]]`) instead of the note title/basename.
- The property name must be configurable because vaults use different frontmatter schemas.

## Requirement

**REQ: Configurable project ID property**

1. **Setting**  
   The plugin SHALL provide a setting (e.g. “Project ID Key”) that specifies the frontmatter key name to read from the **selected project note** when building the wiki link.

2. **Behavior when key is set**  
   When the user adds a project:
   - If the project note’s frontmatter contains the configured key, the stored link SHALL be `[[<note path/basename>|<value of that key>]]`.
   - The value is used as the link label (display text).

3. **Behavior when key is missing or empty**  
   If the key is not set in settings, or the project note has no frontmatter for that key, the stored link SHALL be `[[<note path/basename>]]` (no custom label).

4. **Defaults**  
   The default value for the setting SHALL be a sensible key name (e.g. `project_id`) and SHALL be documented in the setting description.

## Acceptance criteria

- [ ] Settings UI includes a text field for “Project ID Key” (or equivalent label) with a clear description of what it does (read from project note, used as link label).
- [ ] Adding a project whose note has the configured key in frontmatter stores `[[basename|value]]` in the current note’s project list.
- [ ] Adding a project whose note lacks the key (or key is empty) stores `[[basename]]`.
- [ ] The chosen key is persisted and used consistently across sessions.

## Implementation notes

- **Where it’s used:** Project selector `addProject()` (e.g. `project-selector.ts`): read `settings.projectIdKey`, then `projectCache.frontmatter[projectIdKey]` on the selected project file.
- **Related setting:** “Project Frontmatter Key” is the key on the **current** note where the list of project links is stored; “Project ID Key” is the key on each **project** note used to get the link label.
