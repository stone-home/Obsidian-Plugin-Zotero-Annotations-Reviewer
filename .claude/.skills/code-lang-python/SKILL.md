---
name: code-lang-python
description: Python coding standards (PEP 8, type hints, Google docstrings, minimal diffs, class-local logic, cross-file placement) and pytest conventions (conftest.py, shared fixtures/helpers at the lowest common ancestor). Use when writing or editing Python (*.py) or Jupyter notebook (*.ipynb) files or pytest tests in this repo.
---

# Python

- **Edits & refactors:** Follow a **minimal-change** principle: touch only what the task requires; avoid drive-by cleanups, unrelated renames, or scope creep. **Prefer extending or adjusting existing code** in place over large refactors or rewrites unless the user explicitly asks for a broader redesign or the current structure is blocking the change.
- **Style:** **PEP 8**. Use **type hints** for function args and return values.
- **Paths:** Prefer `pathlib` over `os.path`; use f-strings for formatting.
- **Dependencies:** Manage via `requirements.txt` or `pyproject.toml`; pin versions in deployment.
- **Docstrings:** **Google Style** — include Args, Returns, Raises for public functions and modules.
- **Class-local logic:** Unless there is a **clear, overwhelming** reason (reuse across unrelated types, import cycles, explicit shared utility contract, etc.), **do not** move logic that only serves one class out to **module-level standalone functions**. Prefer **instance methods** (`self`) and, when the API should receive the class, **`@classmethod`**, so behavior stays on the type and is discoverable.
- **`@staticmethod`:** **Avoid** putting `@staticmethod` on classes—it is a weak pattern in Python and tends to hide pure functions behind a class namespace for no real benefit. Prefer a **module-level** helper (or `_helpers`), an **instance method**, or a **`@classmethod`** when the first argument should be the class (factories, `cls`-aware hooks).
- **Cross-file placement (per package/slice):** When a variable, constant, type alias, or function is needed **across multiple files** in the same area, put it where others can import it predictably: **shared data / schemas / typed constants / colour maps** → a local `_dtypes` (or equivalent) module; **abstractions** (ABCs, protocols, shared base classes) → a local `_abs` / `base`-style module; **generic reusable functions** (pure utilities, formatting, small algorithms) → a local `_helpers` module. Each vertical slice (e.g. `visualizer/`, `profiler/`) keeps its **own** `_dtypes` / abstraction / `_helpers` trio so ownership stays clear and layers do not leak into unrelated trees.

## Plotly Hierarchy Pitfall (`go.Icicle` / `Sunburst` / `Treemap`)

- **Requirement:** Plotly hierarchy traces require **globally unique** `ids`; `parents` must reference those exact id strings.
- **Codebase pitfall:** `TreeNode.align_key` (from `ScopeTreeFactory._assign_align_keys`) is unique only among siblings; the same `align_key` can reappear in another branch. `source_brick_id` is also unsafe when a brick appears multiple times after cross-type expansion.
- **Do not do:** Using `align_key` or `source_brick_id` directly as Plotly `ids` can create duplicate ids and break charts/exports.
- **Correct pattern:** Generate per-node uid strings during tree traversal (for example `uid_of[id(node)] = f"n{i}"` or `f"d{i}"`), build `parent_of[uid] -> parent_uid` (root parent `""`), and pass those uids to Plotly `ids`/`parents`. Keep `align_key` only in labels/hover/customdata.

## Pytest: `conftest.py` and shared test code

**pytest** is the major Python test framework in this repository. The conventions below assume pytest's runner, fixture model, and `conftest.py` discovery.

### Placement rule (lowest common ancestor)

Anything shared by **two or more** test modules must live under the **lowest common ancestor directory** of those modules (the smallest `test/.../` folder that contains every consumer). Do not leave copy-pasted helpers in individual `test_*.py` files, and do not import shared helpers from unrelated subtrees.

### What belongs in `conftest.py`

Use `conftest.py` for anything pytest **discovers by convention**:

- **`@pytest.fixture`**, **`@pytest.fixture` factories**, parametrisation helpers wired as fixtures.
- **`pytest_*` hooks** (if needed) and **`pytest_plugins`** registration for that subtree.

Keep `conftest.py` **thin**: if a fixture needs a lot of logic, implement the logic in a **support module** (see below) and call it from the fixture.

### Shared utilities, data loaders, constants, helper classes

Pytest does **not** auto-import arbitrary modules for you — only `conftest.py` (and plugins) participate in fixture discovery. For reusable **non-fixture** code (pure functions, large helper classes, canonical dicts, file loaders):

- Put it in **one** module next to the `conftest.py` at that same LCA level, e.g. `_helpers.py`, `*_test_support.py`, or `test_helper.py` (name consistently within the repo).
- **`conftest.py` may import** that module to expose thin fixtures; test files may import the module **or** use fixtures — pick one dominant style per subtree and stay consistent.

Avoid a deep chain of `from test.a.b.c import ...` across unrelated packages; if imports cross many levels, the helper is probably at the **wrong** directory — move it up to the LCA.

### One implementation, one place

Do not maintain two copies of the same helper in sibling `conftest.py` files. Either **move up** to the parent folder's `conftest.py` / support module, or keep the implementation in the parent and **import** it in child `conftest.py` if child-only fixtures need it.

### Single-file-only code

Helpers used by **one** test file only stay in that file until a second consumer appears.

### Quick reference

| Shared by | Fixtures / hooks | Pure helpers, constants, loaders |
|---|---|---|
| Whole suite under `test/` | `test/conftest.py` | `test/<support>.py` + optional `test/conftest.py` wrappers |
| All under `test/analyzer/` | `test/analyzer/conftest.py` | `test/analyzer/<support>.py` + optional local fixtures |
| Only under `test/analyzer/c_allocator/` | `test/analyzer/c_allocator/conftest.py` (LCA) | `test/analyzer/test_helper.py` + optional local fixtures; tests grouped under `ingest/`, `category/`, `brickConverter/` |

### Example (thin `conftest`, heavy logic in support)

```python
# test/analyzer/_analyzer_support.py  — shared constants + AnalyzerTestHelper
CANONICAL_ALLOCATOR_PICKLE_DICT = {...}

class AnalyzerTestHelper:
    ...

# test/analyzer/conftest.py
import pytest
from test.analyzer._analyzer_support import AnalyzerTestHelper

@pytest.fixture
def analyzer_helper() -> AnalyzerTestHelper:
    return AnalyzerTestHelper()

# test/analyzer/c_allocator/category/test_foo.py
def test_ingest(analyzer_helper, tmp_path):
    ...
```
