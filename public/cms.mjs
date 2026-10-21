/* SPDX-License-Identifier: MIT
 * help-bites CMS client for your own site. MIT-licensed (see licenses/MIT.txt)
 * so it can live in any codebase; the rest of HelpBites is AGPL-3.0. No
 * dependencies: copy this file into your project, or import it by URL.
 *
 *   import { createClient, editable, bridge } from 'https://support.example.com/cms.mjs'
 *
 *   const cms = createClient({ host: 'https://support.example.com', pk: 'pk_…' })
 *   const { entry } = await cms.getEntry('home')                 // published content, as JSON
 *   const { entries } = await cms.getEntries({ type: 'post', startsWith: 'blog/' })
 *   const { html, css } = await cms.getEntry('home', { format: 'html' })   // rendered with your components
 *
 * Each block is { _uid, component, ...fields }; render it with your own
 * components, and spread editable(block) on its outer element so the editor's
 * "Your site" preview can select it.
 *
 * Live editing: call bridge() on the page your preview URL opens. Inside the
 * HelpBites editor it hands you the unsaved draft on every edit (onChange) and
 * which block was picked (onSelect); anywhere else it does nothing.
 *
 *   bridge({ host: 'https://support.example.com', onChange: entry => { page.value = entry } })
 */

const SOURCE = 'help-bites-cms'

/** A client for the delivery API: published entries only, no secret needed. */
export function createClient({ host, pk, fetch: fetcher = globalThis.fetch }) {
  if (!host || !pk) throw new Error('createClient needs { host, pk }')
  const base = `${String(host).replace(/\/+$/, '')}/v1/cms/${encodeURIComponent(pk)}`
  async function get(path, query) {
    const qs = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
    const res = await fetcher(`${base}${path}${qs ? `?${qs}` : ''}`, { headers: { accept: 'application/json' } })
    if (!res.ok) {
      const error = new Error(`HelpBites CMS: ${res.status} ${res.statusText}`)
      error.status = res.status
      throw error
    }
    return res.json()
  }
  return {
    /** One published entry by slug (`home`, `pricing`, `blog/hello`). `format: 'html'` adds { html, css }. */
    getEntry: (slug, { format } = {}) => get(`/entries/${String(slug || 'home').replace(/^\/+|\/+$/g, '').split('/').map(encodeURIComponent).join('/')}`, { format }),
    /** Published entries, newest first: { entries, total, page, perPage }. */
    getEntries: ({ type, startsWith, page, perPage } = {}) => get('/entries', { type, starts_with: startsWith, page, per_page: perPage })
  }
}

/** Attributes for a block's outer element: the editor's "Your site" preview selects by them. */
export function editable(block) {
  return block && block._uid ? { 'data-hb-uid': block._uid, 'data-hb-component': block.component } : {}
}

/**
 * Talks to the HelpBites editor when this page is open in its "Your site"
 * preview: receives the draft entry on every edit, reports clicks on blocks
 * (elements with editable()'s attributes) and outlines the selected one.
 * Returns a function that stops it. Does nothing outside the editor.
 */
export function bridge({ host, onChange, onSelect } = {}) {
  if (typeof window === 'undefined' || window.parent === window || !host) return () => {}
  const origin = new URL(host).origin
  const send = msg => window.parent.postMessage({ source: SOURCE, ...msg }, origin)
  const style = document.createElement('style')
  style.textContent = '[data-hb-uid]{cursor:pointer}[data-hb-uid]:hover:not(:has([data-hb-uid]:hover)){outline:1px dashed rgba(99,102,241,.75);outline-offset:-1px}[data-hb-uid][data-hb-selected]{outline:2px solid #6366f1!important;outline-offset:-2px}'
  document.head.appendChild(style)

  function select(id, reveal) {
    document.querySelectorAll('[data-hb-uid]').forEach((el) => {
      const on = el.getAttribute('data-hb-uid') === id
      el.toggleAttribute('data-hb-selected', on)
      if (on && reveal) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }
  function onMessage(event) {
    const d = event.data
    if (event.source !== window.parent || event.origin !== origin || !d || d.source !== SOURCE) return
    if (d.type === 'entry' && d.entry && onChange) onChange(d.entry)
    if (d.type === 'selected') {
      select(d.id, true)
      if (onSelect) onSelect(d.id || null)
    }
  }
  function onClick(event) {
    const el = event.target.closest && event.target.closest('[data-hb-uid]')
    if (!el) return
    event.preventDefault()
    const id = el.getAttribute('data-hb-uid')
    select(id, false)
    send({ type: 'select', id })
  }
  window.addEventListener('message', onMessage)
  document.addEventListener('click', onClick, true)
  send({ type: 'ready', version: 1 })
  return () => {
    window.removeEventListener('message', onMessage)
    document.removeEventListener('click', onClick, true)
    style.remove()
  }
}
