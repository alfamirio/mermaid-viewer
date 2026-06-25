/**
 * common-local-storage.js — Markdown Editor storage & config utilities
 *
 * Manages four localStorage namespaces:
 *   md_editor:doc:{id}    – document content + metadata
 *   md_editor:doc_index   – ordered list of document IDs
 *   md_editor:config      – editor configuration object
 *   md_editor:active_doc  – ID of the currently open document
 *
 * Public surface is window.Store. Internal helpers are prefixed with _.
 */

(function () {
    'use strict';

    /* ════════════════════════════════════════
       CONSTANTS
    ════════════════════════════════════════ */

    const PREFIX       = 'md_editor:';
    const KEY_INDEX    = PREFIX + 'doc_index';   // JSON array of doc IDs
    const KEY_CONFIG   = PREFIX + 'config';
    const KEY_ACTIVE   = PREFIX + 'active_doc';

    function docKey(id) {
        return PREFIX + 'doc:' + id;
    }

    /* ════════════════════════════════════════
       CONFIG SCHEMA  (defaults)
    ════════════════════════════════════════ */

    /**
     * @typedef {Object} EditorConfig
     * @property {string}  theme        – 'light' | 'dark'
     * @property {boolean} wrap         – line-wrap enabled
     * @property {boolean} highlight    – syntax highlight enabled
     * @property {boolean} syncScroll   – sync editor/preview scroll
     * @property {boolean} toc          – table-of-contents panel open
     * @property {boolean} sidebar      – sidebar panel open
     * @property {string}  viewMode     – 'editor' | 'both' | 'preview'
     * @property {number[]} splitSizes  – [sidebar%, editor%, preview%]
     * @property {Object}  [custom]     – app-defined extra keys
     */
    const CONFIG_DEFAULTS = {
        theme:       'dark',
        wrap:        true,
        highlight:   true,
        syncScroll:  true,
        toc:         true,
        sidebar:     true,
        viewMode:    'both',
        splitSizes:  [15, 50, 35],
        editorMode:  'markdown',   // 'markdown' | 'mermaid'
        custom:      {},
    };

    /* ════════════════════════════════════════
       DOCUMENT SCHEMA
    ════════════════════════════════════════ */

    /**
     * @typedef {Object} DocMeta
     * @property {string} id          – unique ID (generated)
     * @property {string} title       – display name
     * @property {number} createdAt   – Unix ms
     * @property {number} updatedAt   – Unix ms
     * @property {number} size        – byte length of content
     */

    /**
     * @typedef {Object} Doc
     * @property {string}  id
     * @property {string}  title
     * @property {string}  content   – raw markdown text
     * @property {number}  createdAt
     * @property {number}  updatedAt
     */

    /* ════════════════════════════════════════
       INTERNAL HELPERS
    ════════════════════════════════════════ */

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function lsGet(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? null : JSON.parse(raw);
        } catch (e) {
            console.warn('[Store] lsGet failed for', key, e);
            return null;
        }
    }

    function lsSet(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            // Likely QuotaExceededError
            console.error('[Store] lsSet failed for', key, e);
            _emit('error', { type: 'quota', key, error: e });
            return false;
        }
    }

    function lsDel(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.warn('[Store] lsDel failed for', key, e);
            return false;
        }
    }

    /* ════════════════════════════════════════
       MINI EVENT BUS
       Lets the rest of the app react to storage
       events without tight coupling.

       Live subscribers (as of current wiring):
         Store.on('doc:saved',          fn)  – index.html, Sidebar
         Store.on('doc:deleted',        fn)  – index.html, Sidebar
         Store.on('doc:loaded',         fn)  – index.html
         Store.on('doc:new',            fn)  – Sidebar (rename mode)
         Store.on('doc:active_changed', fn)  – Sidebar
         Store.on('doc:all_deleted',    fn)  – Sidebar
         Store.on('storage:nuked',      fn)  – Sidebar
         Store.on('error',              fn)  – (quota errors; no subscriber yet)
    ════════════════════════════════════════ */

    const _listeners = {};

    function _emit(event, detail) {
        (_listeners[event] || []).forEach(fn => {
            try { fn(detail); } catch (e) { console.error('[Store] listener error', e); }
        });
    }

    function on(event, fn) {
        if (!_listeners[event]) _listeners[event] = [];
        _listeners[event].push(fn);
        // Return unsubscribe function
        return () => {
            _listeners[event] = _listeners[event].filter(f => f !== fn);
        };
    }

    /* ════════════════════════════════════════
       DOCUMENT INDEX
    ════════════════════════════════════════ */

    /** @returns {string[]} ordered list of document IDs */
    function _getIndex() {
        return lsGet(KEY_INDEX) || [];
    }

    function _setIndex(ids) {
        lsSet(KEY_INDEX, ids);
    }

    function _addToIndex(id) {
        const idx = _getIndex();
        if (!idx.includes(id)) {
            idx.push(id);
            _setIndex(idx);
        }
    }

    function _removeFromIndex(id) {
        const idx = _getIndex().filter(i => i !== id);
        _setIndex(idx);
    }

    /* ════════════════════════════════════════
       DOCUMENT API
    ════════════════════════════════════════ */

    /**
     * Save (create or update) a document.
     *
     * @param {Object} opts
     * @param {string}  [opts.id]       – omit to create new
     * @param {string}  [opts.title]    – defaults to 'Untitled'
     * @param {string}  opts.content    – raw markdown
     * @returns {Doc|null}  saved document, or null on failure
     */
    function saveDoc({ id, title, content = '' } = {}) {
        const now  = Date.now();
        const isNew = !id;
        const docId = id || uid();

        const existing = isNew ? null : lsGet(docKey(docId));
        const doc = {
            id:        docId,
            title:     title ?? existing?.title ?? 'Untitled',
            content,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        const ok = lsSet(docKey(docId), doc);
        if (!ok) return null;

        _addToIndex(docId);
        _emit('doc:saved', { doc, isNew });
        return doc;
    }

    /**
     * Load a single document by ID.
     *
     * @param {string} id
     * @returns {Doc|null}
     */
    function loadDoc(id) {
        if (!id) return null;
        const doc = lsGet(docKey(id));
        if (doc) _emit('doc:loaded', { doc });
        return doc;
    }

    /**
     * Delete a document by ID.
     *
     * @param {string} id
     * @returns {boolean}
     */
    function deleteDoc(id) {
        if (!id) return false;
        const ok = lsDel(docKey(id));
        if (ok) {
            _removeFromIndex(id);
            // If we just deleted the active doc, clear active
            if (getActiveDocId() === id) setActiveDocId(null);
            _emit('doc:deleted', { id });
        }
        return ok;
    }

    /**
     * List all documents (metadata only — no content).
     *
     * @returns {DocMeta[]}
     */
    function listDocs() {
        return _getIndex()
            .map(id => {
                const doc = lsGet(docKey(id));
                if (!doc) return null;
                // Return meta without content to avoid allocating huge strings
                const { content, ...meta } = doc;
                meta.size = new TextEncoder().encode(content).length;
                return meta;
            })
            .filter(Boolean);
    }

    /**
     * Rename a document (update title only).
     *
     * @param {string} id
     * @param {string} title
     * @returns {Doc|null}
     */
    function renameDoc(id, title) {
        const doc = loadDoc(id);
        if (!doc) return null;
        return saveDoc({ ...doc, title });
    }

    /**
     * Delete ALL documents and clear the index.
     */
    function deleteAllDocs() {
        _getIndex().forEach(id => lsDel(docKey(id)));
        lsDel(KEY_INDEX);
        _emit('doc:all_deleted', {});
    }

    /* ════════════════════════════════════════
       ACTIVE DOCUMENT
    ════════════════════════════════════════ */

    /** @returns {string|null} */
    function getActiveDocId() {
        return lsGet(KEY_ACTIVE);
    }

    /**
     * @param {string|null} id
     */
    function setActiveDocId(id) {
        if (id === null) {
            lsDel(KEY_ACTIVE);
        } else {
            lsSet(KEY_ACTIVE, id);
        }
        _emit('doc:active_changed', { id });
    }

    /**
     * Convenience: open a document (set active + return it).
     *
     * @param {string} id
     * @returns {Doc|null}
     */
    function openDoc(id) {
        const doc = loadDoc(id);
        if (doc) setActiveDocId(id);
        return doc;
    }

    /* ════════════════════════════════════════
       CONFIG API
    ════════════════════════════════════════ */

    /**
     * Load config, merging saved values over defaults.
     *
     * @returns {EditorConfig}
     */
    function loadConfig() {
        const saved = lsGet(KEY_CONFIG) || {};
        return {
            ...CONFIG_DEFAULTS,
            ...saved,
            // Deep merge custom keys
            custom: { ...CONFIG_DEFAULTS.custom, ...(saved.custom || {}) },
        };
    }

    /**
     * Save a partial or full config object.
     * Merges with existing config so callers can patch a single key.
     *
     * @param {Partial<EditorConfig>} patch
     * @returns {EditorConfig} resulting full config
     */
    function saveConfig(patch = {}) {
        const current = loadConfig();
        const next = {
            ...current,
            ...patch,
            custom: { ...current.custom, ...(patch.custom || {}) },
        };
        lsSet(KEY_CONFIG, next);
        return next;
    }

    /**
     * Reset config to defaults.
     *
     * @returns {EditorConfig}
     */
    function resetConfig() {
        lsDel(KEY_CONFIG);
        return { ...CONFIG_DEFAULTS };
    }

    /* ════════════════════════════════════════
       STORAGE DIAGNOSTICS
    ════════════════════════════════════════ */

    /**
     * Return a snapshot of storage usage for all editor keys.
     *
     * @returns {{ docs: number, config: number, total: number, docCount: number }}
     */
    function storageInfo() {
        const enc = new TextEncoder();

        let docsBytes   = 0;
        let configBytes = 0;
        const ids = _getIndex();

        ids.forEach(id => {
            const raw = localStorage.getItem(docKey(id));
            if (raw) docsBytes += enc.encode(raw).length;
        });

        const cfgRaw = localStorage.getItem(KEY_CONFIG);
        if (cfgRaw) configBytes = enc.encode(cfgRaw).length;

        return {
            docCount:    ids.length,
            docsBytes,
            configBytes,
            totalBytes:  docsBytes + configBytes,
            // Human-readable helpers
            docsKB:      (docsBytes   / 1024).toFixed(1),
            configKB:    (configBytes / 1024).toFixed(1),
            totalKB:     ((docsBytes + configBytes) / 1024).toFixed(1),
        };
    }

    /**
     * Wipe EVERYTHING written by this editor (docs + config + active).
     * Does not touch other localStorage keys from unrelated apps.
     */
    function nukeStorage() {
        deleteAllDocs();
        lsDel(KEY_CONFIG);
        lsDel(KEY_ACTIVE);
        _emit('storage:nuked', {});
    }

    /* ════════════════════════════════════════
       EXPORT / IMPORT (JSON bundle)
    ════════════════════════════════════════ */

    /**
     * Export all docs + config as a portable JSON object.
     * Suitable for download-as-file or copy-to-clipboard.
     *
     * @returns {{ version: number, exportedAt: number, config: EditorConfig, docs: Doc[] }}
     */
    function exportBundle() {
        const docs = _getIndex().map(id => loadDoc(id)).filter(Boolean);
        return {
            version:    1,
            exportedAt: Date.now(),
            config:     loadConfig(),
            docs,
        };
    }

    /**
     * Import a bundle produced by exportBundle().
     * Merges docs (does not delete existing ones).
     * Config is merged (not replaced) unless opts.replaceConfig is true.
     *
     * @param {Object} bundle
     * @param {{ replaceConfig?: boolean, replaceDocs?: boolean }} [opts]
     * @returns {{ docsImported: number, configImported: boolean, errors: string[] }}
     */
    function importBundle(bundle, { replaceConfig = false, replaceDocs = false } = {}) {
        const errors  = [];
        let docsImported = 0;

        if (!bundle || bundle.version !== 1) {
            return { docsImported: 0, configImported: false, errors: ['Invalid or unsupported bundle version'] };
        }

        // Config
        let configImported = false;
        if (bundle.config) {
            if (replaceConfig) {
                lsSet(KEY_CONFIG, bundle.config);
            } else {
                saveConfig(bundle.config);
            }
            configImported = true;
        }

        // Docs
        if (Array.isArray(bundle.docs)) {
            if (replaceDocs) deleteAllDocs();

            bundle.docs.forEach(doc => {
                if (!doc?.id || typeof doc.content !== 'string') {
                    errors.push('Skipped malformed doc: ' + JSON.stringify(doc?.id));
                    return;
                }
                const ok = lsSet(docKey(doc.id), doc);
                if (ok) {
                    _addToIndex(doc.id);
                    docsImported++;
                } else {
                    errors.push('Failed to save doc: ' + doc.id);
                }
            });
        }

        return { docsImported, configImported, errors };
    }

    /* ════════════════════════════════════════
       EDITOR BRIDGE
       High-level functions that combine storage
       operations with loading content into the
       CodeMirror editor (via window.editor).
    ════════════════════════════════════════ */

    /** Push a string into the CodeMirror editor.
     *  Delegates to window.editor.value so the programmatic annotation
     *  is applied — preventing the updateListener from triggering autosave
     *  or status-count callbacks for code-driven loads. */
    function loadIntoEditor(content) {
        if (window.editor) {
            window.editor.value = content || '';
        } else if (window.cmView) {
            // Fallback before the editor shim is ready (should be rare)
            const view = window.cmView;
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: content || '' },
            });
        }
    }

    /** Flush the current editor content back to the active doc. */
    function autoSave() {
        const id = getActiveDocId();
        if (!id || !window.cmView) return;
        saveDoc({ id, content: window.cmView.state.doc.toString() });
    }

    /**
     * Open a doc: set it active, load its content into the editor.
     * @param {string} id
     * @returns {Doc|null}
     */
    function openDocIntoEditor(id) {
        const doc = openDoc(id);
        if (!doc) return null;
        loadIntoEditor(doc.content);
        return doc;
    }

    /**
     * Restore the previously active doc into the editor on page load.
     * Polls until window.cmView is ready, then wires the auto-save
     * listener by patching cmView.dispatch.
     */
    function restoreActiveDoc() {
        // Wire auto-save as soon as cmView is available
        let tries = 0;
        const interval = setInterval(() => {
            tries++;
            if (window.cmView) {
                clearInterval(interval);
                const orig = window.cmView.dispatch.bind(window.cmView);
                window.cmView.dispatch = function (tr) {
                    orig(tr);
                    if (tr.changes && !tr.changes.empty) {
                        clearTimeout(window._storeSaveTimer);
                        window._storeSaveTimer = setTimeout(autoSave, 800);
                    }
                };
                // Load last active doc, or seed a README on first launch / after reset
                const id = getActiveDocId();
                if (id) {
                    const doc = loadDoc(id);
                    if (doc) loadIntoEditor(doc.content);
                } else if (_getIndex().length === 0) {
                    // No docs at all — create the default README from template.md
                    fetch('template.md')
                        .then(r => r.ok ? r.text() : '')
                        .catch(() => '')
                        .then(content => {
                            const doc = saveDoc({ title: 'README', content });
                            if (!doc) return;
                            setActiveDocId(doc.id);
                            loadIntoEditor(content);
                            _emit('doc:loaded', { doc });
                        });
                }
            } else if (tries > 40) {
                clearInterval(interval);
            }
        }, 100);
    }

    /**
     * Return the next available "Untitled N" title.
     *
     * Scans existing doc titles for the pattern /^Untitled( \d+)?$/i and
     * picks the lowest positive integer not already in use.
     * Results: "Untitled 1", "Untitled 2", … (never bare "Untitled").
     */
    function _nextUntitledName() {
        const used = new Set(
            _getIndex()
                .map(id => lsGet(docKey(id))?.title ?? '')
                .map(t => {
                    const m = t.match(/^Untitled(?: (\d+))?$/i);
                    if (!m) return null;
                    return m[1] ? parseInt(m[1], 10) : 0; // bare "Untitled" → 0
                })
                .filter(n => n !== null)
        );
        let n = 1;
        while (used.has(n)) n++;
        return `Untitled ${n}`;
    }

    /**
     * Create a blank doc, activate it, clear the editor.
     * Emits 'doc:new' so the sidebar can trigger rename mode.
     * @returns {Doc|null}
     */
    function newDoc() {
        autoSave();
        const doc = saveDoc({ title: _nextUntitledName(), content: '' });
        if (!doc) return null;
        setActiveDocId(doc.id);
        loadIntoEditor('');
        _emit('doc:new', { doc });
        return doc;
    }

    /**
     * Create a doc pre-filled with the contents of template.md,
     * activate it, load into editor.
     * Emits 'doc:new' so the sidebar can trigger rename mode.
     */
    function newDocFromTemplateMd(type) {
        autoSave();
        fetch(type == 'mermaid' ? 'template-mermaid.md' : 'template-markdown.md')
            .then(r => r.ok ? r.text() : '')
            .catch(() => '')
            .then(content => {
                const doc = saveDoc({ title: _nextUntitledName(), content });
                if (!doc) return;
                setActiveDocId(doc.id);
                loadIntoEditor(content);
                _emit('doc:new', { doc });
            });
    }

    /**
     * Delete a doc after a browser confirm(). If the deleted doc was
     * active, the next available doc is opened (or the editor cleared).
     * @param {string} id
     * @param {string} title  – shown in the confirm dialog
     */
    function deleteDocWithConfirm(id, title) {
        if (!confirm(`Delete "${title}"?\nThis cannot be undone.`)) return;
        const wasActive = getActiveDocId() === id;
        deleteDoc(id);
        if (wasActive) {
            const remaining = listDocs();
            if (remaining.length > 0) {
                openDocIntoEditor(remaining[0].id);
            } else {
                loadIntoEditor('');
            }
        }
    }

    /* ════════════════════════════════════════
       STATUS BAR & STATS
       Status chip helpers and storage management.
    ════════════════════════════════════════ */

    /** Count words in a string (shared by statusWords and common-input-output.js). */
    function _wordCount(text) {
        return text.trim().split(/\s+/).filter(Boolean).length;
    }

    /** Escape text for safe insertion into HTML attributes or text nodes. */
    function _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ── _setStatValue ───────────────────────────────────────────────────────
       Status chips use a two-level DOM structure built by _buildGroup:
         <span class="toolbar-status-badge">
           <span class="stat-label">Label</span>
           <span class="stat-value">…</span>
         </span>
       We write only into .stat-value so the label is never clobbered. */
    function _setStatValue(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        const val = el.querySelector('.stat-value');
        if (val) {
            val.textContent = value;
        } else {
            // Fallback: plain chip with no inner structure yet
            el.textContent = value;
        }
    }

    /** Update the storage-usage status chip (KB used + % of 5 MB quota). */
    function statusStorage() {
        const info  = storageInfo();
        const MAX   = 5 * 1024 * 1024;
        const pct   = Math.min(100, (info.totalBytes / MAX) * 100);
        _setStatValue('status-storage', `${info.totalKB} KB (${pct.toFixed(1)}%)`);
    }

    /** Update the line-count status chip. */
    function statusLines() {
        const doc = window.cmView?.state.doc;
        _setStatValue('status-lines', 'L ' + (doc ? doc.lines : '–'));
    }

    /** Update the word-count status chip. */
    function statusWords() {
        const doc = window.cmView?.state.doc;
        _setStatValue('status-words', 'W ' + (doc ? _wordCount(doc.toString()) : 0));
    }

    /** Update the saved/unsaved status chip. */
    function isSaved() {
        const id = getActiveDocId();
        _setStatValue('status-saved', id ? '● Saved' : '● Unsaved');
    }

    /**
     * Wipe all editor data from localStorage after confirmation,
     * seed a fresh README from template.md, then refresh the status indicators.
     */
    function deleteLocalStorage() {
        if (!confirm('Delete ALL documents and settings from local storage?')) return;
        nukeStorage();
        newDocFromTemplateMd();
        statusStorage();
        isSaved();
    }

    /**
     * Start a lightweight polling loop that keeps line/word counts
     * up to date while the user types.
     * @param {number} [intervalMs=1000]
     */
    function startPolling(intervalMs = 1000) {
        setInterval(() => { statusLines(); statusWords(); }, intervalMs);
    }

    /* ════════════════════════════════════════
       CONTENT TYPE DETECTION
       Inspects raw document content and returns
       'mermaid' or 'markdown'.
    ════════════════════════════════════════ */

    /**
     * Detect whether a document's content is a Mermaid diagram or Markdown.
     *
     * Strategy: strip leading whitespace/blank lines, then test the first
     * meaningful line against the set of Mermaid diagram-type keywords.
     * Mermaid diagrams always begin with one of these keywords (optionally
     * followed by a direction token like LR / TD, or nothing at all).
     *
     * @param {string} content  – raw document text
     * @returns {'mermaid'|'markdown'}
     */
    function detectDocType(content) {
        if (!content || typeof content !== 'string') return 'markdown';

        // Walk lines until we find a non-empty one
        const lines = content.split('\n');
        let firstLine = '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) { firstLine = trimmed.toLowerCase(); break; }
        }
        if (!firstLine) return 'markdown';

        // Official Mermaid diagram types (as of Mermaid v10)
        const MERMAID_KEYWORDS = [
            'graph',           // graph TD / graph LR / …
            'flowchart',       // flowchart TD
            'sequencediagram', // sequenceDiagram
            'classdiagram',    // classDiagram
            'statediagram',    // stateDiagram / stateDiagram-v2
            'statediagram-v2',
            'erdiagram',       // erDiagram
            'gantt',
            'pie',
            'journey',         // user journey
            'gitgraph',
            'mindmap',
            'timeline',
            'sankey-beta',
            'quadrantchart',
            'xychart-beta',
            'block-beta',
            'architecture-beta',
            'requirementdiagram',
            'c4context',
            'c4container',
            'c4component',
            'c4dynamic',
            'c4deployment',
        ];

        // Extract the leading keyword (first word) and optionally the second
        // word so "graph TD", "graph LR", "pie title …" all match correctly.
        const firstWord = firstLine.split(/\s+/)[0];

        if (MERMAID_KEYWORDS.includes(firstWord)) return 'mermaid';

        return 'markdown';
    }

    /* ════════════════════════════════════════
       PUBLIC API
    ════════════════════════════════════════ */

    window.Store = {
        // Status bar & stats
        statusStorage,
        statusLines,
        statusWords,
        isSaved,
        deleteLocalStorage,
        startPolling,

        // Editor bridge
        autoSave,
        loadIntoEditor,
        openDocIntoEditor,
        restoreActiveDoc,
        newDoc,
        newDocFromTemplateMd,
        deleteDocWithConfirm,

        // Documents
        saveDoc,
        loadDoc,
        deleteDoc,
        listDocs,
        renameDoc,
        deleteAllDocs,

        // Active document
        getActiveDocId,
        setActiveDocId,

        // Config
        loadConfig,
        saveConfig,
        resetConfig,

        // Diagnostics & bulk ops
        storageInfo,
        nukeStorage,
        exportBundle,
        importBundle,

        // Utilities
        wordCount: _wordCount,
        escapeHtml: _escapeHtml,
        detectDocType,

        // Event bus
        on,
    };

})();
