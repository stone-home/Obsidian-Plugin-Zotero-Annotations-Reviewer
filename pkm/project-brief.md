# Project Brief — Zotero Annotation Reviewer

## Project Identity

- **Plugin ID:** `zotero-annotation-reviewer`
- **Display Name:** Zotero Annotation Reviewer
- **Entry Class:** `ZoteroGKPlugin` (`src/main.ts`)
- **Current Version:** `1.9.0` (`minAppVersion`: `0.15.0`)
- **Runtime & Packaging:** Obsidian Desktop/Community Plugin bundled with `esbuild` (CommonJS target `es2018`) into root `main.js` and `styles.css`.
- **Purpose:** Companion Obsidian plugin for Zotero, Better BibTeX, and Obsidian Zotero Integration that unifies annotation review, atomic Zettelkasten synthesis, incoming paper digest triage, searchable Vault literature management, modular webhooks, project linking, and academic Call-for-Papers (CFP) tracking.

## Engineering Objectives & Acceptance Criteria

- **Repository Layout Alignment (`pm-repo-layout`):** Separate published technical documentation (`docs/`) from internal requirement specifications, feature backlogs, and project context (`pkm/`), and isolate automated test suites under `tests/` rather than co-locating `*.test.ts` files inside `src/`.
- **Strict TypeScript Hygiene (`nodejs-typescript`):** Enforce `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, `@typescript-eslint/no-explicit-any: "error"`, and `@typescript-eslint/ban-ts-comment: "error"` across both `src/**/*.ts` and `tests/**/*.ts`, eliminating all `any` types and `@ts-ignore` suppressions.
- **Dependency & Build Cleanliness:** Remove unused runtime dependencies (`winston`), ensure `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm test` pass cleanly with zero errors and zero warnings, and point `package.json#main` to root `main.js`.
- **Documentation Accuracy & Link Integrity:** Keep `README.md`, `docs/ARCHITECTURE.md`, `docs/DEBUGGING.md`, and `pkm/project-brief.md` synchronized with the current Paper House, Paper Workspace, Connector Modal, Vault-backed Templates & Prompts, Webhook, Project Picker, and CFP subsystems with zero broken relative links.

## Module Map

| Module | Source Path | Responsibility |
| --- | --- | --- |
| `ZoteroGKPlugin` | `src/main.ts` | Plugin lifecycle entry point, settings migration, code block processor registration (`zotero-assistant`, `project-picker`, `cfp-list`), command palette registration, background CFP refresh scheduling, template initialization, and lazy Paper House registration. |
| `PaperHubService` | `src/services/paper-hub.ts` | Resolves Paper Workspace paths (`literatureNote`, `report1`, `report2`, `takeaway`, `coreNote`), reads/writes Core Notes and Takeaway/Report markdown, extracts `code_url` from Report 2, parses Takeaway summaries and `### Candidate` atomic note proposals, and manages Vault-backed templates and prompts in `900-Templates/`. |
| `VaultLibraryService` | `src/services/vault-library.ts` | Indexes primary Literature notes across the Vault, powers weighted full-text/metadata search and same-venue discovery, matches Takeaway candidates and cited papers against existing Vault notes, and creates or links permanent atomic Zettels (`003-Permanent/`). |
| `DigestStore` & Digest Services | `src/services/digest-store.ts`, `src/services/digest-types.ts`, `src/services/digest-import.ts`, `src/services/digest-bib.ts`, `src/services/digest-translate.ts`, `src/services/digest-zotero.ts` | Manages `digest-store.json` state (`unchecked`, `accepted`, `rejected`), validates incoming JSONL batches and BibTeX imports, resolves metadata via Zotero Translation Server, and writes accepted items with direction tags and collections to local Zotero. |
| `PaperDigestView` (`Paper House`) | `src/ui/digest-view.ts`, `src/ui/digest-settings.ts` | Popout workspace view (`zotero-paper-digest`) providing the two-tab `[Digest | Library]` interface for keyboard-driven incoming paper triage and searchable Vault Literature Library browsing. |
| `AssistantView` | `src/ui/assistant.ts` | Renders the `zotero-assistant` code block inside Literature notes as a Paper Workspace dashboard with metadata links, Report 1 / Report 2 / Takeaway / Core Note tabs, fleeting note status, CFP conference context, project pills, and webhook actions. |
| `ConnectorModal` | `src/ui/connector-modal.ts` | Interactive two-pane modal connecting synthesized Takeaway candidate Zettels and cited Vault papers to permanent atomic notes (`003-Permanent/`) and Core Note `linked-notes`. |
| `HighlightModal` | `src/ui/highlights.ts` | Fetches annotations and item metadata from Zotero to verify frontmatter fields and export, overwrite, or append highlight and image annotations into Fleeting Notes. |
| `ZoteroService` | `src/services/zotero.ts` | Communicates with Zotero Desktop over Better BibTeX JSON-RPC (`item.search`, `user.groups`, `item.export`, `item.attachments`) using typed RPC payload narrowing. |
| `ZoteroConnectorService` | `src/services/zotero-connector.ts` | Integrates with the Obsidian Zotero Desktop Connector (`obsidian-zotero-desktop-connector`) to trigger paper imports and synchronize the Zotero note Jinja/Nunjucks template in the Vault. |
| `ObsidianService` | `src/services/obsidian.ts` | Creates and updates Literature and Fleeting notes via `markdown-note-orm` (`ObsidianNoteFactory`, `ZettelNoteModel`) and resolves local annotation image attachments by key or PDF coordinates. |
| `WebhookService` & Webhook Modals | `src/services/webhook.ts`, `src/ui/webhook-modals.ts` | Executes HTTP webhooks with recursive JSON/text/form placeholder substitution (`{{citekey}}`, `{{path.*}}`, `{{prompt.*}}`, `{{frontmatter.*}}`), `secretStorage` header resolution, and modal prompts (`WebhookSelectionModal`, `WebhookInputValueModal`). |
| `CFPService` & CFP Parsers/UI | `src/services/cfp.ts`, `src/services/cfp-core.ts`, `src/services/cfp-ccfddl.ts`, `src/services/cfp-wikicfp.ts`, `src/services/cfp-wikicfp-series.ts`, `src/services/cfp-easychair.ts`, `src/services/cfp-openresearch.ts`, `src/ui/cfp-list-view.ts`, `src/ui/cfp-list-modal.ts`, `src/ui/cfp-manual-modal.ts` | Fetches, parses, ranks (CORE CSV + CCF `allconf.yml`), stores, and matches academic Call-for-Papers events and Conference Series notes, exposing `window.__ZoteroAnnotationReviewerCFP.refreshSeries` for DataviewJS buttons. |
| `DataviewService` | `src/services/dataview.ts` | Wraps the optional Obsidian Dataview plugin API (`executeJs`) to run parameterized DataviewJS scripts safely inside Assistant dashboards. |
| Shared Settings & Utilities | `src/settings.ts`, `src/types.ts`, `src/ui/project-selector.ts`, `src/ui/inputs.ts`, `src/utils/parser.ts`, `src/utils/paths.ts`, `src/utils/series.ts` | Provides the tabbed plugin settings UI with CodeMirror 6 editors, shared domain interfaces and defaults, `project-picker` dashboard linking, Windows-safe JSON image map parsing, Vault path normalization, and conference series acronym extraction. |

## Repository Layout & Intentional Adaptations

- `src/` — Production TypeScript source files (`main.ts`, `types.ts`, `settings.ts`, `services/`, `ui/`, `utils/`) and source stylesheet (`src/styles.css`).
- `tests/` — Jest + `ts-jest` automated test suites and Obsidian API test doubles (migrated out of `src/` to maintain strict production/test separation).
- `docs/` — Published developer documentation ([docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md), [docs/DEBUGGING.md](../docs/DEBUGGING.md)) and PlantUML architecture diagrams (`docs/assets/*.puml`).
- `pkm/` — Internal project management brief, feature requirement specifications, and feature backlog notes.
- `playground/` — Local untracked Obsidian test vault / scratchpad directory (gitignored).
- **Intentional Adaptation — Tracked Root Release Artifacts:** Root `main.js` and `styles.css` are generated by `npm run build` and intentionally tracked in Git alongside `manifest.json` and `versions.json` so Obsidian Community Releases and BRAT installations work directly from repository tags/commits.
- **Intentional Adaptation — Host Skill Provisioning:** Root `AGENTS.md` and `ProjectCode` metadata are intentionally deferred to host-level `skill-manager install` rather than hand-authored inside plugin feature branches.

## Documentation & Requirement Index

### Published Documentation

- [README.md](../README.md) — User-facing overview, setup workflow, Paper House & Paper Workspace guide, webhook/CFP usage, and troubleshooting.
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — System architecture, module breakdown, Mermaid data flows, and extension points.
- [docs/DEBUGGING.md](../docs/DEBUGGING.md) — Developer debugging workflows, common error diagnostics, and test execution guide.

### PKM Requirements & Feature Specifications

- [feat - paper digest triage window.md](feat%20-%20paper%20digest%20triage%20window.md) — Paper Digest triage window specification (`digest-store.json`, JSONL/BibTeX ingestion, Translation Server & Zotero Local API workflow).
- [requirements-assistant-cfp-context-simplification.md](requirements-assistant-cfp-context-simplification.md) — Simplified CFP context resolution and display inside `zotero-assistant`.
- [requirements-assistant-cfp-link-and-year-alignment.md](requirements-assistant-cfp-link-and-year-alignment.md) — Conference acronym linking and year alignment between Literature notes and CFP notes.
- [requirements-cfp-ranking-ccf-core.md](requirements-cfp-ranking-ccf-core.md) — CCF (`allconf.yml`) and CORE (`CORE.csv`) conference series ranking enrichment.
- [requirements-cfp-wikicfp-series-and-notes.md](requirements-cfp-wikicfp-series-and-notes.md) — WikiCFP Conference Series A–Z indexing, Series notes, and staggered daily refresh.
- [requirements-project-id-key.md](requirements-project-id-key.md) — Custom `projectIdKey` frontmatter alias support for linked project pills.
- [requirements-project-picker-dashboard-and-display.md](requirements-project-picker-dashboard-and-display.md) — `Dashboard.md` project discovery and display-name resolution in `project-picker`.
- [requirements-webhook-quick-access-and-input-variables.md](requirements-webhook-quick-access-and-input-variables.md) — Modular webhook ribbon/command quick access and runtime input variable prompts.
