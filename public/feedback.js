/* SPDX-License-Identifier: MIT
 * help-bites feedback board loader. MIT-licensed (see licenses/MIT.txt) so sites
 * that embed it carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 * Inline — the board lives in your page and grows with its content:
 *
 *   <div id="feedback"></div>
 *   <script src="https://support.example.com/feedback.js" data-project="pk_…" data-target="#feedback" defer></script>
 *
 * Floating — a "Feedback" button that opens the board in a panel: leave out
 * data-target.
 *
 * Roadmap only — just the public roadmap, no other tabs and no posting, inline
 * or floating:
 *
 *   <script src="https://support.example.com/feedback.js" data-project="pk_…" data-view="roadmap" data-only="roadmap" data-label="Roadmap" data-target="#roadmap" defer></script>
 *
 * The same page stands alone at https://support.example.com/roadmap/pk_….
 *
 * Reading is open to everyone. To let your signed-in users post, vote and
 * comment, hand the board an identity token (the same one the chat uses):
 *
 *   <script>
 *     window.HelpBitesFeedback = window.HelpBitesFeedback || []
 *     HelpBitesFeedback.push(['init', {
 *       getToken: () => fetch('/api/support/token').then(r => r.ok ? r.json() : null).then(r => r && r.token),
 *       onSignIn: () => openYourLoginModal()   // called when a signed-out visitor tries to write
 *     }])
 *     // After your user signs in or out:
 *     HelpBitesFeedback.push(['refresh'])
 *   </script>
 *
 * Without getToken or onSignIn, a project whose admin opened guest access for
 * feedback (Project → Settings) lets a visitor post, vote and comment as a guest.
 * getToken may resolve to null for a signed-out visitor. The token travels by
 * postMessage, never in a URL. Other calls: (['open']), (['close']),
 * (['openPost', id]), (['setView', 'board' | 'roadmap' | 'changelog']).
 * Options (init or data-*): target, view, only ('roadmap'), layout (the
 * roadmap's: 'columns' | 'timeline' | 'list'; defaults to the board's), theme
 * ('system' | 'light' | 'dark'), platform (preselected for new posts), position
 * ('right' | 'left'), label, accent, deepLinkParam ('feedback'), syncUrl
 * (inline default true), host (the HelpBites to read from, when you serve this
 * file yourself or from a cache).
 *
 * Inline, the target shows a skeleton while the board loads, or a snapshot your
 * server drew into it (ssr.mjs, docs/SSR.md), which the board then replaces.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  var origin = (attr('host') || new URL(script.src, location.href).origin).replace(/\/+$/, '')

  var options = {
    project: attr('project'),
    target: attr('target'),
    view: attr('view'),
    only: attr('only'),
    layout: attr('layout'),
    theme: attr('theme'),
    platform: attr('platform'),
    position: attr('position') === 'left' ? 'left' : 'right',
    label: attr('label') || 'Feedback',
    accent: attr('accent'),
    deepLinkParam: attr('deep-link-param') || 'feedback',
    syncUrl: attr('sync-url') ? attr('sync-url') !== 'false' : null
  }

  var queue = window.HelpBitesFeedback || []
  var frame = null, launcher = null, open = false, ready = false, mounted = false, closeTimer = null, pendingPost = ''
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches
  var SPRING = 'cubic-bezier(.16,1.02,.3,1)'

  function inline() { return Boolean(options.target) }

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

  function el(tag, style, attrs) {
    var e = document.createElement(tag)
    e.setAttribute('style', style)
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k])
    return e
  }

  function theme() {
    if (options.theme) return options.theme
    var root = document.documentElement
    if (root.classList.contains('dark')) return 'dark'
    if (root.classList.contains('light')) return 'light'
    return 'system'
  }

  function frameSrc() {
    var linked = deepLink()
    return origin + '/embed/feedback?pk=' + encodeURIComponent(options.project)
      + (inline() ? '&inline=1' : '')
      + '&theme=' + encodeURIComponent(theme())
      + (options.view ? '&view=' + encodeURIComponent(options.view) : '')
      + (options.only ? '&only=' + encodeURIComponent(options.only) : '')
      + (options.layout ? '&layout=' + encodeURIComponent(options.layout) : '')
      + (options.platform ? '&platform=' + encodeURIComponent(options.platform) : '')
      + (linked ? '&post=' + encodeURIComponent(linked) : '')
  }

  function deepLink() {
    try { return new URL(location.href).searchParams.get(options.deepLinkParam) || '' } catch (e) { return '' }
  }

  function mountInline() {
    var host = typeof options.target === 'string' ? document.querySelector(options.target) : options.target
    if (!host) { console.warn('[help-bites] no element matches the feedback target ' + options.target); return }
    frame = el('iframe', 'display:block;width:100%;height:560px;border:0;background:transparent;color-scheme:normal;transition:height .2s ease;', { src: frameSrc(), title: 'Feedback', allow: 'clipboard-write' })
    host.appendChild(frame)
    release = hold(host, frame)
    open = true
  }

  function mountFloating() {
    var side = options.position + ':20px;'
    launcher = el('button', 'position:fixed;bottom:20px;' + side + 'z-index:2147482999;height:44px;padding:0 18px 0 14px;border-radius:22px;border:0;cursor:pointer;background:' + (options.accent || '#4f46e5') + ';color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 2px 6px rgba(0,0,0,.12),0 10px 28px rgba(0,0,0,.14);display:flex;align-items:center;gap:8px;font:500 13px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;transition:transform .25s ' + SPRING + ';', { type: 'button', 'aria-label': 'Open feedback', 'aria-expanded': 'false' })
    launcher.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg><span></span>'
    launcher.lastChild.textContent = options.label
    launcher.onmouseenter = function () { if (!still) launcher.style.transform = 'scale(1.04)' }
    launcher.onmouseleave = function () { launcher.style.transform = '' }
    launcher.onclick = function () { toggle(!open) }

    frame = el('iframe', 'position:fixed;bottom:76px;' + side + 'z-index:2147483000;width:min(440px,calc(100vw - 40px));height:min(680px,calc(100vh - 100px));border:0;border-radius:14px;box-shadow:0 0 0 1px rgba(0,0,0,.06),0 16px 48px rgba(0,0,0,.18);background:transparent;display:none;opacity:0;transform:scale(.9) translateY(14px);transform-origin:bottom ' + options.position + ';transition:transform .34s ' + SPRING + ',opacity .2s ease;', { src: frameSrc(), title: 'Feedback', allow: 'clipboard-write' })
    if (still) frame.style.transition = 'none'
    document.body.appendChild(frame)
    document.body.appendChild(launcher)
    // No accent given: wear the project's own.
    if (!options.accent) {
      fetch(origin + '/v1/feedback/config?pk=' + encodeURIComponent(options.project)).then(function (r) { return r.ok ? r.json() : null }).then(function (r) {
        var accent = r && r.project && r.project.theme && r.project.theme.accent
        if (accent && /^#[0-9a-f]{6}$/i.test(accent)) launcher.style.background = accent
      }).catch(function () {})
    }
  }

  function mount() {
    if (mounted) return
    if (!options.project) { console.warn('[help-bites] feedback.js needs data-project="pk_…"'); return }
    mounted = true
    if (inline()) mountInline()
    else mountFloating()
  }

  function toggle(next) {
    if (inline() || !frame) return
    open = next
    clearTimeout(closeTimer)
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (open) {
      frame.style.display = 'block'
      // A reflow, not requestAnimationFrame: rAF never fires in a hidden tab.
      void frame.offsetHeight
      frame.style.opacity = '1'
      frame.style.transform = 'none'
    } else {
      frame.style.opacity = '0'
      frame.style.transform = 'scale(.9) translateY(14px)'
      closeTimer = setTimeout(function () { if (!open) frame.style.display = 'none' }, still ? 0 : 340)
    }
  }

  function send(message) {
    if (!frame || !frame.contentWindow) return
    message.source = 'help-bites-feedback-host'
    frame.contentWindow.postMessage(message, origin)
  }

  function sendToken() {
    var canSignIn = typeof options.onSignIn === 'function'
    var pending = options.getToken ? Promise.resolve().then(options.getToken) : Promise.resolve(null)
    pending.then(function (token) {
      send({ type: 'token', token: typeof token === 'string' && token ? token : null, canSignIn: canSignIn })
    }).catch(function (e) {
      console.warn('[help-bites] getToken failed', e)
      send({ type: 'token', token: null, canSignIn: canSignIn })
    })
  }

  function syncUrl(postId) {
    var wanted = options.syncUrl === null ? inline() : options.syncUrl
    if (!wanted || !history.replaceState) return
    try {
      var url = new URL(location.href)
      if (postId) url.searchParams.set(options.deepLinkParam, postId)
      else url.searchParams.delete(options.deepLinkParam)
      if (url.href !== location.href) history.replaceState(history.state, '', url.href)
    } catch (e) {}
  }

  window.addEventListener('message', function (event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin) return
    var d = event.data
    if (!d || d.source !== 'help-bites-feedback') return
    if (d.type === 'ready') {
      ready = true
      if (release) release()
      sendToken()
      if (pendingPost) { send({ type: 'open-post', postId: pendingPost }); pendingPost = '' }
    }
    if (d.type === 'token-needed') sendToken()
    if (d.type === 'sign-in') {
      if (typeof options.onSignIn === 'function') options.onSignIn(d.reason || '')
      if (!inline()) toggle(false)
    }
    if (d.type === 'resize' && inline() && d.height > 0) frame.style.height = Math.ceil(d.height) + 'px'
    if (d.type === 'close') toggle(false)
    if (d.type === 'navigate') {
      syncUrl(d.postId || '')
      // Opening a post in a tall inline board: bring its top into view.
      if (inline() && frame.getBoundingClientRect().top < 0) frame.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    }
  })

  function handle(cmd) {
    var name = cmd[0], arg = cmd[1]
    if (name === 'init') {
      var init = arg || {}
      for (var key in init) if (init[key] !== undefined) options[key] = init[key]
      if (!options.project && init.projectKey) options.project = init.projectKey
      mount()
      if (ready) sendToken()
    }
    if (name === 'open') { mount(); toggle(true) }
    if (name === 'close') toggle(false)
    if (name === 'refresh' && ready) sendToken()
    if (name === 'openPost' && typeof arg === 'string') {
      mount()
      if (!inline()) toggle(true)
      if (ready) send({ type: 'open-post', postId: arg })
      else pendingPost = arg
    }
    if (name === 'setView') send({ type: 'set-view', view: arg })
  }

  window.HelpBitesFeedback = {
    push: function (cmd) { handle(cmd) },
    open: function () { handle(['open']) },
    close: function () { handle(['close']) },
    refresh: function () { handle(['refresh']) }
  }
  for (var i = 0; i < queue.length; i++) handle(queue[i])
  // A bare <script data-project> with no init call still renders a read-only board.
  if (!mounted) setTimeout(function () { if (!mounted) mount() }, 0)
})()
