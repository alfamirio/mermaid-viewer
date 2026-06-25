# Markdown Mermaid Editor

A lightweight, browser-based Markdown editor with a live preview pane, multi-document sidebar, syntax highlighting, and a rich export suite — no build step or server required.

---

## Features

- **Split-pane layout** — editor and preview side by side, resizable with a drag handle, or switch to editor-only / preview-only mode
- **CodeMirror 6 editor** — syntax-highlighted Markdown with line numbers, bracket matching, undo/redo, and optional line wrap
- **Live preview** — rendered via [marked](https://marked.js.org/), updates as you type
- **Formatting toolbar** — two-row toolbar for common Markdown operations (bold, italic, strikethrough, inline code, headers, lists, blockquotes, horizontal rules, links, fenced code blocks, and tables via a modal dialog)
- **Multi-document sidebar** — create, rename, delete, and switch between multiple documents; all persisted in `localStorage`
- **Export options** — download as `.md`, `.json`, `.html`, `.pdf` (via jsPDF), or image; copy Markdown or HTML to clipboard
- **Import** — load any `.md` file from disk
- **Themes** — dark (default) and light, toggled from the toolbar; persisted across sessions
- **Sync scroll** — editor and preview scroll positions stay in sync
- **Status bar** — live word count, line count, storage usage, and unsaved-change indicator

---

## File Structure

| File | Purpose |
|---|---|
| `index.html` | App shell — layout, styles, and boot script |
| `toolbar.json` | Declarative toolbar definition (buttons, groups, callbacks) |
| `common-codemirror.js` | CodeMirror 6 setup; exposes `window.cmView` and `window.editor` |
| `common-local-storage.js` | `window.Store` — document CRUD and config persistence via `localStorage` |
| `common-layout.js` | `window.Toolbar`, `window.Layout`, `window.Sidebar` — toolbar rendering, split view, sidebar file list |
| `common-input-output.js` | Import / export helpers: `loadFile()`, `download()`, `exportJson()`, `exportHtml()`, `exportImage()`, `copyClipboard()` |
| `common-input-output-markdown.js` | PDF export engine (`initPdfExport`) — renders Markdown to jsPDF pages |
| `common-markdown.js` | `window.CommonMd` — formatting toolbar handlers (row 2): `fmt()`, `fmtLine()`, `fmtBlock()`, `insertText()`, `insertLink()`, table modal |

---

## Roadmap

- [ ] **Mermaid diagram support** — render fenced ` ```mermaid ``` ` blocks as diagrams in the preview pane, inside markdown
- [ ] **Mermaid diagram support** — full mermaid editor

---

## Getting Started

Because the editor uses ES module imports (`import` in `common-codemirror.js`) it must be served over HTTP rather than opened directly as a `file://` URL.

**Quick start with any static file server:**

```bash
# Python 3
python -m http.server 8080

# Node.js (npx)
npx serve .
```

Then open `http://localhost:8080` in your browser.

All external dependencies are loaded from CDNs — no `npm install` is needed.

---

## Dependencies

All loaded via CDN; no local installation required.

| Library | Version | Role |
|---|---|---|
| Bootstrap | 5.3.3 | UI components and theming |
| Bootstrap Icons | 1.11.3 | Toolbar icons |
| Split.js | 1.6.0 | Resizable editor / preview panes |
| marked | 12.0.0 | Markdown → HTML rendering |
| jsPDF | 2.5.1 | PDF export |
| CodeMirror | 6 (ESM via esm.sh) | Editor core, Markdown language, syntax highlighting |

---

## Toolbar

The toolbar is built at runtime from `toolbar.json`. Each entry declares a `group`, a Bootstrap `color`, which `row` it sits on, and an array of `elements`.

**Row 1** — file and view controls:

| Group | Buttons |
|---|---|
| Viewer | GitHub, Import, Export (.md), Export JSON, Export HTML, Export PDF, Export Image, Copy |
| View | Editor / Both / Preview (toggle) |
| Toggle | Sidebar, Theme (toggle) |
| Config | Highlight, Sync Scroll (toggle) |
| Status | Storage, Lines, Words, Saved indicator, Delete localStorage |

**Row 2** — Markdown formatting:

| Group | Buttons |
|---|---|
| Structures | ` ``` ` Code block, `>` Quote, `—` Rule, Link, `—` UL, `1.` OL, Table |
| Basic | Bold, Italic, Strike, Inline code |
| Headers | H1, H2, H3 |

Toggle-group buttons show an active state (filled) when the corresponding feature is on.

---

## Storage

Documents are stored in `localStorage` under four key namespaces (prefix `md_editor:`):

| Key | Contents |
|---|---|
| `md_editor:doc:{id}` | Document content and metadata |
| `md_editor:doc_index` | Ordered list of document IDs |
| `md_editor:config` | Editor configuration (theme, wrap, highlight, syncScroll, sidebar) |
| `md_editor:active_doc` | ID of the currently open document |

The **Delete** button in the status bar clears all editor data from `localStorage`.

---

## Keyboard Shortcuts (CodeMirror defaults)

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Tab` | Indent |
| `Shift + Tab` | De-indent |

---

## Architecture Notes

- **`window.cmView`** is the raw CodeMirror `EditorView` instance, used by both the storage layer and the formatting toolbar to dispatch transactions.
- The formatting toolbar (row 2) captures the CodeMirror selection on every `mousedown` event before button clicks steal focus, storing it in `_savedSel`. All formatting functions operate on this saved range.
- The toolbar is rendered from JSON by `Toolbar.init('toolbar.json')`, making it easy to add, remove, or reorder buttons without touching HTML.
- PDF export renders the Markdown to a hidden DOM node at high resolution, walks the content block by block, and writes it to a jsPDF document, falling back to `window.print()` if canvas operations fail.
