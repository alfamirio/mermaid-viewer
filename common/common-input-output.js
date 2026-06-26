/* common-input-output.js
   Import and export helpers for the Markdown editor.
   Depends on: window.cmView (CodeMirror EditorView), window.marked
   Called by toolbar buttons: loadFile(), download(), exportJson(),
                              exportHtml(), copyClipboard(), copyHtml()
*/

'use strict';

/* ── Internal helpers ─────────────────────────────────────── */

/** Return the current editor text, or '' if the editor isn't ready yet. */
function _getDoc() {
    return window.cmView?.state.doc.toString() ?? '';
}

/** Derive the title from the first H1 heading, or null if none found.
 *  Used by exportJson(), exportHtml(), and _stemFromDoc(). */
function _firstH1Title(text) {
    const line = text.split('\n').find(l => l.startsWith('# '));
    return line ? line.replace(/^#+\s*/, '').trim() : null;
}

/** Derive a safe filename stem from the first H1 heading, falling back to 'document'. */
function _stemFromDoc() {
    const title = _firstH1Title(_getDoc());
    if (!title) return 'document';
    return title
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase()
        || 'document';
}

/** Trigger a file download in the browser. */
function _triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
        href:     url,
        download: filename,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* ── Import ───────────────────────────────────────────────── */

/**
 * loadFile()
 * Opens a file-picker accepting .md and .txt files, reads the selected file,
 * and loads its content into the editor.
 */
function loadFile() {
    const input = Object.assign(document.createElement('input'), {
        type:   'file',
        accept: '.md,.txt,text/markdown,text/plain',
    });

    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = e => Store.loadIntoEditor(e.target.result);
        reader.onerror = () => alert(`Could not read "${file.name}".`);
        reader.readAsText(file, 'utf-8');
    });

    input.click();
}

/* ── Export: Markdown ─────────────────────────────────────── */

/**
 * download()
 * Exports the current editor content as a .md file.
 */
function download() {
    const text = _getDoc();
    if (!text.trim()) { alert('Nothing to export — the editor is empty.'); return; }
    _triggerDownload(text, `${_stemFromDoc()}.md`, 'text/markdown;charset=utf-8');
}

/* ── Export: JSON ─────────────────────────────────────────── */

/**
 * exportJson()
 * Exports a JSON envelope containing the markdown source, a rendered HTML
 * snapshot, document metadata, and the current editor config.
 *
 * Schema:
 * {
 *   version:    1,
 *   exportedAt: <ISO-8601>,
 *   meta: {
 *     title:    <first H1 or null>,
 *     words:    <word count>,
 *     lines:    <line count>,
 *   },
 *   markdown:   <raw source>,
 *   html:       <rendered HTML>,
 *   config:     <Store.loadConfig() snapshot, if available>,
 * }
 */
function exportJson() {
    const text = _getDoc();
    if (!text.trim()) { alert('Nothing to export — the editor is empty.'); return; }

    const stem  = _stemFromDoc();
    const title = _firstH1Title(text);
    const words   = Store.wordCount(text);
    const lines   = window.cmView?.state.doc.lines ?? text.split('\n').length;
    const html    = window.marked ? window.marked.parse(text) : '';

    const payload = {
        version:    1,
        exportedAt: new Date().toISOString(),
        meta:       { title, words, lines },
        markdown:   text,
        html,
        config:     (typeof Store !== 'undefined') ? Store.loadConfig() : undefined,
    };

    _triggerDownload(
        JSON.stringify(payload, null, 2),
        `${stem}.json`,
        'application/json;charset=utf-8',
    );
}

/* ── Export: HTML ─────────────────────────────────────────── */

/**
 * Colour tokens for each theme.
 * These mirror the Bootstrap 5 CSS variables used by #preview-content in
 * index.html so the exported file looks identical to the live preview pane.
 */
const _HTML_THEMES = {
    light: {
        bg:          '#ffffff',
        color:       '#212529',
        emphColor:   '#000000',
        secondaryBg: '#e9ecef',
        tertiaryBg:  '#f8f9fa',
        border:      '#dee2e6',
        link:        '#0d6efd',
        mutedColor:  '#6c757d',
        accent:      '#0d6efd',
    },
    dark: {
        bg:          '#212529',
        color:       '#dee2e6',
        emphColor:   '#ffffff',
        secondaryBg: '#343a40',
        tertiaryBg:  '#2b3035',
        border:      '#495057',
        link:        '#6ea8fe',
        mutedColor:  '#adb5bd',
        accent:      '#6ea8fe',
    },
};

/**
 * _themeVars()
 * Returns the colour token object for the current editor theme, falling back
 * to light if the attribute is absent or unrecognised.
 */
function _themeVars() {
    const theme = document.documentElement.getAttribute('data-bs-theme') ?? 'light';
    return _HTML_THEMES[theme] ?? _HTML_THEMES.light;
}

/**
 * _buildThemeCss(t)
 * Returns the full inline stylesheet string for a given token object `t`.
 * Extracted so it can be called twice (once per theme) for the
 * prefers-color-scheme media-query block.
 */
function _buildThemeCss(t) {
    return `
    body {
      background: ${t.bg};
      color: ${t.color};
    }
    h1, h2, h3, h4, h5, h6 { color: ${t.emphColor}; }
    h1 { border-bottom-color: ${t.border}; }
    h2 { border-bottom-color: ${t.border}; }
    a  { color: ${t.link}; }
    code {
      background: ${t.tertiaryBg};
      border-color: ${t.border};
      color: ${t.color};
    }
    pre {
      background: ${t.tertiaryBg};
      border-color: ${t.border};
    }
    pre code { color: ${t.color}; }
    blockquote {
      border-left-color: ${t.accent};
      background: ${t.tertiaryBg};
      color: ${t.mutedColor};
    }
    th, td { border-color: ${t.border}; }
    th     { background: ${t.secondaryBg}; }
    hr     { border-top-color: ${t.border}; }`;
}

/**
 * exportHtml()
 * Exports a self-contained, standalone HTML file that reproduces the preview
 * pane styling in the active theme (light or dark).  The file also embeds a
 * prefers-color-scheme media query so it adapts automatically when opened on a
 * device whose OS theme differs from the one chosen at export time.
 *
 * The file embeds:
 *   • the rendered markdown body
 *   • structural CSS (layout, typography, spacing)
 *   • theme colour tokens — active theme applied by default, with an
 *     OS-preference override via @media (prefers-color-scheme)
 *   • the document title from the first H1 heading
 *
 * No external resources are required — the file is fully portable.
 */
function exportHtml() {
    const text = _getDoc();
    if (!text.trim()) { alert('Nothing to export — the editor is empty.'); return; }

    if (!window.marked) { alert('Markdown renderer (marked.js) is not loaded.'); return; }

    const stem    = _stemFromDoc();
    const title   = _firstH1Title(text) ?? stem;
    const body    = window.marked.parse(text);

    // Active theme at export time
    const activeThemeName = document.documentElement.getAttribute('data-bs-theme') ?? 'light';
    const activeTheme     = _HTML_THEMES[activeThemeName] ?? _HTML_THEMES.light;
    // Opposite theme for the OS-preference override
    const osThemeName     = activeThemeName === 'dark' ? 'light' : 'dark';
    const osTheme         = _HTML_THEMES[osThemeName];

    const html = `<!DOCTYPE html>
<html lang="en" data-theme="${activeThemeName}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${Store.escapeHtml(title)}</title>
  <style>
    /* ── Reset & structure ── */
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 2rem 1rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 1rem;
      line-height: 1.7;
    }
    .content {
      max-width: 720px;
      margin: 0 auto;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.4em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.3;
    }
    h1 { font-size: 1.9rem; border-bottom-width: 2px; border-bottom-style: solid; padding-bottom: 0.3em; }
    h2 { font-size: 1.5rem; border-bottom-width: 1px; border-bottom-style: solid; padding-bottom: 0.25em; }
    h3 { font-size: 1.2rem; }
    p  { margin: 0.8em 0; }
    a  { text-decoration: underline; }
    code {
      font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
      font-size: 0.875em;
      border-width: 1px;
      border-style: solid;
      border-radius: 4px;
      padding: 0.15em 0.4em;
    }
    pre {
      border-width: 1px;
      border-style: solid;
      border-radius: 6px;
      padding: 1em 1.2em;
      overflow-x: auto;
      margin: 1em 0;
    }
    pre code { background: none; border: none; padding: 0; font-size: 0.875rem; }
    blockquote {
      border-left-width: 4px;
      border-left-style: solid;
      margin: 1em 0;
      padding: 0.5em 1em;
      border-radius: 0 4px 4px 0;
    }
    ul, ol { padding-left: 1.8em; margin: 0.6em 0; }
    li     { margin: 0.3em 0; }
    table  { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
    th, td { border-width: 1px; border-style: solid; padding: 0.5em 0.8em; text-align: left; }
    th     { font-weight: 600; }
    img    { max-width: 100%; height: auto; }
    hr     { border: none; border-top-width: 1px; border-top-style: solid; margin: 2em 0; }

    /* ── Active theme (chosen at export time): ${activeThemeName} ── */
    ${_buildThemeCss(activeTheme)}

    /* ── OS-preference override: if the viewer's OS prefers ${osThemeName}, use that instead ── */
    @media (prefers-color-scheme: ${osThemeName}) {
      ${_buildThemeCss(osTheme)}
    }
  </style>
</head>
<body>
  <div class="content">
${body}
  </div>
</body>
</html>`;

    _triggerDownload(html, `${stem}.html`, 'text/html;charset=utf-8');
}

/* ── Clipboard: Markdown ──────────────────────────────────── */

/**
 * copyClipboard()
 * Copies the raw Markdown source to the system clipboard.
 * Shows a brief toast-style alert on success/failure.
 */
function copyClipboard() {
    const text = _getDoc();
    if (!text.trim()) { alert('Nothing to copy — the editor is empty.'); return; }

    navigator.clipboard.writeText(text).then(() => {
        _showToast('Markdown copied to clipboard.');
    }).catch(() => {
        // Fallback for browsers where clipboard API is blocked
        _clipboardFallback(text);
    });
}

/* ── Clipboard: HTML ──────────────────────────────────────── */

/**
 * copyHtml()
 * Copies the rendered HTML (as produced by marked.js) to the system clipboard,
 * writing both text/html and text/plain MIME types so it pastes as rich text
 * in apps that support it (Word, Google Docs, etc.) and as plain HTML otherwise.
 */
function copyHtml() {
    const text = _getDoc();
    if (!text.trim()) { alert('Nothing to copy — the editor is empty.'); return; }

    if (!window.marked) { alert('Markdown renderer (marked.js) is not loaded.'); return; }

    const html = window.marked.parse(text);

    // ClipboardItem lets us write both rich-text and plain-text representations.
    if (typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
            'text/html':  new Blob([html],  { type: 'text/html' }),
            'text/plain': new Blob([html],  { type: 'text/plain' }),
        });
        navigator.clipboard.write([item]).then(() => {
            _showToast('HTML copied to clipboard.');
        }).catch(() => {
            _clipboardFallback(html);
        });
    } else {
        // Safari / older browsers: write plain text only
        navigator.clipboard.writeText(html).then(() => {
            _showToast('HTML copied to clipboard (plain text).');
        }).catch(() => {
            _clipboardFallback(html);
        });
    }
}

/* ── Clipboard helpers ────────────────────────────────────── */

/** execCommand-based fallback for environments that block the async Clipboard API. */
function _clipboardFallback(text) {
    const ta = Object.assign(document.createElement('textarea'), {
        value: text,
        style: 'position:fixed;opacity:0;pointer-events:none;',
    });
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        _showToast('Copied to clipboard.');
    } catch {
        alert('Could not access the clipboard. Please copy manually.');
    }
    document.body.removeChild(ta);
}

/* ── Export: PDF ──────────────────────────────────────────── */

/**
 * exportPdf()
 * Delegates to the PDF engine in common-input-output-markdown.js.
 *
 * initPdfExport() expects:
 *   activeNoteName — fn() → string   title used for the saved filename
 *   editor         — object with a .value getter returning the raw markdown
 *   marked         — the global marked library
 *   mermaid        — the global mermaid library
 *   MERMAID_DARK_CONFIG — the app's canonical dark-theme mermaid config
 *                         (read from window so callers don't have to pass it)
 *
 * The engine is initialised lazily on the first call and cached on
 * window._pdfEngine so subsequent calls reuse the same instance.
 */
function exportPdf() {
    if (!window._pdfEngine) {
        if (typeof initPdfExport !== 'function') {
            alert('PDF engine (common-input-output-markdown.js) is not loaded.');
            return;
        }

        // No-op stub used when mermaid is not on the page.
        // The engine calls mermaid.initialize() unconditionally and mermaid.render()
        // only for .mermaid-wrap elements — the stub makes both safe no-ops so
        // diagrams are silently skipped rather than crashing.
        const _mermaidStub = {
            initialize: () => {},
            render:     async () => ({ svg: '' }),
        };

        // Live proxy: resolves window.mermaid at call-time rather than init-time.
        // This means a lazily-loaded mermaid is picked up automatically, and
        // an absent mermaid falls through to the stub without crashing.
        const _mermaidProxy = new Proxy(_mermaidStub, {
            get(stub, prop) {
                const live = window.mermaid;
                return live ? live[prop].bind(live) : stub[prop];
            },
        });

        window._pdfEngine = initPdfExport({
            activeNoteName: () => _firstH1Title(_getDoc()) ?? 'document',
            editor: { get value() { return _getDoc(); } },
            marked:             window.marked,
            mermaid:            _mermaidProxy,
            MERMAID_DARK_CONFIG: window.MERMAID_DARK_CONFIG ?? {},
        });
    }

    window._pdfEngine.exportPdf();
}

/**
 * _showToast(message)
 * Displays a lightweight, self-dismissing notification anchored to the
 * bottom-right of the viewport.  Uses no external libraries.
 */
function _showToast(message) {
    const existing = document.getElementById('io-toast');
    if (existing) existing.remove();

    const toast = Object.assign(document.createElement('div'), {
        id:          'io-toast',
        textContent: message,
    });
    Object.assign(toast.style, {
        position:     'fixed',
        bottom:       '1.25rem',
        right:        '1.25rem',
        background:   '#1a1a1a',
        color:        '#fff',
        padding:      '0.5rem 1rem',
        borderRadius: '6px',
        fontSize:     '0.85rem',
        fontFamily:   'system-ui, sans-serif',
        boxShadow:    '0 4px 12px rgba(0,0,0,0.25)',
        zIndex:       '9999',
        opacity:      '0',
        transition:   'opacity 0.2s ease',
        pointerEvents:'none',
    });

    document.body.appendChild(toast);
    // Trigger transition on next frame
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        }, 2200);
    });
}
