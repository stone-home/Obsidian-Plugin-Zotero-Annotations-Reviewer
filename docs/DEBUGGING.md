# Debugging Guide

This guide helps developers troubleshoot issues in the Zotero Annotation Reviewer plugin.

---

## Common Issues

### 1. Plugin Not Loading

**Symptoms:**
- Plugin doesn't appear in Community Plugins list
- Error in console: "Failed to load plugin"

**Debugging Steps:**

1. **Check Build Output:**
   ```bash
   npm run build
   ```
   Verify `main.js` and `styles.css` are generated in the plugin root.

2. **Check Manifest:**
   - Verify `manifest.json` has correct `id`, `version`, and `minAppVersion`
   - Ensure `main` field points to `main.js`

3. **Check Console:**
   - Open Obsidian Developer Console (`Ctrl/Cmd + Shift + I`)
   - Look for errors during plugin load
   - Check for missing dependencies

4. **Verify Plugin Folder:**
   - Ensure plugin is in correct location:
     - macOS: `~/Library/Application Support/obsidian/plugins/zotero-annotation-reviewer/`
     - Windows: `%APPDATA%\Obsidian\plugins\zotero-annotation-reviewer\`
     - Linux: `~/.config/obsidian/plugins/zotero-annotation-reviewer/`

---

### 2. Zotero Connection Issues

**Symptoms:**
- "Failed to fetch annotations"
- "No citation key found"
- Timeout errors

**Debugging Steps:**

1. **Verify Zotero is Running:**
   - Check Zotero desktop app is open
   - Verify Better BibTeX extension is installed and enabled

2. **Check Port Configuration:**
   - Default port is `23119`
   - Verify in plugin settings: `Settings → Zotero Annotation Reviewer → General → Zotero Port`
   - Test connection:
     ```bash
     curl http://localhost:23119
     ```

3. **Check Citation Key:**
   - Open note with `zotero-assistant` block
   - Verify frontmatter contains `citation-key` (or configured key name)
   - Check console for: `[Zotero] Citation key: <key>`

4. **Inspect JSON-RPC Calls:**
   - Open Developer Console
   - Look for `[Zotero]` prefixed logs
   - Check network tab for requests to `localhost:23119`

**Common Fixes:**
- Restart Zotero
- Reinstall Better BibTeX extension
- Check firewall blocking port 23119

---

### 3. Image Display Issues

**Symptoms:**
- Images appear broken in Assistant view
- Image paths are incorrect
- Images not found

**Debugging Steps:**

1. **Verify Image Map JSON:**
   - Open note with `zotero-assistant` block
   - Check code block contains valid JSON: `{ "annotation-id": "relative/path.png" }`
   - Validate JSON syntax (no trailing commas, proper quotes)

2. **Check Image Paths:**
   - Verify `zotero-image-path` in frontmatter matches Zotero Integration setting
   - Ensure paths are relative to vault root
   - Check paths use forward slashes (`/`)

3. **Verify Files Exist:**
   ```bash
   # In vault root, check if image exists
   ls -la "Attachments/CiteKey/image.png"
   ```

4. **Check Console:**
   - Look for `[Parser]` logs showing parsed image map
   - Check for file not found errors

**Common Fixes:**
- Re-import note from Zotero Integration
- Update Zotero Integration template to include image map
- Verify Image Output Path setting matches template

---

### 4. Webhook Failures

**Symptoms:**
- Webhook button does nothing
- HTTP errors (400, 401, 500)
- Template variables not substituted

**Debugging Steps:**

1. **Check Webhook Configuration:**
   - Verify URL is correct and accessible
   - Check HTTP method matches endpoint expectations
   - Validate headers (especially Authorization)

2. **Inspect Request:**
   - Open Developer Console → Network tab
   - Trigger webhook
   - Check request URL, method, headers, body
   - Verify body template was filled correctly

3. **Check Template Variables:**
   - Verify placeholders match available variables
   - Check `{{frontmatter.KEY}}` keys exist in note frontmatter
   - Ensure input variables are provided if required

4. **Test Template:**
   ```javascript
   // In console, test template filling
   const template = '{"filename": "{{filename}}"}';
   const variables = {'{{filename}}': 'test.md'};
   // Should result in: {"filename": "test.md"}
   ```

5. **Check Secret Headers:**
   - Verify secrets exist in Obsidian `secretStorage`
   - Check secret key matches webhook header configuration

**Common Fixes:**
- Fix JSON syntax in body template
- Ensure Content-Type header matches body format
- Verify external API endpoint is accessible
- Check CORS settings if calling from browser context

---

### 5. CFP Refresh Issues

**Symptoms:**
- CFP notes not updating
- Refresh commands do nothing
- Parsing errors

**Debugging Steps:**

1. **Check Source URLs:**
   - Verify URLs in settings are valid and accessible
   - Test URLs in browser:
     ```bash
     curl "http://www.wikicfp.com/cfp/call?conference=machine%20learning"
     ```

2. **Check Console Logs:**
   - Look for `[CFP]` prefixed logs
   - Check for network errors or parsing failures
   - Verify refresh intervals are respected

3. **Verify Folder Permissions:**
   - Ensure CFP folder exists and is writable
   - Check folder path in settings (relative to vault root)

4. **Test Individual Parsers:**
   - Each source has its own parser service
   - Check specific parser logs:
     - `[CFP] WikiCFP: ...`
     - `[CFP] CCFDDL: ...`
     - `[CFP] EasyChair: ...`
     - `[CFP] OpenResearch: ...`

5. **Check Rate Limiting:**
   - WikiCFP has delays (5-10s between pages, 800ms between events)
   - Series refresh has 30-minute gap between series
   - Check if delays are causing timeouts

**Common Fixes:**
- Update URLs if sources changed structure
- Check if sources require authentication
- Verify network connectivity
- Increase refresh intervals if hitting rate limits

---

### 6. Dataview Integration Issues

**Symptoms:**
- Assistant script not executing
- Dataview queries fail
- Related notes section empty

**Debugging Steps:**

1. **Verify Dataview Plugin:**
   - Check Dataview is installed and enabled
   - Test Dataview queries in a note

2. **Check Assistant Script:**
   - Settings → Zotero Annotation Reviewer → Zotero & Highlights → Assistant Custom JS
   - Verify script syntax is valid JavaScript
   - Test script in DataviewJS block directly

3. **Check Console:**
   - Look for Dataview execution errors
   - Check for `[Dataview]` logs

4. **Verify Script Context:**
   - Script has access to: `container`, `file`, `app`
   - Ensure script uses `dv` (Dataview API) correctly

**Common Fixes:**
- Fix JavaScript syntax errors
- Ensure Dataview queries match your vault structure
- Check file paths in queries are correct

---

## Debugging Workflow

### 1. Enable Debug Mode

Currently, the plugin uses console logging. To see more detailed logs:

1. Open Developer Console (`Ctrl/Cmd + Shift + I`)
2. Filter console by `[Zotero]`, `[CFP]`, `[Webhook]`, `[Parser]`
3. Check both Console and Network tabs

### 2. Check Logs

**Obsidian Logs:**
- macOS: `~/Library/Application Support/obsidian/obsidian.log`
- Windows: `%APPDATA%\Obsidian\obsidian.log`
- Linux: `~/.config/obsidian/obsidian.log`

**Plugin-Specific Logs:**
- Check console for prefixed logs: `[Zotero]`, `[CFP]`, `[Webhook]`
- Network tab for HTTP requests

### 3. Recommended Breakpoints

When debugging in VS Code or similar IDE, set breakpoints in:

**For Zotero Issues:**
- `src/services/zotero.ts:getAnnotations()` - Annotation fetching
- `src/services/zotero.ts:sendRpc()` - JSON-RPC communication

**For Webhook Issues:**
- `src/services/webhook.ts:triggerWebhook()` - Webhook execution
- `src/services/webhook.ts:fillTemplateRecursive()` - Template filling

**For CFP Issues:**
- `src/services/cfp.ts:refresh()` - CFP refresh orchestration
- `src/services/cfp-wikicfp.ts:fetchWikiCFP()` - WikiCFP parsing

**For UI Issues:**
- `src/ui/assistant.ts:render()` - Assistant view rendering
- `src/ui/highlights.ts:onOpen()` - Highlight modal display

### 4. File to Check First

When errors occur, check these files in order:

1. **Console Output** - Immediate error messages
2. **`src/main.ts`** - Plugin initialization
3. **`src/types.ts`** - Type definitions (if TypeScript errors)
4. **Service files** - Based on error context:
   - Zotero → `src/services/zotero.ts`
   - Webhook → `src/services/webhook.ts`
   - CFP → `src/services/cfp.ts`
5. **UI files** - If UI-related:
   - Assistant → `src/ui/assistant.ts`
   - Highlights → `src/ui/highlights.ts`

---

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test -- src/services/zotero.test.ts
```

### Test Structure

Tests are located alongside source files with `.test.ts` extension:

- `src/services/zotero.test.ts` - Zotero service tests
- `src/services/webhook.test.ts` - Webhook service tests
- `src/services/cfp.test.ts` - CFP service tests
- `src/utils/parser.test.ts` - Parser utility tests

### Mocking

Obsidian API is mocked in `__mocks__/obsidian.ts`. To add new mocks:

1. Check existing mocks in `__mocks__/obsidian.ts`
2. Add missing Obsidian API methods as needed
3. Ensure mocks return appropriate types

### Writing Tests

Example test structure:

```typescript
import { ZoteroService } from './zotero';

describe('ZoteroService', () => {
  let service: ZoteroService;

  beforeEach(() => {
    service = new ZoteroService(23119);
  });

  it('should fetch annotations', async () => {
    const annotations = await service.getAnnotations('Test2020');
    expect(annotations).toBeDefined();
  });
});
```

---

## Development Mode

### Running in Development

```bash
# Watch mode (rebuilds on file changes)
npm run dev

# Production build
npm run build

# Type checking only
npm run lint
```

### Hot Reload

1. Run `npm run dev` in terminal
2. Make changes to TypeScript files
3. Files auto-rebuild
4. Reload plugin in Obsidian: `Settings → Community Plugins → Zotero Annotation Reviewer → Reload`

### Debugging in VS Code

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Jest Debug",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

---

## Performance Debugging

### Slow Operations

1. **CFP Refresh:**
   - Check network delays (WikiCFP has 5-10s delays)
   - Verify refresh intervals aren't too frequent
   - Check if multiple refreshes are running simultaneously

2. **Zotero Queries:**
   - Large libraries may take time
   - Check if Better BibTeX is indexing
   - Verify Zotero isn't busy with other operations

3. **Dataview Queries:**
   - Complex queries on large vaults can be slow
   - Check Dataview query performance
   - Consider optimizing queries

### Memory Issues

- Check for memory leaks in long-running operations
- Verify services are properly cleaned up
- Check for circular references in data structures

---

## Getting Help

1. **Check Existing Issues:**
   - GitHub Issues: https://github.com/stone-home/Obsidian-Plugin-Zotero-Annotations-Reviewer/issues

2. **Create Debug Report:**
   - Include Obsidian version
   - Include plugin version
   - Include console logs
   - Include steps to reproduce

3. **Check Documentation:**
   - `README.md` - User documentation
   - `ARCHITECTURE.md` - Architecture details
   - `docs/requirements-*.md` - Feature requirements

---

## Quick Reference

### Console Commands

```javascript
// In Obsidian Developer Console

// Check plugin instance
app.plugins.plugins['zotero-annotation-reviewer']

// Check settings
app.plugins.plugins['zotero-annotation-reviewer'].settings

// Trigger CFP refresh manually
app.plugins.plugins['zotero-annotation-reviewer'].cfpService.refresh()

// Check active file
app.workspace.getActiveFile()

// Check file cache
app.metadataCache.getFileCache(file)
```

### Common Error Messages

- `"No citation key found"` → Check note frontmatter for `citation-key`
- `"Failed to fetch annotations"` → Check Zotero connection and port
- `"Webhook has no URL"` → Configure webhook URL in settings
- `"CFP folder does not exist"` → Create folder or check path setting
- `"Dataview is not available"` → Install and enable Dataview plugin
