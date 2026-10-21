import { fieldLabel, reuid, type CmsBlock, type CmsComponentDef, type CmsField, type CmsFieldType, type CmsLibrary, type CmsStyle } from './content'

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
    fields: [f('title', 'text', { description: 'The browser tab and search result title.' }), f('description', 'textarea', { description: 'One or two sentences for search results and link previews.' }), f('ogImage', 'asset', { label: 'Link preview image', description: '1200 × 630 works everywhere.' }), f('body', 'blocks')],
    html: '<main class="hb-page">{{@body}}</main>'
  }),
  def({
    key: 'nav', name: 'Navigation bar', description: 'The top bar: logo or name, a few links and one button.',
    fields: [f('brand', 'text', { default: 'Acme' }), f('logo', 'asset'), f('links', 'blocks', { allow: ['link'] }), ...cta('cta', 'Get started'), f('sticky', 'boolean', { default: true, description: 'Stays at the top while scrolling.' })],
    example: { links: [{ component: 'link', label: 'Features', url: '#features' }, { component: 'link', label: 'Pricing', url: '#pricing' }] },
    html: `<header class="hb-nav{{#sticky}} hb-nav--sticky{{/sticky}}">
  <div class="hb-container hb-nav__in">
    <span class="hb-nav__brand">{{#logo}}<img src="{{@logo}}" alt="{{@brand}}">{{/logo}}{{^logo}}{{@brand}}{{/logo}}</span>
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
    fields: [f('eyebrow', 'text'), f('title', 'text', { default: 'Simple pricing' }), f('intro', 'markdown'), f('items', 'blocks', { allow: ['plan'] })],
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
    fields: [f('title', 'text', { default: 'Questions' }), f('intro', 'markdown'), f('items', 'blocks', { allow: ['qa'] })],
    example: { items: [1, 2, 3].map(n => ({ component: 'qa', question: `Question ${n}?`, answer: 'A short, honest answer.' })) },
    html: `<section class="hb-section hb-faq" id="faq">
  <div class="hb-container hb-faq__in">{{#title}}<h2 class="hb-center">{{@title}}</h2>{{/title}}{{#intro}}<div class="hb-lead hb-center hb-prose">{{@intro}}</div>{{/intro}}<div class="hb-faq__list">{{@items}}</div></div>
</section>`,
    css: `.hb-faq__in { max-width: 820px; }
.hb-faq__list { margin-top: 40px; border-top: 1px solid var(--hb-line); }`
  }),
  def({
    key: 'qa', name: 'Question', description: 'One question and its answer.',
    fields: [f('question', 'text', { default: 'A question?' }), f('answer', 'markdown', { default: 'The answer.' })],
    html: '<details class="hb-qa"><summary>{{@question}}</summary><div class="hb-muted hb-prose">{{@answer}}</div></details>',
    css: `.hb-qa { border-bottom: 1px solid var(--hb-line); padding: 20px 0; }
.hb-qa summary { cursor: pointer; font-weight: 600; font-size: 1.05rem; list-style: none; display: flex; justify-content: space-between; gap: 16px; }
.hb-qa summary::-webkit-details-marker { display: none; }
.hb-qa summary::after { content: "+"; color: var(--hb-muted); font-weight: 400; font-size: 1.4rem; line-height: 1; transition: transform .2s; }
.hb-qa[open] summary::after { transform: rotate(45deg); }
.hb-qa .hb-prose { padding-top: 12px; }`
  }),
  def({
    key: 'cta', name: 'Call to action', description: 'A closing band that asks for the one action that matters.',
    fields: [f('title', 'text', { default: 'Ready to start?' }), f('body', 'markdown'), ...cta('primary', 'Get started'), f('secondaryLabel', 'text'), f('secondaryUrl', 'url'), f('tone', 'select', { options: ['accent', 'surface'], default: 'accent' })],
    html: `<section class="hb-section hb-cta">
  <div class="hb-container"><div class="hb-cta__box hb-cta__box--{{@tone}} hb-center"><h2>{{@title}}</h2>{{#body}}<div class="hb-lead hb-prose">{{@body}}</div>{{/body}}<div class="hb-actions">{{#primaryLabel}}<a class="hb-btn" href="{{@primaryUrl}}">{{@primaryLabel}}</a>{{/primaryLabel}}{{#secondaryLabel}}<a class="hb-btn hb-btn--ghost" href="{{@secondaryUrl}}">{{@secondaryLabel}}</a>{{/secondaryLabel}}</div></div></div>
</section>`,
    css: `.hb-cta__box { border-radius: calc(var(--hb-radius) * 1.5); padding: clamp(40px, 6vw, 72px) 24px; }
.hb-cta__box--surface { background: var(--hb-surface); border: 1px solid var(--hb-line); }
.hb-cta__box--accent { background: var(--hb-accent); color: var(--hb-on-accent); }
.hb-cta__box--accent .hb-lead { color: inherit; opacity: .85; }
.hb-cta__box--accent .hb-btn { background: var(--hb-on-accent); color: var(--hb-accent); }
.hb-cta__box--accent .hb-btn--ghost { background: transparent; color: var(--hb-on-accent); border-color: currentColor; }`
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
  return { content: reuid(personalise(structuredClone(t.content), projectName.trim() || 'Acme')) as CmsBlock, style: { ...t.style } }
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
