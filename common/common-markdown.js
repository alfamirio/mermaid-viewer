/* common-md.js
   Formatting toolbar handlers — row 2 only.

   Toolbar buttons steal focus from CodeMirror when clicked, so
   view.state.selection is gone by the time onclick fires.
   We capture it on every 'mousedown' on #toolbar and keep it in
   _savedSel so all formatting functions operate on the right range.

   Depends on:
     window.cmView   CodeMirror EditorView (set up by index.html)
*/

'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   SELECTION CAPTURE
   Save the CM selection on every toolbar mousedown so onclick can use it.
═══════════════════════════════════════════════════════════════════════════ */

let _savedSel = null;   // { from, to } — set by _captureSelection()

function _captureSelection() {
    const view = window.cmView;
    if (!view) return;
    const main = view.state.selection.main;
    _savedSel = { from: main.from, to: main.to };
}

function _sel() {
    // Prefer the saved snapshot; fall back to live state (e.g. table modal)
    if (_savedSel) return _savedSel;
    const main = window.cmView?.state.selection.main;
    return main ? { from: main.from, to: main.to } : { from: 0, to: 0 };
}

function _focusEditor() {
    window.cmView?.focus();
    _savedSel = null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BASIC — inline wrap / unwrap
═══════════════════════════════════════════════════════════════════════════ */

/**
 * fmt(before, after)
 * Wraps the selection with markers; toggles off if already wrapped;
 * inserts pair at cursor when nothing is selected.
 *
 * Called by toolbar.json:
 *   fmt('**','**')  fmt('_','_')  fmt('~~','~~')  fmt('`','`')
 */
function fmt(before, after) {
    const view = window.cmView;
    if (!view) return;

    const state = view.state;
    const { from, to } = _sel();
    const bLen = before.length;
    const aLen = after.length;

    // Toggle off when markers already surround the selection
    if (
        from >= bLen &&
        state.doc.sliceString(from - bLen, from) === before &&
        state.doc.sliceString(to, to + aLen)     === after
    ) {
        view.dispatch({
            changes: [
                { from: from - bLen, to: from,             insert: '' },
                { from: to   - bLen, to: to - bLen + aLen, insert: '' },
            ],
            selection: { anchor: from - bLen, head: to - bLen },
        });
        _focusEditor();
        return;
    }

    const selTx = state.doc.sliceString(from, to);

    if (selTx) {
        view.dispatch({
            changes:   { from, to, insert: before + selTx + after },
            selection: { anchor: from + bLen, head: from + bLen + selTx.length },
        });
    } else {
        view.dispatch({
            changes:   { from, to, insert: before + after },
            selection: { anchor: from + bLen },
        });
    }
    _focusEditor();
}

/* ═══════════════════════════════════════════════════════════════════════════
   STRUCTURES — line-level prefixes
═══════════════════════════════════════════════════════════════════════════ */

/**
 * fmtLine(prefix)
 * Prepends prefix to every line in the selection; toggles off if all have it.
 *
 * Called by toolbar.json:
 *   fmtLine('> ')  fmtLine('- ')  fmtLine('1. ')
 *   fmtLine('# ')  fmtLine('## ')  fmtLine('### ')
 */
function fmtLine(prefix) {
    const view = window.cmView;
    if (!view) return;

    const state = view.state;
    const { from, to } = _sel();

    const startLine = state.doc.lineAt(from);
    const endLine   = state.doc.lineAt(to);

    const lines = [];
    for (let n = startLine.number; n <= endLine.number; n++) {
        lines.push(state.doc.line(n));
    }

    const allHavePrefix = lines.every(l => l.text.startsWith(prefix));
    const pLen  = prefix.length;
    const delta = allHavePrefix ? -pLen : pLen;

    const changes = lines.map(l =>
        allHavePrefix
            ? { from: l.from, to: l.from + pLen, insert: '' }
            : { from: l.from, to: l.from,         insert: prefix }
    );

    // anchor moves by one delta; head moves by delta per line
    view.dispatch({
        changes,
        selection: {
            anchor: Math.max(0, from + delta),
            head:   Math.max(0, to + delta * lines.length),
        },
    });
    _focusEditor();
}

/**
 * fmtBlock()
 * Wraps selected lines in a fenced code block; removes fences if already present.
 *
 * Called by toolbar.json:  fmtBlock()
 */
function fmtBlock() {
    const view = window.cmView;
    if (!view) return;

    const state = view.state;
    const { from, to } = _sel();

    const startLine = state.doc.lineAt(from);
    const endLine   = state.doc.lineAt(to);

    const prevNum  = startLine.number - 1;
    const nextNum  = endLine.number + 1;
    const prevLine = prevNum >= 1               ? state.doc.line(prevNum) : null;
    const nextLine = nextNum <= state.doc.lines ? state.doc.line(nextNum) : null;

    if (prevLine?.text.startsWith('```') && nextLine?.text.startsWith('```')) {
        // Remove fences — do in two separate dispatches to keep positions stable
        view.dispatch({ changes: { from: prevLine.from, to: prevLine.to + 1, insert: '' } });
        const ns       = view.state;
        const newNext  = ns.doc.line(endLine.number);   // shifted up by 1
        const fenceLine = ns.doc.line(newNext.number + 1);
        view.dispatch({ changes: { from: fenceLine.from - 1, to: fenceLine.to, insert: '' } });
        _focusEditor();
        return;
    }

    const body  = state.doc.sliceString(startLine.from, endLine.to);
    const fence = '```';
    view.dispatch({
        changes:   { from: startLine.from, to: endLine.to, insert: `${fence}\n${body}\n${fence}` },
        selection: { anchor: startLine.from + fence.length + 1 },
    });
    _focusEditor();
}

/**
 * insertText(text)
 * Inserts literal text at the cursor / replaces the selection.
 *
 * Called by toolbar.json:  insertText('\n---\n')
 */
function insertText(text) {
    const view = window.cmView;
    if (!view) return;

    const { from, to } = _sel();
    view.dispatch({
        changes:   { from, to, insert: text },
        selection: { anchor: from + text.length },
    });
    _focusEditor();
}

/**
 * insertLink()
 * Prompts for URL + label and inserts a Markdown link.
 *
 * Called by toolbar.json:  insertLink()
 */
function insertLink() {
    const view = window.cmView;
    if (!view) return;

    const { from, to } = _sel();
    const label = view.state.doc.sliceString(from, to).trim();

    const url = prompt('URL:', 'https://');
    if (!url) { _focusEditor(); return; }

    const text = label || prompt('Link text:', url) || url;
    const md   = `[${text}](${url})`;

    view.dispatch({
        changes:   { from, to, insert: md },
        selection: { anchor: from + md.length },
    });
    _focusEditor();
}

/* ═══════════════════════════════════════════════════════════════════════════
   TABLE MODAL
   btn-table has no onclick in toolbar.json — wired in CommonMd.init().
═══════════════════════════════════════════════════════════════════════════ */

function openTableModal() {
    // Capture selection now (called from a mousedown-wired button)
    _captureSelection();

    let modal = document.getElementById('md-table-modal');
    if (!modal) {
        modal = _buildTableModal();
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    modal.querySelector('#tbl-cols').value = '3';
    modal.querySelector('#tbl-rows').value = '3';
    modal.querySelector('#tbl-cols').focus();
}

function _buildTableModal() {
    const overlay = document.createElement('div');
    overlay.id = 'md-table-modal';
    overlay.style.cssText = [
        'position:fixed;inset:0;z-index:9999',
        'display:none;align-items:center;justify-content:center',
        'background:rgba(0,0,0,.55)',
    ].join(';');

    overlay.addEventListener('click', e => {
        if (e.target === overlay) { overlay.style.display = 'none'; _focusEditor(); }
    });

    const box = document.createElement('div');
    box.style.cssText = [
        'background:var(--bs-body-bg,#fff)',
        'color:var(--bs-body-color,#212529)',
        'border-radius:10px',
        'padding:1.5rem',
        'width:280px',
        'box-shadow:0 8px 32px rgba(0,0,0,.35)',
    ].join(';');

    box.innerHTML = `
      <h5 style="margin:0 0 1rem">Insert Table</h5>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem">
        <label style="font-size:.85rem">Columns
          <input id="tbl-cols" type="number" min="1" max="20" value="3"
                 style="display:block;width:100%;margin-top:.25rem;padding:.35rem .5rem;
                        border-radius:6px;border:1px solid var(--bs-border-color,#ced4da);
                        background:var(--bs-body-bg);color:var(--bs-body-color)">
        </label>
        <label style="font-size:.85rem">Rows
          <input id="tbl-rows" type="number" min="1" max="50" value="3"
                 style="display:block;width:100%;margin-top:.25rem;padding:.35rem .5rem;
                        border-radius:6px;border:1px solid var(--bs-border-color,#ced4da);
                        background:var(--bs-body-bg);color:var(--bs-body-color)">
        </label>
      </div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end">
        <button id="tbl-cancel"
                style="padding:.4rem 1rem;border-radius:6px;
                       border:1px solid var(--bs-border-color,#ced4da);
                       background:transparent;color:inherit;cursor:pointer">
          Cancel
        </button>
        <button id="tbl-insert"
                style="padding:.4rem 1rem;border-radius:6px;border:none;
                       background:var(--bs-primary,#0d6efd);color:#fff;cursor:pointer">
          Insert
        </button>
      </div>`;

    const close = () => { overlay.style.display = 'none'; _focusEditor(); };

    box.querySelector('#tbl-cancel').addEventListener('click', close);
    box.querySelector('#tbl-insert').addEventListener('click', () => {
        const cols = Math.max(1, Math.min(20, parseInt(box.querySelector('#tbl-cols').value) || 3));
        const rows = Math.max(1, Math.min(50, parseInt(box.querySelector('#tbl-rows').value) || 3));
        close();
        _insertTable(cols, rows);
    });
    box.querySelectorAll('input').forEach(inp =>
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter')  box.querySelector('#tbl-insert').click();
            if (e.key === 'Escape') close();
        })
    );

    overlay.appendChild(box);
    return overlay;
}

function _insertTable(cols, rows) {
    const header    = '| ' + Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(' | ') + ' |';
    const separator = '| ' + Array(cols).fill('---').join(' | ') + ' |';
    const dataRow   = '| ' + Array(cols).fill('     ').join(' | ') + ' |';
    insertText(`\n${header}\n${separator}\n${Array(rows).fill(dataRow).join('\n')}\n`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════════════════ */

window.CommonMd = (() => {

    function init() {
        // Capture the CM selection on every toolbar mousedown, before the
        // button click fires and focus moves away from the editor.
        const toolbar = document.getElementById('toolbar');
        if (toolbar) {
            toolbar.addEventListener('mousedown', _captureSelection);
        }

        // Wire btn-table (no onclick in toolbar.json)
        _wireBtnTable();
    }

    function _wireBtnTable() {
        const btn = document.getElementById('btn-table');
        if (btn) {
            // mousedown so the selection is still live when we capture it
            btn.addEventListener('mousedown', e => {
                e.preventDefault();   // keep focus in CM
                _captureSelection();
                openTableModal();
            });
            return;
        }
        new MutationObserver((_, obs) => {
            const b = document.getElementById('btn-table');
            if (b) {
                b.addEventListener('mousedown', e => {
                    e.preventDefault();
                    _captureSelection();
                    openTableModal();
                });
                obs.disconnect();
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    return { init };
})();
