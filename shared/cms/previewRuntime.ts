/**
 * The Pages editor preview's runtime (app/components/cms/CmsPreview.vue), as
 * the exact text of the one script its srcdoc runs, allowed by its hash
 * (server/plugins/scriptCsp.ts) like the email editor's. What changes per
 * render rides on the tag's data-ids and data-nonce attributes.
 *
 * Every block's outer element carries `data-hb-uid`; a click selects the
 * innermost one. The page's top-level blocks (`data-ids`, in order) get a drag
 * handle; nested blocks move from the layers list. Links and forms do nothing
 * here. Dragging uses pointer events: a line marks the landing spot and
 * nothing moves until the drop.
 */
export const CMS_PREVIEW_RUNTIME = `
(function () {
  var script = document.currentScript;
  var ids = JSON.parse(script.getAttribute('data-ids'));
  var nonce = script.getAttribute('data-nonce');
  script.remove();
  var selectedId = null;
  var drag = null;
  var line = null;

  function send(msg) { msg.__cms = true; msg.nonce = nonce; parent.postMessage(msg, '*'); }
  function byId(id) { return document.querySelector('[data-hb-uid="' + String(id).replace(/"/g, '') + '"]'); }
  function rows() { return ids.map(byId).filter(Boolean); }

  function tag() {
    rows().forEach(function (el) {
      if (el.querySelector(':scope > .hb-drag-handle')) return;
      var handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'hb-drag-handle';
      handle.setAttribute('aria-label', 'Drag to reorder');
      handle.setAttribute('data-for', el.getAttribute('data-hb-uid'));
      for (var k = 0; k < 6; k++) handle.appendChild(document.createElement('span'));
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.insertBefore(handle, el.firstChild);
    });
  }

  function apply(id, reveal) {
    selectedId = id;
    Array.prototype.forEach.call(document.querySelectorAll('[data-hb-uid]'), function (el) {
      var on = el.getAttribute('data-hb-uid') === id;
      el.toggleAttribute('data-hb-selected', on);
      if (on && reveal) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function slotAt(y) {
    var rs = rows();
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return rs.length;
  }

  function update() {
    var rs = rows();
    var at = slotAt(drag.y);
    drag.to = at > drag.from ? at - 1 : at;
    if (!line) { line = document.createElement('div'); line.className = 'hb-drop-line'; }
    if (!line.isConnected) document.body.appendChild(line);
    if (drag.to === drag.from || !rs.length) { line.style.display = 'none'; return; }
    var y = at < rs.length ? rs[at].getBoundingClientRect().top : rs[rs.length - 1].getBoundingClientRect().bottom;
    line.style.display = 'block';
    line.style.top = y + 'px';
  }

  function autoScroll() {
    if (!drag || !drag.active) return;
    var dy = drag.y < 48 ? -14 : drag.y > innerHeight - 48 ? 14 : 0;
    if (dy) { scrollBy(0, dy); update(); }
    requestAnimationFrame(autoScroll);
  }

  function end(commit) {
    if (!drag) return;
    var d = drag;
    drag = null;
    d.el.removeAttribute('data-hb-dragging');
    document.body.classList.remove('hb-dragging');
    if (line) line.style.display = 'none';
    if (commit && d.active && d.to !== d.from) send({ type: 'move', id: d.id, to: d.to });
  }

  document.addEventListener('pointerdown', function (e) {
    var handle = e.button === 0 && e.target.closest && e.target.closest('.hb-drag-handle');
    if (!handle) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    var id = handle.getAttribute('data-for');
    drag = { id: id, el: byId(id), from: ids.indexOf(id), to: ids.indexOf(id), startY: e.clientY, y: e.clientY, active: false };
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    drag.y = e.clientY;
    if (!drag.active) {
      if (Math.abs(drag.y - drag.startY) < 4) return;
      drag.active = true;
      drag.el.setAttribute('data-hb-dragging', '');
      document.body.classList.add('hb-dragging');
      requestAnimationFrame(autoScroll);
    }
    update();
  });
  document.addEventListener('pointerup', function () { end(true); });
  document.addEventListener('pointercancel', function () { end(false); });

  document.addEventListener('click', function (e) {
    if (e.target.closest('a, area, button, summary')) e.preventDefault();
    if (e.target.closest('.hb-drag-handle')) return;
    var el = e.target.closest('[data-hb-uid]');
    send({ type: 'select', id: el ? el.getAttribute('data-hb-uid') : null });
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drag) { end(false); return; }
    if (e.target.closest && e.target.closest('input, textarea')) return;
    var k = e.key.toLowerCase();
    if (((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'y')) || k === 'delete' || k === 'backspace') {
      e.preventDefault();
      send({ type: 'key', key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
    }
  });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== parent || !d || !d.__cms) return;
    if (d.type === 'selected') apply(d.id, true);
    if (d.type === 'render') {
      end(false);
      var next = new DOMParser().parseFromString(d.html, 'text/html');
      document.title = next.title;
      Array.prototype.forEach.call(document.head.querySelectorAll('style:not([data-hb-editor]), link[rel="stylesheet"]'), function (el) { el.remove(); });
      Array.prototype.forEach.call(next.head.querySelectorAll('style, link[rel="stylesheet"]'), function (el) { document.head.appendChild(el); });
      document.body.innerHTML = next.body.innerHTML;
      ids = d.ids;
      tag();
      apply(selectedId);
    }
  });

  var style = document.createElement('style');
  style.setAttribute('data-hb-editor', '');
  style.textContent = [
    '[data-hb-uid] { cursor: pointer; }',
    '[data-hb-uid]:hover:not(:has([data-hb-uid]:hover)) { outline: 1px dashed rgba(99, 102, 241, .75); outline-offset: -1px; }',
    '[data-hb-uid][data-hb-selected] { outline: 2px solid #6366f1 !important; outline-offset: -2px; }',
    '[data-hb-dragging] { opacity: .35; }',
    '.hb-drag-handle { all: unset; align-content: center; background: #fff; border: 1px solid rgba(24, 24, 27, .16); border-radius: 7px; box-shadow: 0 6px 18px rgba(24, 24, 27, .16); box-sizing: border-box; cursor: grab; display: flex; flex-wrap: wrap; gap: 2px; height: 26px; justify-content: center; left: 8px; opacity: 0; padding: 6px; position: absolute; top: 8px; touch-action: none; transition: opacity 140ms ease; width: 26px; z-index: 50; }',
    '.hb-drag-handle span { background: #71717a; border-radius: 999px; height: 3px; width: 3px; }',
    '[data-hb-uid]:hover > .hb-drag-handle, [data-hb-uid][data-hb-selected] > .hb-drag-handle { opacity: 1; }',
    'body.hb-dragging, body.hb-dragging * { cursor: grabbing !important; user-select: none; }',
    'body.hb-dragging [data-hb-uid]:hover { outline: none; }',
    '.hb-drop-line { background: #6366f1; border-radius: 3px; box-shadow: 0 0 0 2px #fff; display: none; height: 3px; left: 0; margin-top: -1.5px; pointer-events: none; position: fixed; right: 0; z-index: 60; }'
  ].join('\\n');
  document.head.appendChild(style);
  tag();
  send({ type: 'ready' });
})();`
