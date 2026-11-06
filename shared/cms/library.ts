import { clone, fieldLabel, reuid, type CmsBlock, type CmsComponentDef, type CmsField, type CmsFieldType, type CmsLibrary, type CmsStyle } from './content'

// The components every project starts with, the page templates made of them,
// and the questions the AI page wizard asks. Built-ins use the same template
// syntax as a project's own components (shared/cms/render.ts) and the `.hb-*`
// helpers in BASE_CSS; they are read-only, and "Duplicate" makes an editable
// copy under a new key.

const f = (key: string, type: CmsFieldType, extra: Partial<CmsField> = {}): CmsField => ({ key, type, label: fieldLabel(key), ...extra })

type Def = Omit<CmsComponentDef, 'id' | 'builtin' | 'root' | 'nestable' | 'css'> & { root?: boolean, css?: string }
const def = (d: Def): CmsComponentDef => ({ id: `hb_${d.key}`, builtin: true, root: !!d.root, nestable: !d.root, css: '', ...d })

const cta = (prefix: string, label: string): CmsField[] => [f(`${prefix}Label`, 'text', { default: label }), f(`${prefix}Url`, 'url', { default: '#' })]

export const BUILTIN_COMPONENTS: CmsComponentDef[] = [
  def({
    key: 'page', name: 'Page', root: true,
    description: 'A landing page: its title and description (for search and link previews) and the blocks that make it up.',
    fields: [f('title', 'text', { description: 'The browser tab and search result title.' }), f('description', 'textarea', { description: 'One or two sentences for search results and link previews.' }), f('ogImage', 'asset', { label: 'Link preview image', description: '1200 × 630 works everywhere.' }), f('background', 'select', { options: ['plain', 'soft'], default: 'plain', description: 'Soft: a faint blue-to-violet wash behind everything.' }), f('body', 'blocks')],
    html: '<main class="hb-page hb-page--{{@background}}">{{@body}}</main>',
    css: '.hb-page--soft { background: linear-gradient(135deg, color-mix(in srgb, #3b82f6 7%, var(--hb-bg)), var(--hb-bg) 45%, color-mix(in srgb, #8b5cf6 6%, var(--hb-bg))); }'
  }),
  def({
    key: 'nav', name: 'Navigation bar', description: 'The top bar: logo or name, a few links and one button.',
    fields: [f('brand', 'text', { default: 'Acme' }), f('byline', 'text', { description: 'Small text after the name: "by Ada".' }), f('bylineUrl', 'url'), f('logo', 'asset'), f('links', 'blocks', { allow: ['link'] }), ...cta('cta', 'Get started'), f('sticky', 'boolean', { default: true, description: 'Stays at the top while scrolling.' }), f('variant', 'select', { options: ['bar', 'overlay'], default: 'bar', description: 'Overlay: transparent with white text over a dark hero, turning into a frosted bar as the page scrolls.' })],
    example: { links: [{ component: 'link', label: 'Features', url: '#features' }, { component: 'link', label: 'Pricing', url: '#pricing' }] },
    html: `<header class="hb-nav hb-nav--{{@variant}}{{#sticky}} hb-nav--sticky{{/sticky}}">
  <div class="hb-container hb-nav__in">
    <span class="hb-nav__brand">{{#logo}}<img src="{{@logo}}" alt="{{@brand}}">{{/logo}}{{^logo}}{{@brand}}{{/logo}}{{#byline}}<a class="hb-nav__by" href="{{@bylineUrl}}">{{@byline}}</a>{{/byline}}</span>
    <nav class="hb-nav__links">{{@links}}</nav>
    {{#ctaLabel}}<a class="hb-btn" href="{{@ctaUrl}}">{{@ctaLabel}}</a>{{/ctaLabel}}
  </div>
</header>`,
    css: `.hb-nav { padding: 16px 0; }
.hb-nav--sticky { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--hb-bg) 84%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--hb-line); }
.hb-nav__in { display: flex; align-items: center; gap: 24px; }
.hb-nav__brand { display: flex; align-items: center; font-weight: 700; font-size: 1.1rem; }
.hb-nav__brand img { height: 28px; width: auto; }
.hb-nav__links { display: flex; gap: 22px; margin-left: auto; }
.hb-nav__links a { color: var(--hb-muted); text-decoration: none; font-size: .95rem; }
.hb-nav__links a:hover { color: var(--hb-text); }
.hb-nav .hb-btn { min-height: 38px; padding: 0 16px; font-size: 14px; }
.hb-nav__by { margin-left: 8px; font-size: .85rem; font-weight: 500; color: var(--hb-muted); text-decoration: none; }
.hb-nav--overlay { position: absolute; inset: 0 0 auto; z-index: 30; color: #fff; padding: 14px 0; background: transparent; border-bottom: 0; -webkit-backdrop-filter: none; backdrop-filter: none; }
.hb-nav--overlay .hb-nav__links a, .hb-nav--overlay .hb-nav__by { color: rgb(255 255 255 / .8); }
.hb-nav--overlay .hb-nav__links a:hover { color: #fff; }
.hb-nav--overlay .hb-btn { background: color-mix(in srgb, currentColor 14%, transparent); color: inherit; border-color: color-mix(in srgb, currentColor 25%, transparent); border-radius: 999px; -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
@supports (animation-timeline: scroll()) {
  .hb-nav--overlay.hb-nav--sticky { position: fixed; animation: hb-nav-frost linear both; animation-timeline: scroll(root); animation-range: 40px 120px; }
  @keyframes hb-nav-frost { to { color: var(--hb-text); background: color-mix(in srgb, var(--hb-bg) 80%, transparent); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); box-shadow: 0 4px 20px -8px rgb(0 0 0 / .15); } }
  .hb-nav--overlay.hb-nav--sticky .hb-nav__links a, .hb-nav--overlay.hb-nav--sticky .hb-nav__by { color: inherit; opacity: .75; }
}
@media (max-width: 720px) { .hb-nav__links { display: none; } .hb-nav .hb-btn { margin-left: auto; } }`
  }),
  def({
    key: 'link', name: 'Link', description: 'A text link, for the navigation bar and the footer.',
    fields: [f('label', 'text', { default: 'Link' }), f('url', 'url', { default: '#' })],
    html: '<a class="hb-link" href="{{@url}}">{{@label}}</a>'
  }),
  def({
    key: 'hero', name: 'Hero', description: 'The first thing visitors see: the headline, one or two sentences on the value, and the main buttons. Centred, or split with an image.',
    fields: [f('eyebrow', 'text'), f('headline', 'text', { default: 'The one-line promise of your product', required: true }), f('subhead', 'markdown', { default: 'Who it is for and what it changes for them, in a sentence or two.' }), ...cta('primary', 'Get started'), f('secondaryLabel', 'text'), f('secondaryUrl', 'url'), f('note', 'text', { description: 'Small print under the buttons: "Free while in beta".' }), f('image', 'asset'), f('layout', 'select', { options: ['center', 'split'], default: 'center' })],
    html: `<section class="hb-section hb-hero hb-hero--{{@layout}}">
  <div class="hb-container hb-hero__in">
    <div class="hb-hero__copy">
      {{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}
      <h1>{{@headline}}</h1>
      {{#subhead}}<div class="hb-lead hb-prose">{{@subhead}}</div>{{/subhead}}
      {{#primaryLabel}}<div class="hb-actions"><a class="hb-btn" href="{{@primaryUrl}}">{{@primaryLabel}}</a>{{#secondaryLabel}}<a class="hb-btn hb-btn--ghost" href="{{@secondaryUrl}}">{{@secondaryLabel}}</a>{{/secondaryLabel}}</div>{{/primaryLabel}}
      {{#note}}<p class="hb-hero__note hb-muted">{{@note}}</p>{{/note}}
    </div>
    {{#image}}<div class="hb-hero__media"><img src="{{@image}}" alt="{{@image.alt}}" width="{{@image.width}}" height="{{@image.height}}"></div>{{/image}}
  </div>
</section>`,
    css: `.hb-hero--center .hb-hero__in { text-align: center; }
.hb-hero--center .hb-lead { margin-left: auto; margin-right: auto; }
.hb-hero--center .hb-actions { justify-content: center; }
.hb-hero--center .hb-hero__media { margin-top: 56px; }
.hb-hero--split .hb-hero__in { display: grid; grid-template-columns: 1.05fr 1fr; gap: 56px; align-items: center; }
.hb-hero__media img { width: 100%; border-radius: var(--hb-radius); border: 1px solid var(--hb-line); box-shadow: 0 30px 80px -40px rgb(0 0 0 / .35); }
.hb-hero__note { font-size: .875rem; margin-top: 14px; }
@media (max-width: 860px) { .hb-hero--split .hb-hero__in { grid-template-columns: 1fr; } }`
  }),
  def({
    key: 'logos', name: 'Logo cloud', description: 'Social proof: the names or logos of customers, sponsors or press.',
    fields: [f('title', 'text', { default: 'Used by teams at' }), f('items', 'blocks', { allow: ['logo'] })],
    example: { items: ['Northwind', 'Globex', 'Initech', 'Umbrella'].map(name => ({ component: 'logo', name })) },
    html: `<section class="hb-logos">
  <div class="hb-container">
    {{#title}}<p class="hb-logos__title hb-muted">{{@title}}</p>{{/title}}
    <div class="hb-logos__row">{{@items}}</div>
  </div>
</section>`,
    css: `.hb-logos { padding: 32px 0 48px; }
.hb-logos__title { text-align: center; font-size: .9rem; margin-bottom: 22px; }
.hb-logos__row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 24px 48px; }`
  }),
  def({
    key: 'logo', name: 'Logo', description: 'One logo in a logo cloud; without an image it shows the name.',
    fields: [f('name', 'text', { default: 'Company' }), f('image', 'asset')],
    html: '<span class="hb-logo">{{#image}}<img src="{{@image}}" alt="{{@name}}">{{/image}}{{^image}}{{@name}}{{/image}}</span>',
    css: `.hb-logo { display: flex; align-items: center; color: var(--hb-muted); font-weight: 650; font-size: 1.15rem; letter-spacing: -0.01em; }
.hb-logo img { height: 28px; width: auto; opacity: .75; filter: grayscale(1); transition: opacity .2s, filter .2s; }
.hb-logo:hover img { opacity: 1; filter: none; }`
  }),
  def({
    key: 'features', name: 'Feature grid', description: 'What it does, as a grid of short cards: an icon, a title and a sentence each.',
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'Everything you need' }), f('intro', 'markdown'), f('columns', 'select', { options: ['2', '3', '4'], default: '3' }), f('items', 'blocks', { allow: ['feature'] })],
    example: { items: [1, 2, 3].map(n => ({ component: 'feature', icon: ['⚡', '🔒', '✨'][n - 1], title: `Feature ${n}`, body: 'One sentence on what it does for the reader.' })) },
    html: `<section class="hb-section hb-features" id="features">
  <div class="hb-container">
    <div class="hb-center hb-features__head">{{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}{{#title}}<h2>{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-prose">{{@intro}}</div>{{/intro}}</div>
    <div class="hb-grid" style="--hb-cols: {{@columns}}">{{@items}}</div>
  </div>
</section>`,
    css: '.hb-features__head { margin-bottom: 48px; }'
  }),
  def({
    key: 'feature', name: 'Feature', description: 'One card in a feature grid.',
    fields: [f('icon', 'text', { description: 'An emoji or a short symbol.' }), f('image', 'asset'), f('title', 'text', { default: 'Feature' }), f('body', 'markdown', { default: 'What it does for the reader.' })],
    html: `<div class="hb-card hb-feature">
  {{#image}}<img class="hb-feature__img" src="{{@image}}" alt="{{@image.alt}}">{{/image}}
  {{#icon}}<div class="hb-feature__icon" aria-hidden="true">{{@icon}}</div>{{/icon}}
  <h3>{{@title}}</h3>
  <div class="hb-muted hb-prose">{{@body}}</div>
</div>`,
    css: `.hb-feature__icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--hb-radius-sm); background: color-mix(in srgb, var(--hb-accent) 14%, transparent); color: var(--hb-accent); font-size: 22px; margin-bottom: 18px; }
.hb-feature__img { width: 100%; border-radius: var(--hb-radius-sm); margin-bottom: 18px; }
.hb-feature h3 { margin-bottom: 8px; }`
  }),
  def({
    key: 'split', name: 'Image and text', description: 'One idea told in depth: a title, a paragraph or a list, and an image beside it. Alternate `reverse` down the page.',
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'A benefit, in depth' }), f('body', 'markdown', { default: 'Explain how it works and why it matters.\n\n- A concrete detail\n- Another one' }), f('image', 'asset'), f('reverse', 'boolean', { description: 'Image on the left.' }), f('ctaLabel', 'text'), f('ctaUrl', 'url')],
    html: `<section class="hb-section hb-split{{#reverse}} hb-split--reverse{{/reverse}}">
  <div class="hb-container hb-split__in">
    <div class="hb-split__copy">{{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}<h2>{{@title}}</h2><div class="hb-lead hb-prose">{{@body}}</div>{{#ctaLabel}}<div class="hb-actions"><a class="hb-btn" href="{{@ctaUrl}}">{{@ctaLabel}}</a></div>{{/ctaLabel}}</div>
    {{#image}}<div class="hb-split__media"><img src="{{@image}}" alt="{{@image.alt}}" loading="lazy"></div>{{/image}}
  </div>
</section>`,
    css: `.hb-split__in { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
.hb-split--reverse .hb-split__media { order: -1; }
.hb-split__media img { width: 100%; border-radius: var(--hb-radius); border: 1px solid var(--hb-line); }
.hb-split .hb-prose ul { padding-left: 1.2em; }
@media (max-width: 860px) { .hb-split__in { grid-template-columns: 1fr; gap: 32px; } .hb-split--reverse .hb-split__media { order: 0; } }`
  }),
  def({
    key: 'stats', name: 'Numbers', description: 'A row of big numbers: users, stars, uptime, time saved.',
    fields: [f('title', 'text'), f('items', 'blocks', { allow: ['stat'] })],
    example: { items: [['10k+', 'Developers'], ['99.9%', 'Uptime'], ['4.9★', 'App Store rating']].map(([value, label]) => ({ component: 'stat', value, label })) },
    html: `<section class="hb-section hb-stats">
  <div class="hb-container">{{#title}}<h2 class="hb-center">{{@title}}</h2>{{/title}}<div class="hb-stats__row">{{@items}}</div></div>
</section>`,
    css: '.hb-stats__row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 24px; text-align: center; margin-top: 32px; }'
  }),
  def({
    key: 'stat', name: 'Number', description: 'One number and what it counts.',
    fields: [f('value', 'text', { default: '100%' }), f('label', 'text', { default: 'What it counts' })],
    html: '<div class="hb-stat"><div class="hb-stat__value">{{@value}}</div><div class="hb-muted">{{@label}}</div></div>',
    css: '.hb-stat__value { font: 700 clamp(2rem, 4vw, 3rem)/1.1 var(--hb-heading-font); letter-spacing: -0.03em; color: var(--hb-accent); }'
  }),
  def({
    key: 'testimonials', name: 'Testimonials', description: 'What customers say, as quote cards.',
    fields: [f('title', 'text', { default: 'Loved by makers' }), f('items', 'blocks', { allow: ['quote'] })],
    example: { items: [1, 2, 3].map(() => ({ component: 'quote', text: 'A specific result this person got from the product.', author: 'Name Surname', role: 'Role, Company' })) },
    html: `<section class="hb-section hb-testimonials">
  <div class="hb-container">{{#title}}<h2 class="hb-center hb-testimonials__title">{{@title}}</h2>{{/title}}<div class="hb-grid">{{@items}}</div></div>
</section>`,
    css: '.hb-testimonials__title { margin-bottom: 40px; }'
  }),
  def({
    key: 'quote', name: 'Quote', description: 'One testimonial.',
    fields: [f('text', 'textarea', { default: 'What they said.' }), f('author', 'text', { default: 'Name' }), f('role', 'text'), f('avatar', 'asset')],
    html: '<figure class="hb-card hb-quote"><blockquote>“{{@text}}”</blockquote><figcaption>{{#avatar}}<img src="{{@avatar}}" alt="">{{/avatar}}<span><strong>{{@author}}</strong>{{#role}}<span class="hb-muted">{{@role}}</span>{{/role}}</span></figcaption></figure>',
    css: `.hb-quote { margin: 0; display: flex; flex-direction: column; gap: 20px; }
.hb-quote blockquote { margin: 0; font-size: 1.05rem; }
.hb-quote figcaption { display: flex; align-items: center; gap: 12px; margin-top: auto; }
.hb-quote figcaption img { width: 40px; height: 40px; border-radius: 999px; object-fit: cover; }
.hb-quote figcaption > span { display: flex; flex-direction: column; font-size: .9rem; line-height: 1.4; }`
  }),
  def({
    key: 'pricing', name: 'Pricing', description: 'Plans side by side.',
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'Simple pricing' }), f('intro', 'markdown'), f('items', 'blocks', { allow: ['plan', 'plan_card'] })],
    example: { items: [{ component: 'plan', name: 'Free', price: '$0', period: '/month', features: '- One project\n- Community support', ctaLabel: 'Start free', ctaUrl: '#' }, { component: 'plan', name: 'Pro', price: '$12', period: '/month', features: '- Unlimited projects\n- Priority support', ctaLabel: 'Go Pro', ctaUrl: '#', highlighted: true }] },
    html: `<section class="hb-section hb-pricing" id="pricing">
  <div class="hb-container">
    <div class="hb-center">{{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}{{#title}}<h2>{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-prose">{{@intro}}</div>{{/intro}}</div>
    <div class="hb-pricing__row">{{@items}}</div>
  </div>
</section>`,
    css: '.hb-pricing__row { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; align-items: stretch; margin-top: 48px; }'
  }),
  def({
    key: 'plan', name: 'Plan', description: 'One plan: name, price, what is included (one item per line, as a list) and a button.',
    fields: [f('name', 'text', { default: 'Plan' }), f('price', 'text', { default: '$0' }), f('period', 'text', { default: '/month' }), f('description', 'text'), f('features', 'markdown', { default: '- What is included' }), ...cta('cta', 'Choose'), f('highlighted', 'boolean')],
    html: `<div class="hb-card hb-plan{{#highlighted}} hb-plan--on{{/highlighted}}">
  <h3>{{@name}}</h3>
  <div class="hb-plan__price"><span>{{@price}}</span>{{#period}}<small class="hb-muted">{{@period}}</small>{{/period}}</div>
  {{#description}}<p class="hb-muted">{{@description}}</p>{{/description}}
  <div class="hb-plan__features hb-prose">{{@features}}</div>
  {{#ctaLabel}}<a class="hb-btn{{^highlighted}} hb-btn--ghost{{/highlighted}}" href="{{@ctaUrl}}">{{@ctaLabel}}</a>{{/ctaLabel}}
</div>`,
    css: `.hb-plan { display: flex; flex-direction: column; gap: 12px; }
.hb-plan--on { border-color: var(--hb-accent); box-shadow: 0 0 0 1px var(--hb-accent); }
.hb-plan h3 { margin: 0; }
.hb-plan__price span { font: 700 2.4rem/1 var(--hb-heading-font); letter-spacing: -0.03em; }
.hb-plan__price small { margin-left: 6px; }
.hb-plan__features ul { list-style: none; padding: 0; margin: 8px 0 16px; display: grid; gap: 8px; }
.hb-plan__features li::before { content: "✓"; color: var(--hb-accent); margin-right: 10px; font-weight: 700; }
.hb-plan .hb-btn { margin-top: auto; }`
  }),
  def({
    key: 'faq', name: 'FAQ', description: 'Questions and answers that open on click (no script).',
    fields: [f('title', 'text', { default: 'Questions' }), f('intro', 'markdown'), f('items', 'blocks', { allow: ['qa'] }), f('layout', 'select', { options: ['center', 'split'], default: 'center', description: 'Split: the title on the left, the questions on the right.' }), f('look', 'select', { options: ['lines', 'cards'], default: 'lines' })],
    example: { items: [1, 2, 3].map(n => ({ component: 'qa', question: `Question ${n}?`, answer: 'A short, honest answer.' })) },
    html: `<section class="hb-section hb-faq hb-faq--{{@layout}} hb-faq--{{@look}}" id="faq">
  <div class="hb-container hb-faq__in"><div class="hb-faq__head">{{#title}}<h2>{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-prose">{{@intro}}</div>{{/intro}}</div><div class="hb-faq__list">{{@items}}</div></div>
</section>`,
    css: `.hb-faq--center .hb-faq__in { max-width: 820px; }
.hb-faq--center .hb-faq__head { text-align: center; }
.hb-faq--center .hb-lead { margin-left: auto; margin-right: auto; }
.hb-faq__list { margin-top: 40px; }
.hb-faq--lines .hb-faq__list { border-top: 1px solid var(--hb-line); }
.hb-faq--split .hb-faq__in { display: grid; grid-template-columns: 2fr 3fr; gap: 64px; align-items: start; }
.hb-faq--split .hb-faq__list { margin-top: 0; }
.hb-faq--split h2 { font-size: 1.65rem; letter-spacing: -0.02em; }
.hb-faq--split .hb-lead { font-size: 1rem; max-width: 24rem; }
.hb-faq--cards .hb-faq__list { display: grid; gap: 10px; }
.hb-faq--cards .hb-qa { border: 0; border-radius: 1rem; background: var(--hb-bg); padding: 0 24px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--hb-line) 60%, transparent), 0 1px 2px rgb(0 0 0 / .05); }
.hb-faq--cards .hb-qa summary { padding: 20px 0; }
.hb-faq--cards .hb-qa .hb-prose { padding: 0 0 20px; }
@media (max-width: 960px) { .hb-faq--split .hb-faq__in { grid-template-columns: 1fr; gap: 24px; } }`
  }),
  def({
    key: 'qa', name: 'Question', description: 'One question and its answer.',
    fields: [f('question', 'text', { default: 'A question?' }), f('answer', 'markdown', { default: 'The answer.' })],
    html: '<details class="hb-qa" name="hb-faq-{{$parent}}"><summary>{{@question}}</summary><div class="hb-muted hb-prose">{{@answer}}</div></details>',
    css: `.hb-qa { border-bottom: 1px solid var(--hb-line); padding: 20px 0; }
.hb-qa summary { cursor: pointer; font-weight: 600; font-size: 1.05rem; list-style: none; display: flex; justify-content: space-between; gap: 16px; }
.hb-qa summary::-webkit-details-marker { display: none; }
.hb-qa summary::after { content: "+"; color: var(--hb-muted); font-weight: 400; font-size: 1.4rem; line-height: 1; transition: transform .2s; }
.hb-qa[open] summary::after { transform: rotate(45deg); }
.hb-qa .hb-prose { padding-top: 12px; }`
  }),
  def({
    key: 'cta', name: 'Call to action', description: 'A closing band that asks for the one action that matters.',
    fields: [f('logo', 'asset'), f('title', 'text', { default: 'Ready to start?' }), f('body', 'markdown'), ...cta('primary', 'Get started'), f('primaryIcon', 'icon'), f('secondaryLabel', 'text'), f('secondaryUrl', 'url'), f('tone', 'select', { options: ['accent', 'surface', 'night'], default: 'accent' }), f('items', 'blocks', { label: 'Icon row', allow: ['dock_icon'], description: 'App icons in a loose row under the buttons.' })],
    html: `<section class="hb-section hb-cta">
  <div class="hb-container"><div class="hb-cta__box hb-cta__box--{{@tone}} hb-center">{{#logo}}<img class="hb-cta__logo" src="{{@logo}}" alt="{{@logo.alt}}">{{/logo}}<h2>{{@title}}</h2>{{#body}}<div class="hb-lead hb-prose">{{@body}}</div>{{/body}}<div class="hb-actions">{{#primaryLabel}}<a class="hb-btn" href="{{@primaryUrl}}">{{@primaryIcon}}{{@primaryLabel}}</a>{{/primaryLabel}}{{#secondaryLabel}}<a class="hb-btn hb-btn--ghost" href="{{@secondaryUrl}}">{{@secondaryLabel}}</a>{{/secondaryLabel}}</div>{{#items}}<div class="hb-cta__icons">{{@items}}</div>{{/items}}</div></div>
</section>`,
    css: `.hb-cta__box { border-radius: calc(var(--hb-radius) * 1.5); padding: clamp(40px, 6vw, 72px) 24px; }
.hb-cta__box--surface { background: var(--hb-surface); border: 1px solid var(--hb-line); }
.hb-cta__box--accent { background: var(--hb-accent); color: var(--hb-on-accent); }
.hb-cta__box--accent .hb-lead { color: inherit; opacity: .85; }
.hb-cta__box--accent .hb-btn { background: var(--hb-on-accent); color: var(--hb-accent); }
.hb-cta__box--accent .hb-btn--ghost { background: transparent; color: var(--hb-on-accent); border-color: currentColor; }
.hb-cta__box--night { background: radial-gradient(60% 50% at 50% 115%, rgb(37 99 235 / .55), transparent 70%), linear-gradient(180deg, #0a0a0f 0%, #0c1230 100%); color: #fff; padding-top: clamp(64px, 9vw, 112px); }
.hb-cta__box--night h2 { font-size: clamp(2.4rem, 5vw, 3.6rem); font-weight: 700; letter-spacing: -0.032em; }
.hb-cta__box--night .hb-lead { color: rgb(255 255 255 / .7); max-width: 30rem; }
.hb-cta__box--night .hb-btn { background: #fff; color: #171717; border-radius: 999px; }
.hb-cta__box--night .hb-btn--ghost { background: rgb(255 255 255 / .12); color: #fff; border-color: rgb(255 255 255 / .25); }
.hb-cta__logo { height: 56px; width: auto; margin: 0 auto 20px; }
.hb-cta__icons { display: flex; justify-content: center; align-items: flex-start; gap: 14px; margin-top: clamp(48px, 7vw, 80px); }
.hb-cta__icons .hb-dock__icon { width: clamp(56px, 7vw, 80px); height: clamp(56px, 7vw, 80px); filter: drop-shadow(0 12px 18px rgb(0 0 0 / .45)); }
.hb-cta__icons .hb-dock__icon:nth-child(odd) { margin-top: 8px; }
.hb-cta__icons .hb-dock__icon--on::after { display: none; }
@media (max-width: 560px) { .hb-cta__icons .hb-dock__icon:first-child, .hb-cta__icons .hb-dock__icon:last-child { display: none; } }`
  }),
  def({
    key: 'signup', name: 'Email sign-up', description: 'A waitlist or newsletter form. Sign-ups land in the project\'s contacts (with double opt-in when it is on). Link buttons to #signup.',
    fields: [f('title', 'text', { default: 'Join the waitlist' }), f('body', 'markdown', { default: 'Be the first to know when it launches.' }), f('placeholder', 'text', { default: 'you@example.com' }), f('buttonLabel', 'text', { default: 'Join' }), f('showName', 'boolean', { label: 'Ask for a name' }), f('namePlaceholder', 'text', { default: 'Your name' }), f('note', 'text', { default: 'No spam. Unsubscribe any time.' })],
    html: `<section class="hb-section hb-signup" id="signup">
  <div class="hb-container hb-center">
    {{#title}}<h2>{{@title}}</h2>{{/title}}
    {{#body}}<div class="hb-lead hb-prose">{{@body}}</div>{{/body}}
    <form class="hb-signup__form" method="post" action="{{$host}}/v1/subscribe">
      <input type="hidden" name="pk" value="{{$pk}}">
      <input class="hb-signup__trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      {{#showName}}<input class="hb-input" type="text" name="name" placeholder="{{@namePlaceholder}}" aria-label="{{@namePlaceholder}}" autocomplete="name">{{/showName}}
      <input class="hb-input" type="email" name="email" required placeholder="{{@placeholder}}" aria-label="{{@placeholder}}" autocomplete="email">
      <button class="hb-btn" type="submit">{{@buttonLabel}}</button>
    </form>
    {{#note}}<p class="hb-muted hb-signup__note">{{@note}}</p>{{/note}}
  </div>
</section>`,
    css: `.hb-signup__form { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 28px; }
.hb-input { min-height: 46px; padding: 0 16px; border-radius: var(--hb-radius-sm); border: 1px solid var(--hb-line); background: var(--hb-bg); color: var(--hb-text); font: 15px var(--hb-font); min-width: 0; flex: 1 1 220px; max-width: 320px; }
.hb-input:focus { outline: 2px solid var(--hb-accent); outline-offset: 1px; }
.hb-signup__trap { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
.hb-signup__note { font-size: .85rem; margin-top: 14px; }`
  }),
  // ---- the project's own HelpBites content ---------------------------------------------
  // Data blocks (shared/cms/dynamic.ts) fill `{{$data}}` from the blog, changelog and pricing the project already
  // has; embed blocks frame HelpBites' own /embed pages (the policy lets them in, see pageCsp).
  def({
    key: 'blog_list', name: 'Blog posts', description: 'The latest posts from the project\'s blog, as cards that link to each post. Shows nothing until a post is published.',
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'From the blog' }), f('intro', 'markdown'), f('count', 'number', { default: 3, description: 'How many posts, 1 to 12.' }), f('tag', 'text', { description: 'Only posts with this tag.' }), f('featuredOnly', 'boolean', { description: 'Only featured posts.' }), f('layout', 'select', { options: ['grid', 'list'], default: 'grid' }), f('showImage', 'boolean', { default: true, label: 'Cover image' }), f('showExcerpt', 'boolean', { default: true, label: 'Excerpt' }), f('showDate', 'boolean', { default: true, label: 'Date' }), f('showAuthor', 'boolean', { label: 'Author' }), f('moreLabel', 'text', { default: 'All posts', description: 'A button to the whole blog; empty hides it.' })],
    html: `<section class="hb-section hb-blog" id="blog">
  <div class="hb-container">
    <div class="hb-center">{{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}{{#title}}<h2>{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-prose">{{@intro}}</div>{{/intro}}</div>
    <div class="hb-blog__list hb-blog__list--{{@layout}}">{{$data}}</div>
    {{#moreLabel}}<div class="hb-center"><div class="hb-actions"><a class="hb-btn hb-btn--ghost" href="{{$host}}/blog/{{$pk}}">{{@moreLabel}}</a></div></div>{{/moreLabel}}
  </div>
</section>`,
    css: `.hb-blog__list { display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; margin-top: 48px; }
.hb-blog__list--list { flex-direction: column; }
.hb-blog__list--grid .hb-blog__post { flex: 1 1 260px; max-width: 380px; }
.hb-blog__post { display: flex; flex-direction: column; overflow: hidden; text-decoration: none; color: inherit; background: var(--hb-surface); border: 1px solid var(--hb-line); border-radius: var(--hb-radius); transition: transform .15s ease; }
.hb-blog__post:hover { transform: translateY(-2px); }
.hb-blog__post img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.hb-blog__body { display: grid; gap: 6px; padding: 20px; align-content: start; }
.hb-blog__body strong { font: 600 1.15rem/1.3 var(--hb-heading-font); letter-spacing: -0.01em; }
.hb-blog__body small { font-size: .8rem; }
.hb-blog__list--list .hb-blog__post { flex-direction: row; align-items: stretch; }
.hb-blog__list--list .hb-blog__post img { width: 220px; aspect-ratio: auto; flex: none; }
@media (max-width: 640px) { .hb-blog__list--list .hb-blog__post { flex-direction: column; } .hb-blog__list--list .hb-blog__post img { width: 100%; aspect-ratio: 16 / 9; } }
.hb-dynamic__empty { padding: 28px; margin-top: 24px; border: 1px dashed var(--hb-line); border-radius: var(--hb-radius); }`
  }),
  def({
    key: 'blog_post', name: 'Blog post', description: 'One post from the project\'s blog, in full, in the look of the page: the latest, or the one whose slug you name.',
    fields: [f('slug', 'text', { description: 'The post\'s slug. Empty shows the latest post.' }), f('showTitle', 'boolean', { default: true, label: 'Title' }), f('showMeta', 'boolean', { default: true, label: 'Date, author and reading time' }), f('showCover', 'boolean', { default: true, label: 'Cover image' })],
    html: `<section class="hb-section hb-bpost">
  <div class="hb-container hb-bpost__in">{{$data}}</div>
</section>`,
    css: `.hb-bpost__in { max-width: 760px; }
.hb-bpost__meta { margin: -.2em 0 1.4em; font-size: .9rem; }
.hb-bpost__cover { width: 100%; border-radius: var(--hb-radius); margin-bottom: 1.6em; }
.hb-bpost__body { font-size: 1.05rem; line-height: 1.7; }
.hb-bpost__body > :first-child { margin-top: 0; }
.hb-bpost__body img { border-radius: var(--hb-radius-sm); margin: 1.4em 0; }
.hb-bpost__body h2, .hb-bpost__body h3 { margin-top: 1.8em; }
.hb-bpost__body a { color: var(--hb-accent); }
.hb-bpost__body blockquote { margin: 1.4em 0; padding-left: 1em; border-left: 3px solid var(--hb-line); color: var(--hb-muted); }
.hb-bpost__body pre { overflow-x: auto; padding: 16px; border-radius: var(--hb-radius-sm); background: var(--hb-surface); font-size: .9rem; }
.hb-bpost__body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em; }
.hb-bpost__body table { display: block; overflow-x: auto; border-collapse: collapse; }
.hb-bpost__body th, .hb-bpost__body td { padding: 8px 12px; border: 1px solid var(--hb-line); }
.hb-dynamic__empty { padding: 28px; border: 1px dashed var(--hb-line); border-radius: var(--hb-radius); }`
  }),
  def({
    key: 'changelog', name: 'Changelog', description: 'The latest entries of the project\'s changelog, newest first, with their tag and version. Shows nothing until an entry is published.',
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'What\'s new' }), f('intro', 'markdown'), f('count', 'number', { default: 5, description: 'How many entries, 1 to 20.' }), f('tag', 'select', { options: ['all', 'new', 'improved', 'fix', 'removed', 'breaking'], default: 'all' }), f('showTag', 'boolean', { default: true, label: 'Tag' }), f('showVersion', 'boolean', { default: true, label: 'Version' }), f('showDate', 'boolean', { default: true, label: 'Date' }), f('showBody', 'boolean', { label: 'Full text', description: 'The whole entry instead of its summary.' }), f('moreLabel', 'text', { default: 'Full changelog', description: 'A button to the whole changelog; empty hides it.' })],
    html: `<section class="hb-section hb-clog" id="changelog">
  <div class="hb-container hb-clog__in">
    <div class="hb-center">{{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}{{#title}}<h2>{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-prose">{{@intro}}</div>{{/intro}}</div>
    <div class="hb-clog__list">{{$data}}</div>
    {{#moreLabel}}<div class="hb-center"><div class="hb-actions"><a class="hb-btn hb-btn--ghost" href="{{$host}}/changelog/{{$pk}}">{{@moreLabel}}</a></div></div>{{/moreLabel}}
  </div>
</section>`,
    css: `.hb-clog__in { max-width: 820px; }
.hb-clog__list { margin-top: 40px; border-top: 1px solid var(--hb-line); }
.hb-clog__entry { display: grid; grid-template-columns: 9rem 1fr; gap: 24px; padding: 28px 0; border-bottom: 1px solid var(--hb-line); }
.hb-clog__meta { padding-top: .4em; line-height: 1.5; }
.hb-clog__entry h3 { margin: 0 0 .4em; }
.hb-clog__text { font-size: .98rem; margin: 0; }
.hb-clog__text img { border-radius: var(--hb-radius-sm); }
.hb-clog__text a { color: var(--hb-accent); }
.hb-clog__tag { margin-right: 6px; font-size: 12px; padding: 4px 9px; vertical-align: .15em; }
.hb-clog__tag--new { background: rgb(16 185 129 / .12); color: #047857; }
.hb-clog__tag--improved { background: rgb(59 130 246 / .12); color: #2563eb; }
.hb-clog__tag--fix { background: rgb(245 158 11 / .14); color: #b45309; }
.hb-clog__tag--removed { background: rgb(107 114 128 / .15); color: var(--hb-muted); }
.hb-clog__tag--breaking { background: rgb(239 68 68 / .12); color: #dc2626; }
.hb-clog .hb-actions { margin-top: 32px; }
@media (max-width: 640px) { .hb-clog__entry { grid-template-columns: 1fr; gap: 6px; } }
.hb-dynamic__empty { padding: 28px; margin-top: 24px; border: 1px dashed var(--hb-line); border-radius: var(--hb-radius); }`
  }),
  def({
    key: 'pricing_table', name: 'Pricing from HelpBites', description: 'The plans of one of the project\'s published pricing tables, as cards with their live prices and buttons. Shows nothing until a table is published.',
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'Pricing' }), f('intro', 'markdown'), f('table', 'text', { label: 'Pricing table', description: 'The key of a published table (Pricing). Empty: the first one.' }), f('interval', 'select', { options: ['auto', 'week', 'month', 'year', 'once'], default: 'auto', description: 'Auto follows the table\'s default.' }), f('showFeatures', 'boolean', { default: true, label: 'Feature lists' })],
    html: `<section class="hb-section hb-ptable">
  <div class="hb-container">
    <div class="hb-center">{{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}{{#title}}<h2>{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-prose">{{@intro}}</div>{{/intro}}</div>
    <div class="hb-ptable__row">{{$data}}</div>
  </div>
</section>`,
    css: `.hb-ptable__row { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; align-items: stretch; margin-top: 48px; }
.hb-ptable__plan { display: flex; flex-direction: column; gap: 12px; position: relative; }
.hb-ptable__plan--on { border-color: var(--hb-accent); box-shadow: 0 0 0 1px var(--hb-accent); }
.hb-ptable__plan h3 { margin: 0; }
.hb-ptable__plan p { margin: 0; }
.hb-ptable__badge { align-self: flex-start; background: var(--hb-accent); color: var(--hb-on-accent); }
.hb-ptable__price { font: 700 2.4rem/1 var(--hb-heading-font); letter-spacing: -0.03em; }
.hb-ptable__price small { font: 400 1rem var(--hb-font); letter-spacing: 0; margin-left: 6px; }
.hb-ptable__note { font-size: .85rem; }
.hb-ptable__lines { list-style: none; padding: 0; margin: 8px 0 16px; display: grid; gap: 8px; }
.hb-ptable__lines li::before { content: "✓"; color: var(--hb-accent); margin-right: 10px; font-weight: 700; }
.hb-ptable__lines .hb-ptable__off { color: var(--hb-muted); text-decoration: line-through; }
.hb-ptable__lines .hb-ptable__off::before { content: "–"; color: var(--hb-muted); }
.hb-ptable .hb-btn { margin-top: auto; }
.hb-dynamic__empty { padding: 28px; margin-top: 24px; border: 1px dashed var(--hb-line); border-radius: var(--hb-radius); }`
  }),
  def({
    key: 'feedback', name: 'Feedback board', description: 'The project\'s feedback board, roadmap or changelog view, live, so visitors can post and vote without leaving the page.',
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'Tell us what to build next' }), f('intro', 'markdown'), f('view', 'select', { options: ['board', 'roadmap', 'changelog'], default: 'board' }), f('theme', 'select', { options: ['light', 'dark', 'system'], default: 'light', description: 'Match the page\'s mode.' }), f('height', 'number', { default: 640, description: 'In pixels.' })],
    html: `<section class="hb-section hb-embed">
  <div class="hb-container">
    <div class="hb-center">{{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}{{#title}}<h2>{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-prose">{{@intro}}</div>{{/intro}}</div>
    <iframe class="hb-embed__frame" src="{{$host}}/embed/feedback?inline=1&amp;pk={{$pk}}&amp;view={{@view}}&amp;theme={{@theme}}" title="Feedback" loading="lazy" style="height: {{@height}}px"></iframe>
  </div>
</section>`,
    css: `.hb-embed__frame { width: 100%; margin-top: 40px; border: 1px solid var(--hb-line); border-radius: var(--hb-radius); background: var(--hb-bg); }`
  }),
  def({
    key: 'chat', name: 'Support chat', description: 'The project\'s support chat, open on the page: visitors write to you and read your answers here.',
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'Talk to us' }), f('intro', 'markdown'), f('theme', 'select', { options: ['light', 'dark', 'system'], default: 'light', description: 'Match the page\'s mode.' }), f('height', 'number', { default: 560, description: 'In pixels.' })],
    html: `<section class="hb-section hb-embed hb-embed--chat">
  <div class="hb-container">
    <div class="hb-center">{{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}{{#title}}<h2>{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-prose">{{@intro}}</div>{{/intro}}</div>
    <iframe class="hb-embed__frame" src="{{$host}}/embed?inline=1&amp;pk={{$pk}}&amp;theme={{@theme}}" title="Support chat" loading="lazy" allow="clipboard-write" style="height: {{@height}}px"></iframe>
  </div>
</section>`,
    css: `.hb-embed--chat .hb-embed__frame { max-width: 720px; margin-left: auto; margin-right: auto; }`
  }),
  def({
    key: 'form', name: 'Lead form', description: 'One of the project\'s forms (Forms), live on the page. Submissions land in the project\'s contacts.',
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'Get in touch' }), f('intro', 'markdown'), f('form', 'text', { default: 'contact', label: 'Form key', description: 'The key of a published form, as in its link.' }), f('height', 'number', { default: 520, description: 'In pixels.' })],
    html: `<section class="hb-section hb-embed hb-embed--form">
  <div class="hb-container">
    <div class="hb-center">{{#eyebrow}}<p class="hb-eyebrow">{{@eyebrow}}</p>{{/eyebrow}}{{#title}}<h2>{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-prose">{{@intro}}</div>{{/intro}}</div>
    <iframe class="hb-embed__frame" src="{{$host}}/f/{{$pk}}/{{@form}}" title="Form" loading="lazy" style="height: {{@height}}px"></iframe>
  </div>
</section>`,
    css: `.hb-embed--form .hb-embed__frame { max-width: 560px; margin-left: auto; margin-right: auto; }`
  }),
  def({
    key: 'notify', name: 'Changelog sign-up', description: 'Visitors enter their email to be told about new releases (with double opt-in). Needs email notifications on in the changelog\'s settings.',
    fields: [f('title', 'text', { default: 'Get notified of new releases' }), f('body', 'markdown', { default: 'One email when something ships. Unsubscribe any time.' }), f('placeholder', 'text', { default: 'you@example.com' }), f('buttonLabel', 'text', { default: 'Notify me' }), f('askFrequency', 'boolean', { label: 'Let them choose how often' }), f('frequency', 'select', { options: ['instant', 'weekly'], default: 'instant', description: 'When they cannot choose.' }), f('instantLabel', 'text', { default: 'Every release' }), f('weeklyLabel', 'text', { default: 'Weekly digest' })],
    html: `<section class="hb-section hb-signup hb-notify" id="notify">
  <div class="hb-container hb-center">
    {{#title}}<h2>{{@title}}</h2>{{/title}}
    {{#body}}<div class="hb-lead hb-prose">{{@body}}</div>{{/body}}
    <form class="hb-signup__form" method="post" action="{{$host}}/v1/changelog/subscribe?pk={{$pk}}">
      <input class="hb-signup__trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <input class="hb-input" type="email" name="email" required placeholder="{{@placeholder}}" aria-label="{{@placeholder}}" autocomplete="email">
      {{#askFrequency}}<select class="hb-input" name="frequency" aria-label="How often"><option value="instant">{{@instantLabel}}</option><option value="weekly">{{@weeklyLabel}}</option></select>{{/askFrequency}}
      {{^askFrequency}}<input type="hidden" name="frequency" value="{{@frequency}}">{{/askFrequency}}
      <button class="hb-btn" type="submit">{{@buttonLabel}}</button>
    </form>
  </div>
</section>`,
    // The same form look as the email sign-up, so either works alone on a page.
    css: `.hb-notify .hb-signup__form { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 28px; }
.hb-notify .hb-input { min-height: 46px; padding: 0 16px; border-radius: var(--hb-radius-sm); border: 1px solid var(--hb-line); background: var(--hb-bg); color: var(--hb-text); font: 15px var(--hb-font); min-width: 0; flex: 1 1 220px; max-width: 320px; }
.hb-notify .hb-input:focus { outline: 2px solid var(--hb-accent); outline-offset: 1px; }
.hb-notify .hb-signup__trap { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }`
  }),
  def({
    key: 'app_badges', name: 'App store buttons', description: 'Download buttons for the App Store and Google Play.',
    fields: [f('appStoreUrl', 'url', { label: 'App Store URL' }), f('appStoreCaption', 'text', { default: 'Download on the' }), f('appStoreLabel', 'text', { default: 'App Store' }), f('playStoreUrl', 'url', { label: 'Google Play URL' }), f('playStoreCaption', 'text', { default: 'Get it on' }), f('playStoreLabel', 'text', { default: 'Google Play' }), f('align', 'select', { options: ['center', 'left'], default: 'center' })],
    example: { appStoreUrl: '#' },
    html: `<div class="hb-container hb-badges hb-badges--{{@align}}">
  {{#appStoreUrl}}<a class="hb-badge" href="{{@appStoreUrl}}"><small>{{@appStoreCaption}}</small><strong>{{@appStoreLabel}}</strong></a>{{/appStoreUrl}}
  {{#playStoreUrl}}<a class="hb-badge" href="{{@playStoreUrl}}"><small>{{@playStoreCaption}}</small><strong>{{@playStoreLabel}}</strong></a>{{/playStoreUrl}}
</div>`,
    css: `.hb-badges { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; margin-bottom: 40px; }
.hb-badges--center { justify-content: center; }
.hb-badge { display: inline-flex; flex-direction: column; justify-content: center; min-width: 160px; height: 52px; padding: 0 18px; border-radius: 12px; background: var(--hb-text); color: var(--hb-bg); text-decoration: none; line-height: 1.15; }
.hb-badge small { font-size: 11px; opacity: .8; }
.hb-badge strong { font-size: 18px; }`
  }),
  def({
    key: 'code', name: 'Code snippet', description: 'A terminal line or a few lines of code: the install command of a developer tool.',
    fields: [f('code', 'textarea', { default: 'npm install your-package' })],
    html: '<div class="hb-container hb-code"><pre><code>{{@code}}</code></pre></div>',
    css: `.hb-code { margin-bottom: 40px; }
.hb-code pre { margin: 0 auto; max-width: 640px; text-align: left; background: #0e0e10; color: #e7e5e4; border: 1px solid #2a2a2e; border-radius: var(--hb-radius-sm); padding: 18px 20px; font: 14px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-x: auto; }`
  }),
  def({
    key: 'video', name: 'Video', description: 'An uploaded video (MP4 or WebM), or a YouTube or Vimeo player.',
    fields: [f('title', 'text'), f('video', 'asset'), f('poster', 'asset'), f('autoplay', 'boolean', { description: 'Plays muted, on a loop, without controls.' }), f('embedUrl', 'url', { label: 'Player URL', description: 'https://www.youtube-nocookie.com/embed/VIDEO_ID or https://player.vimeo.com/video/VIDEO_ID' })],
    html: `<section class="hb-section hb-video">
  <div class="hb-container">
    {{#title}}<h2 class="hb-center">{{@title}}</h2>{{/title}}
    {{#video}}<video class="hb-video__media" src="{{@video}}"{{#poster}} poster="{{@poster}}"{{/poster}}{{#autoplay}} autoplay muted loop playsinline{{/autoplay}}{{^autoplay}} controls{{/autoplay}}></video>{{/video}}
    {{^video}}{{#embedUrl}}<div class="hb-video__frame"><iframe src="{{@embedUrl}}" title="{{@title}}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>{{/embedUrl}}{{/video}}
  </div>
</section>`,
    css: `.hb-video__media, .hb-video__frame { width: 100%; border-radius: var(--hb-radius); overflow: hidden; border: 1px solid var(--hb-line); margin-top: 32px; background: #000; }
.hb-video__frame { aspect-ratio: 16 / 9; }
.hb-video__frame iframe { width: 100%; height: 100%; border: 0; }`
  }),
  def({
    key: 'image', name: 'Image', description: 'One image with an optional caption.',
    fields: [f('image', 'asset'), f('caption', 'text'), f('size', 'select', { options: ['container', 'narrow', 'full'], default: 'container' })],
    html: '<figure class="hb-image hb-image--{{@size}}">{{#image}}<img src="{{@image}}" alt="{{@image.alt}}" loading="lazy">{{/image}}{{#caption}}<figcaption class="hb-muted">{{@caption}}</figcaption>{{/caption}}</figure>',
    css: `.hb-image { margin: 40px auto; padding: 0 24px; max-width: var(--hb-max); }
.hb-image--narrow { max-width: 760px; }
.hb-image--full { max-width: none; padding: 0; }
.hb-image img { width: 100%; border-radius: var(--hb-radius); }
.hb-image--full img { border-radius: 0; }
.hb-image figcaption { text-align: center; font-size: .9rem; margin-top: 12px; }`
  }),
  def({
    key: 'richtext', name: 'Text', description: 'Free text in Markdown: a story, a manifesto, terms, a long explanation.',
    fields: [f('body', 'markdown', { default: '## A heading\n\nA paragraph of text.' }), f('align', 'select', { options: ['left', 'center'], default: 'left' }), f('width', 'select', { options: ['narrow', 'normal'], default: 'narrow' })],
    html: '<section class="hb-section hb-richtext"><div class="hb-container hb-richtext__in hb-richtext--{{@width}} hb-prose" style="text-align: {{@align}}">{{@body}}</div></section>',
    css: `.hb-richtext--narrow { max-width: 760px; }
.hb-richtext__in h2 { margin-top: 1.5em; }
.hb-richtext__in h2:first-child { margin-top: 0; }
.hb-richtext__in ul, .hb-richtext__in ol { padding-left: 1.3em; }
.hb-richtext__in blockquote { border-left: 3px solid var(--hb-accent); margin: 1.5em 0; padding: .2em 0 .2em 1.2em; color: var(--hb-muted); }
.hb-richtext__in code { background: var(--hb-surface); padding: .15em .4em; border-radius: 6px; font-size: .9em; }
.hb-richtext__in pre { background: var(--hb-surface); padding: 16px; border-radius: var(--hb-radius-sm); overflow: auto; }`
  }),
  def({
    key: 'columns', name: 'Columns', description: 'A grid that holds any blocks side by side: cards, quotes, images, text.',
    fields: [f('columns', 'select', { options: ['2', '3', '4'], default: '2' }), f('items', 'blocks')],
    html: '<section class="hb-section hb-columns"><div class="hb-container"><div class="hb-grid" style="--hb-cols: {{@columns}}">{{@items}}</div></div></section>',
    css: '.hb-columns .hb-section { padding: 0; } .hb-columns .hb-container .hb-container { padding: 0; }'
  }),
  def({
    key: 'spacer', name: 'Spacer', description: 'Room between blocks, with an optional line.',
    fields: [f('size', 'select', { options: ['sm', 'md', 'lg'], default: 'md' }), f('line', 'boolean')],
    html: '<div class="hb-spacer hb-spacer--{{@size}}">{{#line}}<hr>{{/line}}</div>',
    css: `.hb-spacer { display: flex; align-items: center; max-width: var(--hb-max); margin: 0 auto; padding: 0 24px; }
.hb-spacer--sm { height: 24px; } .hb-spacer--md { height: 56px; } .hb-spacer--lg { height: 104px; }
.hb-spacer hr { flex: 1; border: 0; border-top: 1px solid var(--hb-line); }`
  }),
  def({
    key: 'footer', name: 'Footer', description: 'The bottom of the page: name or logo, a line of small print and links.',
    fields: [f('brand', 'text', { default: 'Acme' }), f('logo', 'asset'), f('text', 'markdown', { default: '© Acme' }), f('links', 'blocks', { allow: ['link'] })],
    example: { links: [{ component: 'link', label: 'Privacy', url: '#' }, { component: 'link', label: 'Contact', url: '#' }] },
    html: `<footer class="hb-footer">
  <div class="hb-container hb-footer__in">
    <div class="hb-footer__brand">{{#logo}}<img src="{{@logo}}" alt="{{@brand}}">{{/logo}}{{^logo}}<strong>{{@brand}}</strong>{{/logo}}{{#text}}<div class="hb-muted hb-prose">{{@text}}</div>{{/text}}</div>
    <nav class="hb-footer__links">{{@links}}</nav>
  </div>
</footer>`,
    css: `.hb-footer { border-top: 1px solid var(--hb-line); padding: 40px 0; font-size: .9rem; }
.hb-footer__in { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 24px; }
.hb-footer__brand img { height: 24px; width: auto; }
.hb-footer__brand .hb-prose { margin-top: 8px; }
.hb-footer__links { display: flex; flex-wrap: wrap; gap: 20px; }
.hb-footer__links a { color: var(--hb-muted); text-decoration: none; }
.hb-footer__links a:hover { color: var(--hb-text); }`
  }),
  // ---- showcase: the blocks of a product page with a big gradient hero, tinted feature rows and dark panels
  def({
    key: 'gradient_hero', name: 'Gradient hero', description: 'A full-width gradient panel with the headline, two buttons and a row of reassurances; an app screenshot overlaps its bottom edge. Optionally shrinks into a rounded card as the page scrolls.',
    fields: [f('logo', 'asset'), f('headline', 'text', { default: 'The one-line promise of your product', required: true }), f('subhead', 'markdown', { default: 'Who it is for and what it changes for them.' }), ...cta('primary', 'Get started'), f('primaryIcon', 'icon'), f('secondaryLabel', 'text'), f('secondaryUrl', 'url'), f('trust', 'blocks', { label: 'Reassurances', allow: ['trust_item'] }), f('image', 'asset', { label: 'Screenshot' }), f('gradient', 'select', { options: ['sky', 'night', 'sunset', 'aurora'], default: 'sky' }), f('shrink', 'boolean', { default: true, label: 'Shrink on scroll', description: 'The panel becomes a rounded card and the screenshot rises as the page scrolls (browsers with scroll-driven animations).' })],
    example: { trust: [{ component: 'trust_item', icon: 'gift', label: 'Free' }, { component: 'trust_item', icon: 'globe', label: 'Runs in your browser' }] },
    html: `<section class="hb-ghero hb-ghero--{{@gradient}}{{#shrink}} hb-ghero--shrink{{/shrink}}{{#image}} hb-ghero--shot{{/image}}">
  <div class="hb-ghero__panel">
    <div class="hb-ghero__copy">
      {{#logo}}<img class="hb-ghero__logo" src="{{@logo}}" alt="{{@logo.alt}}">{{/logo}}
      <h1>{{@headline}}</h1>
      {{#subhead}}<div class="hb-ghero__sub hb-prose">{{@subhead}}</div>{{/subhead}}
      <div class="hb-ghero__actions">{{#primaryLabel}}<a class="hb-btn hb-btn--ink" href="{{@primaryUrl}}">{{@primaryIcon}}{{@primaryLabel}}</a>{{/primaryLabel}}{{#secondaryLabel}}<a class="hb-btn hb-btn--glass" href="{{@secondaryUrl}}">{{@secondaryLabel}}</a>{{/secondaryLabel}}</div>
      {{#trust}}<ul class="hb-ghero__trust">{{@trust}}</ul>{{/trust}}
    </div>
  </div>
  {{#image}}<div class="hb-ghero__window"><img src="{{@image}}" alt="{{@image.alt}}" width="{{@image.width}}" height="{{@image.height}}" fetchpriority="high"></div>{{/image}}
</section>`,
    css: `.hb-ghero { --overlap: clamp(7.5rem, 21vw, 19.5rem); }
.hb-ghero__panel { position: relative; overflow: hidden; color: #fff; text-align: center; isolation: isolate; }
.hb-ghero__panel::after { content: ""; position: absolute; inset: 0; z-index: -1; opacity: .16; mix-blend-mode: overlay; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.hb-ghero--sky .hb-ghero__panel { background: radial-gradient(42% 30% at 50% 100%, rgb(255 228 196 / .95), transparent 72%), radial-gradient(64% 46% at 4% 102%, rgb(56 189 248 / .95), transparent 70%), radial-gradient(60% 42% at 98% 100%, rgb(192 132 252 / .9), transparent 70%), radial-gradient(70% 55% at 90% -6%, rgb(124 58 237 / .55), transparent 70%), radial-gradient(62% 52% at 6% -4%, rgb(37 99 235 / .75), transparent 70%), linear-gradient(180deg, #0c1a4f 0%, #1d3a8f 32%, #4c45d6 62%, #9b7cf0 84%, #f3c4d6 100%); }
.hb-ghero--night .hb-ghero__panel { background: radial-gradient(55% 45% at 50% 100%, rgb(14 165 233 / .35), transparent 70%), linear-gradient(180deg, #0b0b1e 0%, #0b1d3d 55%, #0b4c6e 100%); }
.hb-ghero--sunset .hb-ghero__panel { background: radial-gradient(60% 50% at 50% 100%, rgb(254 215 170 / .9), transparent 70%), radial-gradient(60% 50% at 0% 0%, rgb(190 24 93 / .6), transparent 70%), linear-gradient(180deg, #3b0764 0%, #9d174d 45%, #f97316 85%, #fde68a 100%); }
.hb-ghero--aurora .hb-ghero__panel { background: radial-gradient(60% 50% at 20% 100%, rgb(52 211 153 / .7), transparent 70%), radial-gradient(60% 50% at 90% 10%, rgb(56 189 248 / .6), transparent 70%), linear-gradient(180deg, #022c22 0%, #064e3b 40%, #0e7490 80%, #a5f3fc 100%); }
.hb-ghero__copy { max-width: 54rem; margin: 0 auto; padding: clamp(104px, 14vw, 152px) 20px 72px; }
.hb-ghero--shot .hb-ghero__copy { padding-bottom: calc(var(--overlap) + 4.5rem); }
.hb-ghero__logo { height: 52px; width: auto; margin: 0 auto 24px; filter: drop-shadow(0 10px 16px rgb(0 0 0 / .25)); }
.hb-ghero h1 { color: #fff; font-size: clamp(2.6rem, 6.4vw, 4.4rem); line-height: 1.03; font-weight: 700; letter-spacing: -0.035em; text-shadow: 0 2px 30px rgb(12 26 79 / .35); }
.hb-ghero__sub { max-width: 40rem; margin: 20px auto 0; font-size: clamp(1.05rem, 1.6vw, 1.2rem); line-height: 1.55; color: rgb(255 255 255 / .8); }
.hb-ghero__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 36px; }
.hb-ghero__actions .hb-btn { border-radius: 999px; min-height: 50px; padding: 0 24px; font-size: 16px; }
.hb-ghero__actions .hb-btn--ink { background: #171717; color: #fff; }
.hb-ghero__trust { list-style: none; padding: 0; margin: 24px 0 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 20px; font-size: 13px; font-weight: 500; color: rgb(255 255 255 / .75); }
.hb-ghero__window { position: relative; z-index: 1; width: calc(100% - 1rem); max-width: 1120px; margin: calc(-1 * var(--overlap)) auto 0; }
.hb-ghero__window img { width: 100%; border-radius: 12px; background: #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / .1), 0 40px 80px -20px rgb(15 23 42 / .45); }
@media (min-width: 640px) { .hb-ghero__window { width: calc(100% - 3rem); } }
@media (max-width: 560px) { .hb-ghero__actions .hb-btn { flex: 1 1 100%; } }
@media (prefers-reduced-motion: no-preference) { @supports (animation-timeline: scroll()) {
  .hb-ghero--shrink .hb-ghero__panel { animation: hb-ghero-card linear both; animation-timeline: scroll(root); animation-range: 0 320px; }
  .hb-ghero--shrink .hb-ghero__window { transform-origin: 50% 0; animation: hb-ghero-rise linear both; animation-timeline: scroll(root); animation-range: 0 100vh; }
  @keyframes hb-ghero-card { to { margin: 0 clamp(1rem, 2.5vw, 1.75rem); border-radius: clamp(2rem, 3.5vw, 2.75rem); } }
  @keyframes hb-ghero-rise { to { transform: translateY(-120px) scale(1.08); } }
} }`
  }),
  def({
    key: 'trust_item', name: 'Reassurance', description: 'One short reassurance under the hero buttons: an icon and a few words.',
    fields: [f('icon', 'icon', { default: 'check' }), f('label', 'text', { default: 'No card needed' })],
    html: '<li class="hb-trust">{{@icon}}<span>{{@label}}</span></li>',
    css: '.hb-trust { display: inline-flex; align-items: center; gap: 6px; } .hb-trust .hb-icon { font-size: 16px; }'
  }),
  def({
    key: 'marquee', name: 'Scrolling row', description: 'A label over a row of names or logos that scrolls sideways without end (still for people who reduce motion).',
    fields: [f('label', 'text', { default: 'Works everywhere you do' }), f('items', 'blocks', { allow: ['marquee_item'] }), f('speed', 'select', { options: ['slow', 'normal', 'fast'], default: 'normal' })],
    example: { items: [['monitor', 'macOS'], ['smartphone', 'iOS'], ['globe', 'The web']].map(([icon, label]) => ({ component: 'marquee_item', icon, label })) },
    html: `<section class="hb-marquee hb-marquee--{{@speed}}">
  {{#label}}<p class="hb-marquee__label">{{@label}}</p>{{/label}}
  <div class="hb-marquee__view"><div class="hb-marquee__track"><div class="hb-marquee__group">{{@items}}</div><div class="hb-marquee__group" aria-hidden="true">{{@items}}</div></div></div>
</section>`,
    css: `.hb-marquee { padding: clamp(56px, 8vw, 96px) 0 40px; }
.hb-marquee__label { text-align: center; font-size: .875rem; font-weight: 500; color: var(--hb-muted); margin-bottom: 28px; }
.hb-marquee__view { overflow: hidden; -webkit-mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent); mask-image: linear-gradient(to right, transparent, #000 12%, #000 88%, transparent); }
.hb-marquee__track { display: flex; width: max-content; animation: hb-marquee var(--hb-marquee-time, 38s) linear infinite; }
.hb-marquee--slow { --hb-marquee-time: 60s; } .hb-marquee--fast { --hb-marquee-time: 22s; }
.hb-marquee__track:hover { animation-play-state: paused; }
.hb-marquee__group { display: flex; align-items: center; gap: clamp(48px, 6vw, 64px); padding-right: clamp(48px, 6vw, 64px); }
@keyframes hb-marquee { to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .hb-marquee__track { animation: none; width: auto; justify-content: center; } .hb-marquee__group { flex-wrap: wrap; justify-content: center; gap: 24px 48px; padding: 0 24px; } .hb-marquee__group[aria-hidden] { display: none; } }`
  }),
  def({
    key: 'marquee_item', name: 'Row item', description: 'One name in a scrolling row, with an icon or a small logo.',
    fields: [f('icon', 'icon'), f('image', 'asset', { label: 'Logo' }), f('label', 'text', { default: 'Name' })],
    html: '<span class="hb-mitem">{{@icon}}{{#image}}<img src="{{@image}}" alt="">{{/image}}<span>{{@label}}</span></span>',
    css: `.hb-mitem { display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; font-size: 19px; font-weight: 600; letter-spacing: -0.01em; color: color-mix(in srgb, var(--hb-muted) 75%, transparent); }
.hb-mitem .hb-icon { font-size: 22px; } .hb-mitem img { height: 22px; width: auto; }`
  }),
  def({
    key: 'link_band', name: 'Icon link band', description: 'A dark rounded band with one sentence and a row of icon links that jump to the sections below.',
    fields: [f('title', 'text', { default: 'Everything in one place, from the first idea to the finished thing.' }), f('items', 'blocks', { allow: ['band_link'] }), f('tone', 'select', { options: ['ink', 'surface'], default: 'ink' })],
    example: { items: [['sparkles', 'Design', '#design'], ['download', 'Export', '#export'], ['share-2', 'Share', '#share']].map(([icon, label, url]) => ({ component: 'band_link', icon, label, url })) },
    html: '<section class="hb-bandwrap"><div class="hb-band hb-band--{{@tone}}"><h2 class="hb-band__title">{{@title}}</h2><nav class="hb-band__links">{{@items}}</nav></div></section>',
    css: `.hb-bandwrap { padding: 0 clamp(8px, 1.5vw, 12px); }
.hb-band { max-width: 1400px; margin: 0 auto; border-radius: clamp(2rem, 3.5vw, 2.75rem); padding: clamp(80px, 10vw, 112px) 24px; text-align: center; }
.hb-band--ink { background: #171717; color: #fff; }
.hb-band--surface { background: var(--hb-surface); color: var(--hb-text); }
.hb-band__title { max-width: 36rem; margin: 0 auto; font-size: clamp(1.6rem, 3vw, 2rem); line-height: 1.22; font-weight: 600; letter-spacing: -0.02em; }
.hb-band__links { display: flex; flex-wrap: wrap; justify-content: center; gap: 24px clamp(8px, 2vw, 24px); margin-top: clamp(48px, 6vw, 56px); }`
  }),
  def({
    key: 'band_link', name: 'Band link', description: 'An icon over a label in an icon link band; point it at a section with #its-anchor.',
    fields: [f('icon', 'icon', { default: 'sparkles' }), f('label', 'text', { default: 'Section' }), f('url', 'url', { default: '#' })],
    html: '<a class="hb-blink" href="{{@url}}">{{@icon}}<span>{{@label}}</span></a>',
    css: `.hb-blink { display: flex; flex-direction: column; align-items: center; gap: 10px; width: clamp(80px, 9vw, 96px); text-decoration: none; font-size: 14px; opacity: .8; transition: opacity .2s; }
.hb-blink .hb-icon { font-size: clamp(28px, 3vw, 32px); opacity: .55; transition: transform .2s, opacity .2s; }
.hb-blink:hover { opacity: 1; } .hb-blink:hover .hb-icon { opacity: 1; transform: translateY(-2px); }`
  }),
  def({
    key: 'section_head', name: 'Section heading', description: 'A pill, a big title and a line of lead text that open a group of blocks.',
    fields: [f('pill', 'text'), f('pillIcon', 'icon'), f('pillTone', 'select', { options: ['neutral', 'blue', 'amber', 'violet', 'emerald', 'dark'], default: 'neutral' }), f('title', 'text', { default: 'A short, confident title.' }), f('lead', 'markdown'), f('align', 'select', { options: ['center', 'left'], default: 'center' }), f('anchor', 'text', { description: 'An id to link to with #anchor.' })],
    html: '<header class="hb-shead hb-shead--{{@align}}"{{#anchor}} id="{{@anchor}}"{{/anchor}}><div class="hb-container">{{#pill}}<span class="hb-pill hb-pill--{{@pillTone}}">{{@pillIcon}}{{@pill}}</span>{{/pill}}<h2 class="hb-title">{{@title}}</h2>{{#lead}}<div class="hb-lead hb-prose">{{@lead}}</div>{{/lead}}</div></header>',
    css: `.hb-shead { padding: clamp(72px, 9vw, 112px) 0 clamp(8px, 2vw, 24px); }
.hb-shead--center { text-align: center; }
.hb-shead--center .hb-title { max-width: 40rem; margin-left: auto; margin-right: auto; }
.hb-shead--center .hb-lead { margin: 16px auto 0; }
.hb-shead .hb-lead { margin-top: 16px; }`
  }),
  def({
    key: 'feature_row', name: 'Feature row', description: 'One feature in depth: a pill, a title, a paragraph, a checklist and a tinted stage holding a screenshot (or a mockup block). Flip rows down the page; number them with step.',
    fields: [f('anchor', 'text', { description: 'An id to link to with #anchor.' }), f('step', 'text', { description: 'A small badge above: 01, 02…' }), f('pill', 'text'), f('pillIcon', 'icon'), f('tone', 'select', { options: ['blue', 'amber', 'violet', 'emerald', 'neutral'], default: 'blue' }), f('title', 'text', { default: 'A benefit, told in depth' }), f('body', 'markdown'), f('checks', 'markdown', { label: 'Checklist', description: 'A Markdown list: one "- item" per line.' }), f('items', 'blocks', { label: 'Small features', allow: ['mini_feature'] }), f('ctaLabel', 'text'), f('ctaUrl', 'url'), f('linkLabel', 'text'), f('linkUrl', 'url'), f('image', 'asset', { label: 'Screenshot' }), f('imageFit', 'select', { options: ['bleed', 'center', 'contain'], default: 'bleed', description: 'Bleed runs off the right and bottom edges and fades out.' }), f('media', 'blocks', { label: 'Mockup', allow: ['dock_mockup', 'code_window'], description: 'Instead of a screenshot.' }), f('reverse', 'boolean', { description: 'Media on the left.' })],
    example: { checks: '- A concrete detail\n- Another one\n- And a third' },
    html: `<section class="hb-frow hb-tint--{{@tone}}{{#reverse}} hb-frow--flip{{/reverse}}"{{#anchor}} id="{{@anchor}}"{{/anchor}}>
  <div class="hb-container hb-frow__in">
    <div class="hb-frow__copy">
      {{#step}}<span class="hb-step">{{@step}}</span>{{/step}}
      {{#pill}}<div><span class="hb-pill hb-pill--{{@tone}}">{{@pillIcon}}{{@pill}}</span></div>{{/pill}}
      <h3 class="hb-heading">{{@title}}</h3>
      {{#body}}<div class="hb-lead hb-prose hb-frow__body">{{@body}}</div>{{/body}}
      {{#checks}}<div class="hb-checks">{{@checks}}</div>{{/checks}}
      {{#items}}<div class="hb-frow__items">{{@items}}</div>{{/items}}
      {{#ctaLabel}}<div class="hb-actions"><a class="hb-btn hb-btn--soft" href="{{@ctaUrl}}">{{@ctaLabel}}</a>{{#linkLabel}}<a class="hb-textlink" href="{{@linkUrl}}">{{@linkLabel}}</a>{{/linkLabel}}</div>{{/ctaLabel}}
    </div>
    <div class="hb-frow__media">{{#media}}{{@media}}{{/media}}{{^media}}<div class="hb-stage hb-stage--{{@tone}} hb-stage--{{@imageFit}}">{{#image}}<img src="{{@image}}" alt="{{@image.alt}}" loading="lazy">{{/image}}</div>{{/media}}</div>
  </div>
</section>`,
    css: `.hb-frow { padding: clamp(48px, 7vw, 64px) 0; }
.hb-frow__in { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: clamp(40px, 6vw, 80px); align-items: center; }
.hb-frow--flip .hb-frow__in { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
.hb-frow--flip .hb-frow__media { order: -1; }
.hb-frow__body { margin-top: 16px; font-size: 17px; }
.hb-frow__items { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 32px; margin-top: 28px; }
.hb-frow .hb-stage--neutral::before { background: radial-gradient(70% 60% at 50% 0%, rgb(0 0 0 / .04), transparent 70%); }
@media (max-width: 960px) { .hb-frow__in, .hb-frow--flip .hb-frow__in { grid-template-columns: 1fr; } .hb-frow--flip .hb-frow__media { order: 0; } }
@media (max-width: 560px) { .hb-frow__items { grid-template-columns: 1fr; } }`
  }),
  def({
    key: 'mini_feature', name: 'Small feature', description: 'An icon, a name and one line: for lists of tools inside a feature row.',
    fields: [f('icon', 'icon', { default: 'sparkles' }), f('title', 'text', { default: 'Tool' }), f('body', 'text', { default: 'What it does, in a line.' })],
    html: '<div class="hb-mini"><p class="hb-mini__title">{{@icon}}{{@title}}</p><p class="hb-mini__body">{{@body}}</p></div>',
    css: `.hb-mini__title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 600; }
.hb-mini__title .hb-icon { color: var(--hb-muted); }
.hb-mini__body { margin: 4px 0 0; font-size: 14px; line-height: 1.5; color: var(--hb-muted); }`
  }),
  def({
    key: 'image_tabs', name: 'Image tabs', description: 'Pick a tab, see its picture: a segmented control over a tinted stage that swaps images (no script), beside a title and text.',
    fields: [f('anchor', 'text'), f('pill', 'text'), f('pillIcon', 'icon'), f('live', 'text', { label: 'Second pill', description: 'A green pill with a pulsing dot: "Try it live".' }), f('tone', 'select', { options: ['violet', 'blue', 'amber', 'emerald'], default: 'violet' }), f('title', 'text', { default: 'One thing, several ways' }), f('body', 'markdown'), f('tabs', 'blocks', { allow: ['image_tab'] }), f('reverse', 'boolean', { default: true })],
    example: { tabs: ['One', 'Two', 'Three'].map((label, i) => ({ component: 'image_tab', label, selected: i === 0 })) },
    html: `<section class="hb-frow hb-itabs{{#reverse}} hb-frow--flip{{/reverse}}"{{#anchor}} id="{{@anchor}}"{{/anchor}}>
  <div class="hb-container hb-frow__in">
    <div class="hb-frow__copy">
      <div class="hb-pills">{{#pill}}<span class="hb-pill hb-pill--{{@tone}}">{{@pillIcon}}{{@pill}}</span>{{/pill}}{{#live}}<span class="hb-pill hb-pill--emerald"><span class="hb-ping"></span>{{@live}}</span>{{/live}}</div>
      <h3 class="hb-heading">{{@title}}</h3>
      {{#body}}<div class="hb-lead hb-prose hb-frow__body">{{@body}}</div>{{/body}}
    </div>
    <div class="hb-frow__media"><div class="hb-stage hb-stage--{{@tone}} hb-itabs__stage" role="radiogroup" aria-label="{{@title}}">{{@tabs}}</div></div>
  </div>
</section>`,
    css: `.hb-itabs__stage { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: center; gap: 4px; padding: 0 16px 76px; }
.hb-itabs__stage::after { content: ""; position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); width: min(92%, 420px); height: 44px; border-radius: 999px; background: rgb(255 255 255 / .75); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 0 0 1px rgb(0 0 0 / .05); z-index: 0; }`
  }),
  def({
    key: 'image_tab', name: 'Image tab', description: 'One tab of an image tabs block: its label, its picture and a line under it.',
    fields: [f('label', 'text', { default: 'Tab' }), f('image', 'asset'), f('note', 'text'), f('selected', 'boolean', { label: 'Selected at first' })],
    html: '<label class="hb-itab"><input type="radio" name="hb-tabs-{{$parent}}"{{#selected}} checked{{/selected}}><span class="hb-itab__label">{{@label}}</span><span class="hb-itab__panel">{{#image}}<img src="{{@image}}" alt="{{@image.alt}}" loading="lazy">{{/image}}</span>{{#note}}<span class="hb-itab__note">{{@note}}</span>{{/note}}</label>',
    css: `/* No z-index here: a flex item with one stacks on its own, and the next tab's picture would cover this label. */
.hb-itab { cursor: pointer; margin-bottom: -56px; }
.hb-itab input { position: absolute; opacity: 0; pointer-events: none; }
.hb-itab__label { position: relative; z-index: 2; display: inline-flex; align-items: center; height: 36px; padding: 0 16px; border-radius: 999px; font-size: 14px; font-weight: 600; color: #525252; transition: background .2s, color .2s; }
.hb-itab:has(input:checked) .hb-itab__label, .hb-itabs__stage:not(:has(input:checked)) .hb-itab:first-child .hb-itab__label { background: var(--hb-accent); color: var(--hb-on-accent); box-shadow: 0 2px 8px -2px color-mix(in srgb, var(--hb-accent) 50%, transparent); }
.hb-itab input:focus-visible + .hb-itab__label { outline: 2px solid var(--hb-accent); outline-offset: 2px; }
.hb-itab__panel { position: absolute; inset: 8% 12% 92px; opacity: 0; transition: opacity .35s ease; pointer-events: none; }
.hb-itab__panel img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 30px 40px rgb(76 29 149 / .22)); }
.hb-itab__note { position: absolute; left: 24px; right: 24px; bottom: 6px; z-index: 2; text-align: center; font-size: 12px; color: #525252; opacity: 0; transition: opacity .35s; pointer-events: none; }
.hb-itab:has(input:checked) .hb-itab__panel, .hb-itab:has(input:checked) .hb-itab__note, .hb-itabs__stage:not(:has(input:checked)) .hb-itab:first-child .hb-itab__panel { opacity: 1; }`
  }),
  def({
    key: 'bento', name: 'Bento grid', description: 'Big rounded cards in a grid, each a picture over a title and a sentence.',
    fields: [f('columns', 'select', { options: ['2', '3'], default: '2' }), f('items', 'blocks', { allow: ['bento_card'] })],
    example: { items: [1, 2, 3, 4].map(n => ({ component: 'bento_card', title: `Card ${n}`, body: 'One sentence about it.' })) },
    html: '<section class="hb-bento"><div class="hb-container"><div class="hb-bento__grid" style="--hb-cols: {{@columns}}">{{@items}}</div></div></section>',
    css: `.hb-bento { padding: clamp(40px, 6vw, 64px) 0; }
.hb-bento__grid { display: grid; gap: clamp(20px, 2vw, 24px); grid-template-columns: repeat(var(--hb-cols, 2), minmax(0, 1fr)); }
@media (max-width: 860px) { .hb-bento__grid { grid-template-columns: 1fr; } }`
  }),
  def({
    key: 'bento_card', name: 'Bento card', description: 'One card of a bento grid.',
    fields: [f('image', 'asset', { label: 'Picture' }), f('title', 'text', { default: 'Card' }), f('body', 'text', { default: 'One sentence about it.' }), f('dots', 'boolean', { default: true, label: 'Dot grid behind the picture' })],
    html: '<article class="hb-bcard"><div class="hb-bcard__art{{#dots}} hb-bcard__art--dots{{/dots}}">{{#image}}<img src="{{@image}}" alt="{{@image.alt}}" loading="lazy">{{/image}}</div><div class="hb-bcard__copy"><h3>{{@title}}</h3><p>{{@body}}</p></div></article>',
    css: `.hb-bcard { border-radius: 2rem; background: var(--hb-surface); overflow: hidden; }
.hb-bcard__art { height: clamp(16rem, 24vw, 18rem); display: grid; place-items: center; padding: 24px; }
.hb-bcard__art--dots { background-image: radial-gradient(color-mix(in srgb, var(--hb-text) 9%, transparent) 1px, transparent 1.4px); background-size: 16px 16px; -webkit-mask-image: linear-gradient(to bottom, #000 80%, transparent); mask-image: linear-gradient(to bottom, #000 80%, transparent); }
.hb-bcard__art img { max-height: 100%; max-width: 100%; object-fit: contain; }
.hb-bcard__copy { text-align: center; padding: 8px clamp(28px, 3vw, 40px) 36px; }
.hb-bcard h3 { font-size: 1.25rem; letter-spacing: -0.015em; margin-bottom: 8px; }
.hb-bcard p { margin: 0 auto; max-width: 28rem; font-size: 15px; line-height: 1.6; color: var(--hb-muted); }`
  }),
  def({
    key: 'showcase_panel', name: 'Showcase panel', description: 'A rounded panel with its own gradient for one standout feature: copy beside a picture, or centred over it, with an optional footnote.',
    fields: [f('anchor', 'text'), f('tone', 'select', { options: ['violet', 'ocean', 'night', 'surface'], default: 'violet' }), f('layout', 'select', { options: ['split', 'center'], default: 'split' }), f('pill', 'text'), f('pillIcon', 'icon'), f('title', 'text', { default: 'One standout feature.' }), f('body', 'markdown'), f('checks', 'markdown', { label: 'Checklist' }), f('ctaLabel', 'text'), f('ctaUrl', 'url'), f('ctaIcon', 'icon'), f('image', 'asset', { label: 'Picture' }), f('note', 'text', { label: 'Footnote' }), f('noteIcon', 'icon')],
    html: `<section class="hb-spanel-wrap"{{#anchor}} id="{{@anchor}}"{{/anchor}}>
  <div class="hb-spanel hb-spanel--{{@tone}} hb-spanel--{{@layout}}">
    <div class="hb-spanel__copy">
      {{#pill}}<span class="hb-pill hb-pill--violet hb-spanel__pill">{{@pillIcon}}{{@pill}}</span>{{/pill}}
      <h2 class="hb-title">{{@title}}</h2>
      {{#body}}<div class="hb-lead hb-prose">{{@body}}</div>{{/body}}
      {{#checks}}<div class="hb-checks hb-tint--violet">{{@checks}}</div>{{/checks}}
      {{#ctaLabel}}<div class="hb-actions"><a class="hb-btn hb-btn--ink" href="{{@ctaUrl}}">{{@ctaLabel}}{{@ctaIcon}}</a></div>{{/ctaLabel}}
    </div>
    {{#image}}<div class="hb-spanel__media"><img src="{{@image}}" alt="{{@image.alt}}" loading="lazy"></div>{{/image}}
    {{#note}}<p class="hb-spanel__note">{{@noteIcon}}{{@note}}</p>{{/note}}
  </div>
</section>`,
    css: `.hb-spanel-wrap { padding: clamp(24px, 4vw, 48px) clamp(8px, 1.5vw, 12px); }
.hb-spanel { position: relative; max-width: 1200px; margin: 0 auto; border-radius: clamp(2rem, 3.5vw, 2.75rem); padding: clamp(56px, 7vw, 80px) clamp(24px, 4vw, 48px); overflow: hidden; }
.hb-spanel--split { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: clamp(40px, 6vw, 80px); align-items: center; }
.hb-spanel--center { text-align: center; }
.hb-spanel--center .hb-spanel__copy { max-width: 44rem; margin: 0 auto; }
.hb-spanel--center .hb-lead { margin-left: auto; margin-right: auto; }
.hb-spanel--center .hb-actions { justify-content: center; }
.hb-spanel--center .hb-spanel__media { margin: clamp(40px, 6vw, 56px) auto 0; max-width: min(100%, 22rem); }
.hb-spanel .hb-lead { margin-top: 16px; font-size: 17px; }
.hb-spanel__media img { width: 100%; border-radius: 1.5rem; box-shadow: 0 24px 60px -28px rgb(76 29 149 / .4); }
.hb-spanel__note { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 48px 0 0; font-size: .875rem; opacity: .65; }
.hb-spanel--violet { background: linear-gradient(135deg, rgb(139 92 246 / .1), rgb(14 165 233 / .05), rgb(99 102 241 / .1)); }
.hb-spanel--surface { background: var(--hb-surface); }
.hb-spanel--ocean, .hb-spanel--night { color: #fff; }
.hb-spanel--ocean { background: radial-gradient(55% 45% at 50% 62%, rgb(14 165 233 / .35), transparent 70%), linear-gradient(180deg, #0b0b1e 0%, #0b1d3d 55%, #0b4c6e 100%); }
.hb-spanel--night { background: radial-gradient(60% 50% at 50% 115%, rgb(37 99 235 / .5), transparent 70%), linear-gradient(180deg, #0a0a0f, #0c1230); }
.hb-spanel--ocean .hb-lead, .hb-spanel--night .hb-lead { color: rgb(255 255 255 / .7); }
.hb-spanel--ocean .hb-spanel__pill, .hb-spanel--night .hb-spanel__pill { background: rgb(255 255 255 / .1); color: rgb(255 255 255 / .85); box-shadow: inset 0 0 0 1px rgb(255 255 255 / .1); }
.hb-spanel--ocean .hb-btn--ink, .hb-spanel--night .hb-btn--ink { background: #fff; color: #171717; }
.hb-spanel .hb-btn { border-radius: 999px; }
.hb-spanel .hb-btn .hb-icon { order: 2; }
@media (max-width: 960px) { .hb-spanel--split { grid-template-columns: 1fr; } }`
  }),
  def({
    key: 'dock_mockup', name: 'Desktop with a Dock', description: 'A desktop picture with a menu bar and a frosted Dock of app icons: show an icon where it will live.',
    fields: [f('wallpaper', 'asset'), f('appName', 'text', { default: 'Finder' }), f('time', 'text', { default: '9:41' }), f('items', 'blocks', { label: 'Dock icons', allow: ['dock_icon'] })],
    example: { items: [1, 2, 3, 4, 5].map(n => ({ component: 'dock_icon', name: `App ${n}`, running: n === 3 })) },
    html: `<div class="hb-desk">{{#wallpaper}}<img class="hb-desk__wall" src="{{@wallpaper}}" alt="">{{/wallpaper}}
  <div class="hb-desk__bar"><svg class="hb-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-3.9zM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/></svg><strong>{{@appName}}</strong><span>{{@time}}</span></div>
  <div class="hb-dock">{{@items}}</div>
</div>`,
    css: `.hb-desk { position: relative; aspect-ratio: 5 / 4; border-radius: 2rem; overflow: hidden; background: linear-gradient(160deg, #a5b4fc, #f0abfc 55%, #fde68a); }
.hb-desk__wall { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hb-desk__bar { position: absolute; inset: 0 0 auto; display: flex; align-items: center; gap: 14px; height: 26px; padding: 0 16px; font-size: 11px; color: #111; background: rgb(255 255 255 / .25); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.hb-desk__bar span { margin-left: auto; }
.hb-dock { position: absolute; left: 50%; bottom: 6%; transform: translateX(-50%); display: flex; align-items: flex-end; gap: clamp(4px, 1vw, 10px); padding: clamp(6px, 1vw, 10px); border-radius: clamp(1.4rem, 2vw, 1.6rem); background: rgb(255 255 255 / .22); -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); box-shadow: inset 0 1px 0 rgb(255 255 255 / .65), inset 0 0 0 1px rgb(255 255 255 / .35), 0 20px 40px -12px rgb(15 23 42 / .35); }
@media (max-width: 560px) { .hb-dock .hb-dock__icon:first-child, .hb-dock .hb-dock__icon:last-child { display: none; } }`
  }),
  def({
    key: 'dock_icon', name: 'App icon', description: 'One icon in a Dock or an icon row.',
    fields: [f('image', 'asset'), f('name', 'text', { default: 'App' }), f('running', 'boolean', { description: 'A dot under it, like an open app.' })],
    html: '<span class="hb-dock__icon{{#running}} hb-dock__icon--on{{/running}}" title="{{@name}}">{{#image}}<img src="{{@image}}" alt="{{@name}}">{{/image}}</span>',
    css: `.hb-dock__icon { position: relative; display: block; width: clamp(48px, 6vw, 68px); height: clamp(48px, 6vw, 68px); transition: transform .2s cubic-bezier(.2, .8, .2, 1); }
.hb-dock__icon:empty { display: none; }
.hb-dock__icon img { width: 100%; height: 100%; object-fit: contain; }
.hb-dock .hb-dock__icon:hover { transform: translateY(-6px) scale(1.18); }
.hb-dock__icon--on::after { content: ""; position: absolute; left: 50%; bottom: -6px; width: 4px; height: 4px; margin-left: -2px; border-radius: 999px; background: rgb(0 0 0 / .6); }`
  }),
  def({
    key: 'code_window', name: 'Code window', description: 'A dark terminal window with a few lines of code or commands, and a caption under it.',
    fields: [f('title', 'text'), f('code', 'textarea', { default: '# A comment\ncurl https://api.example.com/v1/thing' }), f('caption', 'text')],
    html: '<figure class="hb-codewin"><div class="hb-codewin__bar"><i></i><i></i><i></i>{{#title}}<span>{{@title}}</span>{{/title}}</div><pre><code>{{@code}}</code></pre>{{#caption}}<figcaption>{{@caption}}</figcaption>{{/caption}}</figure>',
    css: `.hb-codewin { margin: 0; }
.hb-codewin__bar { display: flex; align-items: center; gap: 6px; padding: 14px 16px 0; background: #171717; border-radius: 1rem 1rem 0 0; }
.hb-codewin__bar i { width: 11px; height: 11px; border-radius: 999px; background: #ff5f57; } .hb-codewin__bar i:nth-child(2) { background: #febc2e; } .hb-codewin__bar i:nth-child(3) { background: #28c840; }
.hb-codewin__bar span { margin-left: 8px; font-size: 12px; color: #a3a3a3; }
.hb-codewin pre { margin: 0; padding: 18px 20px 22px; background: #171717; color: #f5f5f5; border-radius: 0 0 1rem 1rem; font: 12.5px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-x: auto; box-shadow: 0 30px 60px -30px rgb(0 0 0 / .5); }
.hb-codewin figcaption { margin-top: 14px; font-size: .875rem; color: var(--hb-muted); }`
  }),
  def({
    key: 'feature_cells', name: 'Feature list with previews', description: 'Many features as a hairline grid of icon and name; hovering (or focusing) one pops up a card with its picture and a line.',
    fields: [f('items', 'blocks', { allow: ['feature_cell'] }), f('ctaLabel', 'text'), f('ctaUrl', 'url')],
    example: { items: [['sparkles', 'Feature one'], ['zap', 'Feature two'], ['lock', 'Feature three']].map(([icon, label]) => ({ component: 'feature_cell', icon, label, tagline: 'One line about it.' })) },
    html: '<section class="hb-cells"><div class="hb-container"><ul class="hb-cells__grid">{{@items}}</ul>{{#ctaLabel}}<div class="hb-cells__cta"><a class="hb-btn hb-btn--soft" href="{{@ctaUrl}}">{{@ctaLabel}}</a></div>{{/ctaLabel}}</div></section>',
    css: `.hb-cells { padding: 20px 0 clamp(56px, 8vw, 96px); }
.hb-cells__grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); clip-path: inset(0 1px 1px 0); }
.hb-cells__cta { display: flex; justify-content: center; margin-top: 32px; }
.hb-cells__cta .hb-btn { border-radius: 999px; }
@media (max-width: 960px) { .hb-cells__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .hb-cells__grid { grid-template-columns: 1fr; } }`
  }),
  def({
    key: 'feature_cell', name: 'Feature cell', description: 'One feature in a feature list: its icon and name, and the card that pops up (picture, line, link).',
    fields: [f('icon', 'icon', { default: 'sparkles' }), f('label', 'text', { default: 'Feature' }), f('badge', 'text', { description: 'A small tag on the right: "Plus".' }), f('tagline', 'text'), f('image', 'asset', { label: 'Card picture' }), f('url', 'url'), f('linkLabel', 'text', { default: 'Learn more' })],
    html: '<li class="hb-cell" tabindex="0"><span class="hb-cell__main">{{@icon}}<span>{{@label}}</span>{{#badge}}<em>{{@badge}}</em>{{/badge}}</span>{{#tagline}}<span class="hb-cell__card" role="tooltip">{{#image}}<img src="{{@image}}" alt="" loading="lazy">{{/image}}<strong>{{@icon}}{{@label}}</strong><span>{{@tagline}}</span>{{#url}}<a href="{{@url}}">{{@linkLabel}} →</a>{{/url}}</span>{{/tagline}}</li>',
    css: `.hb-cell { position: relative; border-right: 1px solid var(--hb-line); border-bottom: 1px solid var(--hb-line); outline: none; }
.hb-cell__main { display: flex; align-items: center; gap: 12px; padding: 20px 24px; font-size: 15px; font-weight: 500; transition: background .15s; }
.hb-cell:hover .hb-cell__main, .hb-cell:focus-visible .hb-cell__main { background: color-mix(in srgb, var(--hb-surface) 60%, transparent); }
.hb-cell__main .hb-icon { font-size: 18px; color: var(--hb-muted); }
.hb-cell__main em { margin-left: auto; font-style: normal; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, var(--hb-accent) 12%, transparent); color: var(--hb-accent); }
.hb-cell__card { position: absolute; left: 16px; bottom: calc(100% - 6px); z-index: 10; width: 20rem; max-width: calc(100vw - 48px); display: flex; flex-direction: column; gap: 6px; padding: 8px 8px 14px; border-radius: 1.5rem; background: var(--hb-bg); box-shadow: 0 0 0 1px var(--hb-line), 0 24px 48px -16px rgb(0 0 0 / .25); opacity: 0; transform: translateY(6px) scale(.92); transform-origin: 20% 100%; pointer-events: none; transition: opacity .2s, transform .32s cubic-bezier(.34, 1.56, .64, 1); }
.hb-cell:hover .hb-cell__card, .hb-cell:focus-within .hb-cell__card { opacity: 1; transform: none; pointer-events: auto; transition-delay: .15s; }
.hb-cell__card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 1rem; margin-bottom: 4px; }
.hb-cell__card strong { display: flex; align-items: center; gap: 8px; padding: 0 8px; font-size: 14px; }
.hb-cell__card strong .hb-icon { color: var(--hb-accent); }
.hb-cell__card > span, .hb-cell__card a { padding: 0 8px; font-size: 13px; color: var(--hb-muted); }
.hb-cell__card a { color: var(--hb-accent); font-size: 12px; font-weight: 600; text-decoration: none; }`
  }),
  def({
    key: 'plan_card', name: 'Plan card (framed)', description: 'A plan in a framed card: name and tagline on the frame, price, button and list on an inset panel. Light, or dark for the plan to pick.',
    fields: [f('name', 'text', { default: 'Plan' }), f('tagline', 'text'), f('pricePrefix', 'text', { description: '"From"' }), f('price', 'text', { default: '$0' }), f('period', 'text'), f('note', 'text', { description: 'Under the price: "No card needed."' }), ...cta('cta', 'Choose'), f('ctaIcon', 'icon'), f('features', 'markdown', { default: '- What is included' }), f('tone', 'select', { options: ['light', 'dark'], default: 'light' })],
    html: `<div class="hb-pcard hb-pcard--{{@tone}}">
  <div class="hb-pcard__head"><h3>{{@name}}</h3>{{#tagline}}<p>{{@tagline}}</p>{{/tagline}}</div>
  <div class="hb-pcard__body">
    <div class="hb-pcard__price">{{#pricePrefix}}<small>{{@pricePrefix}}</small>{{/pricePrefix}}<span>{{@price}}</span>{{#period}}<small>{{@period}}</small>{{/period}}</div>
    {{#note}}<p class="hb-pcard__note">{{@note}}</p>{{/note}}
    {{#ctaLabel}}<a class="hb-btn hb-pcard__btn" href="{{@ctaUrl}}">{{@ctaIcon}}{{@ctaLabel}}</a>{{/ctaLabel}}
    <div class="hb-pcard__list hb-prose">{{@features}}</div>
  </div>
</div>`,
    css: `.hb-pcard { border-radius: 2rem; padding: 6px; display: flex; flex-direction: column; }
.hb-pcard--light { background: color-mix(in srgb, var(--hb-surface) 70%, var(--hb-bg)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--hb-line) 70%, transparent); }
.hb-pcard--dark { background: #171717; color: #fff; }
.hb-pcard__head { padding: 20px clamp(20px, 2.5vw, 28px); }
.hb-pcard__head h3 { margin: 0; font-size: 1.25rem; }
.hb-pcard__head p { margin: 4px 0 0; font-size: 15px; opacity: .6; }
.hb-pcard__body { flex: 1; border-radius: 1.6rem; padding: 28px clamp(20px, 2.5vw, 28px) 32px; box-shadow: 0 0 0 1px rgb(0 0 0 / .05); }
.hb-pcard--light .hb-pcard__body { background: var(--hb-bg); box-shadow: 0 0 0 1px rgb(0 0 0 / .05), 0 1px 2px rgb(0 0 0 / .05); }
.hb-pcard--dark .hb-pcard__body { background: rgb(0 0 0 / .5); }
.hb-pcard__price { display: flex; align-items: baseline; gap: 6px; }
.hb-pcard__price span { font-size: 2.75rem; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.hb-pcard__price small { font-size: 15px; opacity: .6; }
.hb-pcard__note { margin: 6px 0 0; font-size: 14px; opacity: .6; }
.hb-pcard__btn { width: 100%; margin-top: 24px; border-radius: 12px; }
.hb-pcard--dark .hb-pcard__btn { background: #fff; color: #171717; }
.hb-pcard__list ul { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 12px; font-size: 15px; }
.hb-pcard__list li { display: flex; gap: 10px; }
.hb-pcard__list li::before { content: "✓"; font-weight: 700; color: var(--hb-accent); }
.hb-pcard--dark .hb-pcard__list li::before { color: #38bdf8; }`
  })
]

export const BUILTIN_KEYS = new Set(BUILTIN_COMPONENTS.map(d => d.key))

/** The built-ins followed by the project's own components. */
export function libraryOf(custom: CmsComponentDef[] = []): CmsLibrary {
  return new Map([...BUILTIN_COMPONENTS, ...custom.filter(d => !BUILTIN_KEYS.has(d.key))].map(d => [d.key, d]))
}

// ---- templates -------------------------------------------------------------------

type Node = { component: string, [key: string]: unknown }
const b = (component: string, values: Record<string, unknown> = {}): Node => ({ component, ...values })
const anim = (effect: string, extra: Record<string, unknown> = {}) => ({ _anim: { effect, trigger: 'in-view', duration: 700, delay: 0, easing: 'ease-out', stagger: 0, once: true, distance: 28, ...extra } })
const links = (...items: [string, string][]) => items.map(([label, url]) => b('link', { label, url }))
const features = (items: [string, string, string][]) => items.map(([icon, title, body]) => b('feature', { icon, title, body }))
const qas = (items: [string, string][]) => items.map(([question, answer]) => b('qa', { question, answer }))

export type CmsTemplate = { id: string, name: string, description: string, style: Partial<CmsStyle>, content: Node }

/** `{project}` in a template's copy becomes the project's name. */
export const CMS_TEMPLATES: CmsTemplate[] = [
  {
    id: 'saas', name: 'SaaS launch', description: 'A web product: a clear promise, the features, proof, pricing and questions.',
    style: { radius: 'soft', mode: 'light' },
    content: b('page', {
      title: '{project}: the promise in a few words',
      description: 'What {project} does, for whom, in one sentence.',
      body: [
        b('nav', { brand: '{project}', links: links(['Features', '#features'], ['Pricing', '#pricing'], ['FAQ', '#faq']), ctaLabel: 'Start free', ctaUrl: '#pricing', sticky: true }),
        b('hero', { eyebrow: 'New', headline: 'Ship the thing your users keep asking for', subhead: '{project} turns *the slow, manual part* of your day into one click, so you can get back to building.', primaryLabel: 'Start free', primaryUrl: '#pricing', secondaryLabel: 'See how it works', secondaryUrl: '#features', note: 'Free for small teams. No card needed.', layout: 'center', ...anim('fade-up', { trigger: 'load', stagger: 0 }) }),
        b('logos', { title: 'Used by teams at', items: ['Northwind', 'Globex', 'Initech', 'Umbrella', 'Hooli'].map(name => b('logo', { name })) }),
        b('features', { eyebrow: 'Features', title: 'Everything in one place', columns: '3', items: features([['⚡', 'Fast by default', 'Pages load in under a second, everywhere.'], ['🔒', 'Private', 'Your data stays yours. Export it any time.'], ['🧩', 'Plays well with others', 'Connect the tools you already use.'], ['📈', 'Know what works', 'See what people use and what they skip.'], ['🤝', 'Built for teams', 'Invite people and share the work.'], ['🛟', 'Real support', 'Talk to the people who build it.']]), ...anim('fade-up', { stagger: 80 }) }),
        b('split', { eyebrow: 'How it works', title: 'From sign-up to value in five minutes', body: 'Connect your account, pick what to automate, and let {project} do the rest.\n\n- Set up in minutes\n- No code needed\n- Undo anything', ...anim('fade-left') }),
        b('stats', { items: [['2,400+', 'Teams'], ['98%', 'Stay after a month'], ['5 min', 'To set up']].map(([value, label]) => b('stat', { value, label })), ...anim('fade-up', { stagger: 100 }) }),
        b('testimonials', { title: 'Loved by makers', items: [['We cut our weekly busywork in half.', 'Ada Park', 'Founder, Northwind'], ['The first tool the whole team actually uses.', 'Leo Brandt', 'CTO, Globex'], ['Setup took one coffee.', 'Mia Chen', 'Indie developer']].map(([text, author, role]) => b('quote', { text, author, role })), ...anim('fade-up', { stagger: 100 }) }),
        b('pricing', { eyebrow: 'Pricing', title: 'Simple, fair pricing', items: [b('plan', { name: 'Free', price: '$0', period: '/month', description: 'For trying it out.', features: '- 1 project\n- Community support', ctaLabel: 'Start free', ctaUrl: '#' }), b('plan', { name: 'Pro', price: '$12', period: '/month', description: 'For growing products.', features: '- Unlimited projects\n- Priority support\n- Everything in Free', ctaLabel: 'Go Pro', ctaUrl: '#', highlighted: true }), b('plan', { name: 'Team', price: '$39', period: '/month', description: 'For teams.', features: '- Seats for everyone\n- Roles and audit log\n- Everything in Pro', ctaLabel: 'Talk to us', ctaUrl: '#' })], ...anim('fade-up', { stagger: 100 }) }),
        b('faq', { title: 'Questions', items: qas([['Is there a free plan?', 'Yes. Free stays free, with no time limit.'], ['Can I cancel any time?', 'Yes, in two clicks. You keep your data.'], ['Where is my data stored?', 'In the EU, encrypted at rest.'], ['Do you have an API?', 'Yes, everything in the app is in the API.']]) }),
        b('cta', { title: 'Try {project} today', body: 'Free for small teams. Set up in five minutes.', primaryLabel: 'Start free', primaryUrl: '#pricing', tone: 'accent', ...anim('zoom-in') }),
        b('footer', { brand: '{project}', text: '© {project}', links: links(['Privacy', '#'], ['Terms', '#'], ['Contact', '#']) })
      ]
    })
  },
  {
    id: 'app', name: 'Mobile app', description: 'An iPhone or Android app: screenshots, what it does, reviews and download buttons.',
    style: { radius: 'round', mode: 'light' },
    content: b('page', {
      title: '{project}: for iPhone and Android',
      description: 'What {project} does, in one sentence.',
      body: [
        b('nav', { brand: '{project}', links: links(['Features', '#features'], ['FAQ', '#faq']), ctaLabel: 'Download', ctaUrl: '#download', sticky: true }),
        b('hero', { eyebrow: 'For iPhone and Android', headline: 'The calm way to keep track of everything', subhead: '{project} keeps *the thing you care about* in one place, and nudges you at the right moment.', layout: 'split', ...anim('fade-up', { trigger: 'load' }) }),
        b('app_badges', { appStoreUrl: '#', playStoreUrl: '#', align: 'center', ...anim('fade', { trigger: 'load', delay: 200 }) }),
        b('features', { title: 'Made for every day', columns: '3', items: features([['📱', 'Works offline', 'Everything is on your phone, synced when you are back online.'], ['🔔', 'Smart reminders', 'At the right time, never too many.'], ['🌙', 'Dark mode', 'Easy on the eyes, day and night.']]), ...anim('fade-up', { stagger: 80 }) }),
        b('split', { title: 'Your day at a glance', body: 'Open the app and see what matters now. Nothing else.', ...anim('fade-right') }),
        b('split', { title: 'Private by design', body: 'No ads, no tracking. Your data stays on your devices and in your iCloud.', reverse: true, ...anim('fade-left') }),
        b('testimonials', { title: 'People like it', items: [['Finally an app that does one thing well.', 'App Store review', '★★★★★'], ['I open it every morning.', 'Play Store review', '★★★★★'], ['Simple and beautiful.', 'App Store review', '★★★★★']].map(([text, author, role]) => b('quote', { text, author, role })), ...anim('fade-up', { stagger: 100 }) }),
        b('faq', { title: 'Questions', items: qas([['Is it free?', 'Free to download, with an optional subscription for extras.'], ['Does it sync between devices?', 'Yes, through your own iCloud or Google account.'], ['Which devices does it run on?', 'iPhone and iPad with iOS 17 or later, and Android 10 or later.']]) }),
        b('cta', { title: 'Get {project}', body: 'Free on the App Store and Google Play.', primaryLabel: 'Download', primaryUrl: '#download', tone: 'surface' }),
        b('footer', { brand: '{project}', text: '© {project}', links: links(['Privacy', '#'], ['Support', '#']) })
      ]
    })
  },
  {
    id: 'waitlist', name: 'Waitlist', description: 'Coming soon: the promise, three reasons to care, and an email sign-up.',
    style: { radius: 'soft', mode: 'dark' },
    content: b('page', {
      title: '{project}: coming soon',
      description: 'Join the waitlist for {project}.',
      body: [
        b('hero', { eyebrow: 'Coming soon', headline: 'Something better for the thing you do every day', subhead: '{project} is in private beta. Join the waitlist and be the first to try it.', primaryLabel: 'Join the waitlist', primaryUrl: '#signup', layout: 'center', ...anim('blur', { trigger: 'load', duration: 900 }) }),
        b('features', { columns: '3', title: '', items: features([['🚀', 'Early access', 'Waitlist members get in first.'], ['💬', 'Shape it', 'Tell us what you need; we build it.'], ['🎁', 'Founding price', 'A lower price, for as long as you stay.']]), ...anim('fade-up', { stagger: 100 }) }),
        b('signup', { title: 'Join the waitlist', body: 'One email when it is ready. Nothing else.', buttonLabel: 'Join', note: 'No spam. Unsubscribe any time.', ...anim('fade-up') }),
        b('faq', { title: 'Questions', items: qas([['When does it launch?', 'Soon. Waitlist members hear first.'], ['How much will it cost?', 'There will be a free plan, and a founding price for early members.']]) }),
        b('footer', { brand: '{project}', text: '© {project}' })
      ]
    })
  },
  {
    id: 'devtool', name: 'Developer tool', description: 'An open-source project or a developer tool: install command, what it does, numbers and docs.',
    style: { radius: 'sharp', mode: 'dark', bodyFont: 'Inter' },
    content: b('page', {
      title: '{project}: the tool in a few words',
      description: 'What {project} does for developers, in one sentence.',
      body: [
        b('nav', { brand: '{project}', links: links(['Docs', '#'], ['GitHub', '#']), ctaLabel: 'Star on GitHub', ctaUrl: '#', sticky: true }),
        b('hero', { eyebrow: 'Open source', headline: 'The fast, boring way to do the hard part', subhead: '{project} is a small library that does *one hard thing* well. MIT licensed.', primaryLabel: 'Get started', primaryUrl: '#', secondaryLabel: 'View on GitHub', secondaryUrl: '#', layout: 'center', ...anim('fade-up', { trigger: 'load' }) }),
        b('code', { code: 'npm install {project}', ...anim('fade', { trigger: 'load', delay: 250 }) }),
        b('features', { title: 'Why developers pick it', columns: '3', items: features([['⚡', 'Zero dependencies', 'Small, fast, and nothing to audit.'], ['🧪', 'Tested', 'Thousands of tests, run on every commit.'], ['📦', 'Works everywhere', 'Node, Bun, Deno and the browser.']]), ...anim('fade-up', { stagger: 80 }) }),
        b('split', { title: 'Five lines to get going', body: 'Import it, call it, done. The defaults are the ones you would pick anyway.\n\n- Typed API\n- Readable errors\n- Docs with examples', ...anim('fade-left') }),
        b('stats', { items: [['12k', 'GitHub stars'], ['300+', 'Contributors'], ['2M', 'Weekly downloads']].map(([value, label]) => b('stat', { value, label })), ...anim('fade-up', { stagger: 100 }) }),
        b('faq', { title: 'Questions', items: qas([['What is the license?', 'MIT. Use it anywhere.'], ['Is it production ready?', 'Yes. It runs in production at many companies.'], ['How do I get help?', 'Open a GitHub issue or join the Discord.']]) }),
        b('cta', { title: 'Build with {project}', primaryLabel: 'Read the docs', primaryUrl: '#', secondaryLabel: 'GitHub', secondaryUrl: '#', tone: 'surface' }),
        b('footer', { brand: '{project}', text: 'MIT licensed. © {project} contributors', links: links(['Docs', '#'], ['GitHub', '#']) })
      ]
    })
  },
  {
    id: 'design-tool', name: 'Design tool', description: 'A creative app in the browser, after macosicons.com/editor: gradient hero, platform row, tinted feature rows, bento, dark panels, toolbox, pricing and FAQ.',
    style: { radius: 'round', mode: 'light', accent: '#3b82f6', headingFont: 'Avenir', bodyFont: 'Avenir', width: 'normal' },
    content: b('page', {
      title: '{project}: icon editor',
      description: 'A vector editor that only does icons, with liquid glass, clay and emboss built in. Runs in your browser and exports .icns, PNG and Icon Composer .icon bundles.',
      background: 'soft',
      body: [
        b('nav', { brand: '{project}', variant: 'overlay', sticky: true, links: links(['Editor', '#'], ['API', '#'], ['Community', '#']), ctaLabel: 'Log in', ctaUrl: '#' }),
        b('gradient_hero', {
          headline: 'Design, preview and export icons in one place',
          subhead: 'A vector editor that only does icons, with liquid glass, clay and emboss built in. It runs directly in your browser and exports .icns, PNG and Icon Composer .icon bundles.',
          primaryLabel: 'Open the editor', primaryUrl: '#', primaryIcon: 'pen-tool', secondaryLabel: 'Log in', secondaryUrl: '#',
          trust: [['gift', 'Free'], ['user-round-check', 'No account needed until you export'], ['globe', 'Runs in your browser']].map(([icon, label]) => b('trust_item', { icon, label })),
          gradient: 'sky', shrink: true
        }),
        b('marquee', { label: 'One icon, ready for every platform', speed: 'normal', items: [['apple', 'macOS'], ['layers', 'Icon Composer'], ['smartphone', 'iOS'], ['hammer', 'Xcode'], ['monitor', 'Windows'], ['terminal', 'Linux'], ['globe', 'The web']].map(([icon, label]) => b('marquee_item', { icon, label })) }),
        b('link_band', { title: 'From the first path to the finished .icns, without leaving the tab.', tone: 'ink', items: [['gem', 'Materials', '#materials'], ['pen-tool', 'Draw', '#draw'], ['wand-sparkles', 'AI', '#ai'], ['app-window-mac', 'Preview', '#preview'], ['download', 'Export', '#export'], ['share-2', 'Share', '#share']].map(([icon, label, url]) => b('band_link', { icon, label, url })) }),
        b('image_tabs', {
          anchor: 'materials', pill: 'Materials', pillIcon: 'gem', live: 'Try it live', tone: 'violet', reverse: true,
          title: 'Glass, clay and emboss on live vector shapes',
          body: 'The material stays attached to the path, so when you change the shape, the refraction, bezel and specular follow it.',
          tabs: [
            b('image_tab', { label: 'Flat', note: 'Flat keeps fills and strokes exactly as drawn. No lighting pass.' }),
            b('image_tab', { label: 'Clay', note: 'Clay is a soft matte volume. Bezel and softness are the two you will touch most.' }),
            b('image_tab', { label: 'Glass', note: 'The inspector\'s own sliders, on the editor\'s own glass shader.', selected: true }),
            b('image_tab', { label: 'Emboss', note: 'Emboss presses the shape into the background. Light direction does most of the work.' })
          ],
          ...anim('fade-up', { once: false })
        }),
        b('feature_row', { anchor: 'draw', pill: 'Vector tools', pillIcon: 'pen-tool', tone: 'blue', title: 'Draw with real vector tools', checks: '- Pen, lines and point-by-point path editing\n- Boolean operations, corner radii and Apple\'s squircle corners\n- Heroicons and Lucide glyphs, text layers and woven paths', imageFit: 'bleed', ...anim('fade-up', { once: false }) }),
        b('feature_row', { pill: 'App and folder icons', pillIcon: 'folder', tone: 'amber', reverse: true, title: 'The app icon and its folder, in one document', checks: '- macOS folder boards with real tint, blur and grain\n- macOS, iOS and watchOS masks, or no mask at all\n- Several boards side by side, each with its own layers', imageFit: 'bleed', ...anim('fade-up', { once: false }) }),
        b('section_head', { pill: 'Editor', pillTone: 'neutral', title: 'Pixels, paths and polish. One editor.', ...anim('fade-up', { once: false }) }),
        b('bento', { columns: '2', items: [
          ['Backgrounds that match', 'Mesh gradients you shape by hand, and color suggestions, harmonies included, taken from your own artwork.'],
          ['Effects, stacked', 'Inner and outer shadows, glow, grain, sticker borders and holographic foil, plus GLSL shaders you can write yourself.'],
          ['From pixels to paths', 'Remove a background four different ways, or trace a bitmap into an editable SVG layer with a live preview.'],
          ['Start from a template', 'Open a designed template, or duplicate any project in the community gallery to see exactly how it was built.']
        ].map(([title, body]) => b('bento_card', { title, body, dots: true })), ...anim('fade-up', { stagger: 90, once: false }) }),
        b('showcase_panel', {
          anchor: 'weave', tone: 'violet', layout: 'split', pill: 'Weave', pillIcon: 'infinity',
          title: 'Make paths pass over and under.',
          body: 'Turn overlapping paths into a woven mark, then choose which strand sits on top at every crossing.',
          checks: '- Your original paths stay separate and editable\n- Click any crossing to flip the over-and-under order\n- Remove the weave whenever you want the plain paths back',
          ctaLabel: 'Open the editor', ctaUrl: '#', ctaIcon: 'arrow-right', ...anim('fade-up', { once: false })
        }),
        b('showcase_panel', {
          anchor: 'ai', tone: 'ocean', layout: 'center', pill: 'AI', pillIcon: 'wand-sparkles',
          title: 'Describe it. Get layers you can edit.',
          body: 'Generate up to eight icon options from one prompt, or split a flat image into separate layers. Everything comes back as layers on your canvas, so you can keep going by hand.',
          note: 'AI needs a free account. Every account gets AI credits each month.', noteIcon: 'coins', ...anim('fade-up', { once: false })
        }),
        b('section_head', { pill: 'Preview, export, share', pillTone: 'neutral', title: 'From the canvas to the Dock.', ...anim('fade-up', { once: false }) }),
        b('feature_row', {
          anchor: 'preview', step: '01', tone: 'blue', title: 'See it where it will live',
          body: 'Check your icon at real pixel sizes, in the Dock and on a Home Screen, in light and dark, before you export anything.',
          media: [b('dock_mockup', { appName: 'Finder', time: '9:41', items: ['Web', 'Camera', 'App Store', '{project}', 'Cloud', 'Music', 'Health'].map((name, i) => b('dock_icon', { name, running: i === 3 })) })],
          ...anim('fade-up', { once: false })
        }),
        b('feature_row', { anchor: 'export', step: '02', tone: 'blue', reverse: true, title: 'Export every format', body: 'Icon Composer .icon bundles for macOS Tahoe, .icns for older versions, PNG at any size, an .appiconset for Xcode, Windows and Linux kits and a favicon pack, or all of it in one zip.', imageFit: 'center', ...anim('fade-up', { once: false }) }),
        b('feature_row', { anchor: 'share', step: '03', tone: 'amber', title: 'Share it, or publish it', body: 'Send a link that can view or edit, post the project to the community gallery, or submit the finished icon to the {project} library.', imageFit: 'contain', ...anim('fade-up', { once: false }) }),
        b('section_head', { pill: 'And more', pillTone: 'neutral', title: 'The rest of the toolbox', ...anim('fade-up', { once: false }) }),
        b('feature_cells', {
          ctaLabel: 'See every feature', ctaUrl: '#',
          items: [
            ['squares-unite', 'Boolean operations', 'Non-destructive shape math.'], ['squircle', 'Squircle corners', 'Apple\'s continuous-curvature corners.'], ['infinity', 'Woven paths', 'Over-and-under woven outlines.'],
            ['blend', 'Mesh gradients', 'Mesh-gradient backgrounds in one click.'], ['palette', 'Color harmonies', 'Background colors that match your artwork.'], ['mountain', 'Depth maps for glass', 'Refraction with a real silhouette.'],
            ['layers-2', 'Stacked shadows', 'Stacked shadows, real depth.'], ['sticker', 'Sticker effects', 'Die-cut sticker looks.'], ['code-xml', 'GLSL shaders', 'Figma-style shaders, real GLSL.'],
            ['type', 'Text layers', 'Type that stays editable.'], ['library', 'Heroicons and Lucide', '200k+ searchable glyphs.'], ['grid-3x3', 'Keyline grid', 'Apple\'s alignment grid.'],
            ['sun-moon', 'Dark, clear and tinted looks', 'Design once for every macOS appearance.'], ['file-input', 'Opens .icon bundles', 'Full Icon Composer parity.'], ['smartphone', 'Works on a phone', 'The full editor on a phone.'],
            ['history', 'Version history', 'Time Machine for your icon.', 'Plus'], ['wifi-off', 'Works offline', 'Design on a plane.'], ['users', 'Live collaboration', 'Design together in real time.', 'Plus']
          ].map(([icon, label, tagline, badge]) => b('feature_cell', { icon, label, tagline, ...(badge ? { badge } : {}), url: '#', linkLabel: 'Full guide' }))
        }),
        b('feature_row', {
          pill: 'For developers', pillIcon: 'terminal', tone: 'neutral', title: 'Icon Toolkit and API',
          body: 'Search, mask, convert and generate icons without opening a document. Every button in the toolkit is also an API endpoint.',
          items: [
            ['search', 'Search', '25,000+ macOS app icons, with filters and categories.'], ['squircle', 'Mask', 'Any PNG into a compliant app or folder icon, shadow included.'],
            ['sparkles', 'Generate', 'A prompt in, up to eight masked icons out.'], ['arrow-left-right', 'Convert', '.icns, .ico, .appiconset and Icon Composer .icon bundles.'],
            ['package', 'Favicons & kits', 'A web favicon pack, or every release artifact in one zip.'], ['eraser', 'Remove background', 'Pixel-exact, no AI repainting.'],
            ['palette', 'Palette & previews', 'Extract the colors, or see the icon in a Dock mockup.'], ['images', 'Image conversion', 'Convert or compress a batch of images at once: PNG, JPEG, WebP, AVIF and more.']
          ].map(([icon, title, body]) => b('mini_feature', { icon, title, body })),
          ctaLabel: 'Open the Icon Toolkit', ctaUrl: '#', linkLabel: 'API docs', linkUrl: '#',
          media: [b('code_window', { code: '# Mask any PNG into a macOS app icon\ncurl -X POST https://api.example.com/v1/editor/mask \\\n  -H "x-api-key: $API_KEY" \\\n  -F "image=@artwork.png" \\\n  -o icon.png\n\n# Every release file in one zip\ncurl -X POST https://api.example.com/v1/editor/pack \\\n  -H "x-api-key: $API_KEY" \\\n  -F "image=@artwork.png" \\\n  -o release-kit.zip', caption: 'Every account gets an API key with a free tier.' })],
          ...anim('fade-up', { once: false })
        }),
        b('section_head', { pill: 'Pricing', pillTone: 'neutral', title: 'Free to design. Plus when you need more room.', ...anim('fade-up', { once: false }) }),
        b('pricing', { title: '', items: [
          b('plan_card', { tone: 'light', name: 'Free', tagline: 'The whole editor, for everyone.', price: '€0', note: 'No card needed.', ctaLabel: 'Open the editor', ctaUrl: '#', ctaIcon: 'pen-tool', features: '- Every tool, material and effect\n- Every export format\n- Start designing without signing up\n- AI credits every month' }),
          b('plan_card', { tone: 'dark', name: '{project}+', tagline: 'One membership. All of {project}.', pricePrefix: 'From', price: '€4.99', period: '/month', note: 'Save 25% with yearly billing', ctaLabel: 'See plans', ctaUrl: '#', ctaIcon: 'arrow-right', features: '- More room in the editor\n- More AI credits\n- No ads, anywhere\n- More API calls' })
        ], ...anim('fade-up', { stagger: 100, once: false }) }),
        b('faq', { layout: 'split', look: 'cards', title: 'Frequently asked questions', intro: 'Quick answers about pricing, accounts, formats and more.', items: qas([
          ['Is the editor free?', 'Yes. Every tool, material and export format is free. You need a free account to save and export, and {project}+ adds unlimited documents and projects, version history, more AI credits and no ads.'],
          ['Do I need an account to try it?', 'No. The editor opens as a scratch document in your browser. Sign up when you want to save or export it.'],
          ['Which formats can I export?', '.icns, PNG at any size and Icon Composer .icon bundles, plus .ico, an Xcode .appiconset, Windows and Linux icon kits and a favicon pack, or all of them in one zip.'],
          ['Can I open icons I already have?', 'Yes. Drop a PNG, SVG or .icns file onto the canvas to get a layer, or open an Icon Composer .icon bundle as a whole editable document.'],
          ['Does it work on Windows, Linux or a phone?', 'Yes. It runs in Safari, Chrome or Firefox on any computer, and switches to a touch layout on phones.'],
          ['Can I work offline?', 'Yes. Keep a document, a project or your whole workspace on the device and open it with no connection. Changes you make offline sync when you\'re back online.'],
          ['Is there an API?', 'Yes. Every account gets an API key with a free tier. Masking, converting, generating and release kits are all endpoints.']
        ]) }),
        b('cta', { tone: 'night', title: 'Your next icon starts here.', body: 'It opens as a scratch document in your browser. Sign up when you want to save or export.', primaryLabel: 'Open the editor', primaryUrl: '#', primaryIcon: 'pen-tool', secondaryLabel: 'Create a free account', secondaryUrl: '#', items: ['Health', 'Cloud', 'App Store', '{project}', 'Bolt', 'Music', 'Camera'].map(name => b('dock_icon', { name })), ...anim('zoom-in', { once: false }) })
      ]
    })
  },
  {
    id: 'blank', name: 'Blank', description: 'An empty page to build from scratch.',
    style: {},
    content: b('page', { title: '{project}', description: '', body: [] })
  }
]

function personalise<T>(value: T, project: string): T {
  if (typeof value === 'string') return value.replaceAll('{project}', project) as T
  if (Array.isArray(value)) return value.map(v => personalise(v, project)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, personalise(v, project)])) as T
  return value
}

/** A template's content with fresh ids and the project's name in its copy. */
export function templateContent(id: string, projectName: string): { content: CmsBlock, style: Partial<CmsStyle> } | null {
  const t = CMS_TEMPLATES.find(x => x.id === id)
  if (!t) return null
  return { content: reuid(personalise(clone(t.content), projectName.trim() || 'Acme')) as CmsBlock, style: { ...t.style } }
}

// ---- the AI wizard ---------------------------------------------------------------

export type WizardQuestion = { id: string, label: string, help?: string, kind: 'text' | 'longtext' | 'select' | 'repos', options?: { value: string, label: string }[], required?: boolean, placeholder?: string }

export const CMS_WIZARD_QUESTIONS: WizardQuestion[] = [
  { id: 'product', label: 'What is it called?', kind: 'text', required: true, placeholder: 'Acme' },
  { id: 'oneLiner', label: 'What is it, in one sentence?', kind: 'text', required: true, placeholder: 'A habit tracker for people who hate habit trackers' },
  { id: 'audience', label: 'Who is it for?', help: 'The more specific, the better the copy: "indie iOS developers" beats "developers".', kind: 'text', required: true },
  { id: 'problem', label: 'What problem does it solve for them?', help: 'What do they do today, and what is painful about it?', kind: 'longtext' },
  { id: 'features', label: 'The three to five things it does best', kind: 'longtext', placeholder: 'One per line' },
  { id: 'proof', label: 'Proof', help: 'Numbers, users, stars, reviews, press, who built it and why.', kind: 'longtext' },
  {
    id: 'goal', label: 'What should a visitor do?', kind: 'select', required: true,
    options: [{ value: 'waitlist', label: 'Join a waitlist' }, { value: 'signup', label: 'Sign up' }, { value: 'download', label: 'Download the app' }, { value: 'buy', label: 'Buy' }, { value: 'github', label: 'Star it on GitHub' }, { value: 'contact', label: 'Get in touch' }]
  },
  { id: 'links', label: 'Links the page needs', help: 'Sign-up URL, App Store, GitHub, docs.', kind: 'longtext', placeholder: 'One per line' },
  {
    id: 'tone', label: 'Tone', kind: 'select',
    options: [{ value: 'plain', label: 'Plain and direct' }, { value: 'friendly', label: 'Friendly' }, { value: 'bold', label: 'Bold and punchy' }, { value: 'technical', label: 'Technical' }, { value: 'playful', label: 'Playful' }]
  },
  { id: 'repos', label: 'Repositories to read', help: 'The assistant reads their README and code to get the facts right.', kind: 'repos' },
  {
    id: 'layout', label: 'Layout', kind: 'select', required: true,
    options: [...CMS_TEMPLATES.filter(t => t.id !== 'blank').map(t => ({ value: t.id, label: `Start from "${t.name}"` })), { value: 'new', label: 'Design a new layout for me' }]
  }
]

export type WizardAnswers = Record<string, string | string[]>

/** The wizard's answers as the first message to the assistant. */
export function wizardPrompt(answers: WizardAnswers): string {
  const get = (id: string) => {
    const v = answers[id]
    return Array.isArray(v) ? v.join(', ') : String(v ?? '').trim()
  }
  const lines = CMS_WIZARD_QUESTIONS.filter(q => q.id !== 'layout' && q.id !== 'repos' && get(q.id)).map((q) => {
    const option = q.options?.find(o => o.value === get(q.id))
    return `- ${q.label} ${option ? option.label : get(q.id)}`
  })
  const layout = get('layout')
  const template = CMS_TEMPLATES.find(t => t.id === layout)
  const repos = get('repos')
  return [
    `Build this landing page${template ? ` starting from the "${template.name}" layout already on the page` : ' with a new layout: pick the blocks that tell this story best, and write a custom component when no built-in fits'}.`,
    'Write all the copy for it: make the value proposition specific and concrete, and lead with the reader\'s outcome rather than the features.',
    repos ? `First read these repositories for the real facts: ${repos}.` : '',
    'Then save what you learned about the audience and the message to the messaging brief.',
    'What I know:',
    ...lines
  ].filter(l => l !== '').join('\n')
}
