/* common-input-output-mermaid.js
   Export helpers for Mermaid diagrams rendered in the preview pane.
   Depends on: the Mermaid SVG being present inside #preview-content
               (injected by common-markdown.js when editor-mode is "mermaid")

   Public API (called by toolbar buttons):
     exportMermaidPng()   — downloads the diagram as a .png file
     exportMermaidWebp()  — downloads the diagram as a .webp file

   Taint-safety: all external URLs (@import / @font-face / url(…)) inside SVG
   <style> blocks are fetched and replaced with base64 data-URIs before the
   SVG is drawn onto a canvas, keeping the canvas untainted.

   Resolution: the export target is MIN_EXPORT_PX on the long side, scaled up
   from the rendered screen size.  Mermaid SVGs frequently have no explicit
   width/height (or tiny ones), so we read the actual rendered size via
   getBoundingClientRect() and use the viewBox aspect ratio to derive clean
   pixel dimensions.
*/

'use strict';

/* ── Config ───────────────────────────────────────────────── */

/** Minimum pixels on the long side of the exported image. */
const _MERMAID_MIN_EXPORT_PX = 2400;

/* ── SVG lookup ───────────────────────────────────────────── */

function _getMermaidSvg() {
    return document.querySelector('#preview-content .mermaid-preview-container svg')
        ?? document.querySelector('#preview-content svg');
}

/* ── Filename helper ──────────────────────────────────────── */

function _stemFromMermaid() {
    const text  = window.cmView?.state.doc.toString() ?? '';
    const line  = text.split('\n').find(l => l.startsWith('# '));
    const title = line ? line.replace(/^#+\s*/, '').trim() : null;
    if (!title) return 'diagram';
    return title
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase()
        || 'diagram';
}

/* ── Dimension resolver ───────────────────────────────────── */

/**
 * _resolveDimensions(svgEl)
 * Returns { svgW, svgH, scale } where svgW×svgH are the logical pixel
 * dimensions to stamp on the clone, and scale is the canvas multiplier.
 *
 * Priority:
 *   1. viewBox — most reliable for Mermaid; gives true aspect ratio.
 *   2. width/height attributes (if numeric and > 1).
 *   3. getBoundingClientRect() — actual rendered size.
 *   4. Hard fallback 800×600.
 *
 * We then choose a scale so the longer side reaches at least
 * _MERMAID_MIN_EXPORT_PX pixels, multiplied by devicePixelRatio.
 */
function _resolveDimensions(svgEl) {
    let logicalW = 0;
    let logicalH = 0;

    // 1. viewBox
    const vb = svgEl.getAttribute('viewBox');
    if (vb) {
        const parts = vb.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 1 && parts[3] > 1) {
            logicalW = parts[2];
            logicalH = parts[3];
        }
    }

    // 2. Explicit attributes (skip % values and tiny placeholders)
    if (!logicalW || !logicalH) {
        const attrW = parseFloat(svgEl.getAttribute('width')  ?? '');
        const attrH = parseFloat(svgEl.getAttribute('height') ?? '');
        if (attrW > 1 && attrH > 1) { logicalW = attrW; logicalH = attrH; }
    }

    // 3. Rendered bounding rect
    if (!logicalW || !logicalH) {
        const r = svgEl.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) { logicalW = r.width; logicalH = r.height; }
    }

    // 4. Hard fallback
    if (!logicalW || !logicalH) { logicalW = 800; logicalH = 600; }

    // Scale so the long side ≥ _MERMAID_MIN_EXPORT_PX, then multiply by DPR.
    const dpr      = window.devicePixelRatio || 2;
    const longSide = Math.max(logicalW, logicalH);
    const minScale = _MERMAID_MIN_EXPORT_PX / longSide;
    const scale    = Math.max(minScale, dpr);

    return { svgW: logicalW, svgH: logicalH, scale };
}

/* ── Taint-safe font inlining ─────────────────────────────── */

async function _fetchAsDataUri(url) {
    try {
        const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise(resolve => {
            const r   = new FileReader();
            r.onload  = () => resolve(r.result);
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

async function _inlineFontsInCss(cssText) {
    const URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/g;
    const urls   = new Set();
    let m;
    while ((m = URL_RE.exec(cssText)) !== null) {
        const u = (m[1] || m[2]).trim();
        if (u && !u.startsWith('data:')) urls.add(u);
    }
    if (urls.size === 0) return cssText;

    const entries = await Promise.all([...urls].map(async url => {
        const absolute = new URL(url, document.baseURI).href;
        const dataUri  = await _fetchAsDataUri(absolute);
        return [url, dataUri];
    }));

    let result = cssText;
    for (const [original, dataUri] of entries) {
        if (!dataUri) continue;
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), dataUri);
    }
    return result;
}

async function _cloneSvgWithInlinedFonts(svgEl) {
    const clone    = svgEl.cloneNode(true);
    const styleEls = clone.querySelectorAll('style');
    await Promise.all([...styleEls].map(async s => {
        s.textContent = await _inlineFontsInCss(s.textContent ?? '');
    }));
    return clone;
}

/* ── Computed-style inlining ──────────────────────────────── */

function _inlineComputedStyles(source, target) {
    try {
        const srcEls = [source, ...source.querySelectorAll('*')];
        const tgtEls = [target, ...target.querySelectorAll('*')];
        const PROPS  = [
            'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
            'stroke-linecap', 'stroke-linejoin', 'opacity',
            'font-family', 'font-size', 'font-weight', 'font-style',
            'text-anchor', 'dominant-baseline',
            'color', 'background-color', 'display', 'visibility',
            'marker-start', 'marker-end', 'marker-mid',
        ];
        srcEls.forEach((srcEl, i) => {
            const tgtEl = tgtEls[i];
            if (!tgtEl || !(srcEl instanceof Element)) return;
            const computed = getComputedStyle(srcEl);
            PROPS.forEach(prop => {
                const val = computed.getPropertyValue(prop);
                if (val) tgtEl.style.setProperty(prop, val);
            });
        });
    } catch (_) { /* non-fatal */ }
}

/* ── Canvas rendering ─────────────────────────────────────── */

async function _svgToCanvas(svgEl) {
    // ── 1. True dimensions + scale ─────────────────────────────────────────
    const { svgW, svgH, scale } = _resolveDimensions(svgEl);

    // ── 2. Clone with inlined fonts (no cross-origin taint) ────────────────
    const clone = await _cloneSvgWithInlinedFonts(svgEl);

    // Force explicit px dimensions on the clone so the browser renders at
    // exactly the logical size we calculated, not some inherited/percentage value.
    clone.setAttribute('width',  svgW);
    clone.setAttribute('height', svgH);
    clone.style.width  = svgW + 'px';
    clone.style.height = svgH + 'px';

    // ── 3. Inline computed styles ──────────────────────────────────────────
    _inlineComputedStyles(svgEl, clone);

    // ── 4. Serialise to base64 data-URI (always same-origin) ───────────────
    const svgStr  = new XMLSerializer().serializeToString(clone);
    const svgB64  = btoa(unescape(encodeURIComponent(svgStr)));
    const dataUri = `data:image/svg+xml;base64,${svgB64}`;

    // ── 5. Create HiRes canvas ─────────────────────────────────────────────
    const canvasW = Math.round(svgW * scale);
    const canvasH = Math.round(svgH * scale);

    const canvas  = document.createElement('canvas');
    canvas.width  = canvasW;
    canvas.height = canvasH;

    const ctx = canvas.getContext('2d');

    // Background fill so transparent SVG areas don't render black.
    const bg =
        getComputedStyle(document.documentElement).getPropertyValue('--bs-body-bg').trim()
        || (document.documentElement.getAttribute('data-bs-theme') === 'dark'
            ? '#212529' : '#ffffff');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.scale(scale, scale);

    // ── 6. Draw ────────────────────────────────────────────────────────────
    await new Promise((resolve, reject) => {
        const img   = new Image();
        img.onload  = () => { ctx.drawImage(img, 0, 0, svgW, svgH); resolve(); };
        img.onerror = () => reject(new Error(
            'Could not rasterise the SVG. ' +
            'The diagram may contain unsupported SVG features.'
        ));
        img.src = dataUri;
    });

    return canvas;
}

/* ── Download helper ──────────────────────────────────────── */

function _triggerImageDownload(canvas, filename, mimeType, quality = 0.95) {
    canvas.toBlob(blob => {
        if (!blob) {
            alert('Failed to encode the image — the format may not be supported by this browser.');
            return;
        }
        const url = URL.createObjectURL(blob);
        const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, mimeType, quality);
}

/* ── Shared export pipeline ───────────────────────────────── */

async function _exportMermaidAs(format) {
    const svgEl = _getMermaidSvg();
    if (!svgEl) {
        alert(
            'No Mermaid diagram found in the preview.\n\n' +
            'Switch to Mermaid mode and make sure the diagram renders without errors first.'
        );
        return;
    }

    const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
    const filename = `${_stemFromMermaid()}.${format}`;

    try {
        const canvas = await _svgToCanvas(svgEl);
        _triggerImageDownload(canvas, filename, mimeType);
    } catch (err) {
        console.error('[common-input-output-mermaid] Export failed:', err);
        alert('Export failed: ' + err.message);
    }
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * exportMermaidPng()
 * Downloads the Mermaid diagram as a high-resolution PNG (≥ 2400 px long side).
 */
function exportMermaidPng()  { _exportMermaidAs('png');  }

/**
 * exportMermaidWebp()
 * Downloads the Mermaid diagram as a WebP image (≥ 2400 px long side, quality 0.95).
 */
function exportMermaidWebp() { _exportMermaidAs('webp'); }
