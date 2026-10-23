/* SPDX-License-Identifier: MIT
 * help-bites server-side helper. MIT-licensed (see licenses/MIT.txt) so it can
 * live in any codebase; the rest of HelpBites is AGPL-3.0. No dependencies, any
 * runtime with fetch (Node 18+, Bun, Deno, edge): copy this file into your
 * project, or import it by URL.
 *
 *   import { createHelpBites } from './ssr.mjs'
 *   const hb = createHelpBites({ host: 'https://support.example.com', pk: 'pk_…', budget: 300 })
 *
 * Read the API while rendering a page. Each call answers within `budget` ms:
 *
 *   const { data, source } = await hb.roadmap()
 *   // data   the response, or null when there is none yet
 *   // source 'cache'   fresh in memory, no request made
 *   //        'stale'   older than `ttl`: answered from memory and refreshed behind your back
 *   //        'live'    HelpBites answered within the budget
 *   //        'late'    it did not: draw a skeleton and fetch in the browser; the request keeps
 *   //                  going here, so the next visit is 'cache'
 *   //        'error'   it failed (`status` says how) and nothing is cached
 *
 * The plug & play scripts, server-rendered. embed() returns the container with
 * a snapshot of the content inside (changelog, roadmap) or a skeleton, plus
 * the script tag. The script keeps what is there until its frame has loaded,
 * then swaps it, so nothing jumps and a crawler sees the content.
 *
 *   const { html } = await hb.embed('changelog', { scriptSrc: '/hb/changelog.js' })
 *
 * Kinds: 'changelog', 'roadmap' (feedback.js, roadmap only), 'feedback' (the
 * board) and 'chat' (widget.js, inline). A framework that adds the script
 * itself takes `inner` (the container's content) and `attrs` (its data-*).
 *
 * Self-host and cache the script. script() fetches a file of HelpBites's
 * (widget.js, feedback.js, changelog.js, …) once and keeps it, so serve it
 * from your own route with its `body`; scripts read `data-host` for where the
 * API is, which embed() sets.
 *
 * `store` is { get(key), set(key, entry) }, sync or async: pass your Redis or
 * KV to share the cache between servers. The default is a small in-memory map.
 * Everything here swallows failures: HelpBites being down never breaks a page.
 * The HTML from the API (a changelog entry's body, a legal document) is
 * sanitised by HelpBites; the helper inserts it as it is.
 */

const DAY = 86_400_000
const FILES = { changelog: 'changelog.js', roadmap: 'feedback.js', feedback: 'feedback.js', chat: 'widget.js' }

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** The default cache: insertion-ordered, oldest out first. */
export function memoryStore(max = 200) {
  const map = new Map()
  return {
    get: key => map.get(key),
    set(key, entry) {
      map.delete(key)
      map.set(key, entry)
      if (map.size > max) map.delete(map.keys().next().value)
    }
  }
}

/** The styles of skeletons and snapshots. Low specificity (:where), so your CSS wins; colours follow the text. */
export const css = [
  ':where(.hb-ssr){--hb-ssr-line:color-mix(in srgb,currentColor 14%,transparent);--hb-ssr-muted:color-mix(in srgb,currentColor 62%,transparent);--hb-ssr-radius:10px}',
  ':where(.hb-ssr) :where(article,section.hb-stage li){border:1px solid var(--hb-ssr-line);border-radius:var(--hb-ssr-radius);padding:16px;margin:0 0 12px;list-style:none}',
  ':where(.hb-ssr) :where(h3,h4){margin:0 0 4px}',
  ':where(.hb-ssr) :where(time,.hb-tag,.hb-votes){font-size:12px;color:var(--hb-ssr-muted)}',
  ':where(.hb-ssr) .hb-tag{margin-left:8px;text-transform:capitalize}',
  ':where(.hb-ssr) ul.hb-items{padding:0;margin:0}',
  '.hb-sk i{display:block;height:84px;margin:0 0 12px;border-radius:var(--hb-ssr-radius);background:var(--hb-ssr-line);animation:hb-pulse 1.4s ease-in-out infinite}',
  '.hb-sk.hb-sk-chat i{height:420px}',
  '@keyframes hb-pulse{50%{opacity:.45}}',
  '@media (prefers-reduced-motion:reduce){.hb-sk i{animation:none}}',
  '.hb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}'
].join('')

/** What stands in for content that is not here yet. The plug & play scripts replace it. */
export function skeleton(kind = 'changelog') {
  const bars = kind === 'chat' ? '<i></i>' : '<i></i><i></i><i></i>'
  return `<div class="hb-ssr hb-sk hb-sk-${esc(kind)}" data-hb-ssr="pending" role="status" aria-busy="true"><span class="hb-sr">Loading…</span>${bars}</div>`
}

const day = iso => (iso ? `<time datetime="${esc(iso)}">${esc(String(iso).slice(0, 10))}</time>` : '')

/** GET /v1/changelog as HTML: releases and loose entries, newest first. */
export function renderChangelog(data) {
  const entry = e => `<article><h4>${esc(e.title)}</h4>${day(e.publishedAt)}<span class="hb-tag">${esc(e.tag)}</span><div class="hb-body">${typeof e.bodyHtml === 'string' ? e.bodyHtml : `<p>${esc(e.summary || e.excerpt)}</p>`}</div></article>`
  const items = [
    ...(data.releases || []).map(r => ({ at: r.publishedAt, html: `<section class="hb-release"><h3>${esc(r.version)}${r.title ? ` · ${esc(r.title)}` : ''}</h3>${day(r.publishedAt)}${r.summary ? `<p>${esc(r.summary)}</p>` : ''}${(r.entries || []).map(entry).join('')}</section>` })),
    ...(data.entries || []).map(e => ({ at: e.publishedAt, html: entry(e) }))
  ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  return `<div class="hb-ssr" data-hb-ssr="ready">${items.map(i => i.html).join('')}</div>`
}

/** GET /v1/feedback/roadmap as HTML: one list per status that has items, in the board's order. */
export function renderRoadmap(data) {
  const stages = (data.statuses || []).map(s => ({ s, items: (data.items || []).filter(i => i.status === s.key) })).filter(x => x.items.length)
  const item = i => `<li><h4>${esc(i.title)}</h4>${i.description ? `<p>${esc(i.description)}</p>` : ''}${i.voteCount ? `<span class="hb-votes">${esc(i.voteCount)} votes</span>` : ''}</li>`
  return `<div class="hb-ssr" data-hb-ssr="ready">${stages.map(({ s, items }) => `<section class="hb-stage"><h3>${esc(s.label)}</h3><ul class="hb-items">${items.map(item).join('')}</ul></section>`).join('')}</div>`
}

/** A snapshot of `kind`'s content, or null when it has none to draw (the board and the chat are only frames). */
export function render(kind, data) {
  if (!data) return null
  return kind === 'changelog' ? renderChangelog(data) : kind === 'roadmap' ? renderRoadmap(data) : null
}

export function createHelpBites({ host, pk, budget = 300, ttl = 60_000, stale = DAY, timeout = 8_000, store = memoryStore(), fetch: fetcher = globalThis.fetch } = {}) {
  if (!host || !pk) throw new Error('createHelpBites needs { host, pk }')
  host = String(host).replace(/\/+$/, '')
  const inflight = new Map()

  // One request per address at a time; it never rejects, and a good answer lands in the store even
  // when the caller has stopped waiting.
  function refresh(url, as) {
    if (inflight.has(url)) return inflight.get(url)
    const run = (async () => {
      try {
        const res = await fetcher(url, { headers: { accept: as === 'json' ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(timeout) })
        if (!res.ok) return { data: null, source: 'error', status: res.status }
        const data = as === 'json' ? await res.json() : await res.text()
        try { await store.set(url, { at: Date.now(), data }) } catch { /* a broken cache is a miss */ }
        return { data, source: 'live' }
      } catch {
        return { data: null, source: 'error', status: 0 }
      }
    })().finally(() => inflight.delete(url))
    inflight.set(url, run)
    return run
  }

  async function read(url, as, wait) {
    let hit
    try { hit = await store.get(url) } catch { /* miss */ }
    const age = hit ? Date.now() - hit.at : Infinity
    if (hit && age < ttl) return { data: hit.data, source: 'cache' }
    const live = refresh(url, as)
    if (hit && age < stale) return { data: hit.data, source: 'stale' }
    let timer
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ data: null, source: 'late' }), wait) })
    try { return await Promise.race([live, late]) } finally { clearTimeout(timer) }
  }

  const address = (path, query) => {
    const qs = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
    return `${host}${path}${qs ? `?${qs}` : ''}`
  }
  /** Any public GET of the API: `{ query, budget }`. */
  const get = (path, { query, budget: wait = budget } = {}) => read(address(path, query), 'json', wait)

  const changelog = (query, o) => get('/v1/changelog', { ...o, query: { pk, ...query } })
  const roadmap = o => get('/v1/feedback/roadmap', { ...o, query: { pk } })

  async function embed(kind, { id = `hb-${kind}`, scriptSrc, attrs = {}, budget: wait } = {}) {
    const file = FILES[kind]
    if (!file) throw new Error(`embed kind must be one of ${Object.keys(FILES).join(', ')}`)
    const result = kind === 'changelog' ? await changelog(undefined, { budget: wait }) : kind === 'roadmap' ? await roadmap({ budget: wait }) : { data: null, source: 'late' }
    const snapshot = render(kind, result.data)
    const inner = snapshot || skeleton(kind)
    const data = { project: pk, host, target: `#${id}`, ...(kind === 'roadmap' ? { view: 'roadmap', only: 'roadmap' } : {}), ...(kind === 'chat' ? { mode: 'inline' } : {}), ...attrs }
    const tag = `<script src="${esc(scriptSrc || `${host}/${file}`)}" ${Object.entries(data).map(([k, v]) => `data-${esc(k)}="${esc(v)}"`).join(' ')} defer></script>`
    return { html: `<style>${css}</style><div id="${esc(id)}">${inner}</div>${tag}`, inner, attrs: data, source: result.source, ssr: snapshot ? 'ready' : 'pending' }
  }

  /** A public legal document ({ title, html, … }); `data` is the document itself. */
  async function legal(slug, o) {
    const r = await get(`/v1/legal/${encodeURIComponent(pk)}/${encodeURIComponent(slug)}`, o)
    return { ...r, data: r.data ? r.data.document : null }
  }

  /** One of HelpBites's scripts (`widget.js`), kept for `ttl`. `body` is null when it cannot be had. */
  async function script(file) {
    if (!/^[a-z][a-z0-9-]*\.m?js$/.test(file)) return { body: null, source: 'error', status: 404 }
    const r = await read(`${host}/${file}`, 'text', timeout)
    return { ...r, body: r.data }
  }

  return { host, pk, get, changelog, roadmap, legal, loader: o => get(`/v1/hub/${encodeURIComponent(pk)}/loader`, o), embed, script }
}
