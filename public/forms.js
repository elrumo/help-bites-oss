/* SPDX-License-Identifier: MIT
 * help-bites lead forms. MIT-licensed (see licenses/MIT.txt) so sites that
 * embed it carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 * A waitlist, "notify me" or interest form from HelpBites, drawn in your page
 * where the script tag is (or in data-target). People who sign up become
 * contacts in your project:
 *
 *   <script src="https://support.example.com/forms.js" data-project="pk_…" data-form="waitlist" defer></script>
 *
 * Without data-form it draws the project's first form. The form is drawn here
 * from JSON (no iframe), in a shadow root, so your CSS and its CSS never collide.
 *
 * Options (data-* or init): form, target (a selector), theme ('light' |
 * 'dark' | 'system'; defaults to a dark/light class on your <html>, then the
 * colour behind the form), accent,
 * radius, font ('system' | 'rounded' | 'serif' | 'mono'), layout ('stacked' |
 * 'inline': the inputs and the button on one row), show (the parts to show:
 * 'title,description,footnote' by default; 'none' for just the inputs), host
 * (where HelpBites is, when you serve this file from your own site).
 *
 *   <script>
 *     window.HelpBitesForms = window.HelpBitesForms || []
 *     HelpBitesForms.push(['init', {
 *       labels: { title: 'Get early access', button: 'Count me in', successTitle: 'Thanks!' },
 *       values: { plan: 'pro' },              // answers you fill in yourself (hidden fields, by key)
 *       onSuccess: (result) => {}, onError: (message) => {}
 *     }])
 *     HelpBitesForms.push(['render', { form: 'beta', target: '#beta-form' }])   // another form
 *   </script>
 *
 * Restyle it from your CSS with variables on .help-bites-form
 * (--hb-form-accent, -on-accent, -bg, -text, -muted, -border, -input-bg,
 * -radius, -font, -gap, -max-width) or parts (::part(form), title,
 * description, fields, field, label, input, button, footnote, success, error).
 * Every outcome is also a `helpbites:form` event on window. The data is
 * GET /v1/forms/{pk}/{key}, and answers are posted to the same URL, if you
 * would rather draw your own.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  // A copy served from your own site (it is MIT) names the HelpBites it reads from.
  var origin = (attr('host') || new URL(script.src, location.href).origin).replace(/\/+$/, '')
  var own = {
    project: attr('project'), form: attr('form'), target: attr('target'), theme: attr('theme'), accent: attr('accent'), radius: attr('radius'),
    font: attr('font'), layout: attr('layout'), show: attr('show'), host: origin, anchor: script
  }

  // A second script tag on the page: the first one's code draws its form too.
  var ready = window.HelpBitesForms
  if (ready && ready.__helpBites) { ready.push(['render', own]); return }

  var TIMEOUT_MS = 8000
  var FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", -apple-system, BlinkMacSystemFont, sans-serif',
    serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif',
    mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace'
  }
  var INPUT = { email: 'email', name: 'text', text: 'text', number: 'number', url: 'url', phone: 'tel' }
  var AUTO = { email: 'email', name: 'name', phone: 'tel', url: 'url' }
  var defaults = { labels: {}, values: {}, onSuccess: null, onError: null }
  var mounts = []

  function emit(type, form, extra) {
    try { window.dispatchEvent(new CustomEvent('helpbites:form', { detail: Object.assign({ type: type, form: form.key }, extra || {}) })) } catch (e) {}
  }

  function onColour(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return '#ffffff'
    var n = parseInt(m[1], 16)
    var lin = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255) > 0.179 ? '#000000' : '#ffffff'
  }

  /** The first solid background behind `el`: the form sits on your page, so it follows what is really there. */
  function behind(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(node).backgroundColor || '')
      if (m && (m[4] === undefined || +m[4] > 0.5)) return [+m[1], +m[2], +m[3]]
    }
    return null
  }

  function dark(theme, host) {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    if (theme === 'system') return matchMedia('(prefers-color-scheme: dark)').matches
    var root = document.documentElement
    if (root.classList.contains('dark')) return true
    if (root.classList.contains('light')) return false
    var rgb = host && behind(host.parentElement)
    // A page that paints no background of its own is the browser's white.
    return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) < 128 : false
  }

  function pick(o, key) { return o[key] !== undefined && o[key] !== '' ? o[key] : defaults[key] }

  function css(form, o, host) {
    var style = form.style || {}
    var accent = /^#[0-9a-f]{6}$/i.test(pick(o, 'accent') || '') ? pick(o, 'accent') : style.accent || '#5e6ad2'
    var r = pick(o, 'radius')
    var radius = r !== undefined && r !== '' && !isNaN(+r) ? +r : (typeof style.radius === 'number' ? style.radius : 12)
    // No background of its own: the form sits on your page, without a card, in its light or dark.
    var card = !!style.background
    var night = card ? onColour(style.background) === '#ffffff' : dark(pick(o, 'theme'), host)
    var text = style.text || (night ? '#f4f4f5' : '#18181b')
    var font = FONTS[pick(o, 'font')] || FONTS[style.font] || FONTS.system
    return ':host{all:initial;display:block;--_accent:var(--hb-form-accent,' + accent + ');--_on:var(--hb-form-on-accent,' + onColour(accent) + ');--_bg:var(--hb-form-bg,' + (style.background || 'transparent') + ');--_text:var(--hb-form-text,' + text + ');--_muted:var(--hb-form-muted,color-mix(in srgb,var(--_text) 62%,transparent));--_border:var(--hb-form-border,color-mix(in srgb,var(--_text) 16%,transparent));--_input:var(--hb-form-input-bg,' + (night ? 'rgba(255,255,255,.04)' : '#ffffff') + ');--_r:var(--hb-form-radius,' + radius + 'px);--_font:var(--hb-form-font,' + font + ');--_gap:var(--hb-form-gap,12px)}'
      + '*{box-sizing:border-box}'
      + '.root{max-width:var(--hb-form-max-width,520px);background:var(--_bg);color:var(--_text);font:15px/1.5 var(--_font);-webkit-font-smoothing:antialiased;color-scheme:' + (night ? 'dark' : 'light') + (card ? ';padding:24px;border-radius:var(--_r);box-shadow:0 0 0 1px var(--_border)' : '') + '}'
      + '.logo{display:block;width:40px;height:40px;border-radius:calc(var(--_r) * .6);object-fit:cover;margin:0 0 14px}'
      + '.title{margin:0;font-size:22px;line-height:1.25;font-weight:650;letter-spacing:-.015em;text-wrap:balance}'
      + '.description{margin:8px 0 0;color:var(--_muted);text-wrap:pretty;white-space:pre-line}'
      + 'form{margin:0}'
      + '.head + form{margin-top:18px}'
      + '.fields{display:flex;flex-direction:column;gap:var(--_gap)}'
      + '.inline .fields{flex-direction:row;flex-wrap:wrap;align-items:flex-end}'
      + '.inline .field{flex:1 1 200px;min-width:0}'
      + '.inline .field.wide,.inline .field.check{flex-basis:100%}'
      + '.field{display:flex;flex-direction:column;gap:6px;margin:0}'
      + '.label{font-size:13px;font-weight:550}'
      + '.label small{font-weight:400;color:var(--_muted)}'
      + '.inline .label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
      + 'input,select,textarea{width:100%;height:44px;padding:0 12px;border:1px solid var(--_border);border-radius:calc(var(--_r) * .75);background:var(--_input);color:var(--_text);font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}'
      + 'textarea{height:auto;min-height:96px;padding:10px 12px;resize:vertical}'
      + 'input:focus,select:focus,textarea:focus{border-color:var(--_accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--_accent) 22%,transparent)}'
      + 'input::placeholder,textarea::placeholder{color:var(--_muted);opacity:.8}'
      + '.check{flex-direction:row;align-items:flex-start;gap:10px;cursor:pointer}'
      + '.check input{width:18px;height:18px;margin:2px 0 0;flex:none;accent-color:var(--_accent)}'
      + '.check .label{font-weight:400;font-size:14px}'
      + '.button{height:44px;padding:0 20px;border:0;border-radius:calc(var(--_r) * .75);background:var(--_accent);color:var(--_on);font:inherit;font-weight:600;cursor:pointer;white-space:nowrap;transition:transform .12s ease,filter .15s,opacity .15s}'
      + '.stacked .button{width:100%;margin-top:4px}'
      + '.inline .button{flex:0 0 auto}'
      + '.button:hover{filter:brightness(1.06)}'
      + '.button:active{transform:scale(.98)}'
      + '.button[disabled]{opacity:.6;cursor:default}'
      + 'button:focus-visible{outline:2px solid var(--_accent);outline-offset:2px}'
      + '.error{margin:12px 0 0;padding:8px 12px;border-radius:calc(var(--_r) * .6);background:color-mix(in srgb,#ef4444 12%,transparent);color:var(--_text);font-size:14px}'
      + '.footnote{margin:12px 0 0;color:var(--_muted);font-size:13px}'
      + '.success{display:flex;gap:12px;align-items:flex-start}'
      + '.tick{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:color-mix(in srgb,var(--_accent) 16%,transparent);color:var(--_accent);font-weight:700}'
      + '.success .title{font-size:18px}'
      + '.success .description{margin-top:4px}'
      + '.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}'
  }

  function el(tag, cls, part) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (part) e.setAttribute('part', part)
    return e
  }

  function text(tag, cls, part, value) {
    var e = el(tag, cls, part)
    e.textContent = value
    return e
  }

  /** The words: your labels win, then the form's own. */
  function words(form, o) {
    var given = Object.assign({}, defaults.labels, o.labels || {})
    var c = form.content || {}
    return {
      title: given.title !== undefined ? given.title : c.title,
      description: given.description !== undefined ? given.description : c.description,
      button: given.button || c.buttonLabel || 'Notify me',
      successTitle: given.successTitle || c.successTitle || 'You are on the list',
      successMessage: given.successMessage || c.successMessage || '',
      confirmMessage: given.confirmMessage || c.confirmMessage || '',
      footnote: given.footnote !== undefined ? given.footnote : c.footnote
    }
  }

  function parts(o) {
    var show = pick(o, 'show')
    if (!show) return { title: 1, description: 1, footnote: 1 }
    var out = {}
    String(show).split(',').forEach(function (p) { out[p.trim()] = 1 })
    return out
  }

  function fieldEl(f, id, inline) {
    var label = f.label || f.key
    if (f.type === 'checkbox') {
      var box = el('label', 'field check', 'field')
      var c = el('input', '', 'input')
      c.type = 'checkbox'
      c.name = f.key
      c.required = !!f.required
      box.appendChild(c)
      box.appendChild(text('span', 'label', 'label', label))
      return box
    }
    var wrap = el('label', 'field' + (f.type === 'textarea' ? ' wide' : ''), 'field')
    var name = el('span', 'label', 'label')
    name.textContent = label
    if (!f.required && !inline) name.appendChild(text('small', '', '', ' (optional)'))
    var input
    if (f.type === 'textarea') input = el('textarea', '', 'input')
    else if (f.type === 'select') {
      input = el('select', '', 'input')
      var none = el('option')
      none.value = ''
      none.textContent = f.placeholder || '—'
      input.appendChild(none)
      ;(f.options || []).forEach(function (option) { var opt = el('option'); opt.value = option; opt.textContent = option; input.appendChild(opt) })
    } else {
      input = el('input', '', 'input')
      input.type = INPUT[f.type] || 'text'
      if (AUTO[f.type]) input.autocomplete = AUTO[f.type]
      if (f.type === 'number') input.step = 'any'
    }
    input.name = f.key
    input.id = id
    input.required = !!f.required
    if (f.placeholder && f.type !== 'select') input.placeholder = f.placeholder
    else if (inline && f.type !== 'select') input.placeholder = label
    wrap.appendChild(name)
    wrap.appendChild(input)
    return wrap
  }

  /** Draws `form` into `host`'s shadow root: the form, then what happens after. */
  function draw(host, form, o) {
    var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' })
    shadow.innerHTML = ''
    var styleEl = el('style')
    styleEl.textContent = css(form, o, host)
    shadow.appendChild(styleEl)
    var layout = pick(o, 'layout') || (form.style && form.style.layout) || 'stacked'
    var w = words(form, o)
    var show = parts(o)
    var root = el('div', 'root ' + (layout === 'inline' ? 'inline' : 'stacked'))
    root.setAttribute('role', 'region')
    root.setAttribute('aria-label', w.title || form.name || 'Sign up')
    shadow.appendChild(root)

    function success(pending) {
      root.innerHTML = ''
      var box = el('div', 'success', 'success')
      box.setAttribute('role', 'status')
      box.appendChild(text('span', 'tick', '', '✓'))
      var words2 = el('div')
      words2.appendChild(text('p', 'title', 'title', w.successTitle))
      var message = pending ? w.confirmMessage : w.successMessage
      if (message) words2.appendChild(text('p', 'description', 'description', message))
      box.appendChild(words2)
      root.appendChild(box)
    }

    if (o.state === 'success') { success(!!form.doubleOptIn); return }

    var head = el('div', 'head')
    if (show.logo && form.project && /^https?:\/\//.test(form.project.logoUrl || '')) { var logo = el('img', 'logo', 'logo'); logo.src = form.project.logoUrl; logo.alt = ''; head.appendChild(logo) }
    if (show.title && w.title) head.appendChild(text('h2', 'title', 'title', w.title))
    if (show.description && w.description) head.appendChild(text('p', 'description', 'description', w.description))
    if (head.childNodes.length) root.appendChild(head)

    var formEl = el('form', '', 'form')
    formEl.noValidate = false
    var fields = el('div', 'fields', 'fields')
    ;(form.fields || []).forEach(function (f, i) { fields.appendChild(fieldEl(f, 'hb-form-' + (form.key || 'f') + '-' + i, layout === 'inline')) })
    var hp = el('div', 'hp')
    hp.setAttribute('aria-hidden', 'true')
    var trap = el('input')
    trap.name = 'website'
    trap.tabIndex = -1
    trap.autocomplete = 'off'
    hp.appendChild(trap)
    var button = text('button', 'button', 'button', w.button)
    button.type = 'submit'
    fields.appendChild(button)
    formEl.appendChild(fields)
    formEl.appendChild(hp)
    root.appendChild(formEl)
    var error = el('p', 'error', 'error')
    error.setAttribute('role', 'alert')
    error.hidden = true
    root.appendChild(error)
    if (show.footnote && w.footnote) root.appendChild(text('p', 'footnote', 'footnote', w.footnote))

    formEl.addEventListener('submit', function (e) {
      e.preventDefault()
      if (formEl.reportValidity && !formEl.reportValidity()) return
      var values = Object.assign({}, defaults.values, o.values || {})
      ;(form.fields || []).forEach(function (f) {
        var input = formEl.elements[f.key]
        if (!input) return
        values[f.key] = f.type === 'checkbox' ? input.checked : input.value
      })
      values.website = trap.value
      if (o.preview) { success(!!form.doubleOptIn); return }
      error.hidden = true
      button.disabled = true
      emit('submit', form)
      var controller = window.AbortController ? new AbortController() : null
      var timer = setTimeout(function () { if (controller) controller.abort() }, TIMEOUT_MS)
      var url = o.host + '/v1/forms/' + encodeURIComponent(o.project) + '/' + encodeURIComponent(form.key)
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values), credentials: 'omit', signal: controller && controller.signal })
        .then(function (r) { return r.json().catch(function () { return {} }).then(function (body) { return { ok: r.ok, status: r.status, body: body } }) })
        .then(function (res) {
          clearTimeout(timer)
          button.disabled = false
          if (res.ok) {
            var pending = !!(res.body && res.body.pending)
            success(pending)
            emit('success', form, { pending: pending })
            var done = o.onSuccess || defaults.onSuccess
            if (done) try { done({ form: form.key, pending: pending }) } catch (x) {}
            return
          }
          fail(res.status === 429 ? 'Too many tries. Wait a moment and try again.' : (res.body && (res.body.message || res.body.statusMessage)) || 'Something went wrong. Please try again.')
        })
        .catch(function () { clearTimeout(timer); button.disabled = false; fail('Could not reach the server. Check your connection and try again.') })
    })

    function fail(message) {
      error.textContent = message
      error.hidden = false
      emit('error', form, { message: message })
      var cb = o.onError || defaults.onError
      if (cb) try { cb(message) } catch (x) {}
    }
  }

  function hostFor(o) {
    var target = o.target ? (typeof o.target === 'string' ? document.querySelector(o.target) : o.target) : null
    if (o.target && !target) { console.warn('[help-bites] no element matches the form target ' + o.target); return null }
    var host = el('div', 'help-bites-form')
    if (target) { target.innerHTML = ''; target.appendChild(host) } else if (o.anchor && o.anchor.parentNode) o.anchor.parentNode.insertBefore(host, o.anchor.nextSibling)
    else document.body.appendChild(host)
    return host
  }

  function render(o) {
    if (!o.project) return console.warn('[help-bites] forms.js needs data-project="pk_…"')
    o.host = (o.host || origin).replace(/\/+$/, '')
    var host = hostFor(o)
    if (!host) return
    var controller = window.AbortController ? new AbortController() : null
    var timer = setTimeout(function () { if (controller) controller.abort() }, TIMEOUT_MS)
    var url = o.host + '/v1/forms/' + encodeURIComponent(o.project) + (o.form ? '/' + encodeURIComponent(o.form) : '')
    fetch(url, { credentials: 'omit', signal: controller && controller.signal })
      .then(function (r) { if (r.status === 404) console.warn('[help-bites] no active form ' + (o.form || '') + ' for ' + o.project); return r.ok ? r.json() : null })
      .then(function (body) {
        clearTimeout(timer)
        if (!body || !body.form) { host.remove(); return }
        var mount = { host: host, form: body.form, options: o }
        mounts.push(mount)
        draw(host, body.form, o)
      })
      .catch(function () { clearTimeout(timer); host.remove() })
  }

  var commands = {
    // Defaults for every form on the page; forms already drawn are drawn again with them.
    init: function (opts) {
      for (var k in (opts || {})) if (opts[k] !== undefined) defaults[k] = opts[k]
      mounts.forEach(function (m) { draw(m.host, m.form, m.options) })
    },
    render: function (opts) { render(Object.assign({}, own, { anchor: null }, opts || {})) },
    // Draws a form you pass in, without fetching or sending anything (the panel's preview).
    preview: function (opts) {
      var target = opts && (typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target)
      if (!target || !opts.form) return
      var host = target.querySelector('.help-bites-form')
      if (!host) { host = el('div', 'help-bites-form'); target.innerHTML = ''; target.appendChild(host) }
      draw(host, opts.form, { preview: true, theme: opts.theme, state: opts.state, labels: {}, values: {} })
    }
  }

  function run(command) {
    if (!command || !commands[command[0]]) return
    commands[command[0]].apply(null, [].slice.call(command, 1))
  }

  var queue = window.HelpBitesForms || []
  window.HelpBitesForms = { push: run, __helpBites: true }
  for (var i = 0; i < queue.length; i++) run(queue[i])
  if (own.project) render(own)
})()
