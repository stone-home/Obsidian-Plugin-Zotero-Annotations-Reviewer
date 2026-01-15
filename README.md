# Zotero Assistant for Obsidian

**Zotero Assistant** is a powerful companion plugin for the official [Zotero Integration](https://github.com/mgmeyers/obsidian-zotero-integration) plugin. 

While Zotero Integration handles the importing of bibliography and images, **Zotero Assistant** provides a visual dashboard to review these highlights, browse extracted images directly in Obsidian, and convert them into atomic fleeting notes.

## ✨ Features

- **Visual Dashboard**: Embeds a control panel (`zotero-assistant`) directly into your literature notes.
- **Image Review**: Automatically locates and displays images extracted by Zotero Integration (no more broken links!).
- **JSON Map Strategy**: Uses a robust JSON mapping system to ensure 100% accurate image linking.
- **Atomic Notes**: One-click creation of fleeting notes from any highlight or image.
- **Webhook Integration**: Send your note data to external services (n8n, Zapier) with conditional triggers.

## ⚠️ Prerequisites (Mandatory)

This plugin **requires** the [Zotero Integration](https://github.com/mgmeyers/obsidian-zotero-integration) plugin to be installed and enabled. 

* **Zotero Integration**: Handles the raw data export (text & images) from Zotero.
* **Zotero Assistant**: Reads that data and provides the UI/UX.

## 🛠️ Configuration Guide

For this plugin to work, you must configure **Zotero Integration** to output data in a specific format.

### Step 1: Configure Image Output Path
1.  Open Obsidian Settings -> **Zotero Integration**.
2.  Scroll to **Image Output Path**.
3.  Set it to a structured path, for example: `Attachments/{{citekey}}`
    * *Note: This ensures all images for a paper are kept in one folder.*

### Step 2: Add the Import Template
You must use a specific Nunjucks template that generates the **JSON Map** required by the Assistant.

1.  Go to **Zotero Integration** -> **Import Formats**.
2.  Select your format (e.g., "Obsidian Import") or create a new one.
3.  **Copy and Paste** the following template into the **Note Content** area:

`````jinja2
---
zotero-key: {{citekey}}
zotero-image-path: "Attachments/{{citekey}}"
title: "{{ title | replace('"', '\\"') }}"
type: literature
aliases:
  - "{{citekey}}"
authors:
{%- if creators %}
{%- for creator in creators %}
  - {{creator.firstName}} {{creator.lastName}}
{%- endfor %}
{%- endif %}
date: {{date | format("YYYY-MM-DD")}}
year: {{date | format("YYYY")}}
tags:
{%- for t in tags %}
  - {{t.tag}}
{%- endfor %}
---

```zotero-assistant
{
{%- set comma = joiner() -%}
{%- for annotation in annotations -%}
{%- if annotation.imageRelativePath -%}
    {{ comma() }}
    "{{annotation.id}}": "{{ annotation.imageRelativePath | replace('\\', '\\\\') }}"
{%- endif -%}
{%- endfor -%}
}

```

## Abstract

{{abstractNote}}

## Highlights

{% for annotation in annotations %}

> [!quote]
> {{annotation.annotatedText}}
> ^ann-{{annotation.id}}

{% if annotation.comment %}
**Comment**: {{annotation.comment}}
{% endif %}
{% endfor %}

`````

> **IMPORTANT**: The line `zotero-image-path: "Attachments/{{citekey}}"` in the Frontmatter MUST match the **Image Output Path** you set in Step 1.

## 🚀 How to Use

1.  **Import a Paper**: Use Zotero Integration (`Ctrl/Cmd + P` -> `Zotero Integration: Create Note`) to import a paper.
2.  **Open the Note**: You will see the **🤖 Zotero Assistant** panel at the top.
3.  **Review**: Click **"Fetch / Review Highlights"**.
    * A modal will open showing all annotations.
    * Images will be automatically loaded.
    * Metadata will be displayed at the top.
4.  **Create Notes**: Click "Create Note" on any card to generate a separate fleeting note for that specific concept.

## 🔌 Webhook Configuration (Optional)

1.  Go to **Settings** -> **Zotero Assistant**.
2.  **Webhook URL**: Enter your endpoint (e.g., n8n webhook).
3.  **Enable Condition**: (Optional) Enter a regex to restrict when the button is active.
    * Example: `tags:.*finished` (Button only active if note has #finished tag).

