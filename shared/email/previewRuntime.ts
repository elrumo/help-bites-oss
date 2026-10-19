/**
 * The email editor preview's runtime (app/components/email/EmailPreview.vue),
 * as the exact text of the one script its srcdoc runs. It stays the same from
 * render to render on purpose: a srcdoc frame inherits the panel's script CSP,
 * which allows this script by its hash (server/plugins/scriptCsp.ts). What
 * changes per render rides on the tag's data-ids and data-nonce attributes.
 *
 * Every block's cell carries `data-block-id` (a preview render only; exports
 * stay clean), and a click selects the innermost one. Top-level blocks are the
 * rows of the content table, in document order: they get the drag handle;
 * blocks inside sections and columns move from the inspector.
 *
 * Dragging uses pointer events (not HTML5 drag and drop): nothing moves until
 * the drop, a line marks the landing spot, and the edge of the frame scrolls.
 * When a render reorders the blocks, each one glides from its old place.
 */
export const EMAIL_PREVIEW_RUNTIME = `
(function () {
  // The editor hands over the block order and this render's nonce on the tag
  // itself, and the tag goes before anything else could read them off it.
  var script = document.currentScript;
  var ids = JSON.parse(script.getAttribute('data-ids'));
  var nonce = script.getAttribute('data-nonce');
  script.remove();
  var selectedId = null;
  var drag = null;
  var line = null;

  function send(msg) { msg.__email = true; msg.nonce = nonce; parent.postMessage(msg, '*'); }

  function rows() {
    var t = document.querySelector('body > table > tbody > tr > td > table');
    return t ? Array.prototype.slice.call(t.rows) : [];
  }

  function tag() {
    rows().forEach(function (row) {
      var cell = row.cells[0];
      if (!cell || !cell.hasAttribute('data-block-id')) return;
      var handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'email-drag-handle';
      handle.setAttribute('aria-label', 'Drag to reorder');
      for (var k = 0; k < 6; k++) handle.appendChild(document.createElement('span'));
      cell.insertBefore(handle, cell.firstChild);
    });
  }

  function apply(id, reveal) {
    selectedId = id;
    Array.prototype.forEach.call(document.querySelectorAll('td[data-block-id]'), function (cell) {
      var on = cell.getAttribute('data-block-id') === id;
      cell.toggleAttribute('data-selected', on);
      if (on && reveal) cell.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  // Insertion point (0..rows) for a viewport y: before the first row whose middle is below it.
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
    if (!line) {
      line = document.createElement('div');
      line.className = 'email-drop-line';
    }
    if (!line.isConnected) document.body.appendChild(line);
    if (drag.to === drag.from || !rs.length) { line.style.display = 'none'; return; }
    var box = rs[0].parentNode.getBoundingClientRect();
    var y = at < rs.length ? rs[at].getBoundingClientRect().top : rs[rs.length - 1].getBoundingClientRect().bottom;
    line.style.display = 'block';
    line.style.top = y + 'px';
    line.style.left = box.left + 'px';
    line.style.width = box.width + 'px';
  }

  // Each top-level block's viewport top, by id.
  function tops() {
    var at = {};
    rows().forEach(function (row) {
      var cell = row.cells[0];
      if (cell && cell.hasAttribute('data-block-id')) at[cell.getAttribute('data-block-id')] = cell.getBoundingClientRect().top;
    });
    return at;
  }

  // FLIP: slide each block from where it was (tops() before the swap) to where it is.
  function glide(from) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    rows().forEach(function (row) {
      var cell = row.cells[0];
      var top = cell && from[cell.getAttribute('data-block-id')];
      var dy = top == null ? 0 : top - cell.getBoundingClientRect().top;
      if (dy) cell.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2, 0, 0, 1)' });
    });
  }

  function autoScroll() {
    if (!drag || !drag.active) return;
    var dy = drag.y < 48 ? -12 : drag.y > innerHeight - 48 ? 12 : 0;
    if (dy) { scrollBy(0, dy); update(); }
    requestAnimationFrame(autoScroll);
  }

  function end(commit) {
    if (!drag) return;
    var d = drag;
    drag = null;
    d.row.removeAttribute('data-dragging');
    document.body.classList.remove('email-dragging');
    if (line) line.style.display = 'none';
    if (commit && d.active && d.to !== d.from) send({ type: 'move', id: d.id, to: d.to });
  }

  document.addEventListener('pointerdown', function (e) {
    var handle = e.button === 0 && e.target.closest && e.target.closest('.email-drag-handle');
    var cell = handle && handle.closest('td[data-block-id]');
    var row = cell && cell.parentElement;
    if (!row) return;
    e.preventDefault(); // no text selection while dragging
    handle.setPointerCapture(e.pointerId);
    var id = cell.getAttribute('data-block-id');
    drag = { id: id, row: row, from: ids.indexOf(id), to: ids.indexOf(id), startY: e.clientY, y: e.clientY, active: false };
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    drag.y = e.clientY;
    if (!drag.active) {
      if (Math.abs(drag.y - drag.startY) < 4) return;
      drag.active = true;
      drag.row.setAttribute('data-dragging', '');
      document.body.classList.add('email-dragging');
      requestAnimationFrame(autoScroll);
    }
    update();
  });
  document.addEventListener('pointerup', function () { end(true); });
  document.addEventListener('pointercancel', function () { end(false); });

  document.addEventListener('click', function (e) {
    if (e.target.closest('a, area')) e.preventDefault();
    var cell = e.target.closest('td[data-block-id]');
    send({ type: 'select', id: cell ? cell.getAttribute('data-block-id') : null });
  });

  // Focus sits in here after a click or drag: hand the editor its shortcuts.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drag) { end(false); return; }
    var k = e.key.toLowerCase();
    if (((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'y')) || k === 'delete' || k === 'backspace') {
      e.preventDefault();
      send({ type: 'key', key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
    }
  });

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== parent || !d || !d.__email) return;
    if (d.type === 'selected') apply(d.id, true);
    if (d.type === 'render') {
      end(false);
      // Only a new order glides; typing just reflows.
      var from = d.ids.join() !== ids.join() ? tops() : null;
      var next = new DOMParser().parseFromString(d.html, 'text/html');
      document.title = next.title;
      document.body.setAttribute('style', next.body.getAttribute('style') || '');
      document.body.innerHTML = next.body.innerHTML;
      ids = d.ids;
      tag();
      apply(selectedId);
      if (from) glide(from);
    }
  });

  var style = document.createElement('style');
  style.textContent = [
    'td[data-block-id] { cursor: pointer; position: relative; }',
    // Only the innermost block under the pointer: a card's children outline on their own.
    'td[data-block-id]:hover:not(:has(td[data-block-id]:hover)) { outline: 1px dashed rgba(99, 102, 241, .7); outline-offset: -1px; }',
    'td[data-block-id][data-selected] { outline: 2px solid #6366f1; outline-offset: -2px; }',
    'tr[data-dragging] { opacity: .35; }',
    '.email-drag-handle { all: unset; align-content: center; background: #fff; border: 1px solid rgba(24, 24, 27, .16); border-radius: 7px; box-shadow: 0 6px 18px rgba(24, 24, 27, .16); box-sizing: border-box; cursor: grab; display: flex; flex-wrap: wrap; gap: 2px; height: 26px; justify-content: center; left: 6px; opacity: 0; padding: 6px; position: absolute; top: 50%; touch-action: none; transform: translateY(-50%); transition: opacity 140ms ease; width: 26px; z-index: 20; }',
    '.email-drag-handle span { background: #71717a; border-radius: 999px; height: 3px; width: 3px; }',
    'td[data-block-id]:hover > .email-drag-handle, td[data-block-id][data-selected] > .email-drag-handle { opacity: 1; }',
    'body.email-dragging, body.email-dragging * { cursor: grabbing !important; user-select: none; }',
    'body.email-dragging td[data-block-id]:hover { outline: none; }',
    'body.email-dragging td[data-block-id][data-selected] { outline: 2px solid #6366f1; }',
    'body.email-dragging .email-drag-handle { opacity: 0; }',
    '.email-drop-line { background: #6366f1; border-radius: 3px; box-shadow: 0 0 0 2px #fff; display: none; height: 3px; margin-top: -1.5px; pointer-events: none; position: fixed; z-index: 30; }'
  ].join('\\n');
  document.head.appendChild(style);
  tag();
  send({ type: 'ready' });
})();`
