/* SPDX-License-Identifier: MIT
 * help-bites brand kit loader. MIT-licensed (see licenses/MIT.txt) so sites
 * that embed it carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 * Your public brand page (logos, colours, type, screenshots, guidelines, with
 * downloads) inside your own site, growing with its content. Turn the page on
 * first (Project -> Brand -> Page):
 *
 *   <div id="brand"></div>
 *   <script src="https://support.example.com/brand.js" data-project="pk_…" data-target="#brand" defer></script>
 *
 * Options (data-*), each overriding the kit's own page settings: template
 * ('minimal' | 'editorial' | 'split'), theme ('auto' | 'light' | 'dark'; defaults
 * to a dark/light class on your <html>), radius ('sharp' | 'soft' | 'round'),
 * accent ('#rrggbb'), sections (which to show, in order: colors, typography,
 * logos, screenshots, assets, guidelines; comma-separated).
 *
 * The same page stands alone at https://support.example.com/brand/pk_…, and the
 * data is at GET /v1/brand/pk_… if you would rather build your own.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var origin = new URL(script.src, location.href).origin
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  var project = attr('project')
  var host = attr('target') && document.querySelector(attr('target'))
  if (!project) return console.warn('[help-bites] brand.js needs data-project="pk_…"')
  if (!host) return console.warn('[help-bites] no element matches the brand target ' + attr('target'))

  var root = document.documentElement
  var theme = attr('theme') || (root.classList.contains('dark') ? 'dark' : root.classList.contains('light') ? 'light' : '')
  var params = new URLSearchParams({ embed: '1' })
  if (theme) params.set('theme', theme)
  ;['template', 'radius', 'accent', 'sections'].forEach(function (name) { if (attr(name)) params.set(name, attr(name)) })

  var frame = document.createElement('iframe')
  frame.setAttribute('style', 'display:block;width:100%;height:720px;border:0;background:transparent;color-scheme:normal;')
  frame.setAttribute('title', 'Brand kit')
  frame.setAttribute('loading', 'lazy')
  frame.src = origin + '/brand/' + encodeURIComponent(project) + '?' + params.toString()
  host.appendChild(frame)

  window.addEventListener('message', function (event) {
    var d = event.data
    if (event.source !== frame.contentWindow || event.origin !== origin || !d || d.source !== 'help-bites-brand') return
    if (d.type === 'resize' && d.height > 0) frame.style.height = Math.ceil(d.height) + 'px'
  })
})()
