/* SPDX-License-Identifier: MIT
 * help-bites loader. MIT-licensed (see licenses/MIT.txt) so sites that embed it
 * carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 * One tag instead of four. It asks HelpBites which embeds your project has
 * (GET /v1/hub/{pk}/loader) and adds only those, as the individual scripts
 * (widget.js, feedback.js, changelog.js, onboarding.js), so you never edit your
 * site when you switch a feature on:
 *
 *   <script src="https://support.example.com/helpbites.js" data-project="pk_…" async></script>
 *
 * With nothing else it adds the chat. The others are opt-in, because they draw
 * on your page: name the modules with data-features, or give one its setting.
 *
 *   data-features="chat,feedback"        only these (chat | feedback | changelog | onboarding)
 *   data-changelog-target="#changelog"   the changelog, inline in that element
 *   data-feedback-target="#board"        the feedback board, inline (without it: a floating button)
 *   data-flow="welcome"                  an onboarding flow, shown once
 *   data-scripts="/hb"                   load the module scripts from here (your own site or a cache)
 *                                        instead of from HelpBites; they still talk to data-host
 *   data-cache="false"                   do not start from the answer remembered in this browser
 *
 * Attributes pass through to the scripts. These reach every module that reads
 * them: data-accent, data-theme, data-position, data-locale, data-token.
 * data-mode and data-target are the chat's, data-flow is onboarding's. Prefix
 * any attribute with a module to aim it: data-feedback-position="left",
 * data-onboarding-show="update", data-chat-mode="inline".
 *
 * data-token is the person's identity token (a string). For a token that is
 * fetched when needed, use the chat's own call, which this keeps working:
 *
 *   <script>
 *     window.HelpBites = window.HelpBites || []
 *     HelpBites.push(['init', { getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token) }])
 *   </script>
 *
 * Calls before or after the scripts have loaded go to the right one:
 * HelpBites.push(['open']) is the chat's; HelpBites.push(['feedback', 'open']),
 * (['onboarding', 'open']) and (['chat', 'close']) name the module.
 *
 * A script already on the page is never added twice, so you can move to this
 * one tag a module at a time. If HelpBites cannot be reached, the modules you
 * asked for by name still load. The `helpbites:loaded` event on window says
 * which were added. The data is GET /v1/hub/{pk}/loader.
 *
 * That answer is remembered in this browser (localStorage, a week): the next
 * page starts from it at once and the fresh one is kept for the page after.
 * Serve the scripts yourself (data-scripts, data-host) and cache them on your
 * server with ssr.mjs: docs/SSR.md.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  // A copy served from your own site (it is MIT) names the HelpBites it reads from.
  var origin = (attr('host') || new URL(script.src, location.href).origin).replace(/\/+$/, '')
  var project = attr('project')
  // Where the module scripts come from: HelpBites itself, or a copy of yours (they then need data-host).
  var scriptBase = (attr('scripts') || origin).replace(/\/+$/, '')
  if (!project) return console.warn('[help-bites] helpbites.js needs data-project="pk_…"')

  var MODULES = ['chat', 'feedback', 'changelog', 'onboarding']
  var FILES = { chat: 'widget.js', feedback: 'feedback.js', changelog: 'changelog.js', onboarding: 'onboarding.js' }
  var QUEUES = { feedback: 'HelpBitesFeedback', onboarding: 'HelpBitesOnboarding' }
  // Reach every module that reads them.
  var SHARED = ['accent', 'theme', 'position', 'locale', 'token']
  // Reach one module without a prefix.
  var OWN = { chat: ['mode', 'target'], onboarding: ['flow'] }

  // ---- the HelpBites.push queue --------------------------------------------------
  // widget.js reads window.HelpBites as an array when it loads and then replaces
  // it with its own object, so until then this is an array whose push also routes
  // module calls; once the chat is there, a router in front of it does the same.
  var existing = window.HelpBites
  var chat = existing && !Array.isArray(existing) && typeof existing.push === 'function' ? existing : null
  var queue = Array.isArray(existing) ? existing : []
  var sawInit = !!chat
  var plainPush = Array.prototype.push

  function queueFor(name) {
    var key = QUEUES[name]
    if (!key) return null
    window[key] = window[key] || []
    return window[key]
  }

  function route(cmd) {
    if (!cmd || !cmd.length) return
    var target = String(cmd[0])
    if (MODULES.indexOf(target) !== -1 && cmd.length > 1 && typeof cmd[1] === 'string') {
      var rest = cmd.slice(1)
      if (target === 'chat') return chat ? chat.push(rest) : plainPush.call(queue, rest)
      var q = queueFor(target)
      if (q) return q.push(rest)
      return console.warn('[help-bites] ' + target + ' has no calls to forward to')
    }
    if (cmd[0] === 'init') sawInit = true
    if (chat) return chat.push(cmd)
    plainPush.call(queue, cmd)
  }

  var router = {
    push: route,
    open: function () { route(['open']) },
    close: function () { route(['close']) }
  }

  if (chat) {
    window.SupportBites = window.HelpBites = router
  } else {
    for (var i = 0; i < queue.length; i++) if (queue[i] && queue[i][0] === 'init') sawInit = true
    queue.push = function () { for (var j = 0; j < arguments.length; j++) route(arguments[j]); return queue.length }
    window.HelpBites = queue
  }
  queueFor('feedback')
  queueFor('onboarding')

  // ---- which modules ---------------------------------------------------------------

  var listed = attr('features').split(',').map(function (s) { return s.trim().toLowerCase() }).filter(Boolean)

  function wanted(name) {
    if (listed.length) return listed.indexOf(name) !== -1
    if (name === 'chat') return true
    if (name === 'feedback') return !!attr('feedback-target')
    if (name === 'changelog') return !!attr('changelog-target')
    return !!(attr('flow') || attr('onboarding-flow'))
  }

  function onPage(file) {
    var scripts = document.getElementsByTagName('script')
    for (var s = 0; s < scripts.length; s++) {
      var src = (scripts[s].getAttribute('src') || '').split(/[?#]/)[0]
      if (src.slice(-file.length - 1) === '/' + file) return true
    }
    return false
  }

  function moduleAttrs(name, info) {
    var out = { project: project }
    if (scriptBase !== origin) out.host = origin
    SHARED.forEach(function (key) { if (attr(key)) out[key] = attr(key) })
    ;(OWN[name] || []).forEach(function (key) { if (attr(key)) out[key] = attr(key) })
    // data-<module>-<name> aims one attribute at one module, whatever it is.
    var all = script.attributes
    for (var a = 0; a < all.length; a++) {
      var match = /^data-(chat|feedback|changelog|onboarding)-(.+)$/.exec(all[a].name)
      if (match && match[1] === name) out[match[2]] = all[a].value
    }
    // An onboarding flow named by nobody: the project's only one, or its "welcome".
    if (name === 'onboarding' && !out.flow && info && info.flows && info.flows.length) out.flow = info.flows.indexOf('welcome') !== -1 ? 'welcome' : info.flows[0]
    return out
  }

  var loaded = []

  function inject(name, info) {
    var file = FILES[name]
    if (onPage(file)) return null
    var attrs = moduleAttrs(name, info)
    if (name === 'changelog' && !attrs.target) { console.warn('[help-bites] changelog needs data-changelog-target="#element"'); return null }
    if (name === 'onboarding' && !attrs.flow) return null
    var tag = document.createElement('script')
    tag.src = scriptBase + '/' + file
    tag.async = true
    for (var k in attrs) tag.setAttribute('data-' + k, attrs[k])
    loaded.push(name)
    document.head.appendChild(tag)
    return tag
  }

  function afterChat(tag) {
    tag.addEventListener('load', function () {
      // widget.js has replaced window.HelpBites with its own; keep the routing in front of it.
      chat = window.HelpBites && window.HelpBites !== queue ? window.HelpBites : null
      if (!chat) return
      window.SupportBites = window.HelpBites = router
      // The page did not call init itself: start the chat, wearing data-token when there is one.
      if (!sawInit) {
        var token = attr('token')
        chat.push(['init', token ? { getToken: function () { return token } } : {}])
      }
    })
  }

  function start(info) {
    var modules = info ? info.modules : null
    MODULES.forEach(function (name) {
      if (!wanted(name)) return
      // Something the project has not set up is left out (its script would only find nothing).
      if (modules && modules[name] && modules[name].enabled === false) return
      var tag = inject(name, modules && modules[name])
      if (tag && name === 'chat') afterChat(tag)
    })
    window.dispatchEvent(new CustomEvent('helpbites:loaded', { detail: { modules: loaded.slice(), hub: info && info.hub ? info.hub : null } }))
  }

  // The last answer, kept in this browser: start from it, then refresh it for next time.
  var memo = 'helpbites:loader:' + project
  function remembered() {
    if (attr('cache') === 'false') return null
    try {
      var kept = JSON.parse(localStorage.getItem(memo))
      return kept && kept.info && Date.now() - kept.at < 7 * 864e5 ? kept.info : null
    } catch (e) { return null }
  }
  function remember(info) {
    try { if (info) localStorage.setItem(memo, JSON.stringify({ at: Date.now(), info: info })) } catch (e) {}
  }

  var done = false
  var finish = function (info) { if (!done) { done = true; start(info) } }
  var before = remembered()
  if (before) finish(before)
  var timer = setTimeout(function () { finish(null) }, 4000)
  fetch(origin + '/v1/hub/' + encodeURIComponent(project) + '/loader')
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (info) { clearTimeout(timer); remember(info); finish(info) })
    .catch(function () { clearTimeout(timer); finish(null) })
})()
