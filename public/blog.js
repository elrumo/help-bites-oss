/* SPDX-License-Identifier: MIT
 * help-bites blog. MIT-licensed (see licenses/MIT.txt) so sites that embed it
 * carry no copyleft obligations; the rest of HelpBites is AGPL-3.0.
 *
 * Your blog inside your page: the posts, each opening in place with its
 * reactions, comments and a newsletter sign-up. Drawn here (no iframe), so it
 * takes your page's width and fonts:
 *
 *   <div id="blog"></div>
 *   <script src="https://support.example.com/blog.js" data-project="pk_…" data-target="#blog" defer></script>
 *
 * Render posts yourself (from GET /v1/blog) and want only what goes under
 * one? data-view="extras" data-post="the-slug". One post (or page) with all
 * of it: data-view="post" data-post="the-slug". A members-only post shows its
 * excerpt and a sign-in until the reader is a member; with data-body="#el"
 * the extras view puts the body into your #el once they are.
 *
 * Reading is open to everyone. To let your signed-in users react and comment,
 * hand it an identity token (the same one the chat uses):
 *
 *   <script>
 *     window.HelpBitesBlog = window.HelpBitesBlog || []
 *     HelpBitesBlog.push(['init', {
 *       getToken: () => fetch('/api/support/token').then(r => r.ok ? r.json() : null).then(r => r && r.token),
 *       onSignIn: () => openYourLoginModal()   // called when a signed-out reader tries to write
 *     }])
 *     HelpBitesBlog.push(['refresh'])           // after your user signs in or out
 *   </script>
 *
 * Without getToken, readers sign in with just their email when the project
 * allows email-only users (Project -> Settings); otherwise reading stays open
 * and writing is off.
 *
 * Options (data-* or init): project, target, view ('blog' | 'post' | 'extras'),
 * post, tag, q (a search), layout ('list' | 'grid' | 'magazine'; defaults to
 * the hosted blog's), body, limit (posts per page, default 10), theme ('system' | 'light' |
 * 'dark'; defaults to a dark/light class on your <html>), accent (defaults to
 * the project's), radius, font ('inherit' | 'system' | 'serif' | 'mono'),
 * show (which parts: 'cover,excerpt,tags,author,date,badges,search,reactions,comments,subscribe'),
 * deep-link-param ('post': the URL parameter an open post is kept in), host
 * (when you serve this file yourself), labels (init only: any of WORDS below).
 * Other calls: (['open', slug]), (['back']).
 *
 * Restyle it from your CSS with variables on .help-bites-blog
 * (--hb-blog-accent, -on-accent, -bg, -card, -text, -muted, -line, -radius,
 * -font, -width) or parts (::part(header), search, list, card, cover, title, meta,
 * excerpt, tag, badge, post, body, gate, reactions, reaction, comments, comment,
 * composer, button, subscribe). Every reader action is also a `helpbites:blog` event on
 * window ({ type: 'open' | 'react' | 'comment' | 'subscribe', slug }).
 * The data is GET /v1/blog?pk=… if you would rather draw your own.
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1] })()
  var attr = function (name) { return script.getAttribute('data-' + name) || '' }
  var origin = (attr('host') || new URL(script.src, location.href).origin).replace(/\/+$/, '')

  var options = {
    project: attr('project'),
    target: attr('target'),
    view: attr('view') || 'blog',
    post: attr('post'),
    tag: attr('tag'),
    q: attr('q'),
    layout: attr('layout'),
    body: attr('body'),
    limit: Number(attr('limit')) || 10,
    theme: attr('theme'),
    accent: attr('accent'),
    radius: attr('radius'),
    font: attr('font') || 'inherit',
    show: attr('show'),
    deepLinkParam: attr('deep-link-param') || 'post',
    labels: {},
    getToken: null,
    onSignIn: null
  }

  var FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
    serif: 'ui-serif, "Iowan Old Style", Georgia, serif',
    mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace'
  }
  var EMOJI = { 'heart': '❤️', '+1': '👍', 'hooray': '🎉', 'laugh': '😄', 'rocket': '🚀', 'eyes': '👀' }
  var REACTIONS = ['heart', '+1', 'hooray', 'laugh', 'rocket', 'eyes']
  var WORDS = {
    back: 'All posts', more: 'Older posts', empty: 'Nothing here yet.', minRead: 'min read', rss: 'RSS',
    comments: 'Comments', noComments: 'No comments yet.', write: 'Add a comment…', post: 'Comment', reply: 'Reply', cancel: 'Cancel',
    edit: 'Edit', save: 'Save', remove: 'Delete', removeConfirm: 'Delete your comment?', edited: 'edited', team: 'Team',
    closed: 'Comments are closed.', signIn: 'Sign in to comment', signInReact: 'Sign in to react',
    email: 'Your email', name: 'Your name (shown with your comments)', continue: 'Continue', code: 'The 6-digit code we emailed you', verify: 'Verify', signOut: 'Sign out',
    subscribeTitle: 'Get new posts by email', subscribe: 'Subscribe', subscribed: 'Check your inbox to confirm.', subscribedDone: 'You are subscribed.',
    error: 'Something went wrong. Try again.', notFound: 'This post is not available.',
    search: 'Search posts', noMatches: 'No posts match that.', featured: 'Featured', members: 'Members',
    membersTitle: 'This post is for members', membersText: 'Sign in with your email to read the rest.', membersOnly: 'Only members can read the rest.', readOn: 'Sign in to read'
  }
  var queue = window.HelpBitesBlog || []
  var host = null, root = null, mounted = false
  var state = { blog: null, posts: [], hasMore: false, slug: '', post: null, comments: [], project: null, token: null, auth: 'idle', authEmail: '', authError: '', composing: '', replyTo: '', editing: '', editText: '', busy: false, error: '', subscribe: '' }

  function word(key) { return options.labels[key] || WORDS[key] }
  function shows(part) { return !options.show || (',' + options.show + ',').indexOf(',' + part + ',') !== -1 }
  function emit(type, slug) { try { window.dispatchEvent(new CustomEvent('helpbites:blog', { detail: { type: type, slug: slug || '' } })) } catch (e) {} }
  function sessionKey() { return 'hb-blog-session:' + options.project }
  function stored() { try { return localStorage.getItem(sessionKey()) } catch (e) { return null } }
  function store(token) { try { token ? localStorage.setItem(sessionKey(), token) : localStorage.removeItem(sessionKey()) } catch (e) {} }

  function h(tag, attrs, children) {
    var el = document.createElement(tag)
    for (var k in (attrs || {})) {
      var v = attrs[k]
      if (v === null || v === undefined || v === false) continue
      if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v)
      else if (k === 'html') el.innerHTML = v // sanitised by HelpBites when it was saved
      else el.setAttribute(k, v === true ? '' : v)
    }
    ;[].concat(children || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c) })
    return el
  }

  function api(path, opts) {
    opts = opts || {}
    var sep = path.indexOf('?') === -1 ? '?' : '&'
    var url = origin + '/v1' + path + (state.token ? '' : sep + 'pk=' + encodeURIComponent(options.project))
    var headers = { 'Content-Type': 'application/json' }
    if (state.token) headers.Authorization = 'Bearer ' + state.token
    return fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (data) {
        if (r.ok) return data
        var err = new Error(data.statusMessage || data.message || word('error'))
        err.status = r.status
        err.code = data.data && data.data.code
        throw err
      })
    })
  }

  function theme() {
    if (options.theme) return options.theme
    var html = document.documentElement
    return html.classList.contains('dark') ? 'dark' : html.classList.contains('light') ? 'light' : 'system'
  }

  function css() {
    var accent = options.accent || (state.project && state.project.theme && state.project.theme.accent) || '#4f46e5'
    var dark = ':host { --hb-blog-bg: #111113; --hb-blog-card: #19191c; --hb-blog-text: #ececf0; --hb-blog-muted: #a2a2ad; --hb-blog-line: #2b2b31; }'
    var mode = theme()
    return ':host { all: initial; display: block; font-family: inherit; --hb-blog-accent: ' + accent + '; --hb-blog-on-accent: #fff; --hb-blog-bg: transparent; --hb-blog-card: #fff; --hb-blog-text: #1c1c21; --hb-blog-muted: #62626d; --hb-blog-line: #e6e6ea; --hb-blog-radius: ' + (options.radius ? options.radius + 'px' : '14px') + '; --hb-blog-font: ' + (FONTS[options.font] || 'inherit') + '; --hb-blog-width: 760px; }'
      + (mode === 'dark' ? dark : mode === 'system' ? '@media (prefers-color-scheme: dark) { ' + dark + ' }' : '')
      + '.wrap { max-width: var(--hb-blog-width); margin: 0 auto; color: var(--hb-blog-text); background: var(--hb-blog-bg); font-size: 16px; line-height: 1.65; font-family: var(--hb-blog-font); }'
      + '* { box-sizing: border-box; } a { color: var(--hb-blog-accent); }'
      + 'button { font: inherit; cursor: pointer; } button:disabled { opacity: .6; cursor: default; }'
      + '.btn { border: 0; border-radius: 999px; padding: 8px 16px; background: var(--hb-blog-accent); color: var(--hb-blog-on-accent); font-weight: 600; font-size: 14px; }'
      + '.quiet { background: none; border: 0; color: var(--hb-blog-muted); font-size: 14px; padding: 4px 6px; } .quiet:hover { color: var(--hb-blog-text); }'
      + '.head { margin: 0 0 24px; } .head h2 { font-size: 1.8em; line-height: 1.2; margin: 0 0 4px; letter-spacing: -0.02em; } .head p { margin: 0; color: var(--hb-blog-muted); }'
      + '.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }'
      + '.card { display: block; width: 100%; text-align: left; color: inherit; background: var(--hb-blog-card); border: 1px solid var(--hb-blog-line); border-radius: var(--hb-blog-radius); overflow: hidden; padding: 0; }'
      + '.card:hover { border-color: color-mix(in srgb, var(--hb-blog-accent) 45%, var(--hb-blog-line)); }'
      + '.cover { display: block; width: 100%; aspect-ratio: 2 / 1; object-fit: cover; background: var(--hb-blog-line); }'
      + '.card .in { padding: 18px 22px 20px; } .title { font-size: 1.25em; line-height: 1.3; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.01em; }'
      + '.meta { color: var(--hb-blog-muted); font-size: 14px; margin: 0; } .excerpt { margin: 8px 0 0; color: var(--hb-blog-muted); font-size: 15px; }'
      + '.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; } .tag { font-size: 13px; line-height: 1; padding: 6px 10px; border-radius: 999px; background: color-mix(in srgb, var(--hb-blog-accent) 10%, transparent); color: var(--hb-blog-accent); border: 0; }'
      + '.post { background: var(--hb-blog-card); border: 1px solid var(--hb-blog-line); border-radius: var(--hb-blog-radius); overflow: hidden; } .post .in { padding: 32px 36px 36px; }'
      + '.post h1 { font-size: 2em; line-height: 1.15; margin: 0 0 8px; letter-spacing: -0.02em; } .post .meta { margin-bottom: 24px; }'
      + '.body h2 { font-size: 1.4em; margin: 1.8em 0 .5em; } .body h3 { font-size: 1.2em; margin: 1.5em 0 .5em; } .body img { max-width: 100%; height: auto; border-radius: 10px; }'
      + '.body pre { background: color-mix(in srgb, var(--hb-blog-text) 6%, transparent); border-radius: 10px; padding: 14px; overflow-x: auto; font-size: 14px; } .body code { font-size: .9em; }'
      + '.body blockquote { margin: 0 0 1em; padding-left: 14px; border-left: 3px solid var(--hb-blog-accent); color: var(--hb-blog-muted); } .body table { border-collapse: collapse; width: 100%; } .body th, .body td { border: 1px solid var(--hb-blog-line); padding: 6px 8px; }'
      + '.reactions { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 0; } .reaction { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--hb-blog-line); background: var(--hb-blog-card); color: var(--hb-blog-text); border-radius: 999px; padding: 5px 12px; font-size: 14px; }'
      + '.reaction[aria-pressed="true"] { border-color: var(--hb-blog-accent); background: color-mix(in srgb, var(--hb-blog-accent) 12%, var(--hb-blog-card)); }'
      + '.box { margin-top: 24px; background: var(--hb-blog-card); border: 1px solid var(--hb-blog-line); border-radius: var(--hb-blog-radius); padding: 20px 22px; } .box h3 { margin: 0 0 12px; font-size: 1.1em; }'
      + '.comment { padding: 12px 0; border-top: 1px solid var(--hb-blog-line); } .comment:first-of-type { border-top: 0; } .comment.reply { margin-left: 28px; }'
      + '.who { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; } .who strong { font-weight: 600; } .badge { font-size: 11px; padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--hb-blog-accent) 14%, transparent); color: var(--hb-blog-accent); }'
      + '.cbody { margin: 4px 0 0; font-size: 15px; } .cbody p { margin: 4px 0; } .actions { display: flex; gap: 4px; margin-top: 2px; }'
      + 'textarea, input { width: 100%; font: inherit; font-size: 15px; color: inherit; background: transparent; border: 1px solid var(--hb-blog-line); border-radius: 10px; padding: 10px 12px; margin: 0 0 10px; } textarea { min-height: 84px; resize: vertical; }'
      + '.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .note { color: var(--hb-blog-muted); font-size: 14px; margin: 8px 0 0; } .err { color: #dc2626; font-size: 14px; margin: 8px 0 0; }'
      + '.hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }'
      + '.find { margin: 14px 0 0; } .find input { margin: 0; max-width: 320px; padding: 8px 14px; border-radius: 999px; }'
      + '.list.grid, .list.magazine { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); } .list.magazine > li:first-child { grid-column: 1 / -1; } .list.magazine > li:first-child .title { font-size: 1.6em; }'
      + '.list > li, .list .card { height: 100%; } .badges { display: flex; gap: 6px; margin: 0 0 6px; } .chip { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, var(--hb-blog-accent) 12%, transparent); color: var(--hb-blog-accent); }'
      + '.gate { text-align: center; } .gate h3 { margin-bottom: 4px; } .gate form, .gate > .btn { margin: 12px auto 0; max-width: 360px; }'
      + '@media (max-width: 640px) { .post .in { padding: 22px 18px 24px; } .post h1 { font-size: 1.6em; } }'
  }

  function when(iso) {
    try { return new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: 'long' }).format(new Date(iso)) } catch (e) { return '' }
  }

  function metaLine(post) {
    return [shows('date') && post.publishedAt ? when(post.publishedAt) : '', shows('author') ? post.authorName : '', post.readingMinutes + ' ' + word('minRead')].filter(Boolean).join(' · ')
  }

  function badges(post) {
    if (!shows('badges') || (!post.featured && !post.locked)) return null
    return h('div', { class: 'badges' }, [post.featured ? h('span', { class: 'chip', part: 'badge' }, word('featured')) : null, post.locked ? h('span', { class: 'chip', part: 'badge' }, word('members')) : null])
  }

  function tags(post) {
    if (!shows('tags') || !post.tags.length) return null
    return h('div', { class: 'tags' }, post.tags.map(function (tag) {
      // A tag filters the list, which only the full blog view has.
      if (options.view !== 'blog') return h('span', { class: 'tag', part: 'tag' }, tag)
      return h('button', { class: 'tag', part: 'tag', type: 'button', onclick: function (e) { e.stopPropagation(); options.tag = tag; back() } }, tag)
    }))
  }

  // ---- views ---------------------------------------------------------------

  function render() {
    if (!root) return
    var wrap = h('div', { class: 'wrap' })
    if (state.error) wrap.appendChild(h('p', { class: 'note' }, state.error))
    else if (state.slug) wrap.appendChild(postView())
    else if (state.blog) wrap.appendChild(listView())
    root.innerHTML = ''
    root.appendChild(h('style', {}, css()))
    root.appendChild(wrap)
  }

  function listView() {
    var b = state.blog
    var meta = []
    if (options.tag || options.q) meta.push((options.q ? '“' + options.q + '”' : '#' + options.tag) + ' · ', h('a', { href: '#', onclick: function (e) { e.preventDefault(); options.tag = ''; options.q = ''; load() } }, word('back')), ' · ')
    meta.push(h('a', { href: b.feedUrl, target: '_blank', rel: 'noopener' }, word('rss')))
    var find = shows('search') ? h('form', { class: 'find', part: 'search', role: 'search', onsubmit: function (e) { e.preventDefault(); options.q = e.target.elements.q.value.trim(); options.tag = ''; load() } }, h('input', { type: 'search', name: 'q', value: options.q || '', placeholder: word('search'), 'aria-label': word('search') })) : null
    var head = h('div', { class: 'head', part: 'header' }, [h('h2', {}, b.title), b.description ? h('p', {}, b.description) : null, h('p', { class: 'meta' }, meta), find])
    if (!state.posts.length) return h('div', {}, [head, h('p', { class: 'note' }, options.q ? word('noMatches') : word('empty'))])
    var layout = options.layout || b.layout || 'list'
    // The magazine's large first card is the front page's, not a search's.
    if (layout === 'magazine' && (options.q || options.tag)) layout = 'grid'
    var list = h('ul', { class: 'list ' + layout, part: 'list' }, state.posts.map(function (post) {
      return h('li', {}, h('button', { class: 'card', part: 'card', type: 'button', onclick: function () { open(post.slug, true) } }, [
        shows('cover') && post.coverImageUrl ? h('img', { class: 'cover', part: 'cover', src: post.coverImageUrl, alt: post.coverImageAlt || '', loading: 'lazy' }) : null,
        h('div', { class: 'in' }, [
          badges(post),
          h('p', { class: 'title', part: 'title' }, post.title),
          h('p', { class: 'meta', part: 'meta' }, metaLine(post)),
          shows('excerpt') && post.excerpt ? h('p', { class: 'excerpt', part: 'excerpt' }, post.excerpt) : null,
          tags(post)
        ])
      ]))
    }))
    var more = state.hasMore ? h('p', {}, h('button', { class: 'quiet', type: 'button', onclick: loadMore }, word('more') + ' →')) : null
    return h('div', {}, [head, list, more, subscribeView()])
  }

  function postView() {
    var post = state.post
    var top = options.view === 'blog' ? h('p', {}, h('button', { class: 'quiet', type: 'button', onclick: back }, '← ' + word('back'))) : null
    if (!post) return h('div', {}, [top, h('p', { class: 'note' }, state.busy ? '…' : word('notFound'))])
    var page = post.type === 'page'
    var article = options.view === 'extras' ? null : h('article', { class: 'post', part: 'post' }, [
      shows('cover') && post.coverImageUrl ? h('img', { class: 'cover', part: 'cover', src: post.coverImageUrl, alt: post.coverImageAlt || '' }) : null,
      h('div', { class: 'in' }, [
        h('h1', { part: 'title' }, post.title),
        page ? null : h('p', { class: 'meta', part: 'meta' }, metaLine(post)),
        post.locked
          ? h('div', { class: 'body', part: 'body' }, post.excerpt ? h('p', {}, post.excerpt) : null)
          : h('div', { class: 'body', part: 'body', html: post.bodyHtml || '' }),
        page ? null : tags(post)
      ])
    ])
    if (post.locked) return h('div', {}, [top, article, gateView()])
    return h('div', {}, [top, article, page ? null : reactionsView(), page ? null : commentsView(), page ? null : subscribeView()])
  }

  /** A members-only post the reader may not read yet: who can, and the way in. */
  function gateView() {
    var canSignIn = options.onSignIn || (state.project && state.project.allowAnonymousUsers)
    return h('section', { class: 'box gate', part: 'gate' }, [
      h('h3', {}, word('membersTitle')),
      h('p', { class: 'note' }, canSignIn ? word('membersText') : word('membersOnly')),
      canSignIn ? signInView('read') : null
    ])
  }

  /** The extras view under your own copy of a members-only post: the body, once the reader may read it. */
  function fillBody() {
    var el = options.body && state.post ? document.querySelector(options.body) : null
    if (!el) return
    // The page's own "for members" note is for readers without JavaScript; the sign-in drawn here replaces it.
    if (state.post.locked) { var note = el.querySelector('.gate'); if (note) note.remove(); return }
    if (state.post.bodyHtml) el.innerHTML = state.post.bodyHtml // sanitised by HelpBites when it was saved
  }

  function reactionsView() {
    var post = state.post
    if (!shows('reactions') || !state.blog.reactions) return null
    var have = {}
    post.reactions.forEach(function (r) { have[r.key] = r })
    return h('div', { class: 'reactions', part: 'reactions' }, REACTIONS.map(function (key) {
      var r = have[key] || { count: 0, reacted: false }
      return h('button', { class: 'reaction', part: 'reaction', type: 'button', 'aria-pressed': r.reacted ? 'true' : 'false', title: state.token ? '' : word('signInReact'), onclick: function () { react(key) } }, [EMOJI[key], r.count ? String(r.count) : null])
    }))
  }

  function commentsView() {
    var post = state.post
    if (!shows('comments') || !state.blog.comments) return null
    var items = threaded(state.comments).map(function (c) { return commentView(c) })
    var form = post.commentsOpen ? composer('', state.composing, function (text) { state.composing = text }) : h('p', { class: 'note' }, word('closed'))
    return h('section', { class: 'box', part: 'comments' }, [
      h('h3', {}, word('comments') + (post.commentCount ? ' (' + post.commentCount + ')' : '')),
      items.length ? h('div', {}, items) : h('p', { class: 'note' }, word('noComments')),
      form
    ])
  }

  function threaded(list) {
    var ids = {}
    list.forEach(function (c) { ids[c.id] = true })
    var out = []
    list.filter(function (c) { return !c.parentId || !ids[c.parentId] }).forEach(function (c) {
      out.push(c)
      list.forEach(function (r) { if (r.parentId === c.id) out.push(r) })
    })
    return out
  }

  function commentView(c) {
    var mine = c.viewerIsAuthor
    var body = state.editing === c.id
      ? h('form', { onsubmit: function (e) { e.preventDefault(); saveEdit(c) } }, [h('textarea', { oninput: function (e) { state.editText = e.target.value } }, state.editText), h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'submit', disabled: state.busy }, word('save')), h('button', { class: 'quiet', type: 'button', onclick: function () { state.editing = ''; render() } }, word('cancel'))])])
      : h('div', { class: 'cbody', html: c.bodyHtml })
    var actions = h('div', { class: 'actions' }, [
      state.post.commentsOpen && !c.parentId ? h('button', { class: 'quiet', type: 'button', onclick: function () { state.replyTo = state.replyTo === c.id ? '' : c.id; render() } }, word('reply')) : null,
      mine && state.editing !== c.id ? h('button', { class: 'quiet', type: 'button', onclick: function () { state.editing = c.id; state.editText = c.body; render() } }, word('edit')) : null,
      mine ? h('button', { class: 'quiet', type: 'button', onclick: function () { remove(c) } }, word('remove')) : null
    ])
    return h('div', { class: 'comment' + (c.parentId ? ' reply' : ''), part: 'comment' }, [
      h('div', { class: 'who' }, [h('strong', {}, c.authorName), c.authorIsStaff ? h('span', { class: 'badge' }, word('team')) : null, h('span', { class: 'meta' }, when(c.createdAt) + (c.editedAt ? ' · ' + word('edited') : ''))]),
      body,
      actions,
      state.replyTo === c.id ? composer(c.id, '', null) : null
    ])
  }

  /** Guests may comment: the project opened it, and the page has no sign-in of its own. */
  function guestComments() {
    return !options.onSignIn && !options.getToken && state.project && state.project.guestSurfaces && state.project.guestSurfaces.indexOf('comments') !== -1
  }

  /** The reader's guest session, made on their first comment or reaction (never on load). */
  function ensureGuest() {
    if (state.token) return Promise.resolve(true)
    if (!guestComments()) return Promise.resolve(false)
    return api('/anonymous/guest', { method: 'POST', body: { pk: options.project } }).then(function (r) {
      state.token = r.token
      store(r.token)
      return true
    }, function (e) { state.authError = e.message; render(); return false })
  }

  function composer(parentId, text, onText) {
    if (!state.token && !guestComments()) return signInView()
    var area = h('textarea', { placeholder: word('write'), oninput: function (e) { if (onText) onText(e.target.value) } }, text)
    return h('form', { part: 'composer', onsubmit: function (e) { e.preventDefault(); comment(parentId, area.value, area) } }, [
      area,
      h('div', { class: 'row' }, [
        h('button', { class: 'btn', part: 'button', type: 'submit', disabled: state.busy }, parentId ? word('reply') : word('post')),
        parentId ? h('button', { class: 'quiet', type: 'button', onclick: function () { state.replyTo = ''; render() } }, word('cancel')) : null,
        !parentId && !options.getToken ? h('button', { class: 'quiet', type: 'button', onclick: signOut }, word('signOut')) : null
      ]),
      state.authError ? h('p', { class: 'err' }, state.authError) : null
    ])
  }

  function signInView(reason) {
    var label = reason === 'read' ? word('readOn') : word('signIn')
    var emailOnly = !options.onSignIn && state.project && state.project.allowAnonymousUsers
    if (!emailOnly) return options.onSignIn ? h('button', { class: 'btn', part: 'button', type: 'button', onclick: function () { options.onSignIn(reason || 'comment') } }, label) : null
    if (state.auth === 'code') {
      var code = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: word('code') })
      return h('form', { onsubmit: function (e) { e.preventDefault(); confirmCode(code.value) } }, [code, h('button', { class: 'btn', type: 'submit', disabled: state.busy }, word('verify')), state.authError ? h('p', { class: 'err' }, state.authError) : null])
    }
    if (state.auth !== 'email') return h('button', { class: 'btn', part: 'button', type: 'button', onclick: function () { state.auth = 'email'; render() } }, label)
    var email = h('input', { type: 'email', autocomplete: 'email', placeholder: word('email'), required: true })
    var name = h('input', { type: 'text', autocomplete: 'name', placeholder: word('name') })
    return h('form', { onsubmit: function (e) { e.preventDefault(); startSession(email.value, name.value) } }, [email, name, h('button', { class: 'btn', type: 'submit', disabled: state.busy }, word('continue')), state.authError ? h('p', { class: 'err' }, state.authError) : null])
  }

  function subscribeView() {
    if (!shows('subscribe') || !state.blog.subscribeForm) return null
    if (state.subscribe === 'pending' || state.subscribe === 'done') return h('section', { class: 'box', part: 'subscribe' }, h('p', { class: 'note' }, state.subscribe === 'done' ? word('subscribedDone') : word('subscribed')))
    var email = h('input', { type: 'email', autocomplete: 'email', placeholder: word('email'), required: true })
    var trap = h('input', { class: 'hp', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' })
    return h('section', { class: 'box', part: 'subscribe' }, [
      h('h3', {}, word('subscribeTitle')),
      h('form', { onsubmit: function (e) { e.preventDefault(); subscribe(email.value, trap.value) } }, [email, trap, h('button', { class: 'btn', part: 'button', type: 'submit', disabled: state.busy }, word('subscribe'))]),
      state.subscribe && state.subscribe !== 'pending' ? h('p', { class: 'err' }, state.subscribe) : null
    ])
  }

  // ---- actions -------------------------------------------------------------

  function busy(promise) {
    state.busy = true
    render()
    return promise.then(function (v) { state.busy = false; render(); return v }, function (e) { state.busy = false; render(); throw e })
  }

  function needsSignIn(e) {
    if (e.code === 'email_verification_required' && state.project && state.project.allowAnonymousUsers && state.authEmail) {
      state.auth = 'code'
      return api('/anonymous/verify', { method: 'POST', body: { pk: options.project, email: state.authEmail } }).then(render, render)
    }
    if (e.status === 401) { state.token = null; store(null) }
    state.authError = e.message
    render()
  }

  function react(key) {
    if (!state.token) {
      if (guestComments()) return ensureGuest().then(function (ok) { if (ok) react(key) })
      if (options.onSignIn) return options.onSignIn('react')
      state.auth = 'email'
      return render()
    }
    api('/blog/' + encodeURIComponent(state.slug) + '/reactions', { method: 'POST', body: { reaction: key } }).then(function (r) {
      state.post.reactions = r.reactions
      emit('react', state.slug)
      render()
    }, needsSignIn)
  }

  function comment(parentId, text, area) {
    if (!text.trim()) return
    state.authError = ''
    ensureGuest().then(function (ok) { return ok ? send() : render() })
    function send() {
      busy(api('/blog/' + encodeURIComponent(state.slug) + '/comments', { method: 'POST', body: { body: text, parentId: parentId || undefined } })).then(function (r) {
        state.comments.push(r.comment)
        state.post.commentCount = r.commentCount
        if (parentId) state.replyTo = ''
        else state.composing = ''
        if (area) area.value = ''
        emit('comment', state.slug)
        render()
      }, needsSignIn)
    }
  }

  function saveEdit(c) {
    busy(api('/blog/comments/' + c.id, { method: 'PATCH', body: { body: state.editText } })).then(function (r) {
      state.comments = state.comments.map(function (x) { return x.id === c.id ? r.comment : x })
      state.editing = ''
      render()
    }, needsSignIn)
  }

  function remove(c) {
    if (!confirm(word('removeConfirm'))) return
    busy(api('/blog/comments/' + c.id, { method: 'DELETE' })).then(function (r) {
      state.comments = state.comments.filter(function (x) { return x.id !== c.id })
      state.post.commentCount = r.commentCount
      render()
    }, needsSignIn)
  }

  function startSession(email, name) {
    state.authEmail = email.trim()
    state.authError = ''
    busy(api('/anonymous/session', { method: 'POST', body: { pk: options.project, email: state.authEmail, name: name.trim() } })).then(function (r) {
      if (r.status !== 'token') { state.auth = 'code'; return render() }
      state.token = r.token
      store(r.token)
      state.auth = 'idle'
      if (!state.post || !state.post.locked) return render()
      // Members read once they confirm the address: send the code.
      return loadPost(state.slug).then(function () {
        if (state.post && state.post.locked) return needsSignIn({ code: 'email_verification_required' })
      })
    }, function (e) { state.authError = e.message; render() })
  }

  function confirmCode(code) {
    state.authError = ''
    busy(api('/anonymous/verify/confirm', { method: 'POST', body: { pk: options.project, email: state.authEmail, code: code.trim() } })).then(function (r) {
      state.token = r.token
      store(r.token)
      state.auth = 'idle'
      return loadPost(state.slug)
    }, function (e) { state.authError = e.message; render() })
  }

  function signOut() {
    state.token = null
    store(null)
    state.auth = 'idle'
    loadPost(state.slug)
  }

  function subscribe(email, website) {
    busy(api('/subscribe', { method: 'POST', body: { pk: options.project, email: email, website: website } })).then(function (r) {
      state.subscribe = r.pending ? 'pending' : 'done'
      emit('subscribe', state.slug)
      render()
    }, function (e) { state.subscribe = e.message; render() })
  }

  // ---- loading and navigation ----------------------------------------------

  function filters() {
    return (options.tag ? '&tag=' + encodeURIComponent(options.tag) : '') + (options.q ? '&q=' + encodeURIComponent(options.q) : '')
  }

  function load() {
    state.slug = ''
    return api('/blog?limit=' + options.limit + filters()).then(function (blog) {
      state.blog = blog
      state.posts = blog.posts
      state.hasMore = blog.hasMore
      state.error = ''
      render()
    }, function (e) { state.error = e.status === 404 ? word('notFound') : word('error'); render() })
  }

  function loadMore() {
    api('/blog?limit=' + options.limit + '&skip=' + state.posts.length + filters()).then(function (blog) {
      state.posts = state.posts.concat(blog.posts)
      state.hasMore = blog.hasMore
      render()
    })
  }

  function loadPost(slug) {
    state.slug = slug
    state.post = null
    state.comments = []
    state.busy = true
    render()
    var meta = state.blog ? Promise.resolve(state.blog) : api('/blog?limit=1')
    return Promise.all([meta, api('/blog/' + encodeURIComponent(slug))]).then(function (all) {
      state.blog = all[0]
      state.post = all[1].post
      // A members-only post's thread opens with its body; a page has none.
      var thread = state.post.locked || state.post.type === 'page' ? Promise.resolve({ comments: [] }) : api('/blog/' + encodeURIComponent(slug) + '/comments?limit=100').catch(function () { return { comments: [] } })
      return thread.then(function (page) {
        state.comments = page.comments
        state.busy = false
        fillBody()
        render()
      })
    }, function () { state.busy = false; render() })
  }

  function syncUrl(slug, push) {
    if (options.view !== 'blog' || !history.pushState) return
    try {
      var url = new URL(location.href)
      if (slug) url.searchParams.set(options.deepLinkParam, slug)
      else url.searchParams.delete(options.deepLinkParam)
      if (url.href !== location.href) history[push ? 'pushState' : 'replaceState']({ hbBlog: slug }, '', url.href)
    } catch (e) {}
  }

  function open(slug, push) {
    syncUrl(slug, push)
    emit('open', slug)
    loadPost(slug).then(function () { if (host.getBoundingClientRect().top < 0) host.scrollIntoView({ block: 'start' }) })
  }

  function back() {
    syncUrl('', true)
    load()
  }

  function token() {
    var pending = options.getToken ? Promise.resolve().then(options.getToken).catch(function (e) { console.warn('[help-bites] getToken failed', e); return null }) : Promise.resolve(stored())
    return pending.then(function (t) { state.token = typeof t === 'string' && t ? t : null })
  }

  function mount() {
    if (mounted) return
    if (!options.project) return console.warn('[help-bites] blog.js needs data-project="pk_…"')
    var target = typeof options.target === 'string' ? (options.target ? document.querySelector(options.target) : null) : options.target
    if (!target) {
      // No target: draw it where the script tag is.
      target = document.createElement('div')
      script.parentNode.insertBefore(target, script)
    }
    mounted = true
    host = document.createElement('div')
    host.className = 'help-bites-blog'
    target.appendChild(host)
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
    var linked = ''
    try { linked = new URL(location.href).searchParams.get(options.deepLinkParam) || '' } catch (e) {}
    var first = options.view === 'blog' ? linked : options.post
    Promise.all([token(), fetch(origin + '/v1/projects/' + encodeURIComponent(options.project) + '/public').then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null })]).then(function (all) {
      state.project = all[1]
      if (first) loadPost(first)
      else if (options.view === 'blog') load()
      else { state.error = word('notFound'); render() }
    })
    window.addEventListener('popstate', function () {
      if (options.view !== 'blog') return
      var slug = ''
      try { slug = new URL(location.href).searchParams.get(options.deepLinkParam) || '' } catch (e) {}
      if (slug) loadPost(slug)
      else load()
    })
  }

  function handle(cmd) {
    var name = cmd[0], arg = cmd[1]
    if (name === 'init') {
      var init = arg || {}
      for (var key in init) if (init[key] !== undefined) options[key] = key === 'labels' ? Object.assign({}, options.labels, init[key]) : init[key]
      if (!options.project && init.projectKey) options.project = init.projectKey
      if (mounted) token().then(function () { state.slug ? loadPost(state.slug) : render() })
      else mount()
    }
    if (name === 'refresh' && mounted) token().then(function () { state.slug ? loadPost(state.slug) : load() })
    if (name === 'open' && typeof arg === 'string') { mount(); open(arg, true) }
    if (name === 'back' && mounted) back()
  }

  window.HelpBitesBlog = { push: function (cmd) { handle(cmd) } }
  for (var i = 0; i < queue.length; i++) handle(queue[i])
  // A bare <script data-project> with no init call still renders the blog.
  if (!mounted) setTimeout(function () { if (!mounted) mount() }, 0)
})()
