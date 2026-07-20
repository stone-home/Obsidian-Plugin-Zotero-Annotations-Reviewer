---
name: code-lang-bash
description: Bash/shell script standards (strict mode, quoting, help). Use when writing or editing shell scripts (*.sh, files under scripts/) or any Bash automation.
---

# Bash

- **Shebang:** `#!/usr/bin/env bash`
- **Strict mode:** `set -euo pipefail` (exit on error, undefined vars, pipe failures).
- **Quoting:** Double-quote variables (`"$VAR"`); use `[[ ]]` for conditions.
- **Scripts with args:** Include a `show_help` (or similar) function and document usage.
