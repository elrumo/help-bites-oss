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
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  // A copy served from your own site (it is MIT) names the HelpBites it reads from.
  var origin = (attr('host') || new URL(script.src, location.href).origin).replace(/\/+$/, '')
  var project = attr('project')
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
  // it, so until then this is an array whose push also routes module calls.
  var chat = null
  var sawInit = false
  var queue = Array.isArray(window.HelpBites) ? window.HelpBites : []
  var plainPush = Array.prototype.push

  function module(name) {
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
      var q = module(target)
      if (q) return q.push(rest)
      return console.warn('[help-bites] ' + target + ' has no calls to forward to')
    }
    if (cmd[0] === 'init') sawInit = true
    if (chat) return chat.push(cmd)
    plainPush.call(queue, cmd)
  }

  for (var i = 0; i < queue.length; i++) if (queue[i] && queue[i][0] === 'init') sawInit = true
  queue.push = function () { for (var j = 0; j < arguments.length; j++) route(arguments[j]); return queue.length }
  window.HelpBites = queue
  module('feedback')
  module('onboarding')

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
    tag.src = origin + '/' + file
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
      var router = {
        push: route,
        open: function () { route(['open']) },
        close: function () { route(['close']) }
      }
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

  var done = false
  var finish = function (info) { if (!done) { done = true; start(info) } }
  var timer = setTimeout(function () { finish(null) }, 4000)
  fetch(origin + '/v1/hub/' + encodeURIComponent(project) + '/loader')
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (info) { clearTimeout(timer); finish(info) })
    .catch(function () { clearTimeout(timer); finish(null) })
})()
