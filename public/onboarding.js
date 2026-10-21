/* SPDX-License-Identifier: MIT
 * help-bites onboarding. MIT-licensed (see licenses/MIT.txt) so sites that
 * embed it carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 * Shows a published onboarding flow to a new visitor, once:
 *
 *   <script src="https://support.example.com/onboarding.js" data-project="pk_…" data-flow="welcome" defer></script>
 *
 * It never waits on HelpBites for long and never needs it twice: the flow is
 * drawn here from JSON (no iframe), the last good copy is kept in localStorage,
 * and you can ship a copy in the page for the very first visit when HelpBites
 * cannot be reached (Project -> Onboarding -> Download offline copy):
 *
 *   <script type="application/json" id="welcome-flow">{ "flow": { … } }</script>
 *   <script src="…/onboarding.js" data-project="pk_…" data-flow="welcome" data-fallback="#welcome-flow" defer></script>
 *
 * For a first visit that works with HelpBites entirely down, serve this file
 * from your own site too, with data-host="https://support.example.com".
 *
 * Options (data-* or init): flow, target (a selector: draw it inline in that
 * element instead of as a dialog), show ('once' | 'update': again after each
 * publish | 'always' | 'manual': only on ['open']), theme ('system' | 'light' |
 * 'dark'; defaults to a dark/light class on your <html>), accent, radius, font
 * ('system' | 'rounded' | 'serif' | 'mono'), fallback, locale (a language tag such as
 * 'es' or 'pt-BR': the translation to show; defaults to your <html lang>, then the
 * browser's language; a flow without that translation shows in its own language).
 *
 *   <script>
 *     window.HelpBitesOnboarding = window.HelpBitesOnboarding || []
 *     HelpBitesOnboarding.push(['init', {
 *       show: 'update',
 *       labels: { next: 'Next', done: 'Start', back: 'Back', skip: 'Not now' },
 *       onComplete: (flow) => {}, onSkip: (flow, step) => {}, onStep: (step, flow) => {}
 *     }])
 *     HelpBitesOnboarding.push(['open'])    // show it now
 *     HelpBitesOnboarding.push(['reset'])   // forget that this browser saw it
 *   </script>
 *
 * Restyle it from your CSS with variables on .help-bites-onboarding
 * (--hb-onboarding-accent, -on-accent, -bg, -text, -muted, -radius, -font,
 * -backdrop, -width) or parts (::part(card), overlay, progress, skip, media,
 * image, title, body, actions, back, next). Every outcome is also a
 * `helpbites:onboarding` event on window. The data is
 * GET /v1/onboarding/{pk}/{key} if you would rather draw your own.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  // A copy served from your own site (it is MIT) names the HelpBites it reads from.
  var origin = (attr('host') || new URL(script.src, location.href).origin).replace(/\/+$/, '')

  var options = {
    project: attr('project'),
    flow: attr('flow') || 'welcome',
    target: attr('target'),
    show: attr('show') || 'once',
    theme: attr('theme'),
    accent: attr('accent'),
    radius: attr('radius'),
    font: attr('font'),
    fallback: attr('fallback'),
    locale: attr('locale'),
    labels: {},
    onComplete: null,
    onSkip: null,
    onStep: null
  }

  var FRESH_MS = 10 * 60 * 1000
  var TIMEOUT_MS = 4000
  var FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", -apple-system, BlinkMacSystemFont, sans-serif',
    serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif',
    mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace'
  }
  // The words the buttons use when a step has no label of its own, by language (labels in your options win).
  var WORDS = {
    en: { next: 'Continue', done: 'Get started', back: 'Back', skip: 'Skip' },
    es: { next: 'Continuar', done: 'Empezar', back: 'Atrás', skip: 'Omitir' },
    ca: { next: 'Continua', done: 'Comença', back: 'Enrere', skip: 'Omet' },
    fr: { next: 'Continuer', done: 'Commencer', back: 'Retour', skip: 'Passer' },
    de: { next: 'Weiter', done: 'Los geht\u2019s', back: 'Zur\u00fcck', skip: '\u00dcberspringen' },
    it: { next: 'Continua', done: 'Inizia', back: 'Indietro', skip: 'Salta' },
    pt: { next: 'Continuar', done: 'Come\u00e7ar', back: 'Voltar', skip: 'Pular' },
    ja: { next: '\u7d9a\u3051\u308b', done: '\u59cb\u3081\u308b', back: '\u623b\u308b', skip: '\u30b9\u30ad\u30c3\u30d7' },
    ko: { next: '\uacc4\uc18d', done: '\uc2dc\uc791\ud558\uae30', back: '\ub4a4\ub85c', skip: '\uac74\ub108\ub6f0\uae30' },
    zh: { next: '\u7ee7\u7eed', done: '\u5f00\u59cb', back: '\u8fd4\u56de', skip: '\u8df3\u8fc7' }
  }
  var RTL = { ar: 1, he: 1, fa: 1, ur: 1 }
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches
  var current = null

  // ---- storage: every access may throw (private mode, blocked storage) ----
  function store(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)) } catch (e) {} }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch (e) { return null } }
  /** The language to ask for: your choice, else the page's <html lang>, else the browser's. */
  function wanted() { return options.locale || document.documentElement.lang || (navigator.languages && navigator.languages[0]) || navigator.language || '' }
  function cacheKey() { return 'hb-onboarding:flow:' + origin + ':' + options.project + ':' + options.flow + ':' + wanted() }
  function seenKey() { return 'hb-onboarding:seen:' + options.project + ':' + options.flow }

  function emit(type, flow, step) {
    try { window.dispatchEvent(new CustomEvent('helpbites:onboarding', { detail: { type: type, flow: flow.key, version: flow.version, step: step } })) } catch (e) {}
  }

  function bundled() {
    var given = options.fallback
    if (given && typeof given === 'object') return given.flow || given
    var el = given && document.querySelector(given)
    if (!el) return null
    try { var parsed = JSON.parse(el.textContent || ''); return parsed.flow || parsed } catch (e) { console.warn('[help-bites] the onboarding fallback is not valid JSON'); return null }
  }

  /** The flow, from the freshest place that answers: a recent cache, the network, an old cache, the bundled copy. */
  function resolve(done) {
    var cached = load(cacheKey())
    var fresh = cached && cached.flow && Date.now() - cached.at < FRESH_MS
    if (fresh) { done(cached.flow); refresh(function () {}); return }
    refresh(function (flow, gone) {
      if (gone) return done(null)
      done(flow || (cached && cached.flow) || bundled())
    })
  }

  function refresh(done) {
    var url = origin + '/v1/onboarding/' + encodeURIComponent(options.project) + '/' + encodeURIComponent(options.flow) + (wanted() ? '?locale=' + encodeURIComponent(wanted()) : '')
    var controller = window.AbortController ? new AbortController() : null
    var timer = setTimeout(function () { if (controller) controller.abort() }, TIMEOUT_MS)
    fetch(url, { signal: controller && controller.signal, credentials: 'omit' })
      .then(function (r) {
        // Unpublished or deleted: forget the copy, so it is not shown again.
        if (r.status === 404) { store(cacheKey(), null); return { gone: true } }
        return r.ok ? r.json() : null
      })
      .then(function (body) {
        clearTimeout(timer)
        if (body && body.flow) store(cacheKey(), { flow: body.flow, at: Date.now() })
        done(body && body.flow, body && body.gone)
      })
      .catch(function () { clearTimeout(timer); done(null) })
  }

  function shouldShow(flow) {
    var seen = load(seenKey())
    if (options.show === 'always') return true
    if (options.show === 'manual') return false
    if (options.show === 'update') return !seen || (seen.version || 0) < flow.version
    return !seen
  }

  // ---- drawing ----
  function onColour(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return '#ffffff'
    var n = parseInt(m[1], 16)
    var lin = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255) > 0.179 ? '#000000' : '#ffffff'
  }

  function dark(theme) {
    var t = theme || options.theme
    if (t === 'dark') return true
    if (t === 'light') return false
    var root = document.documentElement
    if (root.classList.contains('dark')) return true
    if (root.classList.contains('light')) return false
    return matchMedia('(prefers-color-scheme: dark)').matches
  }

  function css(flow, inline, theme) {
    var style = flow.style || {}
    var accent = /^#[0-9a-f]{6}$/i.test(options.accent) ? options.accent : style.accent || '#5e6ad2'
    var radius = options.radius !== '' && !isNaN(+options.radius) ? +options.radius : (typeof style.radius === 'number' ? style.radius : 20)
    var night = dark(theme)
    var bg = style.background || (night ? '#18181b' : '#ffffff')
    var text = style.text || (night ? '#f4f4f5' : '#18181b')
    var font = FONTS[options.font] || FONTS[style.font] || FONTS.system
    return ':host{all:initial;--_accent:var(--hb-onboarding-accent,' + accent + ');--_on:var(--hb-onboarding-on-accent,' + onColour(accent) + ');--_bg:var(--hb-onboarding-bg,' + bg + ');--_text:var(--hb-onboarding-text,' + text + ');--_muted:var(--hb-onboarding-muted,color-mix(in srgb,var(--_text) 62%,transparent));--_r:var(--hb-onboarding-radius,' + radius + 'px);--_font:var(--hb-onboarding-font,' + font + ');--_w:var(--hb-onboarding-width,400px)}'
      + '*{box-sizing:border-box}'
      + '.overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--hb-onboarding-backdrop,rgba(9,9,11,.48));-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .24s ease}'
      + '.overlay.in{opacity:1}'
      + '.card{position:relative;width:min(var(--_w),100%);max-height:calc(100vh - 32px);overflow:auto;display:flex;flex-direction:column;background:var(--_bg);color:var(--_text);font:15px/1.55 var(--_font);border-radius:var(--_r);-webkit-font-smoothing:antialiased;color-scheme:' + (night ? 'dark' : 'light') + '}'
      + (inline ? '.card{margin:0 auto;box-shadow:0 0 0 1px color-mix(in srgb,var(--_text) 10%,transparent)}' : '.card{box-shadow:0 0 0 1px color-mix(in srgb,var(--_text) 8%,transparent),0 24px 80px rgba(0,0,0,.28);transform:translateY(14px) scale(.98);transition:transform .32s cubic-bezier(.2,.8,.2,1)}.in .card{transform:none}')
      + '.top{display:flex;align-items:center;gap:12px;min-height:44px;padding:16px 20px 0}'
      + '.progress{flex:1;display:flex;gap:5px;align-items:center}'
      + '.seg{flex:1;height:3px;border-radius:3px;background:color-mix(in srgb,var(--_text) 14%,transparent);transition:background .2s}'
      + '.seg.on{background:var(--_accent)}'
      + '.dot{width:6px;height:6px;border-radius:6px;background:color-mix(in srgb,var(--_text) 18%,transparent);transition:width .25s,background .2s}'
      + '.dot.on{width:18px;background:var(--_accent)}'
      + '.skip{margin-left:auto;padding:6px 2px;border:0;background:none;color:var(--_muted);font:inherit;font-size:14px;cursor:pointer;border-radius:6px}'
      + '.skip:hover{color:var(--_text)}'
      + '.step{display:flex;flex-direction:column;transition:opacity .2s ease,transform .22s ease}'
      + '.step.out{opacity:0;transform:translateX(var(--_dir,10px))}'
      + '.media{margin:16px 20px 0;aspect-ratio:4/3;display:grid;place-items:center;overflow:hidden;border-radius:max(0px,calc(var(--_r) - 8px));background:color-mix(in srgb,var(--_accent) 10%,transparent)}'
      + '.media img{display:block;width:100%;height:100%;object-fit:contain}'
      + '.text{padding:22px 24px 0}'
      + '.text.solo{padding-top:36px}'
      + '.title{margin:0;font-size:22px;line-height:1.25;font-weight:650;letter-spacing:-.015em;text-wrap:balance}'
      + '.body{margin:10px 0 0;color:var(--_muted);white-space:pre-line;text-wrap:pretty}'
      + '.actions{display:flex;gap:10px;padding:24px}'
      + '.btn{height:46px;padding:0 18px;border:0;border-radius:max(6px,calc(var(--_r) * .6));font:inherit;font-weight:600;cursor:pointer;transition:transform .12s ease,filter .15s}'
      + '.btn:active{transform:scale(.98)}'
      + '.next{flex:1;background:var(--_accent);color:var(--_on)}'
      + '.next:hover{filter:brightness(1.06)}'
      + '.back{background:color-mix(in srgb,var(--_text) 7%,transparent);color:var(--_text)}'
      + 'button:focus-visible{outline:2px solid var(--_accent);outline-offset:2px}'
      + '@media (max-width:520px){.overlay{align-items:flex-end;padding:8px 8px calc(8px + env(safe-area-inset-bottom))}}'
      + (still ? '*{transition:none!important}' : '')
  }

  function el(tag, cls, part) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (part) e.setAttribute('part', part)
    return e
  }

  /** Draws `flow` into a new host: a dialog over the page, or inline in `target`. Returns a handle to close it. */
  function draw(flow, how) {
    var steps = (flow.steps || []).filter(function (s) { return s && (s.title || s.body || s.imageUrl) })
    if (!steps.length) return null
    var base = String(flow.locale || '').toLowerCase().split('-')[0]
    var words = WORDS[base] || WORDS.en
    var given = options.labels || {}
    var labels = { next: given.next || words.next, done: given.done || words.done, back: given.back || words.back, skip: given.skip || words.skip }
    var opts = flow.options || {}
    var host = el('div', 'help-bites-onboarding')
    if (flow.locale) host.setAttribute('lang', flow.locale)
    if (RTL[base]) host.setAttribute('dir', 'rtl')
    var shadow = host.attachShadow({ mode: 'open' })
    var styleEl = el('style')
    styleEl.textContent = css(flow, !!how.target, how.theme)
    shadow.appendChild(styleEl)

    var overlay = how.target ? null : el('div', 'overlay', 'overlay')
    var card = el('div', 'card', 'card')
    card.setAttribute('role', how.target ? 'region' : 'dialog')
    if (!how.target) card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-label', flow.name || 'Welcome')
    var top = el('div', 'top')
    var progress = el('div', 'progress', 'progress')
    var skip = el('button', 'skip', 'skip')
    skip.type = 'button'
    skip.textContent = labels.skip
    top.appendChild(progress)
    if (opts.skippable !== false && !how.preview) top.appendChild(skip)
    var step = el('div', 'step')
    card.appendChild(top)
    card.appendChild(step)
    ;(overlay || shadow).appendChild(card)
    if (overlay) shadow.appendChild(overlay)

    var index = Math.max(0, Math.min(steps.length - 1, how.step || 0))
    var returnFocus = document.activeElement
    var closed = false

    function paint(dir) {
      var s = steps[index]
      var last = index === steps.length - 1
      progress.innerHTML = ''
      progress.setAttribute('aria-label', 'Step ' + (index + 1) + ' of ' + steps.length)
      if (opts.progress !== 'none' && steps.length > 1) {
        for (var i = 0; i < steps.length; i++) progress.appendChild(el('span', (opts.progress === 'dots' ? 'dot' : 'seg') + (i <= index && opts.progress !== 'dots' || i === index ? ' on' : '')))
      }
      skip.style.visibility = last ? 'hidden' : ''
      var next = function () {
        step.innerHTML = ''
        if (s.imageUrl) {
          var media = el('div', 'media', 'media')
          var img = el('img', '', 'image')
          img.alt = s.imageAlt || ''
          img.onerror = function () { media.remove(); text.classList.add('solo') }
          img.src = s.imageUrl
          media.appendChild(img)
          step.appendChild(media)
        }
        var text = el('div', 'text' + (s.imageUrl ? '' : ' solo'))
        if (s.title) { var h = el('h2', 'title', 'title'); h.id = 'hb-onb-title'; h.textContent = s.title; text.appendChild(h) }
        if (s.body) { var p = el('p', 'body', 'body'); p.textContent = s.body; text.appendChild(p) }
        step.appendChild(text)
        var actions = el('div', 'actions', 'actions')
        if (index > 0) {
          var back = el('button', 'btn back', 'back')
          back.type = 'button'
          back.textContent = labels.back
          back.onclick = function () { go(-1) }
          actions.appendChild(back)
        }
        var primary = el('button', 'btn next', 'next')
        primary.type = 'button'
        primary.textContent = s.buttonLabel || (last ? labels.done : labels.next)
        primary.onclick = function () { last ? finish('complete') : go(1) }
        actions.appendChild(primary)
        step.appendChild(actions)
        if (s.title) card.setAttribute('aria-labelledby', 'hb-onb-title')
        step.classList.remove('out')
        if (!how.target && !how.preview) primary.focus({ preventScroll: true })
      }
      if (dir && !still) {
        step.style.setProperty('--_dir', (dir > 0 ? -10 : 10) + 'px')
        step.classList.add('out')
        setTimeout(next, 160)
      } else next()
      if (!how.preview) { emit('step', flow, index); if (options.onStep) try { options.onStep(index, flow) } catch (e) {} }
    }

    function go(dir) {
      var to = index + dir
      if (to < 0 || to >= steps.length) return
      index = to
      paint(dir)
    }

    function close() {
      if (closed) return
      closed = true
      document.removeEventListener('keydown', onKey, true)
      if (overlay) {
        overlay.classList.remove('in')
        setTimeout(function () { host.remove() }, still ? 0 : 240)
      } else host.remove()
      if (!how.preview && returnFocus && returnFocus.focus) try { returnFocus.focus({ preventScroll: true }) } catch (e) {}
      if (current && current.host === host) current = null
    }

    function finish(result) {
      if (how.preview) return
      store(seenKey(), { version: flow.version || 0, result: result, at: Date.now() })
      emit(result, flow, index)
      var cb = result === 'complete' ? options.onComplete : options.onSkip
      if (cb) try { result === 'complete' ? cb(flow) : cb(flow, index) } catch (e) {}
      close()
    }

    function onKey(e) {
      if (closed || how.preview) return
      if (e.key === 'Escape' && opts.skippable !== false && !how.target) { e.preventDefault(); finish('skip') }
      else if (e.key === 'ArrowRight' && !how.target) go(1)
      else if (e.key === 'ArrowLeft' && !how.target) go(-1)
      else if (e.key === 'Tab' && overlay) {
        // Keep focus inside the dialog.
        var items = [].slice.call(shadow.querySelectorAll('button')).filter(function (b) { return b.offsetParent !== null && b.style.visibility !== 'hidden' })
        if (!items.length) return
        var at = items.indexOf(shadow.activeElement)
        if (e.shiftKey && at <= 0) { e.preventDefault(); items[items.length - 1].focus() } else if (!e.shiftKey && at === items.length - 1) { e.preventDefault(); items[0].focus() }
      }
    }

    // A horizontal swipe turns the page on touch screens.
    var startX = null
    card.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') startX = e.clientX })
    card.addEventListener('pointerup', function (e) {
      if (startX === null) return
      var dx = e.clientX - startX
      startX = null
      if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1)
    })
    skip.onclick = function () { finish('skip') }
    if (!how.preview) document.addEventListener('keydown', onKey, true)

    var mount = how.target ? (typeof how.target === 'string' ? document.querySelector(how.target) : how.target) : document.body
    if (!mount) { console.warn('[help-bites] no element matches the onboarding target ' + how.target); return null }
    mount.appendChild(host)
    paint(0)
    if (overlay) requestAnimationFrame(function () { requestAnimationFrame(function () { overlay.classList.add('in') }) })
    if (!how.preview) emit('show', flow, index)
    return { host: host, close: close }
  }

  function show(flow) {
    if (!flow) return
    if (current) current.close()
    current = draw(flow, { target: options.target })
  }

  function start(force) {
    if (!options.project) return console.warn('[help-bites] onboarding.js needs data-project="pk_…"')
    resolve(function (flow) { if (flow && (force || shouldShow(flow))) show(flow) })
  }

  var started = false
  var commands = {
    init: function (opts) {
      for (var k in (opts || {})) if (opts[k] !== undefined) options[k] = opts[k]
    },
    open: function () { started = true; start(true) },
    close: function () { if (current) current.close() },
    reset: function () { store(seenKey(), null) },
    // Draws a flow you pass in, inline, without fetching or remembering anything (the panel's preview).
    preview: function (opts) {
      var target = opts && (typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target)
      if (!target || !opts.flow) return
      if (target.__helpBitesOnboarding) target.__helpBitesOnboarding.close()
      target.__helpBitesOnboarding = draw(opts.flow, { target: target, preview: true, step: opts.step || 0, theme: opts.theme })
    }
  }

  function run(command) {
    if (!command || !commands[command[0]]) return
    commands[command[0]].apply(null, [].slice.call(command, 1))
  }

  var queue = window.HelpBitesOnboarding || []
  window.HelpBitesOnboarding = { push: run }
  for (var i = 0; i < queue.length; i++) run(queue[i])
  if (!started && options.project && options.show !== 'manual') start(false)
})()
