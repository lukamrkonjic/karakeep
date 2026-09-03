// ==UserScript==
// @name         Karakeep drag fix
// @namespace    karakeep-drop
// @version      1.0
// @description  Attaches the image URL to drags that a site would otherwise send empty, so images can be dragged out to other applications.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Why this exists
 * ---------------
 * Some sites start a drag carrying no data at all. Pinterest is the clearest
 * case: it makes an element draggable but attaches nothing, so the drop
 * arrives with zero types — verified both in a receiving desktop app and in
 * a plain browser page. Nothing on the receiving side can recover that,
 * because nothing ever crosses the process boundary.
 *
 * The only place with enough information is the page itself, at dragstart,
 * where the <img> is still reachable. This finds it and fills in the standard
 * flavours the site left empty.
 *
 * It never overwrites data a site set deliberately — only fills gaps — so
 * sites that already drag correctly are untouched.
 */
(function () {
  "use strict";

  /** Largest candidate in a srcset, so we don't grab a thumbnail. */
  function widestFromSrcset(srcset) {
    let best = null;
    let bestWeight = -1;
    for (const part of srcset.split(",")) {
      const [url, descriptor] = part.trim().split(/\s+/);
      if (!url) continue;
      const weight = descriptor ? parseFloat(descriptor) || 0 : 0;
      if (weight > bestWeight) {
        bestWeight = weight;
        best = url;
      }
    }
    return best;
  }

  function urlFromElement(el) {
    if (!el || !el.tagName) return null;

    if (el.tagName === "IMG") {
      // currentSrc is what the browser actually loaded for this viewport.
      const srcset = el.getAttribute("srcset");
      const wide = srcset ? widestFromSrcset(srcset) : null;
      return el.currentSrc || wide || el.src || null;
    }
    if (el.tagName === "VIDEO") {
      const source = el.querySelector("source[src]");
      return el.currentSrc || el.src || (source && source.src) || null;
    }
    // An image painted as a CSS background has no <img> to find.
    const bg = getComputedStyle(el).backgroundImage;
    const match = bg && /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(bg);
    return match ? match[1] : null;
  }

  /**
   * Finds the media the user meant. The element the drag started on is often
   * a transparent overlay sitting on top of the image, so this looks through
   * the whole stack under the cursor, not just the event target.
   */
  function findMediaUrl(event) {
    const seen = [];

    const target = event.target;
    if (target && target.nodeType === 1) {
      seen.push(target);
      const inner = target.querySelector && target.querySelector("img, video");
      if (inner) seen.push(inner);
      // Walk a few ancestors: the draggable wrapper is usually close by.
      let parent = target.parentElement;
      for (let i = 0; i < 4 && parent; i++, parent = parent.parentElement) {
        seen.push(parent);
        const nested = parent.querySelector && parent.querySelector("img, video");
        if (nested) seen.push(nested);
      }
    }

    // The stack under the pointer catches the case where the overlay shares
    // no useful ancestry with the image.
    if (document.elementsFromPoint && typeof event.clientX === "number") {
      for (const el of document.elementsFromPoint(event.clientX, event.clientY)) {
        seen.push(el);
        const inner = el.querySelector && el.querySelector("img, video");
        if (inner) seen.push(inner);
      }
    }

    for (const el of seen) {
      const url = urlFromElement(el);
      // Ignore blob:/data: — another application can't resolve a blob URL,
      // and a data: URL is usually a placeholder rather than the real image.
      if (url && /^https?:\/\//i.test(url)) {
        return url;
      }
    }
    return null;
  }

  function fillGaps(event) {
    const dt = event.dataTransfer;
    if (!dt) return;

    const existing = Array.from(dt.types || []);
    // The site attached something real — leave it entirely alone.
    if (existing.includes("text/uri-list") || existing.includes("Files")) {
      return;
    }

    const url = findMediaUrl(event);
    if (!url) return;

    try {
      dt.setData("text/uri-list", url);
      if (!existing.includes("text/plain")) {
        dt.setData("text/plain", url);
      }
      if (!existing.includes("text/html")) {
        dt.setData("text/html", '<img src="' + url + '">');
      }
    } catch (e) {
      // A site can put the transfer in a state that rejects writes; nothing
      // to do but leave the drag as it was.
    }
  }

  // Registered in both phases: capture runs before the page's own handler,
  // and the bubble pass gets the last word if the site overwrote us. If the
  // site stops propagation, at least one of the two still fires.
  document.addEventListener("dragstart", fillGaps, true);
  document.addEventListener("dragstart", fillGaps, false);
})();
