/* SPDX-License-Identifier: MIT
 * help-bites changelog loader. MIT-licensed (see licenses/MIT.txt) so sites
 * that embed it carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 * Your public changelog, inside your page, growing with its content. It is
 * read-only and needs no feedback board, only the project's public changelog
 * switched on (Project -> Changelog -> Settings):
 *
 *   <div id="changelog"></div>
 *   <script src="https://support.example.com/changelog.js" data-project="pk_…" data-target="#changelog" defer></script>
 *
 * Options (data-*): project, target, theme ('system' | 'light' | 'dark';
 * defaults to a dark/light class on your <html>).
 *
 * The same page stands alone at https://support.example.com/changelog/pk_…, and
 * the data is at GET /v1/changelog?pk=pk_… if you would rather build your own UI.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var origin = new URL(script.src, location.href).origin
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  var project = attr('project')
  var host = attr('target') && document.querySelector(attr('target'))
  if (!project) return console.warn('[help-bites] changelog.js needs data-project="pk_…"')
  if (!host) return console.warn('[help-bites] no element matches the changelog target ' + attr('target'))

  var root = document.documentElement
  var theme = attr('theme') || (root.classList.contains('dark') ? 'dark' : root.classList.contains('light') ? 'light' : 'system')
  var frame = document.createElement('iframe')
  frame.setAttribute('style', 'display:block;width:100%;height:480px;border:0;background:transparent;color-scheme:normal;transition:height .2s ease;')
  frame.setAttribute('title', 'Changelog')
  frame.src = origin + '/embed/changelog?inline=1&pk=' + encodeURIComponent(project) + '&theme=' + encodeURIComponent(theme)
  host.appendChild(frame)

  window.addEventListener('message', function (event) {
    var d = event.data
    if (event.source !== frame.contentWindow || event.origin !== origin || !d || d.source !== 'help-bites-changelog') return
    if (d.type === 'resize' && d.height > 0) frame.style.height = Math.ceil(d.height) + 'px'
  })
})()
