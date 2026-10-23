/* SPDX-License-Identifier: MIT
 * help-bites pricing tables. MIT-licensed (see licenses/MIT.txt) so sites that
 * embed it carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 * Your plans, drawn in your page where the script tag is (or in data-target):
 *
 *   <script src="https://support.example.com/pricing.js" data-project="pk_..." data-table="pricing" defer></script>
 *
 * Without data-table it draws the project's first published table. Prices of
 * plans linked to Stripe are Stripe's; the words are yours, from the panel. The
 * table is drawn here from JSON (no iframe), in a shadow root, so your CSS and
 * its CSS never collide.
 *
 * Options (data-* or init): table, target (a selector), template ('tiers' |
 * 'rows' | 'paywall' | 'matrix' | 'spotlight': overrides the table's), theme
 * ('light' | 'dark' | 'system'; defaults to a dark/light class on your <html>,
 * the project style's scheme, then the colour behind the table), accent, radius
 * (0 to 32), shadow ('none' | 'soft' | 'medium' | 'strong': the card shadow of tables
 * whose surface is 'shadow'), font ('system' | 'rounded'
 * | 'serif' | 'mono'), density ('compact' | 'comfortable' | 'spacious'),
 * interval ('week' | 'month' | 'year': where the toggle starts), currency (a
 * three-letter code, or 'auto' for the visitor's region; shown when every price
 * has it, and a switcher offers the others), locale (a language tag; defaults to
 * your <html lang>, then the browser's), show (the parts to show:
 * 'title,subtitle,toggle,currency,features,footnote,logo' by default, 'none' for
 * just the plans), current (the key of the visitor's plan: its button says
 * Current plan), email and ref (filled into checkout: the buyer's email and
 * your id for them), return (where checkout comes back to; this page by
 * default), host (where HelpBites is, when you serve this file from your own
 * site).
 *
 * It counts a view when it draws the table and a click when a plan's button is
 * pressed, under a random id it keeps in localStorage ('hb-visitor'), so the
 * table's numbers and A/B tests count each visitor once and show them the same
 * table each visit. Purchases are counted from Stripe, not here.
 *
 *   <script>
 *     window.HelpBitesPricing = window.HelpBitesPricing || []
 *     HelpBitesPricing.push(['init', {
 *       email: currentUser.email, ref: currentUser.id, current: 'starter',
 *       labels: { yearly: 'Annual', choose: 'Choose' },
 *       // Return false to handle it yourself (your own checkout, a sign-up first).
 *       onSelect: (plan, interval, price) => {}
 *     }])
 *     HelpBitesPricing.push(['render', { table: 'teams', target: '#team-pricing' }])   // another table
 *   </script>
 *
 * The table wears the project's style (the Style panel's light and dark colours,
 * corner radius, shadow) wherever the table's own look leaves a field empty; the
 * options above win over both.
 *
 * Restyle it from your CSS with variables on .help-bites-pricing
 * (--hb-pricing-accent, -on-accent, -bg, -card, -text, -muted, -border,
 * -radius, -font, -gap, -max-width) or parts (::part(root), head, title,
 * subtitle, toggle, toggle-option, savings, plans, plan, plan-highlighted,
 * badge, name, description, price, amount, period, compare, note, trial,
 * button, includes, features, feature, value, hint, option, table, footnote,
 * links). Every outcome is also a `helpbites:pricing` event on window. The data
 * is GET /v1/pricing/{pk}/{key} if you would rather draw your own.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  // A copy served from your own site (it is MIT) names the HelpBites it reads from.
  var origin = (attr('host') || new URL(script.src, location.href).origin).replace(/\/+$/, '')
  var own = {
    project: attr('project'), table: attr('table'), target: attr('target'), template: attr('template'), theme: attr('theme'), accent: attr('accent'),
    radius: attr('radius'), shadow: attr('shadow'), font: attr('font'), density: attr('density'), interval: attr('interval'), currency: attr('currency'), locale: attr('locale'),
    show: attr('show'), current: attr('current'), email: attr('email'), ref: attr('ref'), returnUrl: attr('return'), host: origin, anchor: script
  }

  // A second script tag on the page: the first one's code draws its table too.
  var ready = window.HelpBitesPricing
  if (ready && ready.__helpBites) { if (own.project) ready.push(['render', own]); return }

  var TIMEOUT_MS = 8000
  var FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", -apple-system, BlinkMacSystemFont, sans-serif',
    serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, serif',
    mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace'
  }
  // The project style's shadows (shared/projectStyle.ts STYLE_SHADOW_CSS).
  var SHADOWS = {
    none: 'none',
    soft: '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.08)',
    medium: '0 4px 12px rgb(0 0 0 / 0.1)',
    strong: '0 12px 32px rgb(0 0 0 / 0.18)'
  }
  var DENSITY = { compact: [16, 12, 14], comfortable: [24, 16, 15], spacious: [32, 24, 16] }
  // The words the table uses when the operator left one empty, by language (labels in your options win).
  var WORDS = {
    en: { weekly: 'Weekly', perWeek: '/week', everyWeeks: 'every {n} weeks', currency: 'Currency', monthly: 'Monthly', yearly: 'Yearly', save: 'Save {percent}%', perMonth: '/month', perYear: '/year', everyMonths: 'every {n} months', everyYears: 'every {n} years', billedYearly: '{total} billed yearly', monthlyEq: '{monthly} a month', once: 'One-time payment', free: 'Free', custom: 'Custom', choose: 'Get started', trial: 'Start {days}-day free trial', trialNote: '{days}-day free trial', contact: 'Contact us', current: 'Current plan', included: 'Included', notIncluded: 'Not included', everything: 'Everything in {plan}, plus:', features: 'Features', billing: 'Billing period', next: 'Continue', terms: 'Terms', privacy: 'Privacy', perUnit: 'per {unit}', original: 'Original price', plans: 'Plans' },
    es: { weekly: 'Semanal', perWeek: '/semana', everyWeeks: 'cada {n} semanas', currency: 'Moneda', monthly: 'Mensual', yearly: 'Anual', save: 'Ahorra un {percent}%', perMonth: '/mes', perYear: '/a\u00f1o', everyMonths: 'cada {n} meses', everyYears: 'cada {n} a\u00f1os', billedYearly: '{total} al a\u00f1o', monthlyEq: '{monthly} al mes', once: 'Pago \u00fanico', free: 'Gratis', custom: 'A medida', choose: 'Empezar', trial: 'Empieza la prueba gratis de {days} d\u00edas', trialNote: 'Prueba gratis de {days} d\u00edas', contact: 'Cont\u00e1ctanos', current: 'Tu plan actual', included: 'Incluido', notIncluded: 'No incluido', everything: 'Todo lo de {plan}, y adem\u00e1s:', features: 'Funciones', billing: 'Periodo de facturaci\u00f3n', next: 'Continuar', terms: 'T\u00e9rminos', privacy: 'Privacidad', perUnit: 'por {unit}', original: 'Precio original', plans: 'Planes' },
    ca: { weekly: 'Setmanal', perWeek: '/setmana', everyWeeks: 'cada {n} setmanes', currency: 'Moneda', monthly: 'Mensual', yearly: 'Anual', save: 'Estalvia un {percent}%', perMonth: '/mes', perYear: '/any', everyMonths: 'cada {n} mesos', everyYears: 'cada {n} anys', billedYearly: '{total} a l\u2019any', monthlyEq: '{monthly} al mes', once: 'Pagament \u00fanic', free: 'Gratu\u00eft', custom: 'A mida', choose: 'Comen\u00e7a', trial: 'Comen\u00e7a la prova gratu\u00efta de {days} dies', trialNote: 'Prova gratu\u00efta de {days} dies', contact: 'Contacta\u2019ns', current: 'El teu pla actual', included: 'Incl\u00f2s', notIncluded: 'No incl\u00f2s', everything: 'Tot el de {plan}, i a m\u00e9s:', features: 'Funcions', billing: 'Per\u00edode de facturaci\u00f3', next: 'Continua', terms: 'Termes', privacy: 'Privadesa', perUnit: 'per {unit}', original: 'Preu original', plans: 'Plans' },
    fr: { weekly: 'Hebdomadaire', perWeek: '/semaine', everyWeeks: 'toutes les {n} semaines', currency: 'Devise', monthly: 'Mensuel', yearly: 'Annuel', save: '\u00c9conomisez {percent} %', perMonth: '/mois', perYear: '/an', everyMonths: 'tous les {n} mois', everyYears: 'tous les {n} ans', billedYearly: '{total} factur\u00e9s par an', monthlyEq: '{monthly} par mois', once: 'Paiement unique', free: 'Gratuit', custom: 'Sur mesure', choose: 'Commencer', trial: 'Commencer l\u2019essai gratuit de {days} jours', trialNote: 'Essai gratuit de {days} jours', contact: 'Nous contacter', current: 'Votre formule actuelle', included: 'Inclus', notIncluded: 'Non inclus', everything: 'Tout {plan}, et en plus :', features: 'Fonctionnalit\u00e9s', billing: 'P\u00e9riode de facturation', next: 'Continuer', terms: 'Conditions', privacy: 'Confidentialit\u00e9', perUnit: 'par {unit}', original: 'Prix d\u2019origine', plans: 'Formules' },
    de: { weekly: 'W\u00f6chentlich', perWeek: '/Woche', everyWeeks: 'alle {n} Wochen', currency: 'W\u00e4hrung', monthly: 'Monatlich', yearly: 'J\u00e4hrlich', save: 'Spare {percent} %', perMonth: '/Monat', perYear: '/Jahr', everyMonths: 'alle {n} Monate', everyYears: 'alle {n} Jahre', billedYearly: '{total} j\u00e4hrlich abgerechnet', monthlyEq: '{monthly} pro Monat', once: 'Einmalzahlung', free: 'Kostenlos', custom: 'Individuell', choose: 'Loslegen', trial: '{days} Tage kostenlos testen', trialNote: '{days} Tage kostenlos testen', contact: 'Kontakt aufnehmen', current: 'Dein aktueller Plan', included: 'Enthalten', notIncluded: 'Nicht enthalten', everything: 'Alles aus {plan}, plus:', features: 'Funktionen', billing: 'Abrechnungszeitraum', next: 'Weiter', terms: 'AGB', privacy: 'Datenschutz', perUnit: 'pro {unit}', original: 'Urspr\u00fcnglicher Preis', plans: 'Pl\u00e4ne' },
    it: { weekly: 'Settimanale', perWeek: '/settimana', everyWeeks: 'ogni {n} settimane', currency: 'Valuta', monthly: 'Mensile', yearly: 'Annuale', save: 'Risparmia il {percent}%', perMonth: '/mese', perYear: '/anno', everyMonths: 'ogni {n} mesi', everyYears: 'ogni {n} anni', billedYearly: '{total} fatturati annualmente', monthlyEq: '{monthly} al mese', once: 'Pagamento unico', free: 'Gratis', custom: 'Su misura', choose: 'Inizia', trial: 'Inizia la prova gratuita di {days} giorni', trialNote: 'Prova gratuita di {days} giorni', contact: 'Contattaci', current: 'Il tuo piano attuale', included: 'Incluso', notIncluded: 'Non incluso', everything: 'Tutto di {plan}, in pi\u00f9:', features: 'Funzionalit\u00e0', billing: 'Periodo di fatturazione', next: 'Continua', terms: 'Termini', privacy: 'Privacy', perUnit: 'per {unit}', original: 'Prezzo originale', plans: 'Piani' },
    pt: { weekly: 'Semanal', perWeek: '/semana', everyWeeks: 'a cada {n} semanas', currency: 'Moeda', monthly: 'Mensal', yearly: 'Anual', save: 'Economize {percent}%', perMonth: '/m\u00eas', perYear: '/ano', everyMonths: 'a cada {n} meses', everyYears: 'a cada {n} anos', billedYearly: '{total} por ano', monthlyEq: '{monthly} por m\u00eas', once: 'Pagamento \u00fanico', free: 'Gr\u00e1tis', custom: 'Personalizado', choose: 'Come\u00e7ar', trial: 'Come\u00e7ar teste gr\u00e1tis de {days} dias', trialNote: 'Teste gr\u00e1tis de {days} dias', contact: 'Fale conosco', current: 'Seu plano atual', included: 'Inclu\u00eddo', notIncluded: 'N\u00e3o inclu\u00eddo', everything: 'Tudo do {plan}, e mais:', features: 'Recursos', billing: 'Per\u00edodo de cobran\u00e7a', next: 'Continuar', terms: 'Termos', privacy: 'Privacidade', perUnit: 'por {unit}', original: 'Pre\u00e7o original', plans: 'Planos' },
    ja: { weekly: '\u9031\u6255\u3044', perWeek: '/\u9031', everyWeeks: '{n}\u9031\u9593\u3054\u3068', currency: '\u901a\u8ca8', monthly: '\u6708\u6255\u3044', yearly: '\u5e74\u6255\u3044', save: '{percent}%\u304a\u5f97', perMonth: '/\u6708', perYear: '/\u5e74', everyMonths: '{n}\u304b\u6708\u3054\u3068', everyYears: '{n}\u5e74\u3054\u3068', billedYearly: '\u5e74\u984d{total}', monthlyEq: '\u6708\u3042\u305f\u308a{monthly}', once: '\u8cb7\u3044\u5207\u308a', free: '\u7121\u6599', custom: '\u8981\u76f8\u8ac7', choose: '\u59cb\u3081\u308b', trial: '{days}\u65e5\u9593\u306e\u7121\u6599\u30c8\u30e9\u30a4\u30a2\u30eb\u3092\u958b\u59cb', trialNote: '{days}\u65e5\u9593\u306e\u7121\u6599\u30c8\u30e9\u30a4\u30a2\u30eb', contact: '\u304a\u554f\u3044\u5408\u308f\u305b', current: '\u73fe\u5728\u306e\u30d7\u30e9\u30f3', included: '\u542b\u307e\u308c\u308b', notIncluded: '\u542b\u307e\u308c\u306a\u3044', everything: '{plan}\u306e\u3059\u3079\u3066\u306b\u52a0\u3048\u3066:', features: '\u6a5f\u80fd', billing: '\u8acb\u6c42\u671f\u9593', next: '\u7d9a\u3051\u308b', terms: '\u5229\u7528\u898f\u7d04', privacy: '\u30d7\u30e9\u30a4\u30d0\u30b7\u30fc', perUnit: '{unit}\u3042\u305f\u308a', original: '\u5143\u306e\u4fa1\u683c', plans: '\u30d7\u30e9\u30f3' },
    ko: { weekly: '\uc8fc\uac04', perWeek: '/\uc8fc', everyWeeks: '{n}\uc8fc\ub9c8\ub2e4', currency: '\ud1b5\ud654', monthly: '\uc6d4\uac04', yearly: '\uc5f0\uac04', save: '{percent}% \uc808\uc57d', perMonth: '/\uc6d4', perYear: '/\ub144', everyMonths: '{n}\uac1c\uc6d4\ub9c8\ub2e4', everyYears: '{n}\ub144\ub9c8\ub2e4', billedYearly: '\uc5f0 {total} \uccad\uad6c', monthlyEq: '\uc6d4 {monthly}', once: '\uc77c\ud68c\uc131 \uacb0\uc81c', free: '\ubb34\ub8cc', custom: '\ub9de\ucda4\ud615', choose: '\uc2dc\uc791\ud558\uae30', trial: '{days}\uc77c \ubb34\ub8cc \uccb4\ud5d8 \uc2dc\uc791', trialNote: '{days}\uc77c \ubb34\ub8cc \uccb4\ud5d8', contact: '\ubb38\uc758\ud558\uae30', current: '\ud604\uc7ac \ud50c\ub79c', included: '\ud3ec\ud568', notIncluded: '\ubbf8\ud3ec\ud568', everything: '{plan}\uc758 \ubaa8\ub4e0 \uae30\ub2a5, \ucd94\uac00\ub85c:', features: '\uae30\ub2a5', billing: '\uacb0\uc81c \uc8fc\uae30', next: '\uacc4\uc18d', terms: '\uc774\uc6a9\uc57d\uad00', privacy: '\uac1c\uc778\uc815\ubcf4 \ucc98\ub9ac\ubc29\uce68', perUnit: '{unit}\ub2f9', original: '\uc6d0\ub798 \uac00\uaca9', plans: '\ud50c\ub79c' },
    zh: { weekly: '\u6309\u5468', perWeek: '/\u5468', everyWeeks: '\u6bcf {n} \u5468', currency: '\u8d27\u5e01', monthly: '\u6309\u6708', yearly: '\u6309\u5e74', save: '\u8282\u7701 {percent}%', perMonth: '/\u6708', perYear: '/\u5e74', everyMonths: '\u6bcf {n} \u4e2a\u6708', everyYears: '\u6bcf {n} \u5e74', billedYearly: '\u6bcf\u5e74 {total}', monthlyEq: '\u6bcf\u6708 {monthly}', once: '\u4e00\u6b21\u6027\u4ed8\u6b3e', free: '\u514d\u8d39', custom: '\u5b9a\u5236', choose: '\u5f00\u59cb\u4f7f\u7528', trial: '\u5f00\u59cb {days} \u5929\u514d\u8d39\u8bd5\u7528', trialNote: '{days} \u5929\u514d\u8d39\u8bd5\u7528', contact: '\u8054\u7cfb\u6211\u4eec', current: '\u5f53\u524d\u65b9\u6848', included: '\u5305\u542b', notIncluded: '\u4e0d\u5305\u542b', everything: '\u5305\u542b {plan} \u7684\u5168\u90e8\u529f\u80fd\uff0c\u53e6\u52a0\uff1a', features: '\u529f\u80fd', billing: '\u8ba1\u8d39\u5468\u671f', next: '\u7ee7\u7eed', terms: '\u6761\u6b3e', privacy: '\u9690\u79c1', perUnit: '\u6bcf{unit}', original: '\u539f\u4ef7', plans: '\u65b9\u6848' }
  }
  var RTL = { ar: 1, he: 1, fa: 1, ur: 1 }
  var defaults = { labels: {}, onSelect: null, onReady: null }
  var mounts = []
  var uid = 0

  function emit(type, table, extra) {
    try { window.dispatchEvent(new CustomEvent('helpbites:pricing', { detail: Object.assign({ type: type, table: table.key }, extra || {}) })) } catch (e) {}
  }

  function onColour(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '')
    if (!m) return '#ffffff'
    var n = parseInt(m[1], 16)
    var lin = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255) > 0.179 ? '#000000' : '#ffffff'
  }

  /** The first solid background behind `el`: the table sits on your page, so it follows what is really there. */
  function behind(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(node).backgroundColor || '')
      if (m && (m[4] === undefined || +m[4] > 0.5)) return [+m[1], +m[2], +m[3]]
    }
    return null
  }

  function dark(theme, host, scheme) {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    if (theme === 'system') return matchMedia('(prefers-color-scheme: dark)').matches
    var root = document.documentElement
    if (root.classList.contains('dark')) return true
    if (root.classList.contains('light')) return false
    // The project style fixes a scheme: that one.
    if (scheme === 'dark' || scheme === 'light') return scheme === 'dark'
    var rgb = host && behind(host.parentElement)
    // A page that paints no background of its own is the browser's white.
    return rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) < 128 : false
  }

  function pick(o, key) { return o[key] !== undefined && o[key] !== '' && o[key] !== null ? o[key] : defaults[key] }
  function fill(text, values) { return String(text || '').replace(/\{(\w+)\}/g, function (m, k) { return values[k] !== undefined ? values[k] : m }) }

  function css(table, o, host) {
    var style = table.style || {}
    // The project's style under the table's own fields (table.look, null while the project has none).
    var look = table.look
    var night = style.background ? onColour(style.background) === '#ffffff' : dark(pick(o, 'theme'), host, look && look.scheme)
    var p = look && look[night ? 'dark' : 'light']
    var accent = /^#[0-9a-f]{6}$/i.test(pick(o, 'accent') || '') ? pick(o, 'accent') : (p && p.accent) || style.accent || '#5e6ad2'
    var r = pick(o, 'radius')
    var radius = r !== undefined && r !== '' && !isNaN(+r) ? +r : (look ? look.radius : typeof style.radius === 'number' ? style.radius : 16)
    var text = style.text || (p ? p.text : night ? '#f4f4f5' : '#18181b')
    var card = style.background || (p ? p.surface : night ? '#18181b' : '#ffffff')
    // Muted and border follow the project's palette, unless the table sets its own background or text.
    var tinted = p && !style.background && !style.text
    var shadow = SHADOWS[pick(o, 'shadow')] || (look && look.shadowCss) || ''
    var font = FONTS[pick(o, 'font')] || (look && style.font === 'system' ? look.fontFamily : FONTS[style.font]) || FONTS.system
    var d = DENSITY[pick(o, 'density')] || DENSITY[style.density] || DENSITY.comfortable
    var surface = style.surface || 'outline'
    var highlight = style.highlight || 'border'
    var on = onColour(accent)
    return ':host{all:initial;display:block;--_accent:var(--hb-pricing-accent,' + accent + ');--_on:var(--hb-pricing-on-accent,' + on + ');--_bg:var(--hb-pricing-bg,transparent);--_card:var(--hb-pricing-card,' + card + ');--_text:var(--hb-pricing-text,' + text + ');--_muted:var(--hb-pricing-muted,' + (tinted ? p.muted : 'color-mix(in srgb,var(--_text) 62%,transparent)') + ');--_border:var(--hb-pricing-border,' + (tinted ? p.border : 'color-mix(in srgb,var(--_text) 13%,transparent)') + ');--_r:var(--hb-pricing-radius,' + radius + 'px);--_font:var(--hb-pricing-font,' + font + ');--_pad:' + d[0] + 'px;--_gap:var(--hb-pricing-gap,' + d[1] + 'px)}'
      + '*{box-sizing:border-box}'
      + '.root{position:relative;max-width:var(--hb-pricing-max-width,1120px);margin:0 auto;background:var(--_bg);color:var(--_text);font:' + d[2] + 'px/1.5 var(--_font);-webkit-font-smoothing:antialiased;color-scheme:' + (night ? 'dark' : 'light') + '}'
      + '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
      + '.head{text-align:center;margin:0 auto calc(var(--_gap) * 1.5);max-width:640px}'
      + '.logo{display:block;width:48px;height:48px;margin:0 auto 14px;border-radius:calc(var(--_r) * .7);object-fit:cover}'
      + '.title{margin:0;font-size:clamp(24px,4vw,34px);line-height:1.15;font-weight:700;letter-spacing:-.02em;text-wrap:balance}'
      + '.subtitle{margin:10px 0 0;color:var(--_muted);font-size:1.07em;text-wrap:pretty}'
      + '.toggle{display:flex;justify-content:center;margin:0 0 calc(var(--_gap) * 1.5)}'
      + '.seg{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:color-mix(in srgb,var(--_text) 7%,transparent)}'
      + '.seg button{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 16px;border:0;border-radius:999px;background:transparent;color:var(--_muted);font:inherit;font-size:.93em;font-weight:600;cursor:pointer;transition:background .15s,color .15s}'
      + '.seg button[aria-checked="true"]{background:var(--_card);color:var(--_text);box-shadow:0 1px 3px rgba(0,0,0,.12)}'
      + '.savings{padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--_accent) 16%,transparent);color:var(--_accent);font-size:.8em;font-weight:700;white-space:nowrap}'
      + '.currency{display:flex;justify-content:center;margin:calc(var(--_gap) * -0.75) 0 calc(var(--_gap) * 1.5)}'
      + '.currency select{height:32px;padding:0 28px 0 10px;border:1px solid var(--_border);border-radius:999px;background:var(--_card);color:var(--_text);font:inherit;font-size:.86em}'
      + '.tpl-paywall .currency{justify-content:flex-start;margin:0 0 var(--_gap)}'
      + '.plans{display:grid;gap:var(--_gap);grid-template-columns:repeat(auto-fit,minmax(240px,1fr));align-items:stretch}'
      + '.card{position:relative;display:flex;flex-direction:column;min-width:0;padding:var(--_pad);border-radius:var(--_r);background:var(--_card);'
      + (surface === 'flat' ? 'background:color-mix(in srgb,var(--_text) 4%,var(--_card))}' : surface === 'shadow' ? 'box-shadow:' + (shadow || '0 1px 2px rgba(0,0,0,.06),0 12px 32px rgba(0,0,0,' + (night ? '.4' : '.08') + ')') + '}' : 'box-shadow:0 0 0 1px var(--_border)}')
      + (highlight === 'fill' ? '.card.hl{background:var(--_accent);color:var(--_on);--_muted:color-mix(in srgb,var(--_on) 75%,transparent);--_border:color-mix(in srgb,var(--_on) 25%,transparent)}.card.hl .button.primary{background:var(--_on);color:var(--_accent)}.card.hl .badge{background:var(--_on);color:var(--_accent)}.card.hl .check{color:var(--_on)}'
        : highlight === 'raise' ? '.card.hl{box-shadow:0 0 0 1px var(--_accent),0 18px 48px color-mix(in srgb,var(--_accent) 28%,transparent);transform:translateY(-8px)}@media (max-width:640px){.card.hl{transform:none}}'
          : '.card.hl{box-shadow:0 0 0 2px var(--_accent)}')
      + '.badge{align-self:flex-start;margin:0 0 12px;padding:3px 10px;border-radius:999px;background:var(--_accent);color:var(--_on);font-size:.78em;font-weight:700;letter-spacing:.01em}'
      + '.card > .badge{position:absolute;top:0;left:var(--_pad);transform:translateY(-50%);margin:0}'
      + '.name{margin:0;font-size:1.15em;font-weight:650;letter-spacing:-.01em}'
      + '.description{margin:6px 0 0;color:var(--_muted);font-size:.93em;text-wrap:pretty}'
      + '.price{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 6px;margin:18px 0 0}'
      + '.amount{font-size:2.4em;line-height:1;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}'
      + '.period{color:var(--_muted);font-size:.95em}'
      + '.compare{color:var(--_muted);font-size:1.05em;text-decoration:line-through}'
      + '.note,.trial{margin:6px 0 0;color:var(--_muted);font-size:.88em}'
      + '.trial{color:var(--_accent);font-weight:600}'
      + '.card.hl .trial{color:inherit}'
      + '.button{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;margin:20px 0 0;padding:0 18px;border:0;border-radius:calc(var(--_r) * .6);font:inherit;font-weight:600;text-align:center;text-decoration:none;cursor:pointer;transition:transform .12s ease,filter .15s,background .15s}'
      + '.button.primary{background:var(--_accent);color:var(--_on)}'
      + '.button.secondary{background:transparent;color:var(--_text);box-shadow:inset 0 0 0 1px var(--_border)}'
      + '.button.secondary:hover{background:color-mix(in srgb,var(--_text) 6%,transparent)}'
      + '.button.primary:hover{filter:brightness(1.06)}'
      + '.button:active{transform:scale(.98)}'
      + '.button[aria-disabled="true"]{opacity:.55;cursor:default;transform:none}'
      + 'a:focus-visible,button:focus-visible,input:focus-visible + .dot{outline:2px solid var(--_accent);outline-offset:2px}'
      + '.includes{margin:20px 0 0;font-size:.88em;font-weight:600}'
      + '.features{display:flex;flex-direction:column;gap:10px;margin:16px 0 0;padding:0;list-style:none;font-size:.93em}'
      + '.includes + .features{margin-top:10px}'
      + '.feature{display:flex;align-items:flex-start;gap:10px}'
      + '.feature.off{color:var(--_muted)}'
      + '.feature.off .text{text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--_text) 35%,transparent)}'
      + '.check{flex:none;width:18px;height:18px;margin-top:2px;color:var(--_accent)}'
      + '.feature.off .check{color:var(--_muted)}'
      + '.text{flex:1;min-width:0}'
      + '.value{margin-left:auto;padding-left:8px;font-weight:650;white-space:nowrap}'
      + '.hint{position:relative;display:inline-grid;place-items:center;width:16px;height:16px;margin-left:4px;padding:0;border:0;border-radius:50%;background:color-mix(in srgb,var(--_text) 12%,transparent);color:var(--_muted);font:700 10px/1 var(--_font);vertical-align:1px;cursor:help}'
      + '.tip{position:absolute;bottom:calc(100% + 8px);left:50%;z-index:2;width:max-content;max-width:240px;padding:8px 10px;border-radius:8px;background:var(--_text);color:var(--_card);font:400 12px/1.4 var(--_font);text-align:left;transform:translateX(-50%);opacity:0;pointer-events:none;transition:opacity .12s}'
      + '.hint:hover .tip,.hint:focus .tip{opacity:1}'
      + '.footnote{margin:calc(var(--_gap) * 1.5) auto 0;max-width:720px;color:var(--_muted);font-size:.86em;text-align:center;white-space:pre-line}'
      + '.links{display:flex;justify-content:center;gap:16px;margin:12px 0 0;font-size:.86em}'
      + '.links a{color:var(--_muted)}'
      // rows: one line a plan
      + '.tpl-rows .plans{display:flex;flex-direction:column;gap:0;padding:0;border-radius:var(--_r);background:var(--_card);box-shadow:0 0 0 1px var(--_border);overflow:hidden}'
      + '.tpl-rows .card{flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px 20px;border-radius:0;box-shadow:none;transform:none;background:transparent}'
      + '.tpl-rows .card + .card{border-top:1px solid var(--_border)}'
      + '.tpl-rows .card.hl{background:color-mix(in srgb,var(--_accent) 7%,transparent);color:inherit}'
      + '.tpl-rows .who{flex:1 1 220px;min-width:0}'
      + '.tpl-rows .name .badge{margin:0 0 0 8px;vertical-align:2px;font-size:.68em}'
      + '.tpl-rows .price{margin:0;flex:0 0 auto}'
      + '.tpl-rows .amount{font-size:1.6em}'
      + '.tpl-rows .button{width:auto;min-width:140px;margin:0;flex:0 0 auto}'
      + '.tpl-rows .card.hl .button.primary{background:var(--_accent);color:var(--_on)}'
      + '@media (max-width:560px){.tpl-rows .button{width:100%}}'
      // spotlight: one wide card a plan
      + '.tpl-spotlight .plans{grid-template-columns:1fr;max-width:920px;margin:0 auto}'
      + '.tpl-spotlight .card{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(240px,1fr);gap:var(--_gap) calc(var(--_gap) * 2);padding:calc(var(--_pad) * 1.25);transform:none}'
      + '.tpl-spotlight .card > .badge{position:static;transform:none;margin:0 0 10px;grid-column:1}'
      + '.tpl-spotlight .features{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}'
      + '.tpl-spotlight .box{display:flex;flex-direction:column;justify-content:center;padding:var(--_pad);border-radius:calc(var(--_r) * .8);background:color-mix(in srgb,var(--_text) 4%,transparent);text-align:center}'
      + '.tpl-spotlight .card.hl .box{background:color-mix(in srgb,var(--_on) 12%,transparent)}'
      + '.tpl-spotlight .box .price{justify-content:center;margin:0}'
      + '@media (max-width:700px){.tpl-spotlight .card{grid-template-columns:1fr}}'
      // paywall: selectable rows and one button
      + '.tpl-paywall{max-width:var(--hb-pricing-max-width,440px)}'
      + '.tpl-paywall .head{text-align:left}'
      + '.tpl-paywall .logo{margin:0 0 14px}'
      + '.tpl-paywall .features{margin:0 0 calc(var(--_gap) * 1.25);font-size:1em}'
      + '.options{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;border:0}'
      + '.option{position:relative;display:flex;align-items:center;gap:12px;min-height:56px;padding:12px 14px;border-radius:calc(var(--_r) * .75);background:var(--_card);box-shadow:inset 0 0 0 1px var(--_border);cursor:pointer;transition:box-shadow .15s,background .15s}'
      + '.option:has(input:checked){box-shadow:inset 0 0 0 2px var(--_accent);background:color-mix(in srgb,var(--_accent) 6%,var(--_card))}'
      + '.option input{position:absolute;opacity:0;pointer-events:none}'
      + '.dot{flex:none;width:20px;height:20px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--_border)}'
      + '.option input:checked + .dot{box-shadow:inset 0 0 0 6px var(--_accent)}'
      + '.opt-text{flex:1;min-width:0}'
      + '.opt-name{display:block;font-weight:650}'
      + '.opt-sub{display:block;color:var(--_muted);font-size:.86em}'
      + '.opt-price{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}'
      + '.opt-price small{display:block;color:var(--_muted);font-weight:400;font-size:.8em}'
      + '.option .savings{position:absolute;top:0;right:14px;transform:translateY(-50%);background:var(--_accent);color:var(--_on)}'
      + '.tpl-paywall .button{min-height:52px;margin-top:calc(var(--_gap) * 1.25);font-size:1.05em}'
      + '.tpl-paywall .footnote{margin-top:12px}'
      // matrix: a comparison table
      // Positioned, so the screen-reader text in cells scrolled out of view stays inside it rather than widening the page.
      + '.scroll{position:relative;overflow-x:auto;border-radius:var(--_r);background:var(--_card);box-shadow:0 0 0 1px var(--_border)}'
      // Spelled out: a page in quirks mode does not pass colour and font on into tables.
      + 'table{width:100%;border-collapse:collapse;color:inherit;font:inherit;font-size:.93em}'
      + 'caption{text-align:left}'
      + 'th,td{padding:12px 14px;border-bottom:1px solid var(--_border);text-align:center;vertical-align:middle}'
      + 'thead th{vertical-align:bottom;padding-top:var(--_pad);font-weight:400}'
      + 'th[scope=row]{text-align:left;font-weight:500;position:sticky;left:0;background:var(--_card);z-index:1}'
      + 'thead th:first-child{position:sticky;left:0;background:var(--_card);z-index:1}'
      + 'tr.group th{padding-top:20px;text-align:left;font-size:.8em;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--_muted)}'
      + 'tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}'
      + 'thead th.hl{background:color-mix(in srgb,var(--_accent) 8%,var(--_card))}'
      + 'td.hl{background:color-mix(in srgb,var(--_accent) 4%,transparent)}'
      + 'thead .badge{margin:0 auto 8px;display:inline-block}'
      + 'thead .name{font-size:1.05em}'
      + 'thead .price{justify-content:center;margin:8px 0 0}'
      + 'thead .amount{font-size:1.6em}'
      + 'thead .button{margin-top:12px;min-height:38px;font-size:.93em}'
      + 'td .check{display:inline-block;margin:0}'
      + 'td .dash{color:var(--_muted)}'
      + '@media (prefers-reduced-motion:reduce){*{transition:none!important}}'
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

  /** The panel's preview: `edit(key, value)` is called when a word is edited in place; `key` is the table's text key. */
  function editable(node, key, state) {
    var cb = state.o.edit
    if (!cb || !key) return node
    var before = ''
    node.setAttribute('contenteditable', 'plaintext-only')
    node.setAttribute('spellcheck', 'false')
    node.setAttribute('data-edit', '')
    node.addEventListener('focus', function () { before = node.textContent })
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); node.blur() } else if (e.key === 'Escape') { node.textContent = before; node.blur() }
    })
    node.addEventListener('blur', function () {
      var value = node.textContent.replace(/\s+/g, ' ').trim()
      if (value !== before.trim()) cb(key, value)
    })
    return node
  }

  var CHECK = '<path d="M5 10.5l3.2 3.2L15 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
  var CROSS = '<path d="M6.5 6.5l7 7M13.5 6.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  function icon(on) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 20 20')
    svg.setAttribute('class', 'check')
    svg.setAttribute('aria-hidden', 'true')
    svg.innerHTML = on ? CHECK : CROSS
    return svg
  }

  /** The words: your labels win, then the table's own, then the language's. */
  function wordsFor(table, o) {
    var base = String(table.locale || '').toLowerCase().split('-')[0]
    var w = Object.assign({}, WORDS[base] || WORDS.en)
    var given = Object.assign({}, defaults.labels, o.labels || {})
    var c = table.content || {}
    if (c.weeklyLabel) w.weekly = c.weeklyLabel
    if (c.monthlyLabel) w.monthly = c.monthlyLabel
    if (c.yearlyLabel) w.yearly = c.yearlyLabel
    if (c.savingsLabel) w.save = c.savingsLabel
    for (var k in given) if (given[k]) w[k] = given[k]
    return w
  }

  function parts(o) {
    var show = pick(o, 'show')
    if (!show) return { title: 1, subtitle: 1, toggle: 1, currency: 1, features: 1, footnote: 1, logo: 1 }
    var out = {}
    String(show).split(',').forEach(function (p) { out[p.trim()] = 1 })
    return out
  }

  function money(amount, currency, locale) {
    try {
      return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency: String(currency).toUpperCase(), minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(amount)
    } catch (e) {
      return amount + ' ' + String(currency).toUpperCase()
    }
  }

  /** The price a plan shows for `interval`: that slot, else its one-time price, else whichever it has. */
  function priceFor(plan, interval) {
    var p = plan.prices || {}
    return p[interval] || p.once || p.month || p.year || p.week || null
  }

  /** What a price says: the big number, what follows it, and the line under it. */
  function describe(plan, price, table, w) {
    var locale = table.locale
    if (!price) return { amount: plan.customPrice || w.custom, period: '', sub: '', spoken: plan.customPrice || w.custom }
    if (price.amount === 0) return { amount: w.free, period: '', sub: '', spoken: w.free }
    var monthlyView = price.interval === 'year' && (table.options || {}).yearlyAs === 'monthly' && price.monthly !== null
    var count = price.intervalCount || 1
    var every = { week: w.everyWeeks, month: w.everyMonths, year: w.everyYears }
    var per = { week: w.perWeek, month: w.perMonth, year: w.perYear }
    var period = price.interval === 'once' ? '' : count > 1 ? ' ' + fill(every[price.interval] || w.everyMonths, { n: count }) : monthlyView ? w.perMonth : per[price.interval] || ''
    var sub = price.interval === 'once' ? w.once
      : price.interval === 'year' && count === 1 ? (monthlyView ? fill(w.billedYearly, { total: money(price.amount, price.currency, locale) }) : price.monthly ? fill(w.monthlyEq, { monthly: money(price.monthly, price.currency, locale) }) : '')
        : ''
    var amount = money(monthlyView ? price.monthly : price.amount, price.currency, locale)
    return { amount: amount, period: period, sub: sub, spoken: amount + ' ' + period + (sub ? ', ' + sub : '') }
  }

  /** The default button words: a trial, a price, or neither. */
  function buttonWords(plan, price, o, w) {
    if (pick(o, 'current') && pick(o, 'current') === plan.key) return w.current
    if (plan.action && plan.action.label) return plan.action.label
    if (!price) return w.contact
    return price.trialDays > 0 ? fill(w.trial, { days: price.trialDays }) : w.choose
  }

  /** The link with the buyer's details: HelpBites' checkout takes them all, a Stripe Payment Link the email and id. */
  function withDetails(href, table, o) {
    if (!href) return href
    try {
      var url = new URL(href)
      var checkout = url.pathname.indexOf('/v1/pricing/') === 0
      var payment = /(^|\.)buy\.stripe\.com$/.test(url.hostname)
      if (!checkout && !payment) return href
      if (pick(o, 'email')) url.searchParams.set('prefilled_email', pick(o, 'email'))
      if (pick(o, 'ref')) url.searchParams.set('client_reference_id', pick(o, 'ref'))
      // With no id of your own, a Payment Link bought during an A/B test says which test and table it came from.
      else if (payment && table.experiment) url.searchParams.set('client_reference_id', 'hbx__' + table.experiment.table + '__' + table.key + '__' + table.experiment.run)
      if (checkout) {
        url.searchParams.set('visitor', visitor())
        url.searchParams.set('return_url', pick(o, 'returnUrl') || location.href.split('#')[0])
        if (table.locale) url.searchParams.set('locale', table.locale)
        if (pick(o, 'currency')) url.searchParams.set('currency', pick(o, 'currency'))
      }
      return url.toString()
    } catch (e) {
      return href
    }
  }

  /** The plan's button: a link to where it goes, or a button for onSelect. Null when the plan has none. */
  function button(plan, price, state, primary) {
    var table = state.table, o = state.o, w = state.w
    if (plan.action && plan.action.type === 'none') return null
    var current = pick(o, 'current') && pick(o, 'current') === plan.key
    var href = current ? null : (price && price.href) || (plan.action && plan.action.href) || null
    var b = el(href && !o.preview ? 'a' : 'button', 'button ' + (primary ? 'primary' : 'secondary'), 'button')
    var label = buttonWords(plan, price, o, w)
    // Inside a button a space would press it, so the editable words sit in a span.
    if (o.edit) b.appendChild(editable(text('span', '', '', label), 'plans/' + plan.id + '/action', state))
    else b.textContent = label
    if (b.tagName === 'A') { b.href = withDetails(href, table, o); b.rel = 'nofollow' } else b.type = 'button'
    if (current) b.setAttribute('aria-disabled', 'true')
    if (state.ids[plan.id]) b.setAttribute('aria-describedby', state.ids[plan.id])
    b.addEventListener('click', function (e) {
      if (current || o.preview) { e.preventDefault(); return }
      var interval = price ? price.interval : state.interval
      emit('select', table, { plan: plan.key, interval: interval })
      track('click', state, { plan: plan.key, interval: interval })
      var cb = o.onSelect || defaults.onSelect
      var go = true
      if (cb) try { go = cb(plan, interval, price) !== false } catch (x) {}
      if (!go) { e.preventDefault(); return }
      // A button without a link has nothing more to do: onSelect was the point.
    })
    return b
  }

  function priceBlock(plan, price, state) {
    var d = describe(plan, price, state.table, state.w)
    var wrap = el('div', 'price-wrap')
    var row = el('div', 'price', 'price')
    var id = 'hbp-' + (++uid)
    row.id = id
    var spoken = text('span', 'sr', '', d.spoken)
    var amount = text('span', 'amount', 'amount', d.amount)
    amount.setAttribute('aria-hidden', 'true')
    row.appendChild(spoken)
    var month = plan.prices && plan.prices.month
    // The monthly price for a year, struck through beside the yearly one.
    if ((state.table.options || {}).compare && price && price.interval === 'year' && month && month.currency === price.currency && month.amount > 0) {
      var was = (state.table.options || {}).yearlyAs === 'monthly' ? month.amount : month.amount * 12
      var s = el('s', 'compare', 'compare')
      s.setAttribute('aria-label', state.w.original + ': ' + money(was, price.currency, state.table.locale))
      s.textContent = money(was, price.currency, state.table.locale)
      row.appendChild(s)
    }
    row.appendChild(amount)
    if (d.period) { var per = text('span', 'period', 'period', d.period); per.setAttribute('aria-hidden', 'true'); row.appendChild(per) }
    wrap.appendChild(row)
    var note = plan.priceNote || (plan.unitLabel ? fill(state.w.perUnit, { unit: plan.unitLabel }) : '')
    var lines = [d.sub, note].filter(Boolean).join(' \u00b7 ')
    if (lines) wrap.appendChild(text('p', 'note', 'note', lines))
    if (price && price.trialDays > 0 && price.interval !== 'once') wrap.appendChild(text('p', 'trial', 'trial', fill(state.w.trialNote, { days: price.trialDays })))
    return { node: wrap, id: id }
  }

  function featureList(plan, state) {
    var frag = document.createDocumentFragment()
    if (!state.show.features || !(plan.lines || []).length) return frag
    if (plan.includes) frag.appendChild(text('p', 'includes', 'includes', fill(state.w.everything, { plan: plan.includes })))
    var ul = el('ul', 'features', 'features')
    ;(plan.lines || []).forEach(function (line) {
      var li = el('li', 'feature' + (line.included ? '' : ' off'), 'feature')
      li.appendChild(icon(line.included))
      li.appendChild(text('span', 'sr', '', line.included ? state.w.included + ': ' : state.w.notIncluded + ': '))
      var t = text('span', 'text', '', line.text)
      // A hint's button sits inside the words, so those are edited in the panel.
      if (!line.hint) editable(t, 'features/' + line.id + '/text', state)
      if (line.hint) t.appendChild(hint(line))
      li.appendChild(t)
      if (line.value) li.appendChild(text('span', 'value', 'value', line.value))
      ul.appendChild(li)
    })
    frag.appendChild(ul)
    return frag
  }

  function hint(line) {
    var b = el('button', 'hint', 'hint')
    b.type = 'button'
    b.textContent = 'i'
    b.setAttribute('aria-label', line.text)
    var tip = text('span', 'tip', '', line.hint)
    tip.id = 'hbp-tip-' + (++uid)
    tip.setAttribute('role', 'tooltip')
    b.setAttribute('aria-describedby', tip.id)
    b.appendChild(tip)
    b.addEventListener('keydown', function (e) { if (e.key === 'Escape') b.blur() })
    return b
  }

  function head(state) {
    var table = state.table, show = state.show, c = table.content || {}
    var box = el('div', 'head', 'head')
    if (show.logo && state.template === 'paywall' && table.project && /^https?:\/\//.test(table.project.logoUrl || '')) { var logo = el('img', 'logo', 'logo'); logo.src = table.project.logoUrl; logo.alt = ''; box.appendChild(logo) }
    if (show.title && c.title) box.appendChild(editable(text('h2', 'title', 'title', c.title), 'content/title', state))
    if (show.subtitle && c.subtitle) box.appendChild(editable(text('p', 'subtitle', 'subtitle', c.subtitle), 'content/subtitle', state))
    return box.childNodes.length ? box : null
  }

  function toggle(state, redraw) {
    var table = state.table, w = state.w
    var has = function (slot) { return (table.intervals || []).indexOf(slot) >= 0 }
    // Every slot a subscription bills in that some plan has; one alone needs no toggle.
    var choices = ['week', 'month', 'year'].filter(has)
    if (!state.show.toggle || choices.length < 2) return null
    var wrap = el('div', 'toggle')
    var seg = el('div', 'seg', 'toggle')
    seg.setAttribute('role', 'radiogroup')
    seg.setAttribute('aria-label', w.billing)
    var label = { week: w.weekly, month: w.monthly, year: w.yearly }
    var buttons = choices.map(function (slot) {
      var b = el('button', '', 'toggle-option')
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(state.interval === slot))
      b.tabIndex = state.interval === slot ? 0 : -1
      b.appendChild(document.createTextNode(label[slot]))
      if (slot === 'year' && table.savings > 0) b.appendChild(text('span', 'savings', 'savings', fill(w.save, { percent: table.savings })))
      b.addEventListener('click', function () { choose(slot) })
      b.addEventListener('keydown', function (e) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return
        e.preventDefault()
        var at = choices.indexOf(state.interval)
        var step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
        choose(choices[(at + step + choices.length) % choices.length], true)
      })
      seg.appendChild(b)
      return b
    })
    function choose(slot, focus) {
      if (state.interval === slot) return
      state.interval = slot
      redraw(focus ? slot : null)
      if (!state.o.preview) { emit('interval', table, { interval: slot }); var cb = state.o.onInterval; if (cb) try { cb(slot) } catch (x) {} }
    }
    state.focusToggle = function (slot) { var b = buttons[choices.indexOf(slot)]; if (b) b.focus() }
    wrap.appendChild(seg)
    return wrap
  }

  // ---- templates ----

  function cards(state) {
    var list = el('div', 'plans', 'plans')
    list.setAttribute('role', 'list')
    state.table.plans.forEach(function (plan) {
      var price = priceFor(plan, state.interval)
      var card = el('div', 'card' + (plan.highlighted ? ' hl' : ''), plan.highlighted ? 'plan plan-highlighted' : 'plan')
      card.setAttribute('role', 'listitem')
      var who = el('div', 'who')
      var name = editable(text('h3', 'name', 'name', plan.name), 'plans/' + plan.id + '/name', state)
      name.id = 'hbp-' + (++uid)
      // A row's badge sits by its name; a card's on its top edge.
      if (plan.badge) (state.template === 'rows' ? name : card).appendChild(editable(text('span', 'badge', 'badge', plan.badge), 'plans/' + plan.id + '/badge', state))
      who.appendChild(name)
      if (plan.description) who.appendChild(editable(text('p', 'description', 'description', plan.description), 'plans/' + plan.id + '/description', state))
      var p = priceBlock(plan, price, state)
      state.ids[plan.id] = name.id + ' ' + p.id
      if (state.template === 'spotlight') {
        var left = el('div', 'left')
        left.appendChild(who)
        left.appendChild(featureList(plan, state))
        var box = el('div', 'box')
        box.appendChild(p.node)
        var b1 = button(plan, price, state, true)
        if (b1) box.appendChild(b1)
        card.appendChild(left)
        card.appendChild(box)
      } else {
        card.appendChild(who)
        card.appendChild(p.node)
        var b2 = button(plan, price, state, plan.highlighted || state.table.plans.length === 1)
        if (b2) card.appendChild(b2)
        if (state.template !== 'rows') card.appendChild(featureList(plan, state))
      }
      list.appendChild(card)
    })
    return list
  }

  function paywall(state) {
    var table = state.table, w = state.w
    var frag = document.createDocumentFragment()
    // One choice per price: Pro yearly, Pro monthly, Lifetime\u2026
    var choices = []
    table.plans.forEach(function (plan) {
      ;['year', 'month', 'week', 'once'].forEach(function (slot) { if (plan.prices && plan.prices[slot]) choices.push({ plan: plan, price: plan.prices[slot] }) })
      if (!plan.prices || (!plan.prices.week && !plan.prices.month && !plan.prices.year && !plan.prices.once)) choices.push({ plan: plan, price: null })
    })
    if (!choices.length) return frag
    if (state.choice === undefined || !choices[state.choice]) {
      var start = choices.findIndex(function (c) { return c.plan.highlighted && c.price && c.price.interval === state.interval })
      if (start < 0) start = choices.findIndex(function (c) { return c.price && c.price.interval === state.interval })
      state.choice = start < 0 ? 0 : start
    }
    var picked = choices[state.choice]
    frag.appendChild(featureList(picked.plan, state))
    var group = el('div', 'options')
    group.setAttribute('role', 'radiogroup')
    group.setAttribute('aria-label', w.plans)
    var name = 'hbp-choice-' + (++uid)
    var many = table.plans.length > 1
    choices.forEach(function (c, i) {
      var label = el('label', 'option', 'option')
      var input = el('input')
      input.type = 'radio'
      input.name = name
      input.checked = i === state.choice
      input.addEventListener('change', function () { state.choice = i; state.redraw(null, true) })
      label.appendChild(input)
      label.appendChild(el('span', 'dot'))
      var d = describe(c.plan, c.price, table, w)
      var slotName = !c.price ? c.plan.name : { year: w.yearly, month: w.monthly, week: w.weekly }[c.price.interval] || w.once
      var t = el('span', 'opt-text')
      t.appendChild(text('span', 'opt-name', '', many && c.price ? c.plan.name + ' \u00b7 ' + slotName : slotName))
      if (c.plan.badge && c.price && c.price.interval === 'year') t.appendChild(text('span', 'opt-sub', '', c.plan.badge))
      else if (c.price && c.price.trialDays > 0) t.appendChild(text('span', 'opt-sub', '', fill(w.trialNote, { days: c.price.trialDays })))
      label.appendChild(t)
      var pr = text('span', 'opt-price', '', d.amount + d.period)
      if (d.sub) pr.appendChild(text('small', '', '', d.sub))
      label.appendChild(pr)
      if (c.price && c.price.interval === 'year' && c.plan.savings > 0) label.appendChild(text('span', 'savings', 'savings', fill(w.save, { percent: c.plan.savings })))
      group.appendChild(label)
    })
    frag.appendChild(group)
    state.ids[picked.plan.id] = ''
    var b = button(picked.plan, picked.price, state, true)
    if (b) frag.appendChild(b)
    return frag
  }

  function matrix(state) {
    var table = state.table, w = state.w
    var scroll = el('div', 'scroll')
    var t = el('table', '', 'table')
    // Wide enough to read; narrower screens scroll it sideways, the feature names staying put.
    t.style.minWidth = (180 + table.plans.length * 170) + 'px'
    var caption = text('caption', 'sr', '', (table.content && table.content.title) || table.name || w.plans)
    t.appendChild(caption)
    var thead = el('thead')
    var hr = el('tr')
    hr.appendChild(text('th', '', '', w.features))
    hr.firstChild.setAttribute('scope', 'col')
    table.plans.forEach(function (plan) {
      var price = priceFor(plan, state.interval)
      var th = el('th', plan.highlighted ? 'hl' : '')
      th.setAttribute('scope', 'col')
      if (plan.badge) th.appendChild(editable(text('span', 'badge', 'badge', plan.badge), 'plans/' + plan.id + '/badge', state))
      var name = editable(text('div', 'name', 'name', plan.name), 'plans/' + plan.id + '/name', state)
      name.id = 'hbp-' + (++uid)
      th.appendChild(name)
      var p = priceBlock(plan, price, state)
      th.appendChild(p.node)
      state.ids[plan.id] = name.id + ' ' + p.id
      var b = button(plan, price, state, plan.highlighted)
      if (b) th.appendChild(b)
      hr.appendChild(th)
    })
    thead.appendChild(hr)
    t.appendChild(thead)
    var tbody = el('tbody')
    ;(table.features || []).forEach(function (f) {
      var tr = el('tr', f.kind === 'heading' ? 'group' : '')
      if (f.kind === 'heading') {
        var g = text('th', '', '', f.text)
        g.setAttribute('scope', 'colgroup')
        g.colSpan = table.plans.length + 1
        tr.appendChild(g)
      } else {
        var th = text('th', '', '', f.text)
        if (!f.hint) editable(th, 'features/' + f.id + '/text', state)
        th.setAttribute('scope', 'row')
        if (f.hint) th.appendChild(hint(f))
        tr.appendChild(th)
        table.plans.forEach(function (plan) {
          var cell = plan.cells ? plan.cells[f.id] : false
          var td = el('td', plan.highlighted ? 'hl' : '')
          if (typeof cell === 'string' && cell) td.textContent = cell
          else if (cell === true) { td.appendChild(icon(true)); td.appendChild(text('span', 'sr', '', w.included)) } else { td.appendChild(text('span', 'dash', '', '\u2014')); td.lastChild.setAttribute('aria-hidden', 'true'); td.appendChild(text('span', 'sr', '', w.notIncluded)) }
          tr.appendChild(td)
        })
      }
      tbody.appendChild(tr)
    })
    t.appendChild(tbody)
    scroll.appendChild(t)
    return scroll
  }

  /** Draws `table` into `host`'s shadow root. */
  function draw(host, table, o, keep) {
    var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' })
    var state = keep || {}
    var template = pick(o, 'template') || table.template || 'tiers'
    // Somewhere narrow (an onboarding card) the wide layouts become rows.
    if (o.compact && template !== 'paywall' && template !== 'rows') template = 'rows'
    var start = pick(o, 'interval') || (table.options || {}).defaultInterval || 'year'
    var has = table.intervals || []
    if (!state.interval) state.interval = has.indexOf(start) >= 0 ? start : ['year', 'month', 'week', 'once'].filter(function (slot) { return has.indexOf(slot) >= 0 })[0] || 'once'
    state.table = table
    state.o = o
    state.w = wordsFor(table, o)
    state.show = parts(o)
    state.template = template
    state.ids = {}
    state.redraw = function (focusSlot, focusChoice) {
      draw(host, state.table, o, state)
      if (focusSlot && state.focusToggle) state.focusToggle(focusSlot)
      if (focusChoice) { var checked = shadow.querySelector('input:checked'); if (checked) checked.focus() }
      if (state.live) state.live.textContent = { week: state.w.weekly, month: state.w.monthly, year: state.w.yearly }[state.interval] || ''
    }
    shadow.innerHTML = ''
    var styleEl = el('style')
    styleEl.textContent = css(table, o, host) + (o.edit ? '[data-edit]{cursor:text;border-radius:4px;transition:box-shadow .12s}[data-edit]:hover{box-shadow:0 0 0 2px color-mix(in srgb,var(--_accent,currentColor) 45%,transparent)}[data-edit]:focus{outline:none;box-shadow:0 0 0 2px var(--_accent,currentColor)}' : '')
    shadow.appendChild(styleEl)
    var root = el('div', 'root tpl-' + template, 'root')
    root.setAttribute('role', 'region')
    root.setAttribute('aria-label', (table.content && table.content.title) || table.name || state.w.plans)
    if (table.locale) root.setAttribute('lang', table.locale)
    if (RTL[String(table.locale || '').split('-')[0]]) root.setAttribute('dir', 'rtl')
    var h = head(state)
    if (h) root.appendChild(h)
    if (template !== 'paywall') {
      var tg = toggle(state, state.redraw)
      if (tg) root.appendChild(tg)
    }
    var money2 = currencySwitch(state)
    if (money2) root.appendChild(money2)
    root.appendChild(template === 'paywall' ? paywall(state) : template === 'matrix' ? matrix(state) : cards(state))
    var c = table.content || {}
    if (state.show.footnote && c.footnote) root.appendChild(editable(text('p', 'footnote', 'footnote', c.footnote), 'content/footnote', state))
    if (c.termsUrl || c.privacyUrl) {
      var links = el('p', 'links', 'links')
      ;[[c.termsUrl, state.w.terms], [c.privacyUrl, state.w.privacy]].forEach(function (l) {
        if (!l[0]) return
        var a = text('a', '', '', l[1])
        a.href = l[0]
        a.target = '_blank'
        a.rel = 'noopener'
        links.appendChild(a)
      })
      root.appendChild(links)
    }
    var live = el('p', 'sr')
    live.setAttribute('aria-live', 'polite')
    root.appendChild(live)
    state.live = live
    shadow.appendChild(root)
    return state
  }

  /** A choice of currency, when every price can be shown in more than one and the table was fetched (so it can be fetched again in another). */
  function currencySwitch(state) {
    var table = state.table
    if (!state.show.currency || !state.refetch || !(table.currencies || []).length) return null
    var wrap = el('div', 'currency')
    var label = el('label', '', 'currency')
    var name = text('span', 'sr', '', state.w.currency)
    var select = el('select', '', 'currency-select')
    table.currencies.forEach(function (code) {
      var option = el('option')
      option.value = code
      var named = code.toUpperCase()
      try { named = new Intl.DisplayNames([table.locale || 'en'], { type: 'currency' }).of(code.toUpperCase()) + ' (' + code.toUpperCase() + ')' } catch (e) {}
      option.textContent = named
      option.selected = code === table.currency
      select.appendChild(option)
    })
    select.addEventListener('change', function () { state.refetch(select.value) })
    label.appendChild(name)
    label.appendChild(select)
    wrap.appendChild(label)
    return wrap
  }

  // Euro countries first, then the rest: the currency a visitor from there most likely pays in.
  var EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ')
  var REGION_CURRENCY = { US: 'usd', GB: 'gbp', CA: 'cad', AU: 'aud', NZ: 'nzd', JP: 'jpy', IN: 'inr', BR: 'brl', MX: 'mxn', CH: 'chf', SE: 'sek', NO: 'nok', DK: 'dkk', PL: 'pln', CZ: 'czk', HU: 'huf', RO: 'ron', KR: 'krw', CN: 'cny', HK: 'hkd', TW: 'twd', SG: 'sgd', ZA: 'zar', TR: 'try', IL: 'ils', AE: 'aed', SA: 'sar', AR: 'ars', CL: 'clp', CO: 'cop' }
  /** data-currency="auto": the visitor's own, from the region of their language (de-AT is euros, en-GB pounds). */
  function regionCurrency() {
    var tag = (navigator.languages && navigator.languages[0]) || navigator.language || ''
    var region = (tag.split('-')[1] || '').toUpperCase()
    try { if (!region && window.Intl && Intl.Locale) region = new Intl.Locale(tag).maximize().region || '' } catch (e) {}
    return EURO.indexOf(region) >= 0 ? 'eur' : REGION_CURRENCY[region] || ''
  }

  /** An id this browser keeps, so an A/B test shows the same table each visit and visitors are counted once. */
  function visitor() {
    try {
      var id = localStorage.getItem('hb-visitor')
      if (!id) { id = 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('hb-visitor', id) }
      return id
    } catch (e) {
      return ''
    }
  }

  /** A view or a click for the table's numbers (and its A/B test): sent and forgotten, never in the way. */
  function track(type, state, extra) {
    var o = state.o, table = state.table
    if (o.preview || !o.project || !table.key) return
    var body = JSON.stringify(Object.assign({ type: type, visitor: visitor(), experiment: table.experiment ? table.experiment.table : undefined, run: table.experiment ? table.experiment.run : undefined }, extra || {}))
    var url = (o.host || origin).replace(/\/+$/, '') + '/v1/pricing/' + encodeURIComponent(o.project) + '/' + encodeURIComponent(table.key) + '/events'
    try {
      // text/plain, so a beacon needs no preflight from your site.
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return
      fetch(url, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, credentials: 'omit' }).catch(function () {})
    } catch (e) {}
  }

  function hostFor(o) {
    var target = o.target ? (typeof o.target === 'string' ? document.querySelector(o.target) : o.target) : null
    if (o.target && !target) { console.warn('[help-bites] no element matches the pricing target ' + o.target); return null }
    var host = el('div', 'help-bites-pricing')
    if (target) { target.innerHTML = ''; target.appendChild(host) } else if (o.anchor && o.anchor.parentNode) o.anchor.parentNode.insertBefore(host, o.anchor.nextSibling)
    else document.body.appendChild(host)
    return host
  }

  /** The language to ask for: yours, else the page's <html lang>, else the browser's. */
  function wanted(o) { return pick(o, 'locale') || document.documentElement.lang || (navigator.languages && navigator.languages[0]) || navigator.language || '' }

  function render(o) {
    if (!o.project) return console.warn('[help-bites] pricing.js needs data-project="pk_\u2026"')
    o.host = (o.host || origin).replace(/\/+$/, '')
    var host = hostFor(o)
    if (!host) return
    var controller = window.AbortController ? new AbortController() : null
    var timer = setTimeout(function () { if (controller) controller.abort() }, TIMEOUT_MS)
    if (pick(o, 'currency') === 'auto') o.currency = regionCurrency()
    var mount = null
    function load(currency, done) {
      var query = []
      if (wanted(o)) query.push('locale=' + encodeURIComponent(wanted(o)))
      if (currency) query.push('currency=' + encodeURIComponent(currency))
      if (visitor()) query.push('visitor=' + encodeURIComponent(visitor()))
      var url = o.host + '/v1/pricing/' + encodeURIComponent(o.project) + (o.table ? '/' + encodeURIComponent(o.table) : '') + (query.length ? '?' + query.join('&') : '')
      var controller = window.AbortController ? new AbortController() : null
      var timer = setTimeout(function () { if (controller) controller.abort() }, TIMEOUT_MS)
      fetch(url, { credentials: 'omit', signal: controller && controller.signal })
        .then(function (r) { if (r.status === 404) console.warn('[help-bites] no published pricing table ' + (o.table || '') + ' for ' + o.project); return r.ok ? r.json() : null })
        .then(function (body) { clearTimeout(timer); done(body && body.table) })
        .catch(function () { clearTimeout(timer); done(null) })
    }
    // Another currency: the same table fetched again, keeping the interval and paywall choice.
    function refetch(currency) {
      o.currency = currency
      load(currency, function (table) {
        if (!table || !mount) return
        mount.table = table
        mount.state.table = table
        mount.state = draw(host, table, o, mount.state)
      })
    }
    load(pick(o, 'currency'), function (table) {
      if (!table) { host.remove(); return }
      mount = { host: host, table: table, options: o }
      mount.state = draw(host, table, o, { refetch: refetch })
      mounts.push(mount)
      emit('show', table)
      track('view', mount.state)
      var cb = o.onReady || defaults.onReady
      if (cb) try { cb(table) } catch (x) {}
    })
  }

  function into(opts) {
    var target = opts && (typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target)
    if (!target || !opts.table) return null
    var host = target.querySelector('.help-bites-pricing')
    if (!host) { host = el('div', 'help-bites-pricing'); target.innerHTML = ''; target.appendChild(host) }
    return host
  }

  var commands = {
    // Defaults for every table on the page; tables already drawn are drawn again with them.
    init: function (opts) {
      for (var k in (opts || {})) if (opts[k] !== undefined) defaults[k] = opts[k]
      mounts.forEach(function (m) { m.state = draw(m.host, m.table, m.options, m.state) })
    },
    render: function (opts) { render(Object.assign({}, own, { anchor: null }, opts || {})) },
    // Draws a table you pass in (the JSON of GET /v1/pricing/{pk}/{key}) without fetching it: buttons work as usual.
    draw: function (opts) {
      var host = into(opts)
      if (!host) return
      var o = Object.assign({}, own, { anchor: null, preview: false }, opts)
      var mount = { host: host, table: opts.table, options: o }
      mount.state = draw(host, opts.table, o)
      mounts.push(mount)
      // With the project's public key (onboarding passes it), views and clicks count too.
      track('view', mount.state)
    },
    // The same, with buttons that go nowhere (the panel's preview).
    preview: function (opts) {
      var host = into(opts)
      if (!host) return
      // The interval and paywall choice picked in it survive the next redraw, as you type.
      host.__hbPricing = draw(host, opts.table, { preview: true, theme: opts.theme, template: opts.template, interval: opts.interval, compact: opts.compact, show: opts.show, labels: {}, edit: opts.edit }, host.__hbPricing && { interval: host.__hbPricing.interval, choice: host.__hbPricing.choice })
    }
  }

  function run(command) {
    if (!command || !commands[command[0]]) return
    commands[command[0]].apply(null, [].slice.call(command, 1))
  }

  var queue = window.HelpBitesPricing || []
  window.HelpBitesPricing = { push: run, __helpBites: true }
  for (var i = 0; i < queue.length; i++) run(queue[i])
  if (own.project) render(own)
})()
