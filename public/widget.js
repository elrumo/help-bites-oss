/* SPDX-License-Identifier: MIT
 * help-bites widget loader. MIT-licensed (see licenses/MIT.txt) so sites that
 * embed it carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 *   <script src="https://support.example.com/widget.js" data-project="pk_…" defer></script>
 *   <script>
 *     window.HelpBites = window.HelpBites || []
 *     HelpBites.push(['init', { getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token), context: {...} }])
 *   </script>
 *
 * Without getToken, a project whose admin opened guest access for chat (Project →
 * Settings) lets visitors in as guests: HelpBites.push(['init', {}]) is enough.
 *
 * data-mode="inline" data-target="#support" instead renders the chat inside
 * that element (no launcher, always open) — a message panel in your own page.
 * It shows a skeleton while the chat loads, or what your server drew into the
 * element (ssr.mjs, docs/SSR.md). data-host names the HelpBites to talk to when
 * you serve this file yourself or from a cache.
 *
 * The chat wears the widget's style (the project's, light and dark, or its own
 * over it: Project → Settings → Style). Each of these overrides it for this
 * page: data-accent ('#rrggbb', also the launcher's colour), data-radius (0 to
 * 32), data-shadow ('none' | 'soft' | 'medium' | 'strong'), data-theme
 * ('light' | 'dark' | 'system'; without it a dark/light class on your <html>,
 * else the style's scheme, else the visitor's). The same names work as init options.
 *
 * Renders a launcher button and an iframe of the chat. The identity token is
 * fetched from your `getToken` and posted into the iframe; it never lives in
 * a URL. Calls: HelpBites.push(['open']), (['close']), (['setContext', {...}]).
 *
 * When the project turns on the chat's Home tab, "Getting started" starts an
 * onboarding flow in your page: with onboarding.js already on it, that one runs
 * (HelpBitesOnboarding); otherwise this adds it, for that flow only.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var origin = (script.getAttribute('data-host') || new URL(script.src, location.href).origin).replace(/\/+$/, '')
  var projectKey = script.getAttribute('data-project') || ''
  var position = script.getAttribute('data-position') === 'left' ? 'left' : 'right'
  var accentGiven = script.getAttribute('data-accent')
  var accent = accentGiven || '#4f46e5'
  var look = { accent: accentGiven || '', theme: script.getAttribute('data-theme') || '', radius: script.getAttribute('data-radius') || '', shadow: script.getAttribute('data-shadow') || '' }
  // 'floating' is the launcher + popover; 'inline' fills an element you point at
  // with data-target (or the `target` init option) — no launcher, always open.
  var mode = script.getAttribute('data-mode') === 'inline' ? 'inline' : 'floating'
  var target = script.getAttribute('data-target') || ''

  // legacy: old snippets queued on window.SupportBites — drop once no site uses it
  var queue = window.HelpBites || window.SupportBites || []
  var options = null, release = null, frame = null, launcher = null, badge = null, open = false, unread = 0, ready = false

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

  var still = matchMedia('(prefers-reduced-motion: reduce)').matches
  var SPRING = 'cubic-bezier(.16,1.02,.3,1)'
  var icons = {}

  function frameSrc() {
    var root = document.documentElement.classList
    var theme = look.theme || (root.contains('dark') ? 'dark' : root.contains('light') ? 'light' : '')
    return origin + '/embed?pk=' + encodeURIComponent(projectKey)
      + (mode === 'inline' ? '&inline=1' : '')
      // No theme asked for: the style's own scheme applies (the page falls back to the visitor's).
      + (theme ? '&theme=' + encodeURIComponent(theme) : '')
      + (/^#[0-9a-f]{6}$/i.test(look.accent) ? '&accent=' + encodeURIComponent(look.accent) : '')
      + (look.radius ? '&radius=' + encodeURIComponent(look.radius) : '')
      + (look.shadow ? '&shadow=' + encodeURIComponent(look.shadow) : '')
  }

  function mountInline() {
    var host = typeof target === 'string' ? document.querySelector(target) : target
    if (!host) { console.warn('[help-bites] no element matches data-target ' + target); return }
    frame = el('iframe', 'display:block;width:100%;height:100%;min-height:420px;border:0;border-radius:12px;background:transparent;', { src: frameSrc(), title: 'Support chat', allow: 'clipboard-write' })
    host.appendChild(frame)
    release = hold(host, frame)
    open = true
  }

  function mount() {
    if (frame) return
    if (mode === 'inline') return mountInline()
    var side = position + ':20px;'
    launcher = el('button', 'position:fixed;bottom:20px;' + side + 'z-index:2147483000;width:48px;height:48px;border-radius:50%;border:0;cursor:pointer;background:' + accent + ';color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 2px 6px rgba(0,0,0,.12),0 10px 28px rgba(0,0,0,.14);display:flex;align-items:center;justify-content:center;transition:transform .25s ' + SPRING + ',box-shadow .25s ease;', { 'aria-label': 'Open support chat', type: 'button' })

    // Two icons stacked in the same spot; opening spins one out and the other in.
    var iconBase = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:transform .3s ' + SPRING + ',opacity .2s ease;'
    icons.chat = el('span', iconBase)
    icons.chat.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg>'
    icons.close = el('span', iconBase + 'transform:rotate(-90deg) scale(.4);opacity:0;')
    icons.close.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    launcher.appendChild(icons.chat)
    launcher.appendChild(icons.close)

    badge = el('span', 'position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#dc2626;color:#fff;font:600 11px/18px system-ui,sans-serif;display:none;')
    launcher.appendChild(badge)
    launcher.onmouseenter = function () { if (!still) launcher.style.transform = 'scale(1.06)' }
    launcher.onmouseleave = function () { launcher.style.transform = '' }
    launcher.onclick = function () { toggle(!open) }

    var src = frameSrc()
    frame = el('iframe', 'position:fixed;bottom:80px;' + side + 'z-index:2147483000;width:min(400px,calc(100vw - 40px));height:min(640px,calc(100vh - 110px));border:0;border-radius:14px;box-shadow:0 0 0 1px rgba(0,0,0,.06),0 16px 48px rgba(0,0,0,.18);background:transparent;display:none;opacity:0;transform:scale(.88) translateY(14px);transform-origin:bottom ' + position + ';transition:transform .34s ' + SPRING + ',opacity .2s ease;', { src: src, title: 'Support chat', allow: 'clipboard-write' })
    if (still) { frame.style.transition = 'none'; icons.chat.style.transition = 'none'; icons.close.style.transition = 'none' }
    document.body.appendChild(frame)
    document.body.appendChild(launcher)
    // No accent given: wear the widget style's own, as the feedback loader does.
    if (!accentGiven && !(options && options.accent)) {
      fetch(origin + '/v1/projects/' + encodeURIComponent(projectKey) + '/public').then(function (r) { return r.ok ? r.json() : null }).then(function (r) {
        var projectAccent = r && ((r.widgetStyle && r.widgetStyle.light && r.widgetStyle.light.accent) || (r.theme && r.theme.accent))
        if (projectAccent && /^#[0-9a-f]{6}$/i.test(projectAccent)) launcher.style.background = projectAccent
      }).catch(function () {})
    }
  }

  var closeTimer = null

  // The panel grows out of the launcher and collapses back into it.
  function toggle(next) {
    if (mode === 'inline') return
    open = next
    clearTimeout(closeTimer)
    icons.chat.style.transform = open ? 'rotate(90deg) scale(.4)' : 'none'
    icons.chat.style.opacity = open ? '0' : '1'
    icons.close.style.transform = open ? 'none' : 'rotate(-90deg) scale(.4)'
    icons.close.style.opacity = open ? '1' : '0'
    launcher.setAttribute('aria-label', open ? 'Close support chat' : 'Open support chat')

    if (open) {
      frame.style.display = 'block'
      // Flush the collapsed state so the browser has something to animate from.
      // A reflow, not requestAnimationFrame: rAF never fires in a hidden tab,
      // which would leave the panel open but invisible.
      void frame.offsetHeight
      frame.style.opacity = '1'
      frame.style.transform = 'none'
      if (ready) sendContext()
    } else {
      frame.style.opacity = '0'
      frame.style.transform = 'scale(.88) translateY(14px)'
      closeTimer = setTimeout(function () { if (!open) frame.style.display = 'none' }, still ? 0 : 340)
    }
  }

  // Host-driven launcher visibility (e.g. hide it on pages with their own help
  // affordance). Closes the panel first so nothing is left dangling.
  function setHidden(next) {
    if (mode === 'inline' || !launcher) return
    if (next) { toggle(false); launcher.style.display = 'none' }
    else { launcher.style.display = 'flex' }
  }

  function send(msg) {
    if (!frame) return
    msg.source = 'help-bites-host'
    frame.contentWindow.postMessage(msg, origin)
  }

  function sendToken() {
    // Nothing to sign anyone in with: the chat may let the visitor in as a guest, if the project allows it.
    if (!options || !options.getToken) { send({ type: 'no-token' }); return }
    Promise.resolve(options.getToken()).then(function (token) {
      if (typeof token === 'string' && token) send({ type: 'token', token: token })
    }).catch(function (e) { console.warn('[help-bites] getToken failed', e) })
  }

  function sendContext() {
    if (options && options.context) send({ type: 'context', context: options.context })
  }

  function setBadge(count) {
    if (!badge) return
    var grew = count > unread
    unread = count
    badge.textContent = count > 9 ? '9+' : String(count)
    badge.style.display = count > 0 ? 'block' : 'none'
    if (grew && !still) {
      badge.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' })
      launcher.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' })
    }
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== origin || !event.data || event.data.source !== 'help-bites') return
    var d = event.data
    if (d.type === 'ready') { ready = true; if (release) release(); sendToken(); sendContext(); openFromUrl() }
    if (d.type === 'token-needed') sendToken()
    if (d.type === 'unread') setBadge(d.count || 0)
    if (d.type === 'close') toggle(false)
    if (d.type === 'onboarding' && typeof d.flow === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(d.flow)) startOnboarding(d.flow)
  })

  // The Home tab's "Getting started": hand the flow to onboarding.js and get the panel out of its way.
  function startOnboarding(flow) {
    var queue = window.HelpBitesOnboarding = window.HelpBitesOnboarding || []
    queue.push(['init', { flow: flow }])
    queue.push(['open'])
    if (Array.isArray(queue) && !document.querySelector('script[src*="/onboarding.js"]')) {
      var tag = document.createElement('script')
      tag.src = origin + '/onboarding.js'
      tag.async = true
      tag.setAttribute('data-project', projectKey)
      tag.setAttribute('data-flow', flow)
      tag.setAttribute('data-show', 'manual')
      document.head.appendChild(tag)
    }
    toggle(false)
  }

  function openFromUrl() {
    var match = /[?&]sb=([^&#]+)/.exec(location.search)
    if (match) { toggle(true); send({ type: 'open', conversationId: decodeURIComponent(match[1]) }) }
  }

  function handle(cmd) {
    var name = cmd[0], arg = cmd[1]
    if (name === 'init') {
      options = arg || {}
      if (arg && arg.accent) accent = look.accent = arg.accent
      if (arg) ['theme', 'radius', 'shadow'].forEach(function (k) { if (arg[k] !== undefined && arg[k] !== '') look[k] = String(arg[k]) })
      if (arg && arg.target) { target = arg.target; mode = 'inline' }
      if (arg && arg.mode) mode = arg.mode === 'inline' ? 'inline' : 'floating'
      mount()
    }
    if (name === 'open') { mount(); toggle(true) }
    if (name === 'close' && frame) toggle(false)
    if (name === 'hide') setHidden(true)
    if (name === 'show') setHidden(false)
    if (name === 'setContext' && options) { options.context = arg; if (ready) sendContext() }
  }

  window.SupportBites = window.HelpBites = { push: function (cmd) { handle(cmd) }, open: function () { handle(['open']) }, close: function () { handle(['close']) } }
  for (var i = 0; i < queue.length; i++) handle(queue[i])
})()
