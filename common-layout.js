/* common-layout.js
   Toolbar, sidebar file-list, and layout (split/view-mode) for the Markdown editor.

   Depends on:
     - Split.js  (global)
     - Store     (common-local-storage.js)

   Exposes (window globals):
     Toolbar.init(jsonUrl), Toolbar.toggleTheme()
     Layout.init(), Layout.toggleSidebar(), Layout.setViewMode(mode),
       Layout.toggleWrap(), Layout.toggleHighlight(), Layout.toggleSyncScroll()
     Sidebar.init(), Sidebar.render(), Sidebar.newDoc(), Sidebar.newFromTemplate()
*/

(function () {
'use strict';

/* ════════════════════════════════════════════════════════════════════════
   TOOLBAR
   Builds toolbar rows from a JSON config and handles the theme toggle.
════════════════════════════════════════════════════════════════════════ */

window.Toolbar = (() => {


    /* ── _buildGroup ──────────────────────────────────────────────────────
       Renders a single toolbar group (<div class="toolbar-group">) from a
       group config object.

       Buttons  → outline (btn-outline-<color>) for toggle groups
                  (group.type === "toggle"), filled (btn-<color>) for normal
                  action groups. Falls back to "secondary" when uncoloured.
       Spans    → Bootstrap badge (badge bg-<color>) with a two-line
                  label/value structure; color falls back to "secondary". */
    function _buildGroup(group) {
        const wrapper = document.createElement('div');
        wrapper.className = 'toolbar-group';
        if (group.color) wrapper.dataset.color = group.color;

        // Resolve the Bootstrap color token for this group.
        // Only these six semantic names are supported — anything else
        // (including no color at all) returns null; call sites fall back
        // to "secondary".
        const VALID_COLORS = ['secondary', 'primary', 'success', 'warning', 'danger', 'info'];
        const _resolveColor = c => (c && VALID_COLORS.includes(c)) ? c : null;
        const bsColor = _resolveColor(group.color);

        // Toggle groups render as outline buttons; normal action groups render
        // filled. Also tolerates the "toogle" typo that may appear in toolbar.json.
        const isToggleGroup = group.type === 'toggle' || group.type === 'toogle';

        (group.elements || []).forEach(btn => {
            // Element-level color overrides group color
            const elColor = _resolveColor(btn.color) || bsColor;

            if (btn.type === 'span') {
                const badgeColor = elColor || 'secondary';
                const s = document.createElement('span');
                s.className = `badge bg-${badgeColor} toolbar-status-badge`;
                if (btn.id) s.id = btn.id;

                const lbl = document.createElement('span');
                lbl.className   = 'stat-label';
                lbl.textContent = btn.label;

                const val = document.createElement('span');
                val.className = 'stat-value';

                s.appendChild(lbl);
                s.appendChild(val);
                wrapper.appendChild(s);
            } else {
                const b = document.createElement('button');
                const colorName = elColor || 'secondary';
                const btnColor  = isToggleGroup
                    ? `btn-outline-${colorName}`
                    : `btn-${colorName}`;
                b.className   = `btn ${btnColor} btn-sm`;
                b.textContent = btn.label;
                if (btn.id)      b.id = btn.id;
                if (btn.onclick) b.setAttribute('onclick', btn.onclick);
                wrapper.appendChild(b);
            }
        });

        return wrapper;
    }

    /* ── _sep ─────────────────────────────────────────────────────────── */
    function _sep() {
        const el = document.createElement('div');
        el.className = 'toolbar-sep';
        return el;
    }

    /* ── init ─────────────────────────────────────────────────────────── */
    async function init(jsonUrl) {
        const res    = await fetch(jsonUrl);
        const config = await res.json();

        const row1 = document.getElementById('toolbar-row-1');
        const row2 = document.getElementById('toolbar-row-2');

        const statusGroup = config.find(g => g.group === 'Status');
        const mainGroups  = config.filter(g => g.group !== 'Status' && g.row !== 2);
        const row2Groups  = config.filter(g => g.row === 2);

        /* Row 1: main groups */
        mainGroups.forEach((group, i) => {
            if (i > 0) row1.appendChild(_sep());
            row1.appendChild(_buildGroup(group));
        });

        /* Spacer + status group, right-aligned */
        const spacer = document.createElement('div');
        spacer.className = 'toolbar-spacer';
        row1.appendChild(spacer);

        if (statusGroup) {
            row1.appendChild(_sep());
            row1.appendChild(_buildGroup(statusGroup));
        }

        /* Row 2: nested sub-groups inside Formatting entries */
        row2Groups.forEach(group => {
            const subGroups = group.groups || [];
            let first = true;

            subGroups.forEach(sub => {
                if (!first) row2.appendChild(_sep());
                first = false;
                row2.appendChild(_buildGroup(sub));
            });

            // Also handle flat elements at the top-level row-2 group
            if (group.elements && group.elements.length) {
                if (!first) row2.appendChild(_sep());
                row2.appendChild(_buildGroup(group));
            }
        });

        /* Sync the theme button label now that the DOM exists */
        _syncThemeButton();
    }

    /* ── _syncThemeButton ─────────────────────────────────────────────── */
    function _syncThemeButton() {
        const btn = document.getElementById('btn-theme-toolbar');
        if (!btn) return;
        const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
        btn.textContent = isDark ? '☀ Light' : '☾ Dark';
    }

    /* ── toggleTheme ──────────────────────────────────────────────────── */
    function toggleTheme() {
        const html = document.documentElement;
        const next = html.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-bs-theme', next);
        Store.saveConfig({ theme: next });
        _syncThemeButton();
    }

    return { init, toggleTheme };

})();


/* ════════════════════════════════════════════════════════════════════════
   LAYOUT
   Manages the Split.js instance and view-mode (editor / both / preview).
════════════════════════════════════════════════════════════════════════ */

window.Layout = (() => {


    /* ── _rebuildSplit ────────────────────────────────────────────────────
       Single source of truth for the Split.js instance.
       Destroys the current instance (if any) and creates a fresh one with
       only the currently-visible panes as participants.
       Panes hidden from the current view get display:none before Split
       initialises so no wrapper or gutter is ever left dangling. */
    function _rebuildSplit(sidebarOn, viewMode) {
        if (window._splitInstance) {
            window._splitInstance.destroy();
            window._splitInstance = null;
        }

        const sidebar = document.getElementById('sidebar');
        const editor  = document.getElementById('cm-host');
        const preview = document.getElementById('preview');

        // Reset all panes to full flex participation
        [sidebar, editor, preview].forEach(el => {
            el.style.display = '';
            el.style.width   = '';
        });

        const showEditor  = viewMode !== 'preview';
        const showPreview = viewMode !== 'editor';

        if (!sidebarOn)   sidebar.style.display = 'none';
        if (!showEditor)  editor.style.display  = 'none';
        if (!showPreview) preview.style.display  = 'none';

        const cfg   = Store.loadConfig();
        const saved = cfg.splitSizes || [15, 42, 43];

        const panes    = [];
        const sizes    = [];
        const minSizes = [];

        if (sidebarOn)   { panes.push(sidebar); sizes.push(saved[0]); minSizes.push(120); }
        if (showEditor)  { panes.push(editor);  sizes.push(saved[1]); minSizes.push(180); }
        if (showPreview) { panes.push(preview); sizes.push(saved[2]); minSizes.push(180); }

        if (panes.length < 2) {
            if (panes.length === 1) panes[0].style.width = '100%';
            return;
        }

        let normSizes;
        if (sidebarOn && panes.length === 2) {
            normSizes = [saved[0], 100 - saved[0]];
        } else {
            const total = sizes.reduce((a, b) => a + b, 0);
            normSizes   = sizes.map(s => (s / total) * 100);
        }

        window._splitInstance = Split(panes, {
            sizes:      normSizes,
            minSize:    minSizes,
            gutterSize: 4,
            direction:  'horizontal',
            cursor:     'col-resize',
            onDragEnd(newSizes) {
                // Map the active-pane sizes back into the full 3-slot array
                let si = 0;
                const full = [saved[0], saved[1], saved[2]];
                if (sidebarOn)   full[0] = newSizes[si++];
                if (showEditor)  full[1] = newSizes[si++];
                if (showPreview) full[2] = newSizes[si++];
                Store.saveConfig({ splitSizes: full });
            },
        });
    }

    /* ── _cmReconfigure ──────────────────────────────────────────────────
       Reads the current config and calls window.cmReconfigure.
       Theme changes are handled by the MutationObserver in common-codemirror.js
       and do not need to be forwarded here. */
    function _cmReconfigure() {
        if (typeof window.cmReconfigure !== 'function') return;
        const cfg = Store.loadConfig();
        window.cmReconfigure({ wrap: cfg.wrap, highlight: cfg.highlight });
    }

    /* ── _syncToggleButton ───────────────────────────────────────────────
       Sets btn-toolbar-active on a button to reflect a boolean state. */
    function _syncToggleButton(id, active) {
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('btn-toolbar-active', active);
    }

    /* ── toggleWrap ──────────────────────────────────────────────────────
       Flips line-wrapping in CodeMirror. */
    function toggleWrap() {
        const cfg  = Store.loadConfig();
        const next = !cfg.wrap;
        Store.saveConfig({ wrap: next });
        _cmReconfigure();
        _syncToggleButton('btn-wrap', next);
    }

    /* ── toggleHighlight ─────────────────────────────────────────────────
       Flips syntax highlighting in CodeMirror via the highlight compartment. */
    function toggleHighlight() {
        const cfg  = Store.loadConfig();
        const next = !cfg.highlight;
        Store.saveConfig({ highlight: next });
        _cmReconfigure();
        _syncToggleButton('btn-highlight', next);
    }

    /* ── toggleSyncScroll ────────────────────────────────────────────────
       Enables / disables mirroring of editor scroll position to the preview.
       The actual scroll listeners live in the module script; this function
       just flips the window._syncScroll flag they read. */
    function toggleSyncScroll() {
        const cfg  = Store.loadConfig();
        const next = !cfg.syncScroll;
        Store.saveConfig({ syncScroll: next });
        window._syncScroll = next;
        _syncToggleButton('btn-sync-scroll', next);
    }

    /* ── toggleSidebar ────────────────────────────────────────────────── */
    function toggleSidebar() {
        const cfg        = Store.loadConfig();
        const wasVisible = cfg.sidebar !== false;
        const next       = !wasVisible;

        Store.saveConfig({ sidebar: next });
        _rebuildSplit(next, cfg.viewMode || 'both');

        const btn = document.getElementById('btn-sidebar');
        if (btn) btn.classList.toggle('btn-toolbar-active', next);
    }

    /* ── setViewMode ──────────────────────────────────────────────────── */
    function setViewMode(mode) {
        const modeMap = {
            editor:  'btn-view-editor',
            both:    'btn-view-both',
            preview: 'btn-view-preview',
        };

        Object.values(modeMap).forEach(id => {
            const b = document.getElementById(id);
            if (b) b.classList.remove('btn-toolbar-active');
        });
        const active = document.getElementById(modeMap[mode]);
        if (active) active.classList.add('btn-toolbar-active');

        Store.saveConfig({ viewMode: mode });
        const cfg = Store.loadConfig();
        _rebuildSplit(cfg.sidebar !== false, mode);
    }

    /* ── init ─────────────────────────────────────────────────────────── */
    function init() {
        const cfg       = Store.loadConfig();
        const sidebarOn = cfg.sidebar !== false;

        // Reflect persisted sidebar state onto its toggle button
        // (active = sidebar shown, same convention as every other toggle)
        _syncToggleButton('btn-sidebar', sidebarOn);

        // Reflect persisted toggle states
        _syncToggleButton('btn-wrap',        cfg.wrap);
        _syncToggleButton('btn-highlight',   cfg.highlight);
        _syncToggleButton('btn-sync-scroll', cfg.syncScroll);

        // Seed the live sync-scroll flag read by the module scroll listeners
        window._syncScroll = cfg.syncScroll;

        setViewMode(cfg.viewMode || 'both');
    }

    return { init, toggleSidebar, setViewMode, toggleWrap, toggleHighlight, toggleSyncScroll };

})();


/* ════════════════════════════════════════════════════════════════════════
   SIDEBAR
   Renders the file list and handles new-doc, rename, and delete actions.
════════════════════════════════════════════════════════════════════════ */

window.Sidebar = (() => {


    /* ── DOM helper ───────────────────────────────────────────────────── */
    const $l = () => document.getElementById('file-list');

    /* ── render ───────────────────────────────────────────────────────── */
    function render() {
        const docs     = Store.listDocs();
        const activeId = Store.getActiveDocId();
        const ul       = $l();
        ul.innerHTML   = '';

        if (docs.length === 0) {
            ul.innerHTML = `
                <li style="padding:24px 0;text-align:center;opacity:0.4;font-size:0.75rem;pointer-events:none">
                    <i class="bi bi-folder2-open" style="font-size:1.6rem;display:block;margin-bottom:6px"></i>
                    No files yet
                </li>`;
            return;
        }

        docs.forEach(meta => {
            const li = document.createElement('li');
            li.className  = 'file-item' + (meta.id === activeId ? ' active' : '');
            li.dataset.id = meta.id;

            li.innerHTML = `
                <i class="bi bi-file-earmark-text file-item-icon"></i>
                <span class="file-item-name" title="${Store.escapeHtml(meta.title)}">${Store.escapeHtml(meta.title)}</span>
                <div class="file-item-actions">
                    <button class="file-item-btn" title="Rename" data-action="rename">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="file-item-btn danger" title="Delete" data-action="delete">
                        <i class="bi bi-trash3"></i>
                    </button>
                </div>`;

            li.addEventListener('click', e => {
                if (e.target.closest('.file-item-actions')) return;
                Store.openDocIntoEditor(meta.id);
            });

            li.querySelector('[data-action="rename"]').addEventListener('click', e => {
                e.stopPropagation();
                _startRename(meta.id);
            });
            li.querySelector('[data-action="delete"]').addEventListener('click', e => {
                e.stopPropagation();
                Store.deleteDocWithConfirm(meta.id, meta.title);
            });

            ul.appendChild(li);
        });
    }

    /* ── _startRename ─────────────────────────────────────────────────── */
    function _startRename(id) {
        render();
        const li = $l().querySelector(`[data-id="${id}"]`);
        if (!li) return;

        const nameEl  = li.querySelector('.file-item-name');
        const actions = li.querySelector('.file-item-actions');
        const current = Store.listDocs().find(d => d.id === id)?.title || '';

        const input = document.createElement('input');
        input.type      = 'text';
        input.className = 'file-item-rename-input';
        input.value     = current;

        nameEl.replaceWith(input);
        actions.style.opacity      = '0';
        actions.style.pointerEvents = 'none';
        input.focus();
        input.select();

        let committed = false;
        const commit = () => {
            if (committed) return;
            committed = true;
            Store.renameDoc(id, input.value.trim() || 'Untitled');
            render();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { committed = true; input.blur(); render(); }
        });
    }

    /* ── _bindStoreEvents ─────────────────────────────────────────────── */
    function _bindStoreEvents() {
        ['doc:saved', 'doc:deleted', 'doc:active_changed', 'doc:all_deleted', 'storage:nuked']
            .forEach(ev => Store.on(ev, render));

        // When a new doc is created, re-render then immediately enter rename mode
        Store.on('doc:new', ({ doc }) => {
            render();
            _startRename(doc.id);
        });
    }

    /* ── init ─────────────────────────────────────────────────────────── */
    function init() {
        _bindStoreEvents();
        render();
        Store.restoreActiveDoc();
    }

    return {
        init,
        render,
        newDoc:          () => Store.newDoc(),
        newFromTemplate: () => Store.newDocFromTemplateMd(),
    };

})(); // end Sidebar

})(); // end common-layout.js IIFE
