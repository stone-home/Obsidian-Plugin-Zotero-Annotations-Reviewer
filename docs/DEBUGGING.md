# Debugging Guide

This guide helps developers troubleshoot, test, and verify changes in the Zotero Annotation Reviewer plugin.

---

## Common Issues

### 1. Plugin Not Loading

**Symptoms:**
- Plugin does not appear in Community Plugins list
- Error in console: "Failed to load plugin"

**Debugging Steps:**

1. **Check Build Output:**
   ```bash
   npm run build
   ```
   Verify `main.js` and `styles.css` are generated in the plugin root.

2. **Check Manifest:**
   - Verify `manifest.json` has valid `id`, `version`, and `minAppVersion`.
   - Ensure `package.json` `main` points to `main.js`.

3. **Check Console:**
   - Open Obsidian Developer Console (`Ctrl/Cmd + Shift + I`) and inspect errors during plugin load.

4. **Verify Plugin Folder:**
   - macOS: `~/Library/Application Support/obsidian/plugins/zotero-annotation-reviewer/`
   - Windows: `%APPDATA%\Obsidian\plugins\zotero-annotation-reviewer\`
   - Linux: `~/.config/obsidian/plugins/zotero-annotation-reviewer/`

---

### 2. Zotero Connection & Paper House Digest Issues

**Symptoms:**
- "Failed to fetch annotations" or `Citation Key '...' not found`
- Paper House Digest shows Zotero or Translation Server offline

**Debugging Steps:**

1. **Verify Zotero & Better BibTeX:**
   - Confirm Zotero desktop is open with the Better BibTeX extension enabled on port `23119` (configurable under `Settings → Zotero Annotation Reviewer`).
   - Test local connectivity:
     ```bash
     curl http://127.0.0.1:23119/better-bibtex/json-rpc
     ```

2. **Verify Translation Server (for Paper House Digest):**
   - If accepting incoming papers via DOI/URL in **Paper House → Digest**, verify Zotero Translation Server is reachable on `http://127.0.0.1:1969` (or your configured URL).

3. **Check Citation Key:**
   - Open the Literature note and confirm frontmatter contains `citation-key` (or your configured `citationKeyName`).

4. **Inspect Console Logs:**
   - Filter Obsidian Developer Console by `[ZoteroService]` or `[Paper Digest]`.

---

### 3. Image Display Issues

**Symptoms:**
- Annotation images appear broken or missing in `zotero-assistant` or `HighlightModal`

**Debugging Steps:**

1. **Verify Image Map JSON:**
   - Check that the `zotero-assistant` block contains valid JSON `{ "annotation-id": "relative/path.png" }`.

2. **Check Image Paths:**
   - Verify `zotero-image-path` in frontmatter matches Zotero Integration's Image Output Path (e.g. `Attachments/{{citekey}}`) and uses forward slashes (`/`).

3. **Verify Files Exist:**
   ```bash
   ls -la "Attachments/CiteKey/image.png"
   ```

---

### 4. Paper Workspace, Templates & Connector Issues

**Symptoms:**
- Report 1 / Report 2 / Takeaway / Core Note tabs do not locate existing files
- Candidate atomic Zettels do not appear in `ConnectorModal`

**Debugging Steps:**

1. **Check Paper Workspace Path Patterns:**
   - Open `Settings → Zotero Annotation Reviewer → Paper Workspace` and verify `{{citekey}}` path templates match your Vault folders (`002-Literature/`, `003-Permanent/`, `900-Templates/`).

2. **Check Candidate Heading Syntax in Takeaway:**
   - `parseTakeawayCandidates()` expects headings matching `### Candidate <N>` followed by bullet fields such as `- **Link**: [[A - ...]]`, `- **Brief**: ...`, and `- **Evidence**: ...`.

3. **Check Vault Templates:**
   - Verify built-in templates and prompts exist in `900-Templates/` (created automatically on layout ready via `ensureBuiltinTemplatesInVault()`).

---

### 5. Webhook Failures

**Symptoms:**
- Webhook trigger fails with HTTP 4xx/5xx or unsubstituted placeholders

**Debugging Steps:**

1. **Enable Webhook Debug Mode:**
   - Turn on `webhookDebugMode` in plugin settings and inspect the `[Webhook Debug]` console group for the resolved URL, method, headers, and body.

2. **Check Placeholders & Secrets:**
   - Verify `{{frontmatter.KEY}}`, `{{citekey}}`, `{{path.*}}`, `{{prompt.*}}`, and custom input variables match your configuration, and confirm secret header keys exist in Obsidian `secretStorage`.

---

### 6. CFP Refresh & Ranking Issues

**Symptoms:**
- CFP notes do not update or CCF/CORE rank badges are missing

**Debugging Steps:**

1. **Check Source URLs & Local Rank Files:**
   - Verify WikiCFP, CCFDDL, EasyChair, and OpenResearch URLs, plus Vault-relative `cfpCoreCsvPath` (`CORE.csv`) and `cfpCcfddlLocalPath` (`allconf.yml`) if configured.

2. **Check Console Logs & Intervals:**
   - Filter console by `[CFP]` to inspect network/parser warnings and rate-limiting delays (5–10s between WikiCFP pages; >= 30-minute gap for daily staggered Series refreshes).

---

### 7. Dataview Integration Issues

**Symptoms:**
- Custom Assistant script or CFP Series DataviewJS table fails to render

**Debugging Steps:**

1. **Verify Dataview Plugin:**
   - Ensure the Obsidian Dataview plugin is installed and enabled, and check `[Dataview]` / `Dataview Script Execution Error` messages in the Developer Console.

---

## Debugging Workflow

### Recommended Breakpoints

- **Zotero JSON-RPC:** `src/services/zotero.ts` (`getAnnotations`, `getItemMetadata`, `sendRpc`)
- **Paper Workspace & Templates:** `src/services/paper-hub.ts` (`getPaperState`, `saveReportMarkdown`, `parseTakeawayCandidates`)
- **Vault Library & Connector:** `src/services/vault-library.ts` (`listLiteraturePapers`, `matchCandidatesAgainstVault`, `connectCandidateToVault`) and `src/ui/connector-modal.ts`
- **Paper House Digest:** `src/ui/digest-view.ts` and `src/services/digest-store.ts`
- **Webhooks:** `src/services/webhook.ts` (`triggerWebhook`, `fillTemplateRecursive`) and `src/ui/webhook-modals.ts`
- **CFP:** `src/services/cfp.ts` (`refresh`, `refreshWikiCFPSeries`, `findBestMatchingCFPForConference`)

---

## Testing

### Running Tests

```bash
# Run all test suites
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run a specific test suite in tests/
npm test -- tests/services/zotero.test.ts
```

### Test Structure

Automated tests live in the top-level `tests/` directory (strictly separated from production `src/`) and run under Jest + `ts-jest` in the `jsdom` environment:

- `tests/services/zotero.test.ts` - Zotero JSON-RPC service tests
- `tests/services/paper-hub.test.ts` - Paper Workspace and template/takeaway parsing tests
- `tests/services/vault-library.test.ts` - Vault Literature search and atomic-note connector tests
- `tests/services/digest-store.test.ts` - Paper Digest store lifecycle tests
- `tests/services/webhook.test.ts` - Modular webhook substitution and request tests
- `tests/services/cfp.test.ts` - CFP parsing, ranking, and conference matching tests
- `tests/utils/parser.test.ts` - Image map JSON parser tests

Both `src/**/*.ts` and `tests/**/*.ts` are checked under TypeScript `strict: true` and ESLint `@typescript-eslint/no-explicit-any: "error"`.

---

## Development Mode

### Quality & Build Commands

```bash
# Watch mode (rebuilds main.js & styles.css on file changes)
npm run dev

# TypeScript strict typecheck (no emit)
npm run typecheck

# ESLint check across src/ and tests/
npm run lint

# Prettier formatting check across src/ and tests/
npm run format:check

# Full production build (typecheck + esbuild production bundle)
npm run build
```

### Hot Reload in Obsidian

1. Run `npm run dev` in a terminal.
2. Edit TypeScript files under `src/`.
3. Reload the plugin in Obsidian (`Settings → Community Plugins → Zotero Annotation Reviewer` toggle or Hot Reload plugin).

---

## Getting Help

1. **Check Existing Issues:**
   - GitHub Issues: https://github.com/stone-home/Obsidian-Plugin-Zotero-Annotations-Reviewer/issues

2. **Create Debug Report:**
   - Include Obsidian version, plugin version, console logs, and minimal steps to reproduce.

3. **Check Documentation:**
   - [README.md](../README.md) - User documentation and setup guide
   - [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture and module map
   - [pkm/project-brief.md](../pkm/project-brief.md) - Project brief, layout adaptations, and index of `../pkm/requirements-*.md` specifications

---

## Quick Reference

### Console Commands

```javascript
// In Obsidian Developer Console

// Inspect plugin instance and settings
app.plugins.plugins['zotero-annotation-reviewer']
app.plugins.plugins['zotero-annotation-reviewer'].settings

// Trigger CFP refresh manually
app.plugins.plugins['zotero-annotation-reviewer'].cfpService.refresh()

// Inspect active file and frontmatter cache
const file = app.workspace.getActiveFile()
app.metadataCache.getFileCache(file)
```

### Common Error Messages

- `"No citation key found"` → Verify `citation-key` (or configured `citationKeyName`) in note frontmatter.
- `"Citation Key '...' not found."` → Verify Zotero is running with Better BibTeX on port `23119` and the item citekey matches.
- `"Webhook ... has no URL"` → Configure the webhook URL in `Settings → Modular Webhooks`.
- `"Dataview API not available."` → Install and enable the Obsidian Dataview plugin.
