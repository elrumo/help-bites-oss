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
 * It wears the changelog's style from Project -> Changelog -> Style (the
 * project's own, in light and dark). Options (data-*): project, target, theme
 * ('system' | 'light' | 'dark'; defaults to your style's scheme, else a
 * dark/light class on your <html>), and, to override the style for one embed,
 * accent ('#rrggbb'), radius (0 to 32, pixels) and shadow ('none' | 'soft' |
 * 'medium' | 'strong').
 *
 * The same page stands alone at https://support.example.com/changelog/pk_…, and
 * the data is at GET /v1/changelog?pk=pk_… if you would rather build your own UI.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  var origin = (attr('host') || new URL(script.src, location.href).origin).replace(/\/+$/, '')
  var project = attr('project')
  var host = attr('target') && document.querySelector(attr('target'))
  if (!project) return console.warn('[help-bites] changelog.js needs data-project="pk_…"')
  if (!host) return console.warn('[help-bites] no element matches the changelog target ' + attr('target'))

  // What stands in for the frame until it has something to show: a snapshot drawn on the server
  // (ssr.mjs, marked data-hb-ssr) or, failing that, a skeleton. The frame loads out of sight under it
  // and takes its place when it says it is ready (or after 8 s, so an error message still shows).
  function hold(host, frame) {
    var held = host.querySelector('[data-hb-ssr]')
    if (!held) {
      if (!document.getElementById('hb-sk-style')) {
        var style = document.createElement('style')
        style.id = 'hb-sk-style'
        style.textContent = '@keyframes hb-pulse{50%{opacity:.45}}@media(prefers-reduced-motion:reduce){.hb-sk i{animation:none!important}}'
        document.head.appendChild(style)
      }
      held = document.createElement('div')
      held.className = 'hb-sk'
      held.setAttribute('role', 'status')
      held.setAttribute('aria-busy', 'true')
      held.innerHTML = '<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Loading…</span>' + new Array(4).join('<i style="display:block;height:84px;margin:0 0 12px;border-radius:10px;background:rgba(127,127,127,.18);animation:hb-pulse 1.4s ease-in-out infinite"></i>')
      host.appendChild(held)
    }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
    frame.style.position = 'absolute'
    frame.style.visibility = 'hidden'
    frame.style.top = frame.style.left = '0'
    var released = false
    function release() {
      if (released) return
      released = true
      if (held.parentNode) held.parentNode.removeChild(held)
      frame.style.position = frame.style.visibility = frame.style.top = frame.style.left = ''
    }
    setTimeout(release, 8000)
    return release
  }

  var root = document.documentElement
  var theme = attr('theme') || (root.classList.contains('dark') ? 'dark' : root.classList.contains('light') ? 'light' : '')
  var frame = document.createElement('iframe')
  frame.setAttribute('style', 'display:block;width:100%;height:480px;border:0;background:transparent;color-scheme:normal;transition:height .2s ease;')
  frame.setAttribute('title', 'Changelog')
  var query = 'inline=1&pk=' + encodeURIComponent(project)
  // No theme asked for: the style's own scheme applies (the page falls back to the visitor's).
  ;['theme:' + theme, 'accent:' + attr('accent'), 'radius:' + attr('radius'), 'shadow:' + attr('shadow')].forEach(function (pair) {
    var i = pair.indexOf(':')
    if (pair.slice(i + 1)) query += '&' + pair.slice(0, i) + '=' + encodeURIComponent(pair.slice(i + 1))
  })
  frame.src = origin + '/embed/changelog?' + query
  host.appendChild(frame)
  var release = hold(host, frame)

  window.addEventListener('message', function (event) {
    var d = event.data
    if (event.source !== frame.contentWindow || event.origin !== origin || !d || d.source !== 'help-bites-changelog') return
    if (d.type === 'ready') release()
    if (d.type === 'resize' && d.height > 0) frame.style.height = Math.ceil(d.height) + 'px'
  })
})()
