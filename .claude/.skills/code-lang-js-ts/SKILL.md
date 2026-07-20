---
name: code-lang-js-ts
description: JavaScript/TypeScript standards (strict mode, ES6+, async/await, TSDoc) with Obsidian plugin conventions. Use when writing or editing *.ts, *.tsx, *.js, *.mjs files, especially Obsidian plugins or tooling.
---

# JavaScript / TypeScript (Obsidian Plugins)

- **TypeScript:** **Strict Mode**, ES6+ (`?.`, `??`, destructuring), `async/await`. Prefer `type` over `interface`. Ensure ESLint/Prettier compatibility. Use **TSDoc** for exports.
- **Obsidian:** Follow Obsidian plugin API and manifest conventions; keep main logic in entry module, use `export` for public API.
- **General:** Same style for plain JS when used in Obsidian or tooling; prefer TS when adding new code.
