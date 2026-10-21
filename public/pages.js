/* SPDX-License-Identifier: MIT
 * help-bites Pages loader. MIT-licensed (see licenses/MIT.txt) so sites that
 * embed it carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 * A published page from Pages inside your own site, growing with its content:
 *
 *   <div id="launch"></div>
 *   <script src="https://support.example.com/pages.js" data-project="pk_…" data-page="launch" data-target="#launch" defer></script>
 *
 * Options (data-*, or HelpBitesPages.push(['init', { … }]) before the script):
 *   page     the entry's slug (home when left out; folders like blog/hello work)
 *   target   where the page goes (a CSS selector)
 *   height   the starting height in px, before the page reports its own (720)
 *   title    the frame's accessible name (the page name)
 *
 * The page wears its own style (accent, mode, fonts) from the editor. The same
 * page stands alone at https://support.example.com/p/pk_…/<slug>, and its
 * content is JSON at GET /v1/cms/pk_…/entries/<slug> (or rendered HTML with
 * ?format=html) if you would rather render it yourself: see cms.mjs.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var origin = new URL(script.src, location.href).origin
  var queued = window.HelpBitesPages && window.HelpBitesPages.length ? window.HelpBitesPages : []
  var options = {}
  queued.forEach(function (cmd) { if (cmd && cmd[0] === 'init' && cmd[1]) Object.assign(options, cmd[1]) })
  var opt = function (name) { return options[name] != null ? String(options[name]) : script.getAttribute('data-' + name) || '' }
  var project = opt('project')
  var slug = opt('page').replace(/^\/+|\/+$/g, '')
  var host = opt('target') && document.querySelector(opt('target'))
  if (!project) return console.warn('[help-bites] pages.js needs data-project="pk_…"')
  if (!host) return console.warn('[help-bites] no element matches the pages target ' + opt('target'))

  var frame = document.createElement('iframe')
  frame.setAttribute('style', 'display:block;width:100%;height:' + (parseInt(opt('height'), 10) || 720) + 'px;border:0;background:transparent;color-scheme:normal;')
  frame.setAttribute('title', opt('title') || 'Page')
  frame.setAttribute('loading', 'lazy')
  frame.className = 'help-bites-page'
  frame.src = origin + '/p/' + encodeURIComponent(project) + (slug && slug !== 'home' ? '/' + slug.split('/').map(encodeURIComponent).join('/') : '') + '?embed=1'
  host.appendChild(frame)

  window.addEventListener('message', function (event) {
    var d = event.data
    if (event.source !== frame.contentWindow || event.origin !== origin || !d || d.source !== 'help-bites-page') return
    if (d.type === 'resize' && d.height > 0) frame.style.height = Math.ceil(d.height) + 'px'
  })
})()
