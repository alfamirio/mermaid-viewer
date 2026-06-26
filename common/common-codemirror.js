// ── CodeMirror 6 setup ──────────────────────────────
  // Builds the editor instance and exposes window.editor with two
  // public members used by the rest of the app:
  //   .value (get/set) — read or replace the full document text
  //   .setWrap(bool) / .setHighlight(bool) — runtime compartment toggles
  // window.cmView is also set for direct dispatch access (Store, markdown toolbar).
  import { EditorView, keymap, placeholder, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
  import { EditorState, Compartment, Annotation } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap, deleteLine, indentMore, indentLess } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { syntaxHighlighting, HighlightStyle, bracketMatching } from "@codemirror/language";
  import { tags } from "@lezer/highlight";

  // Two colour palettes — one tuned for the dark theme (higher-lightness
  // hues that pop on a near-black background), one for light (the same
  // hues darkened/saturated so each still passes ~4.5:1 contrast against
  // a white background). Same hue per role in both palettes, so the
  // colour language (e.g. "headings are warm red→orange→yellow") stays
  // consistent when the user switches themes — only the lightness changes.
  const DARK_COLORS = {
    heading1: '#ff7b72', heading2: '#ffa657', heading3: '#f2cc60',
    heading4: '#7ee787', heading5: '#79c0ff', heading6: '#d2a8ff',
    link: '#3fb950', url: '#58a6ff', brace: '#d2a8ff',
    quote: '#c9d1d9', sigil: '#aeb5bd', list: '#97eb9f',
    rule: '#58faff', code: '#ffa657', strong: '#ffa657',
    emphasis: '#d2a8ff', strike: '#8b949e', comment: '#8b949e',
    keyword: '#ff7b72', value: '#79c0ff', string: '#a5d6ff',
    escape: '#ffa657', varName: '#e6edf3', localVar: '#ffa657',
    defVar: '#f0883e', fnName: '#d2a8ff', propName: '#7ee787',
    typeName: '#ffa657', className: '#f2cc60', labelName: '#ffa657',
    operator: '#ff7b72', punctuation: '#e6edf3', tagName: '#7ee787',
    attrName: '#79c0ff', attrValue: '#a5d6ff', angleBracket: '#8b949e',
    special: '#d2a8ff', modifier: '#ff7b72',
  };
  const LIGHT_COLORS = {
    heading1: '#d6172b', heading2: '#bf5a00', heading3: '#856200',
    heading4: '#1a8923', heading5: '#0076df', heading6: '#9d42ff',
    link: '#1a7f37', url: '#0071f3', brace: '#9d42ff',
    quote: '#5b6472', sigil: '#5d6773', list: '#1a8925',
    rule: '#08818a', code: '#bf5a00', strong: '#bf5a00',
    emphasis: '#9d42ff', strike: '#65707a', comment: '#65707a',
    keyword: '#d6172b', value: '#0076df', string: '#0077db',
    escape: '#bf5a00', varName: '#3d4654', localVar: '#bf5a00',
    defVar: '#c0590f', fnName: '#9d42ff', propName: '#1a8923',
    typeName: '#bf5a00', className: '#856200', labelName: '#bf5a00',
    operator: '#d6172b', punctuation: '#3d4654', tagName: '#1a8923',
    attrName: '#0076df', attrValue: '#0077db', angleBracket: '#65707a',
    special: '#9d42ff', modifier: '#d6172b',
  };

  // Builds a HighlightStyle from one of the palettes above. Called once
  // up front for the initial theme, then again whenever the theme flips
  // (see the MutationObserver near the bottom of this file), swapping the
  // active style through highlightCompartment so the doc/selection state
  // is preserved — no editor rebuild needed.
  function buildHighlightStyle(c) {
    return HighlightStyle.define([
      // ── Headings — each level gets its own hue ──────────────────
      { tag: tags.heading1,              color: c.heading1, fontWeight: '700', fontSize: '1.2em' },
      { tag: tags.heading2,              color: c.heading2, fontWeight: '700', fontSize: '1.1em' },
      { tag: tags.heading3,              color: c.heading3, fontWeight: '700' },
      { tag: tags.heading4,              color: c.heading4, fontWeight: '600' },
      { tag: tags.heading5,              color: c.heading5, fontWeight: '600' },
      { tag: tags.heading6,              color: c.heading6, fontWeight: '600' },
      { tag: tags.heading,               color: c.heading1, fontWeight: '700' }, // fallback

      // ── Links & URLs ──────────────────────────────────────────────
      { tag: tags.link,                  color: c.link, fontWeight: '600' },   // [name] → green
      { tag: tags.url,                   color: c.url, fontStyle: 'italic' },  // (url)  → blue
      { tag: tags.special(tags.brace),   color: c.brace },

      // ── Blockquote ────────────────────────────────────────────────
      { tag: tags.quote,                 color: c.quote, fontStyle: 'italic' },

      // ── Markup punctuation (##, **, __, ~~, >, -, ``) ─────────────
      // These are the literal sigil characters — must be clearly visible
      { tag: tags.processingInstruction, color: c.sigil, fontWeight: '700' },
      { tag: tags.meta,                  color: c.sigil },

      // ── Lists ─────────────────────────────────────────────────────
      { tag: tags.list,                  color: c.list },

      // ── Horizontal rule ───────────────────────────────────────────
      { tag: tags.contentSeparator,      color: c.rule, fontWeight: '700' },

      // ── Inline code ───────────────────────────────────────────────
      { tag: tags.monospace,             color: c.code },

      // ── Inline emphasis ───────────────────────────────────────────
      { tag: tags.strong,                color: c.strong, fontWeight: '700' },
      { tag: tags.emphasis,              color: c.emphasis, fontStyle: 'italic' },
      { tag: tags.strikethrough,         color: c.strike, textDecoration: 'line-through' },

      // ── Code fence — fenced block content (generic fallback) ──────
      { tag: tags.comment,               color: c.comment, fontStyle: 'italic' },

      // ── Code fence — language keywords ───────────────────────────
      { tag: tags.keyword,               color: c.keyword },
      { tag: tags.controlKeyword,        color: c.keyword },
      { tag: tags.definitionKeyword,     color: c.keyword },
      { tag: tags.moduleKeyword,         color: c.keyword },
      { tag: tags.operatorKeyword,       color: c.keyword },

      // ── Code fence — values ───────────────────────────────────────
      { tag: tags.atom,                  color: c.value },
      { tag: tags.bool,                  color: c.value },
      { tag: tags.null,                  color: c.value },
      { tag: tags.number,                color: c.value },
      { tag: tags.integer,               color: c.value },
      { tag: tags.float,                 color: c.value },

      // ── Code fence — strings ──────────────────────────────────────
      { tag: tags.string,                color: c.string },
      { tag: tags.special(tags.string),  color: c.string },
      { tag: tags.regexp,                color: c.escape },
      { tag: tags.escape,                color: c.escape },

      // ── Code fence — names ────────────────────────────────────────
      { tag: tags.variableName,          color: c.varName },
      { tag: tags.local(tags.variableName), color: c.localVar },
      { tag: tags.definition(tags.variableName), color: c.defVar },
      { tag: tags.function(tags.variableName),   color: c.fnName },
      { tag: tags.propertyName,          color: c.propName },
      { tag: tags.definition(tags.propertyName), color: c.propName },
      { tag: tags.function(tags.propertyName),   color: c.fnName },
      { tag: tags.typeName,              color: c.typeName },
      { tag: tags.className,             color: c.className },
      { tag: tags.namespace,             color: c.className },
      { tag: tags.labelName,             color: c.labelName },

      // ── Code fence — operators & punctuation ──────────────────────
      { tag: tags.operator,              color: c.operator },
      { tag: tags.punctuation,           color: c.punctuation },
      { tag: tags.bracket,               color: c.punctuation },
      { tag: tags.separator,             color: c.punctuation },
      { tag: tags.derefOperator,         color: c.punctuation },

      // ── HTML tags inside markdown ─────────────────────────────────
      { tag: tags.tagName,               color: c.tagName },
      { tag: tags.attributeName,         color: c.attrName },
      { tag: tags.attributeValue,        color: c.attrValue },
      { tag: tags.angleBracket,          color: c.angleBracket },

      // ── Special / decorators ──────────────────────────────────────
      { tag: tags.special(tags.variableName), color: c.special },
      { tag: tags.annotation,            color: c.special },
      { tag: tags.modifier,              color: c.modifier },
      { tag: tags.self,                  color: c.modifier },
    ]);
  }

  function _isDarkTheme() {
    return document.documentElement.getAttribute('data-bs-theme') !== 'light';
  }

  const darkHighlightStyle  = buildHighlightStyle(DARK_COLORS);
  const lightHighlightStyle = buildHighlightStyle(LIGHT_COLORS);

  // Compartments let us flip wrap / highlighting on and off at runtime
  // without tearing down and rebuilding the whole editor state.
  const wrapCompartment      = new Compartment();
  const highlightCompartment = new Compartment();

  // Returns the syntaxHighlighting extension for whichever theme is
  // active right now. Re-evaluated on every call (cheap — just an
  // attribute read + extension wrap) so callers always get the current
  // theme's colours rather than whatever was active at module load.
  function _currentHighlightExt() {
    return syntaxHighlighting(_isDarkTheme() ? darkHighlightStyle : lightHighlightStyle);
  }
  const highlightExt = _currentHighlightExt();

  // Tags transactions dispatched by setting .value so the update listener
  // fires _fireInput only for genuine user edits, not programmatic loads.
  const programmatic = Annotation.define();

  const selectionTheme = EditorView.theme({
    // Bug fix: selected text was invisible. Two compounding causes:
    //  1) index.html had a dark-mode rule that reset .cm-selectionBackground
    //     to `unset`, wiping out the selection colour entirely in dark mode.
    //  2) .cm-activeLine's background paints on the .cm-line element itself,
    //     which sits in front of the .cm-selectionLayer drawn by
    //     drawSelection() — so on the line containing the caret/selection
    //     head, an opaque active-line fill visually covered the selection
    //     highlight on that one line.
    // Fix: (a) made the selection colour fully opaque so it reads clearly
    // on its own, and (b) the updateListener below toggles a `has-selection`
    // class on #cm-host whenever the selection isn't empty, so the
    // `#cm-host.has-selection .cm-activeLine` rule below can drop the
    // active-line fill for as long as a real selection is in effect.
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      background: '#2d63b8 !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      background: '#3573d6 !important',
    },
    // Active line: noticeably stronger fill + a left accent bar so the
    // current line is easy to find at a glance, but still subtle enough
    // not to compete with token colours when nothing is selected.
    '.cm-activeLine': {
      backgroundColor: 'rgba(88, 166, 255, 0.10)',
      borderTop:       '1px solid rgba(88, 166, 255, 0.35)',
      borderBottom:    '1px solid rgba(88, 166, 255, 0.35)',
    },
    // See note above — suppressed while a real selection exists so it
    // can't paint over the selection highlight on the caret's line.
    '#cm-host.has-selection .cm-activeLine': {
      backgroundColor: 'transparent',
      borderTop:       '1px solid transparent',
      borderBottom:    '1px solid transparent',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#1e2a3a !important',
      color:           '#58a6ff !important',
      fontWeight:      '700',
      borderLeft:      '3px solid #58a6ff',
    },
    // Cursor: wide and light-blue so it stands out in dense dark text.
    '&.cm-focused .cm-cursor, &.cm-focused .cm-dropCursor': {
      borderLeftColor: '#93c5fd !important',
      borderLeftWidth: '3px    !important',
    },
  });

  const view = new EditorView({
    parent: document.getElementById('cm-host'),
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        bracketMatching(),
        history(),
        keymap.of([
          { key: 'Mod-d', run: deleteLine },
          // Tab/Shift-Tab: indent/outdent. indentMore/indentLess shift the
          // indentation of every line touched by the selection (or just the
          // current line with a collapsed cursor) by one tab stop — they
          // don't insert a literal tab character at the cursor, matching
          // how Tab/Shift-Tab behave in most code editors.
          { key: 'Tab', run: indentMore, shift: indentLess },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        highlightCompartment.of(highlightExt),
        wrapCompartment.of(EditorView.lineWrapping),
        selectionTheme,
        placeholder('Start writing Markdown here…'),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            // Render preview for ALL doc changes — both user typing and
            // programmatic loads (loadIntoEditor). _fireInput is still
            // fired for non-programmatic changes so external 'input'
            // listeners (autosave, status counts, etc.) keep working.
            window.updatePreview(update.state.doc.toString());
            if (!update.transactions.some(tr => tr.annotation(programmatic))) {
              window.editor._fireInput();
            }
          }
          if (update.selectionSet || update.docChanged) {
            // .cm-activeLine paints its background directly on the .cm-line
            // element, which sits in front of the .cm-selectionLayer drawn by
            // drawSelection() — so on the line the cursor/selection-head is on,
            // an opaque active-line fill visually hides the selection colour.
            // Toggling this class lets CSS drop the active-line fill to ~0
            // whenever there's a real (non-collapsed) selection, so the
            // selection highlight on that line stays fully visible; once the
            // selection collapses back to a caret, the active-line fill
            // returns immediately.
            const host = document.getElementById('cm-host');
            if (host) host.classList.toggle('has-selection', !update.state.selection.main.empty);
          }
        }),
      ],
    }),
  });

  // ── window.editor ───────────────────────────────────

  const listeners = { input: [] };

  window.editor = {
    _view: view,

    get value() { return view.state.doc.toString(); },
    set value(v) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: v },
        annotations: programmatic.of(true),
      });
    },

    _fireInput() { listeners.input.forEach(fn => fn()); },
  };

  // ── Wrap / highlight toggles (called from toggleWrap/toggleHighlight) ──
  window.editor.setWrap = on => {
    view.dispatch({ effects: wrapCompartment.reconfigure(on ? EditorView.lineWrapping : []) });
  };
  window.editor.setHighlight = on => {
    view.dispatch({ effects: highlightCompartment.reconfigure(on ? _currentHighlightExt() : []) });
  };

  // window.cmView — exposed for direct dispatch in common-markdown.js toolbar handlers.
  window.cmView = view;

  // ── Sync-scroll ─────────────────────────────────────────────────────────
  // window._syncScroll is the boolean flag Layout.toggleSyncScroll() flips.
  // Listeners are always attached; the flag gates whether they act.
  window._syncScroll = true;
  let _syncingFrom = null;

  view.scrollDOM.addEventListener('scroll', e => {
    if (!window._syncScroll || _syncingFrom === 'preview') return;
    const editorEl = e.target.closest('.cm-scroller');
    if (!editorEl) return;
    const preview = document.getElementById('preview');
    if (!preview) return;
    _syncingFrom = 'editor';
    const frac = editorEl.scrollTop / (editorEl.scrollHeight - editorEl.clientHeight || 1);
    preview.scrollTop = frac * (preview.scrollHeight - preview.clientHeight);
    requestAnimationFrame(() => { _syncingFrom = null; });
  }, { passive: true });

  document.getElementById('preview').addEventListener('scroll', () => {
    if (!window._syncScroll || _syncingFrom === 'editor') return;
    const preview  = document.getElementById('preview');
    const scroller = document.querySelector('.cm-scroller');
    if (!preview || !scroller) return;
    _syncingFrom = 'preview';
    const frac = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
    scroller.scrollTop = frac * (scroller.scrollHeight - scroller.clientHeight);
    requestAnimationFrame(() => { _syncingFrom = null; });
  }, { passive: true });

  // ── cmReconfigure ────────────────────────────────────────────────────────
  // Called by Layout.toggleWrap() and Layout.toggleHighlight().
  // Uses compartments so doc/selection are preserved — no full state rebuild.
  window.cmReconfigure = function ({ wrap, highlight }) {
    if (wrap !== undefined)      window.editor.setWrap(wrap);
    if (highlight !== undefined) window.editor.setHighlight(highlight);
  };

  // ── updatePreview ────────────────────────────────────────────────────────
  // Single entry-point for rendering editor content into #preview-content.
  // Respects the editorMode stored in config ('markdown' | 'mermaid').
  // Called from the EditorView.updateListener above and from Layout.setEditorMode().
  window.updatePreview = function (text) {
    const el = document.getElementById('preview-content');
    if (!el) return;

    const cfg  = window.Store?.loadConfig() ?? {};
    const mode = cfg.editorMode || 'markdown';

    if (mode === 'mermaid') {
      el.innerHTML = '';
      const container = document.createElement('div');
      container.className = 'mermaid-preview-container';

      if (!text.trim()) {
        container.innerHTML = '<p style="opacity:0.5;font-size:0.85rem;">Start typing a Mermaid diagram…</p>';
        el.appendChild(container);
        return;
      }

      // Wrap bare diagram source in a div; mermaid.render needs an id
      const id = 'mermaid-out-' + Date.now();
      const isDark = document.documentElement.getAttribute('data-bs-theme') !== 'light';

      if (window.mermaid) {
        // Re-init so the theme matches the current BS theme
        window.mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
        });

        window.mermaid.render(id, text.trim())
          .then(({ svg }) => {
            container.innerHTML = svg;
            el.appendChild(container);
          })
          .catch(err => {
            container.innerHTML = `<pre style="color:#e74c3c;white-space:pre-wrap;font-size:0.82rem;">${
              String(err?.message || err).replace(/</g, '&lt;')
            }</pre>`;
            el.appendChild(container);
          });
      } else {
        container.innerHTML = '<p style="color:#e74c3c;font-size:0.85rem;">Mermaid library not loaded.</p>';
        el.appendChild(container);
      }

    } else {
      // Default: Markdown
      if (window.marked) el.innerHTML = window.marked.parse(text);
    }
  };

  // Keep wrap/highlight in sync when the Bootstrap theme attribute flips.
  // setHighlight(true) re-reads the *current* theme via _currentHighlightExt(),
  // so this also swaps the syntax-highlight palette (dark ⇄ light colours)
  // whenever the user toggles the theme — not just the on/off state.
  new MutationObserver(() => {
    const cfg = window.Store?.loadConfig() ?? { wrap: true, highlight: true };
    window.editor.setWrap(cfg.wrap !== false);
    window.editor.setHighlight(cfg.highlight !== false);
    // Re-render preview so mermaid picks up the new theme
    if (typeof window.updatePreview === 'function') {
      window.updatePreview(window.cmView?.state.doc.toString() ?? '');
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
