# Server rendering and caching

HelpBites's public reads and drop-in scripts work with a server-rendered site. `ssr.mjs` is a small helper
(MIT, no dependencies, any runtime with `fetch`) that your server uses to:

- **Render on the server when HelpBites answers fast, and hand over to the browser when it doesn't.** Every read has a
  time budget (300 ms by default). Inside it the page ships with the content. Past it the page ships with a skeleton,
  the request keeps going so the next visit is served from memory, and the browser loads the data itself.
- **Show the last answer first and refresh it behind it.** Answers are kept in memory (or your Redis). Once older than
  `ttl` they are still served at once while a fresh one is fetched.
- **Server-render the plug and play scripts.** `changelog.js`, `feedback.js` and `widget.js` land in a container that
  already holds a snapshot of the content (changelog, roadmap) or a skeleton; the script keeps it on screen until its
  frame is ready, then swaps it, so nothing jumps and a crawler sees the text.
- **Self-host and cache the scripts.** Serve `widget.js` and the others from your own domain, kept on your server, so
  a page never waits on HelpBites for code.

Only public reads go through it (no secret, no identity token), so what is cached is the same for everyone.

Get it from your HelpBites, and copy it into your project:

```bash
curl -o server/lib/helpbites-ssr.mjs https://support.example.com/ssr.mjs
```

```js
import { createHelpBites } from './helpbites-ssr.mjs'

export const hb = createHelpBites({ host: 'https://support.example.com', pk: 'pk_…' })
```

## Reading the API while you render

```js
const { data, source } = await hb.roadmap()      // GET /v1/feedback/roadmap?pk=…
```

`source` says where `data` came from:

| `source` | Meaning |
|---|---|
| `cache` | Fresh in memory. No request was made. |
| `stale` | Older than `ttl`: answered from memory, refreshed in the background. |
| `live` | HelpBites answered inside the budget. |
| `late` | It did not. `data` is `null`: draw a skeleton and fetch in the browser. The request goes on, so the next visit is `cache`. |
| `error` | The request failed (`status` has the HTTP status, `0` for a network error) and nothing is cached. |

Ready-made reads: `hb.changelog(query?)` (`GET /v1/changelog`, so `{ flat: 1, limit: 5 }` works), `hb.roadmap()`,
`hb.legal(slug)` (`data` is the document: `title`, `html`, `markdown`…), `hb.loader()` (`GET /v1/hub/{pk}/loader`) and
`hb.get('/v1/…', { query, budget })` for any other public GET. Each takes a `budget` of its own in its last argument.

A page that loads the data in the browser when the server was late (Nuxt; the same shape works anywhere):

```ts
// server/api/roadmap.get.ts
export default defineEventHandler(async (event) => {
  const within = Number(getQuery(event).within) || 15_000
  const { data } = await hb.roadmap({ budget: within })
  return data   // null: the page is told to ask again
})
```

```vue
<script setup lang="ts">
// On the server ask with a short budget; in the browser, wait as long as it takes.
const { data, refresh } = await useFetch('/api/roadmap', { query: import.meta.server ? { within: 300 } : {} })
onMounted(() => { if (!data.value) refresh() })
</script>

<template>
  <RoadmapBoard v-if="data" :roadmap="data" />
  <USkeleton v-else class="h-64 w-full" />
</template>
```

If the browser can reach HelpBites directly it can skip your server on that second request: the API sends
`Access-Control-Allow-Origin: *`. Do not let a page that is cached as a whole (an `swr` route rule, a CDN) keep the
skeleton version: either do not cache it, or let the cached copy be the one that has data.

## The plug and play scripts, server-rendered

```js
const { html, source } = await hb.embed('changelog', { scriptSrc: '/hb/changelog.js' })
// <style>…</style><div id="hb-changelog">…snapshot or skeleton…</div><script src="/hb/changelog.js" data-project="pk_…" data-host="https://support.example.com" data-target="#hb-changelog" defer></script>
```

| Kind | Script | Server-rendered |
|---|---|---|
| `changelog` | `changelog.js` | A snapshot: releases and entries, newest first. |
| `roadmap` | `feedback.js` (`data-view="roadmap" data-only="roadmap"`) | A snapshot: one list per status that has items. |
| `feedback` | `feedback.js` | A skeleton (the board is interactive; the script draws it). |
| `chat` | `widget.js` (`data-mode="inline"`) | A skeleton. |

Put `html` in your page as it is. A framework that adds scripts itself (Vue, React) takes the parts instead: `inner` is
the container's content, `attrs` the script's `data-*` attributes, and `ssr` is `'ready'` for a snapshot or `'pending'`
for a skeleton.

With no `embed()` at all, the scripts still show a skeleton in their target while they load: `changelog.js` and
`feedback.js` (inline) and `widget.js` (`data-mode="inline"`). Whatever is in the target when the script runs and carries
`data-hb-ssr` is kept in place of the skeleton. The script swaps it when its frame says it is ready, or after 8 seconds,
so an error message still shows. The snapshot is plain HTML in your page's own fonts and colours; the frame that
replaces it wears the project's look, so the two differ in style on purpose.

Style the snapshot with the `.hb-ssr` classes (`article`, `.hb-release`, `.hb-stage`, `.hb-tag`, `.hb-body`…) or the
variables `--hb-ssr-line`, `--hb-ssr-muted` and `--hb-ssr-radius`. The rules use `:where()`, so yours win. The HTML inside
a changelog entry is sanitised by HelpBites and inserted as it is.

## Self-hosting and caching the scripts

`hb.script('widget.js')` fetches a file once, keeps it (`ttl`, then stale-while-revalidate) and returns `{ body }`.
Serve it from your own route:

```ts
// server/routes/hb/[file].get.ts (Nuxt)
export default defineEventHandler(async (event) => {
  const { body } = await hb.script(getRouterParam(event, 'file') ?? '')
  if (!body) throw createError({ statusCode: 502 })
  setHeaders(event, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' })
  return body
})
```

The scripts are MIT, so a file in your repo or on your CDN is fine too. A copy tells the script where HelpBites is with
`data-host`: `widget.js`, `feedback.js`, `changelog.js`, `onboarding.js`, `blog.js`, `forms.js` and `pricing.js` all read it
(`embed()` sets it for you). With the one-tag loader, `data-scripts` is the folder the module scripts come from:

```html
<script src="/hb/helpbites.js" data-project="pk_…" data-host="https://support.example.com" data-scripts="/hb" async></script>
```

`helpbites.js` also remembers the project's answer to "which embeds do you have" in the visitor's browser (a week): the
next page starts from it at once and the fresh answer is kept for the page after. `data-cache="false"` turns that off.

HelpBites sends its scripts with `Cache-Control: public, max-age=300, stale-while-revalidate=86400`, so the browser
cache already serves a script it has without waiting, and refreshes it behind the page.

## Options

| Option | Default | |
|---|---|---|
| `host`, `pk` | required | Your HelpBites address and the project's public key. |
| `budget` | `300` | Milliseconds a read may take before it is `late`. `0` never waits. |
| `ttl` | `60000` | Milliseconds an answer is fresh. |
| `stale` | one day | Milliseconds after which an old answer is not served any more. |
| `timeout` | `8000` | Milliseconds before a request to HelpBites is given up, whoever is still waiting for it. |
| `backoff` | `10000` | Milliseconds a failed address is not asked again (an answer cached earlier is still served). |
| `store` | in memory, 200 answers | `{ get(key), set(key, { at, data }) }`, sync or async: a Redis or KV shared between servers. |
| `fetch` | `globalThis.fetch` | Your own, for tests. |

A broken store is a miss and a failed request is `error`: HelpBites being down never throws in your render.

## In a Swift app

The same idea in SwiftUI: show what was kept, draw a skeleton if there is nothing yet, then replace it with the fresh
answer. Plain `URLSession`, no package.

```swift
import SwiftUI

struct HelpBitesChangelog: View {
    var host = "https://support.example.com"
    var pk = "pk_…"
    var accent: Color = .accentColor
    var cornerRadius: CGFloat = 12

    struct Page: Codable { var entries: [Entry] }
    struct Entry: Codable, Identifiable { var id: String; var title: String; var tag: String; var summary: String }

    @State private var entries: [Entry] = []
    @State private var loading = true

    private var kept: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("helpbites-changelog-\(pk).json")
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 12) {
            if entries.isEmpty && loading {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: cornerRadius).fill(.quaternary).frame(height: 84)
                }
            }
            ForEach(entries) { entry in
                VStack(alignment: .leading, spacing: 4) {
                    Text(entry.title).font(.headline)
                    Text(entry.tag.capitalized).font(.caption).foregroundStyle(accent)
                    if !entry.summary.isEmpty { Text(entry.summary).font(.subheadline).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: cornerRadius))
            }
        }
        .task { await load() }
    }

    func load() async {
        defer { loading = false }
        // The last answer first.
        if let data = try? Data(contentsOf: kept), let page = try? JSONDecoder().decode(Page.self, from: data) {
            entries = page.entries
        }
        // Then HelpBites, kept for next time.
        guard let url = URL(string: "\(host)/v1/changelog?pk=\(pk)&flat=1&limit=20"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let page = try? JSONDecoder().decode(Page.self, from: data) else { return }
        entries = page.entries
        try? data.write(to: kept)
    }
}
```

## Your own UI

Everything here sits on the public API: [`GET /v1/changelog`](FEEDBACK.md), `GET /v1/feedback/roadmap`,
`GET /v1/legal/{pk}/{slug}` (see [LEGAL.md](LEGAL.md)) and `GET /v1/hub/{pk}/loader` ([HUB.md](HUB.md)). Read them with
`hb.get()` and draw them with your own components, as `ssr.mjs` does for the snapshots. The helper never caches anything
sent with a token, because it never sends one.

## Rules

- Only `GET` requests to public endpoints are made, with the project public key; there is no way to pass a secret or an
  identity token. Signed-in, per-person data is the scripts' job, in the browser.
- Concurrent reads of the same address share one request.
- A `404` (a project without a public changelog, a draft document) is `error` with `status: 404` and is not cached.
- `script()` accepts only plain file names (`widget.js`, `helpbites.js`, `cms.mjs`…), never a path.
- Scripts and `ssr.mjs` must come from the same HelpBites version family: a copy that is much older than the server may
  not send the `ready` message, in which case the skeleton gives way after 8 seconds.
