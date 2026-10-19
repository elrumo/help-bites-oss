<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader title="Developer">
      <template #actions>
        <UButton to="/_docs/scalar" target="_blank" icon="i-lucide-book-open" label="API reference" color="neutral" variant="outline" size="sm" />
      </template>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex max-w-5xl gap-12 px-6 py-10">
        <article class="min-w-0 flex-1 space-y-12">
          <header class="space-y-2">
            <h1 class="text-2xl font-semibold tracking-tight text-highlighted">Connect your app to HelpBites</h1>
            <p class="text-[15px] leading-relaxed text-muted">
              Each app you run is a project. Its users keep their own accounts — your server signs a short identity
              token — and they chat from a drop-in widget or a UI you build on the API.
            </p>
          </header>

          <!-- Quick links -->
          <div class="grid sm:grid-cols-2 gap-3">
            <a
              v-for="l in links"
              :key="l.label"
              :href="l.to"
              :target="l.external ? '_blank' : undefined"
              :rel="l.external ? 'noopener' : undefined"
              class="flex items-start gap-3 rounded-xl border border-default p-4 text-left transition-colors hover:bg-elevated"
            >
              <UIcon :name="l.icon" class="mt-0.5 size-4 shrink-0 text-muted" />
              <span class="min-w-0">
                <span class="block text-sm font-medium">{{ l.label }}</span>
                <span class="block text-xs text-muted">{{ l.hint }}</span>
              </span>
            </a>
          </div>

          <!-- Get started -->
          <section id="get-started" class="space-y-5 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">Get started</h2>
              <p class="text-sm text-muted">Three steps, about ten minutes.</p>
            </div>

            <ol class="space-y-6 text-sm">
              <li class="space-y-2">
                <h3 class="font-medium"><span class="step">1</span> Create a project</h3>
                <p class="text-toned">
                  <NuxtLink to="/projects" class="underline">Projects → New project</NuxtLink>. You get a public key
                  <code class="inline-code">pk_…</code> (safe in browsers) and a secret <code class="inline-code">sk_…</code>
                  (server only, signs identity tokens). Set the site URL, the origins allowed to host the widget, the name
                  replies are signed with, and who gets notified when a user writes.
                </p>
              </li>

              <li class="space-y-2">
                <h3 class="font-medium"><span class="step">2</span> Mint identity tokens on your server</h3>
                <p class="text-toned">
                  One authenticated route that returns a short-lived HS256 JWT for the signed-in user. Any JWT library
                  works (<code class="inline-code">jose</code>, <code class="inline-code">jsonwebtoken</code>, PyJWT…);
                  the secret is the project secret. Node, no dependencies:
                </p>
                <CodeBlock :code="mintSnippet" lang="js" />
                <p class="text-xs text-muted">
                  Never send the secret to a browser. Rotate it from the project page if it leaks — tokens minted with the
                  old one stop verifying immediately.
                </p>
              </li>

              <li class="space-y-2">
                <h3 class="font-medium"><span class="step">3</span> Show the chat</h3>
                <p class="text-toned">Drop the widget on your site and hand it that token:</p>
                <CodeBlock :code="widgetSnippet" lang="html" />
                <p class="text-xs text-muted">
                  Only origins listed on the project can host the widget; anything else sees an error inside the frame and
                  never gets a token.
                </p>
              </li>
            </ol>
          </section>

          <!-- Token claims -->
          <section id="tokens" class="space-y-4 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">Identity tokens</h2>
              <p class="text-sm text-muted">HS256, signed with the project secret. An hour of life is plenty.</p>
            </div>
            <div class="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-sm border-y border-default py-3">
              <template v-for="c in claims" :key="c.claim">
                <code class="inline-code justify-self-start">{{ c.claim }}</code>
                <span class="text-toned">{{ c.desc }}</span>
              </template>
            </div>
          </section>

          <!-- Widget API -->
          <section id="widget" class="space-y-4 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">Widget</h2>
              <p class="text-sm text-muted">Everything the loader understands.</p>
            </div>
            <ul class="space-y-2 text-sm text-toned list-disc pl-5">
              <li><code class="inline-code">getToken</code> is called when the chat opens and again whenever a token expires.</li>
              <li><code class="inline-code">context</code> is attached to new conversations so you know what the user was looking at. Update it with <code class="inline-code">HelpBites.push(['setContext', {…}])</code>.</li>
              <li><code class="inline-code">HelpBites.push(['open'])</code> / <code class="inline-code">(['close'])</code> control the panel.</li>
              <li><code class="inline-code">data-mode="inline"</code> with <code class="inline-code">data-target="#selector"</code> drops the chat inside an element of your page — a message panel instead of a floating launcher. It fills its container, so give that element a height.</li>
              <li><code class="inline-code">data-position="left"</code> and <code class="inline-code">data-accent="#hex"</code> on the script tag tweak the launcher.</li>
              <li>A link with <code class="inline-code">?sb=&lt;conversationId&gt;</code> — what notification emails use — opens that conversation on load.</li>
            </ul>
          </section>

          <!-- Inline panel -->
          <section id="inline" class="space-y-4 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">Inline panel</h2>
              <p class="text-sm text-muted">Same chat, mounted in your layout — a support page or a section of your settings.</p>
            </div>
            <CodeBlock :code="inlineSnippet" lang="html" />
            <p class="text-xs text-muted">
              Wide enough (640px and up) and the conversation list sits beside the thread; narrower, it stacks like the
              floating widget. There's no close button — the host page owns the panel.
            </p>
          </section>

          <!-- Examples / own UI -->
          <section id="examples" class="space-y-5 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">Examples</h2>
              <p class="text-sm text-muted">
                Everything the widget does is on the API. Send <code class="inline-code">Authorization: Bearer &lt;identity token&gt;</code>.
              </p>
            </div>

            <div class="space-y-2">
              <h3 class="text-sm font-medium">Start a conversation</h3>
              <CodeBlock :code="curlSnippet" lang="bash" />
            </div>

            <div class="space-y-2">
              <h3 class="text-sm font-medium">Your own UI</h3>
              <p class="text-sm text-toned">
                Retries are safe: pass a <code class="inline-code">clientId</code> with each message and a repeated POST
                returns the message that already landed.
              </p>
              <CodeBlock :code="fetchSnippet" lang="js" />
            </div>

            <div class="space-y-2">
              <h3 class="text-sm font-medium">Live updates</h3>
              <p class="text-sm text-toned">
                <code class="inline-code">GET /v1/events</code> is server-sent events. Use <code class="inline-code">fetch</code>
                plus a stream reader so the token stays in a header.
              </p>
              <CodeBlock :code="sseSnippet" lang="js" />
            </div>
          </section>

          <!-- Endpoints -->
          <section id="endpoints" class="space-y-4 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">Endpoints</h2>
              <p class="text-sm text-muted">
                The full schema, with request and response shapes, lives in the
                <a href="/_docs/scalar" target="_blank" rel="noopener" class="underline">API reference</a>.
              </p>
            </div>
            <ul class="divide-y divide-default border-y border-default text-sm">
              <li v-for="e in endpoints" :key="e.method + e.path" class="flex items-baseline gap-3 py-2">
                <span class="w-14 shrink-0 font-mono text-[11px] font-semibold text-muted">{{ e.method }}</span>
                <code class="font-mono text-xs">{{ e.path }}</code>
                <span class="ml-auto text-xs text-muted text-right">{{ e.desc }}</span>
              </li>
            </ul>
            <p class="text-sm text-muted">
              From your server, with the project secret (<code class="inline-code">sk_…</code>): contacts, segments and campaigns.
            </p>
            <ul class="divide-y divide-default border-y border-default text-sm">
              <li v-for="e in serverEndpoints" :key="e.method + e.path" class="flex items-baseline gap-3 py-2">
                <span class="w-14 shrink-0 font-mono text-[11px] font-semibold text-muted">{{ e.method }}</span>
                <code class="font-mono text-xs">{{ e.path }}</code>
                <span class="ml-auto text-xs text-muted text-right">{{ e.desc }}</span>
              </li>
            </ul>
            <UButton to="/_docs/scalar" target="_blank" trailing-icon="i-lucide-external-link" color="primary" size="sm">
              Open the API reference
            </UButton>
          </section>
        </article>

        <!-- On this page -->
        <aside class="hidden lg:block w-44 shrink-0">
          <nav class="sticky top-8 text-sm space-y-1.5">
            <p class="mb-2 text-xs font-medium text-muted">On this page</p>
            <a v-for="s in sections" :key="s.id" :href="`#${s.id}`" class="block text-muted hover:text-highlighted">{{ s.label }}</a>
          </nav>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'agent' })

const appUrl = useAppUrl()

const links = [
  { label: 'Get started', hint: 'Project, token, widget — in three steps', to: '#get-started', icon: 'i-lucide-rocket' },
  { label: 'Admin API keys', hint: 'Automate the complete operator API', to: '/api-keys', icon: 'i-lucide-key-round' },
  { label: 'API reference', hint: 'OpenAPI schema for every /v1 route', to: '/_docs/scalar', external: true, icon: 'i-lucide-code-xml' },
  { label: 'Widget', hint: 'Loader options and JS commands', to: '#widget', icon: 'i-lucide-messages-square' },
  { label: 'Inline panel', hint: 'Embed the chat in your own layout', to: '#inline', icon: 'i-lucide-panels-top-left' },
  { label: 'Examples', hint: 'cURL, your own UI, live events', to: '#examples', icon: 'i-lucide-flask-conical' }
]

const sections = [
  { id: 'get-started', label: 'Get started' },
  { id: 'tokens', label: 'Identity tokens' },
  { id: 'widget', label: 'Widget' },
  { id: 'inline', label: 'Inline panel' },
  { id: 'examples', label: 'Examples' },
  { id: 'endpoints', label: 'Endpoints' }
]

const claims = [
  { claim: 'iss', desc: 'The project public key' },
  { claim: 'sub', desc: "Your user's id — stable and unique per project" },
  { claim: 'name', desc: 'Optional display name' },
  { claim: 'email', desc: 'Optional; enables email notifications for that user' },
  { claim: 'iat / exp', desc: 'Issued-at and expiry' }
]

const endpoints = [
  { method: 'GET', path: '/v1/conversations', desc: 'List the user’s conversations' },
  { method: 'POST', path: '/v1/conversations', desc: 'Start one' },
  { method: 'GET', path: '/v1/conversations/:id/messages', desc: 'Transcript; page with ?before=' },
  { method: 'POST', path: '/v1/conversations/:id/messages', desc: 'Send a message' },
  { method: 'POST', path: '/v1/conversations/:id/read', desc: 'Mark as read' },
  { method: 'DELETE', path: '/v1/messages/:id', desc: 'Unsend' },
  { method: 'GET', path: '/v1/unread', desc: 'Unread counts' },
  { method: 'POST', path: '/v1/attachments', desc: 'Multipart `file`' },
  { method: 'GET', path: '/v1/events', desc: 'Server-sent events' }
]

const serverEndpoints = [
  { method: 'POST', path: '/v1/contacts', desc: 'Create or update one, or up to 1000' },
  { method: 'GET', path: '/v1/contacts', desc: 'List; ?segment=, ?updatedSince=, ?email=' },
  { method: 'PATCH', path: '/v1/contacts/:id', desc: 'Attributes, tags, subscription' },
  { method: 'DELETE', path: '/v1/contacts/:id', desc: 'Erase a person' },
  { method: 'POST', path: '/v1/segments', desc: 'Save a filter' },
  { method: 'POST', path: '/v1/track', desc: 'An event; starts sequences' },
  { method: 'POST', path: '/v1/campaigns', desc: 'A broadcast; PATCH to send' },
  { method: 'POST', path: '/v1/sequences', desc: 'An automated series' },
  { method: 'POST', path: '/v1/subscribe', desc: 'Public sign-up (pk), double opt-in' },
  { method: 'POST', path: '/v1/emails/send', desc: 'Transactional email' }
]

const mintSnippet = `import { createHmac } from 'node:crypto'

// GET /api/support/token — only for a signed-in user of your app
export function mintSupportToken(user) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ iss: process.env.HELP_BITES_PROJECT_KEY, sub: user.id, name: user.name, email: user.email, iat: now, exp: now + 3600 })
  const sig = createHmac('sha256', process.env.HELP_BITES_SECRET).update(head + '.' + body).digest('base64url')
  return head + '.' + body + '.' + sig
}`

const widgetSnippet = computed(() => `<script src="${appUrl.value}/widget.js" data-project="pk_…" defer><\/script>
<script>
  window.HelpBites = window.HelpBites || []
  HelpBites.push(['init', {
    getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token),
    context: { type: 'page', id: location.pathname, label: document.title, url: location.href } // optional
  }])
<\/script>`)

const inlineSnippet = computed(() => `<div id="support" style="height: 560px"></div>

<script src="${appUrl.value}/widget.js" data-project="pk_…" data-mode="inline" data-target="#support" defer><\/script>
<script>
  window.HelpBites = window.HelpBites || []
  HelpBites.push(['init', {
    getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token)
  }])
<\/script>`)

const curlSnippet = computed(() => `curl -X POST ${appUrl.value}/v1/conversations \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "body": "My export is stuck", "context": { "type": "page", "url": "https://app.example.com/exports" } }'`)

const fetchSnippet = computed(() => `const api = (path, init = {}) => fetch('${appUrl.value}' + path, {
  ...init,
  headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${token}\`, ...init.headers }
}).then(r => r.json())

const { conversations } = await api('/v1/conversations')
const { messages } = await api(\`/v1/conversations/\${id}/messages?before=\${cursor}\`)

await api(\`/v1/conversations/\${id}/messages\`, {
  method: 'POST',
  body: JSON.stringify({ body: 'Thanks!', clientId: crypto.randomUUID() })
})`)

const sseSnippet = computed(() => `const res = await fetch('${appUrl.value}/v1/events', {
  headers: { Authorization: \`Bearer \${token}\` }
})

const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
for (;;) {
  const { value, done } = await reader.read()
  if (done) break
  for (const line of value.split('\\n')) {
    if (line.startsWith('data:')) handle(JSON.parse(line.slice(5)))
  }
}`)
</script>

<style scoped>
@reference "~/assets/css/main.css";
.inline-code { @apply rounded border border-default bg-elevated px-1 py-px font-mono text-xs; }
.step { @apply mr-1.5 inline-flex size-5 items-center justify-center rounded-full border border-default bg-elevated align-middle text-[11px] font-semibold tabular-nums text-toned; }
</style>
