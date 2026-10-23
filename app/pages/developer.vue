<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :title="$t('admin.developer.title')">
      <template #actions>
        <UButton to="/_docs/scalar" target="_blank" icon="i-lucide-book-open" :label="$t('admin.developer.apiReference')" color="neutral" variant="outline" size="sm" />
      </template>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex max-w-5xl gap-12 px-6 py-10">
        <article class="min-w-0 flex-1 space-y-12">
          <header class="space-y-2">
            <h1 class="text-2xl font-semibold tracking-tight text-highlighted">{{ $t('admin.developer.heroTitle') }}</h1>
            <p class="text-[15px] leading-relaxed text-muted">
              {{ $t('admin.developer.intro') }}
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

          <!-- AI assistants (MCP) -->
          <section id="mcp" class="space-y-3 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">{{ $t('admin.developer.mcp') }}</h2>
              <p class="text-sm text-muted">{{ $t('admin.developer.mcpIntro') }}</p>
            </div>
            <div class="flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded-lg bg-elevated px-3 py-2 font-mono text-xs">{{ mcpUrl }}</code>
              <UButton :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="outline" size="sm" square :aria-label="$t('workspaceSettings.apiKeys.mcpAddress')" @click="copyMcp" />
            </div>
            <p class="text-sm text-muted">{{ $t('admin.developer.mcpKeyHint') }}</p>
            <CodeBlock :code="mcpSnippet" lang="bash" />
            <div class="flex gap-1">
              <UButton to="/docs/mcp" target="_blank" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="$t('workspaceSettings.apiKeys.mcpDocs')" />
              <UButton to="/api-keys" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="$t('admin.developer.mcpKeys')" />
            </div>
          </section>

          <!-- Get started -->
          <section id="get-started" class="space-y-5 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">{{ $t('admin.developer.getStarted') }}</h2>
              <p class="text-sm text-muted">{{ $t('admin.developer.getStartedHint') }}</p>
            </div>

            <ol class="space-y-6 text-sm">
              <li class="space-y-2">
                <h3 class="font-medium"><span class="step">1</span> {{ $t('admin.developer.step1Title') }}</h3>
                <p class="text-toned">
                  <i18n-t keypath="admin.developer.step1Body" tag="span"><template #projects><NuxtLink to="/projects" class="underline">{{ $t('admin.developer.projectsLink') }}</NuxtLink></template><template #pk><code class="inline-code">pk_…</code></template><template #sk><code class="inline-code">sk_…</code></template></i18n-t>
                </p>
              </li>

              <li class="space-y-2">
                <h3 class="font-medium"><span class="step">2</span> {{ $t('admin.developer.step2Title') }}</h3>
                <p class="text-toned">
                  <i18n-t keypath="admin.developer.step2Body" tag="span"><template #jose><code class="inline-code">jose</code></template><template #jsonwebtoken><code class="inline-code">jsonwebtoken</code></template></i18n-t>
                </p>
                <CodeBlock :code="mintSnippet" lang="js" />
                <p class="text-xs text-muted">
                  {{ $t('admin.developer.step2Note') }}
                </p>
              </li>

              <li class="space-y-2">
                <h3 class="font-medium"><span class="step">3</span> {{ $t('admin.developer.step3Title') }}</h3>
                <p class="text-toned">{{ $t('admin.developer.step3Body') }}</p>
                <CodeBlock :code="widgetSnippet" lang="html" />
                <p class="text-xs text-muted">
                  {{ $t('admin.developer.step3Note') }}
                </p>
              </li>
            </ol>
          </section>

          <!-- Token claims -->
          <section id="tokens" class="space-y-4 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">{{ $t('admin.developer.tokens') }}</h2>
              <p class="text-sm text-muted">{{ $t('admin.developer.tokensHint') }}</p>
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
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">{{ $t('admin.developer.widget') }}</h2>
              <p class="text-sm text-muted">{{ $t('admin.developer.widgetHint') }}</p>
            </div>
            <ul class="space-y-2 text-sm text-toned list-disc pl-5">
              <li><i18n-t keypath="admin.developer.widgetGetToken" tag="span"><template #getToken><code class="inline-code">getToken</code></template></i18n-t></li>
              <li><i18n-t keypath="admin.developer.widgetContext" tag="span"><template #context><code class="inline-code">context</code></template><template #setContext><code class="inline-code">HelpBites.push(['setContext', {…}])</code></template></i18n-t></li>
              <li><i18n-t keypath="admin.developer.widgetOpenClose" tag="span"><template #open><code class="inline-code">HelpBites.push(['open'])</code></template><template #close><code class="inline-code">(['close'])</code></template></i18n-t></li>
              <li><i18n-t keypath="admin.developer.widgetMode" tag="span"><template #mode><code class="inline-code">data-mode="inline"</code></template><template #target><code class="inline-code">data-target="#selector"</code></template></i18n-t></li>
              <li><i18n-t keypath="admin.developer.widgetPosition" tag="span"><template #position><code class="inline-code">data-position="left"</code></template><template #accent><code class="inline-code">data-accent="#hex"</code></template></i18n-t></li>
              <li><i18n-t keypath="admin.developer.widgetSb" tag="span"><template #sb><code class="inline-code">?sb=&lt;conversationId&gt;</code></template></i18n-t></li>
            </ul>
          </section>

          <!-- Inline panel -->
          <section id="inline" class="space-y-4 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">{{ $t('admin.developer.inlinePanel') }}</h2>
              <p class="text-sm text-muted">{{ $t('admin.developer.inlineHint') }}</p>
            </div>
            <CodeBlock :code="inlineSnippet" lang="html" />
            <p class="text-xs text-muted">
              {{ $t('admin.developer.inlineNote') }}
            </p>
          </section>

          <!-- Examples / own UI -->
          <section id="examples" class="space-y-5 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">{{ $t('admin.developer.examples') }}</h2>
              <p class="text-sm text-muted">
                <i18n-t keypath="admin.developer.examplesHint" tag="span"><template #auth><code class="inline-code">Authorization: Bearer &lt;identity token&gt;</code></template></i18n-t>
              </p>
            </div>

            <div class="space-y-2">
              <h3 class="text-sm font-medium">{{ $t('admin.developer.startConversation') }}</h3>
              <CodeBlock :code="curlSnippet" lang="bash" />
            </div>

            <div class="space-y-2">
              <h3 class="text-sm font-medium">{{ $t('admin.developer.ownUi') }}</h3>
              <p class="text-sm text-toned">
                <i18n-t keypath="admin.developer.ownUiBody" tag="span"><template #clientId><code class="inline-code">clientId</code></template></i18n-t>
              </p>
              <CodeBlock :code="fetchSnippet" lang="js" />
            </div>

            <div class="space-y-2">
              <h3 class="text-sm font-medium">{{ $t('admin.developer.liveUpdates') }}</h3>
              <p class="text-sm text-toned">
                <i18n-t keypath="admin.developer.liveBody" tag="span"><template #events><code class="inline-code">GET /v1/events</code></template><template #fetch><code class="inline-code">fetch</code></template></i18n-t>
              </p>
              <CodeBlock :code="sseSnippet" lang="js" />
            </div>
          </section>

          <!-- Endpoints -->
          <section id="endpoints" class="space-y-4 scroll-mt-8">
            <div>
              <h2 class="text-[17px] font-semibold tracking-tight text-highlighted">{{ $t('admin.developer.endpoints') }}</h2>
              <p class="text-sm text-muted">
                <i18n-t keypath="admin.developer.endpointsBody" tag="span"><template #reference><a href="/_docs/scalar" target="_blank" rel="noopener" class="underline">{{ $t('admin.developer.apiReference') }}</a></template></i18n-t>
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
              <i18n-t keypath="admin.developer.serverNote" tag="span"><template #sk><code class="inline-code">sk_…</code></template></i18n-t>
            </p>
            <ul class="divide-y divide-default border-y border-default text-sm">
              <li v-for="e in serverEndpoints" :key="e.method + e.path" class="flex items-baseline gap-3 py-2">
                <span class="w-14 shrink-0 font-mono text-[11px] font-semibold text-muted">{{ e.method }}</span>
                <code class="font-mono text-xs">{{ e.path }}</code>
                <span class="ml-auto text-xs text-muted text-right">{{ e.desc }}</span>
              </li>
            </ul>
            <UButton to="/_docs/scalar" target="_blank" trailing-icon="i-lucide-external-link" color="primary" size="sm">
              {{ $t('admin.developer.openApiRef') }}
            </UButton>
          </section>
        </article>

        <!-- On this page -->
        <aside class="hidden lg:block w-44 shrink-0">
          <nav class="sticky top-8 text-sm space-y-1.5">
            <p class="mb-2 text-xs font-medium text-muted">{{ $t('admin.developer.onThisPage') }}</p>
            <a v-for="s in sections" :key="s.id" :href="`#${s.id}`" class="block text-muted hover:text-highlighted">{{ s.label }}</a>
          </nav>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'agent' })

const { t } = useI18n()
const appUrl = useAppUrl()

const mcpUrl = computed(() => `${appUrl.value}/mcp`)
const mcpSnippet = computed(() => `claude mcp add --transport http helpbites ${mcpUrl.value} \\
  --header "Authorization: Bearer ak_…"`)
const copied = ref(false)
async function copyMcp() {
  await navigator.clipboard.writeText(mcpUrl.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

const links = computed(() => [
  { label: t('admin.developer.getStarted'), hint: t('admin.developer.quickStartHint'), to: '#get-started', icon: 'i-lucide-rocket' },
  { label: t('admin.developer.mcp'), hint: t('admin.developer.mcpHint'), to: '#mcp', icon: 'i-lucide-plug-zap' },
  { label: t('admin.developer.quickAdminKeys'), hint: t('admin.developer.quickAdminKeysHint'), to: '/api-keys', icon: 'i-lucide-key-round' },
  { label: t('admin.developer.apiReference'), hint: t('admin.developer.quickApiRefHint'), to: '/_docs/scalar', external: true, icon: 'i-lucide-code-xml' },
  { label: t('admin.developer.widget'), hint: t('admin.developer.quickWidgetHint'), to: '#widget', icon: 'i-lucide-messages-square' },
  { label: t('admin.developer.inlinePanel'), hint: t('admin.developer.quickInlineHint'), to: '#inline', icon: 'i-lucide-panels-top-left' },
  { label: t('admin.developer.examples'), hint: t('admin.developer.quickExamplesHint'), to: '#examples', icon: 'i-lucide-flask-conical' }
])

const sections = computed(() => [
  { id: 'mcp', label: t('admin.developer.mcp') },
  { id: 'get-started', label: t('admin.developer.getStarted') },
  { id: 'tokens', label: t('admin.developer.tokens') },
  { id: 'widget', label: t('admin.developer.widget') },
  { id: 'inline', label: t('admin.developer.inlinePanel') },
  { id: 'examples', label: t('admin.developer.examples') },
  { id: 'endpoints', label: t('admin.developer.endpoints') }
])

const claims = computed(() => [
  { claim: 'iss', desc: t('admin.developer.claimIss') },
  { claim: 'sub', desc: t('admin.developer.claimSub') },
  { claim: 'name', desc: t('admin.developer.claimName') },
  { claim: 'email', desc: t('admin.developer.claimEmail') },
  { claim: 'iat / exp', desc: t('admin.developer.claimTimes') }
])

const endpoints = computed(() => [
  { method: 'GET', path: '/v1/conversations', desc: t('admin.developer.epListConversations') },
  { method: 'POST', path: '/v1/conversations', desc: t('admin.developer.epStartOne') },
  { method: 'GET', path: '/v1/conversations/:id/messages', desc: t('admin.developer.epTranscript') },
  { method: 'POST', path: '/v1/conversations/:id/messages', desc: t('admin.developer.epSendMessage') },
  { method: 'POST', path: '/v1/conversations/:id/read', desc: t('admin.developer.epMarkRead') },
  { method: 'DELETE', path: '/v1/messages/:id', desc: t('admin.developer.epUnsend') },
  { method: 'GET', path: '/v1/unread', desc: t('admin.developer.epUnread') },
  { method: 'POST', path: '/v1/attachments', desc: t('admin.developer.epAttachments') },
  { method: 'GET', path: '/v1/events', desc: t('admin.developer.epServerEvents') }
])

const serverEndpoints = computed(() => [
  { method: 'POST', path: '/v1/contacts', desc: t('admin.developer.epContactsCreate') },
  { method: 'GET', path: '/v1/contacts', desc: t('admin.developer.epContactsList') },
  { method: 'PATCH', path: '/v1/contacts/:id', desc: t('admin.developer.epContactsPatch') },
  { method: 'DELETE', path: '/v1/contacts/:id', desc: t('admin.developer.epContactsDelete') },
  { method: 'POST', path: '/v1/segments', desc: t('admin.developer.epSegments') },
  { method: 'POST', path: '/v1/track', desc: t('admin.developer.epTrack') },
  { method: 'POST', path: '/v1/campaigns', desc: t('admin.developer.epCampaigns') },
  { method: 'POST', path: '/v1/sequences', desc: t('admin.developer.epSequences') },
  { method: 'POST', path: '/v1/subscribe', desc: t('admin.developer.epSubscribe') },
  { method: 'POST', path: '/v1/emails/send', desc: t('admin.developer.epEmailsSend') }
])

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
