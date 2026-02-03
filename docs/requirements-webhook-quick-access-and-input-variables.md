# Feature requirement: Webhook quick access and input variables

## Summary

Two webhook-related features: (1) an optional **sidebar (ribbon) icon** to trigger webhooks without opening the command palette, and (2) a **per-webhook list of input variables** so the user can define one or more values to be prompted at trigger time and substituted into the body template (e.g. `{{custom}}`, `{{id}}`).

---

## Part A: Webhook icon in sidebar (quick access)

### User need

- Users who trigger webhooks often want a one-click action in the left sidebar instead of opening the command palette every time.
- The choice to show or hide the icon should be configurable so the sidebar is not cluttered for users who prefer the command only.

### Requirement

**REQ-W1: Optional webhook ribbon icon**

1. **Setting**  
   The plugin SHALL provide a setting (e.g. “Show webhook icon in sidebar”) that controls whether a webhook icon appears in the left sidebar (ribbon).

2. **When enabled**  
   When the setting is true, a ribbon icon SHALL be visible. Clicking it SHALL open the same flow as the “Trigger Webhook...” command (select webhook, then optionally enter input variable values if the webhook has any). The active note SHALL be used as context; if no note is open, a notice SHALL inform the user to open a note first.

3. **When disabled**  
   When the setting is false, the ribbon icon SHALL not be shown. The “Trigger Webhook...” command SHALL remain available in the command palette in all cases.

4. **Persistence and live update**  
   The setting SHALL be persisted. Changing the setting SHALL add or remove the ribbon icon immediately without requiring a plugin reload.

### Acceptance criteria (Part A)

- [ ] In webhook configuration (or general settings), a checkbox “Show webhook icon in sidebar” exists with a clear description.
- [ ] When checked, a webhook icon appears in the left sidebar; when unchecked, it is removed.
- [ ] Clicking the icon opens the webhook selection flow and uses the active note; behavior matches the command except for entry point.
- [ ] Toggling the checkbox updates the UI immediately (no reload).

---

## Part B: Per-webhook input variables (list)

### User need

- Different webhooks need different extra values in the body (e.g. label, ID, environment). A single global “custom” field is not enough.
- Users want to define **multiple** variables per webhook, each with a **name** (for the placeholder, e.g. `{{label}}`) and a **type** (e.g. text or number).
- When triggering a webhook, the user should be prompted only for the variables defined for that webhook, and the values should be substituted into the body template.

### Requirement

**REQ-W2: Input variables list per webhook**

1. **Configuration location**  
   Each webhook profile SHALL support an **input variables** configuration. This configuration SHALL be presented in the **Body Template** section of the webhook edit modal (after the usage guide and before the JSON editor).

2. **Structure**  
   Input variables SHALL be a **list**. Each item SHALL have:
   - **Variable name:** a string (e.g. `custom`, `id`, `label`) used as the placeholder name in the body (e.g. `{{custom}}`).
   - **Type:** one of **Text** or **Number** (determines the kind of input and optional validation when the user is prompted).

3. **UI**  
   The UI SHALL provide:
   - A way to **add** a new variable (e.g. “+ Add input variable” button).
   - For each variable: an input for the name, a dropdown for the type, and a way to **remove** the variable.
   - Clear copy that placeholders in the body use `{{name}}` and that each variable name should be unique within that webhook.

4. **Trigger flow**  
   When the user triggers a webhook (via command or ribbon):
   - If the webhook has at least one input variable with a non-empty name, the plugin SHALL show a modal (or equivalent) that prompts for a value for each such variable (respecting type).
   - The collected values SHALL be passed to the webhook service and SHALL be substituted into the body template as `{{name}}` = value. Variables with no value SHALL be substituted as empty string.

5. **Body template**  
   The body template (JSON or text) MAY contain placeholders `{{name}}` for any configured variable names. The usage guide in the same section SHALL list those placeholders (e.g. “{{custom}} (from input)”) when at least one variable is defined.

6. **Persistence**  
   The list of input variables SHALL be saved with the webhook profile. Variables with an empty name SHALL not be persisted (treated as “not configured”).

### Acceptance criteria (Part B)

- [ ] In the webhook edit modal, under Body Template, an “Input variables” subsection exists with add/remove and name/type per row.
- [ ] User can add multiple variables with distinct names and choose Text or Number per variable.
- [ ] When triggering a webhook that has input variables, a modal (or step) asks for each variable’s value; submitted values appear in the request body for the corresponding `{{name}}` placeholders.
- [ ] When triggering a webhook with no input variables (or all names empty), no input modal is shown and the webhook runs with only built-in placeholders (e.g. `{{filename}}`, `{{content}}`).
- [ ] Saving a webhook with empty variable names does not store those entries (list is trimmed to variables with non-empty names).

### Implementation notes

- **Types:** e.g. `WebhookInputVariable { name: string; type: 'text' | 'number' }`, `WebhookProfile.inputVariables?: WebhookInputVariable[]`.
- **Service:** `triggerWebhook(profile, file, extraVariables?: Record<string, string>)`; merge `extraVariables` into the template variables with keys `{{key}}`.
- **Modals:** After the user selects a webhook, if `inputVariables` has items with non-empty names, show a second modal to collect values, then call `triggerWebhook` with the collected `Record<name, value>`.

---

## Document info

- **Scope:** Webhook quick access (ribbon) and per-webhook input variables list.
- **Related:** Project ID key (separate requirement); existing webhook body template and placeholders (`{{filename}}`, `{{content}}`, etc.).
