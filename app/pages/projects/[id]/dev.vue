<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" title="Dev">
      <template #actions>
        <UButton to="/developer" icon="i-lucide-book-open" label="Guide" color="neutral" variant="ghost" size="sm" class="hidden sm:inline-flex" />
        <UButton to="/_docs/scalar" target="_blank" icon="i-lucide-code-xml" label="API reference" color="neutral" variant="outline" size="sm" />
      </template>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="project" class="mx-auto max-w-4xl space-y-10 px-6 py-8">
        <header class="space-y-1">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">Connect {{ project.name }}</h1>
          <p class="text-[13px] text-muted">Keys, snippets and webhooks for your code. Name, branding and email sending are in <NuxtLink :to="`/projects/${id}/settings`" class="font-medium text-default underline-offset-2 hover:underline">project settings</NuxtLink>.</p>
        </header>

        <!-- Credentials -->
        <section class="space-y-3">
          <h2 class="section-title">Credentials</h2>
          <div class="divide-y divide-default overflow-hidden rounded-xl border border-default">
            <div class="cred">
              <div><p class="cred-title">Public key</p><p class="cred-hint">Names the project. Safe in browsers.</p></div>
              <div class="cred-value">
                <code class="cred-code">{{ project.publicKey }}</code>
                <UTooltip :text="copied === 'pk' ? 'Copied' : 'Copy'"><UButton :icon="copied === 'pk' ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" size="sm" square class="text-muted" aria-label="Copy public key" @click="copy(project.publicKey, 'pk')" /></UTooltip>
              </div>
            </div>
            <div class="cred">
              <div><p class="cred-title">Secret key</p><p class="cred-hint">Signs identity tokens and calls the server API. Never ship it to a browser.</p></div>
              <div class="cred-value">
                <code class="cred-code" :class="secret ? '' : 'tracking-widest text-dimmed'">{{ secret || '••••••••••••••••••••••••' }}</code>
                <UTooltip v-if="secret" :text="copied === 'sk' ? 'Copied' : 'Copy'"><UButton :icon="copied === 'sk' ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" size="sm" square class="text-muted" aria-label="Copy secret" @click="copy(secret, 'sk')" /></UTooltip>
                <UTooltip :text="secret ? 'Hide' : 'Reveal'"><UButton :icon="secret ? 'i-lucide-eye-off' : 'i-lucide-eye'" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="secret ? 'Hide secret' : 'Reveal secret'" @click="secret ? (secret = '') : reveal()" /></UTooltip>
                <UTooltip text="Rotate"><UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" square class="text-muted" aria-label="Rotate secret" @click="rotate" /></UTooltip>
              </div>
            </div>
            <div class="cred">
              <div><p class="cred-title">Base URL</p><p class="cred-hint">Where your site and server reach HelpBites.</p></div>
              <div class="cred-value">
                <code class="cred-code">{{ appUrl }}</code>
                <UTooltip :text="copied === 'url' ? 'Copied' : 'Copy'"><UButton :icon="copied === 'url' ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" size="sm" square class="text-muted" aria-label="Copy base URL" @click="copy(appUrl, 'url')" /></UTooltip>
              </div>
            </div>
          </div>
          <p v-if="justCreated" class="flex items-start gap-2 text-xs text-muted"><UIcon name="i-lucide-info" class="mt-0.5 size-3.5 shrink-0" />Your new project's secret is shown above. You can reveal it again here any time; rotating it invalidates tokens minted with the old one.</p>
        </section>

        <!-- Integrations: each tile is a tab for its guide below. -->
        <section id="integrations" class="scroll-mt-6 space-y-3">
          <h2 class="section-title">Integrations</h2>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="tablist" aria-label="Integrations">
            <button
              v-for="item in integrations"
              :id="`tab-${item.key}`"
              :key="item.key"
              type="button"
              role="tab"
              :aria-selected="tab === item.key"
              aria-controls="integration-panel"
              class="rounded-xl border p-3 text-left transition-colors"
              :class="tab === item.key ? 'border-accented bg-elevated' : 'border-default hover:bg-elevated/60'"
              @click="tab = item.key"
            >
              <span class="flex items-center gap-2 text-[13px] font-medium text-highlighted"><UIcon :name="item.icon" class="size-4 shrink-0 text-muted" />{{ item.label }}</span>
              <span class="mt-1.5 flex items-center gap-1.5 truncate text-xs text-muted"><span class="size-1.5 shrink-0 rounded-full" :class="dots[item.tone]" />{{ item.status }}</span>
            </button>
          </div>

          <div id="integration-panel" role="tabpanel" :aria-labelledby="`tab-${tab}`" class="space-y-5 rounded-xl border border-default p-5">
            <!-- Chat widget -->
            <template v-if="tab === 'chat'">
              <div class="panel-head">
                <p>Your server signs a short token for the signed-in user; the widget hands it to HelpBites.</p>
                <UButton :to="`/projects/${id}/settings#widget`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" label="Widget settings" />
              </div>
              <ol class="steps">
                <li><p class="step-title">Mint a token on your server</p><p class="step-text">Any language works; this is Node with no dependencies.</p><CodeBlock :code="mintSnippet" lang="js" /></li>
                <li><p class="step-title">Load the widget on your site</p><p class="step-text">Only the <a href="#security" class="underline">allowed origins</a> below may host it.</p><CodeBlock :code="widgetSnippet" lang="html" /></li>
                <li><p class="step-title">Or build your own UI</p><p class="step-text">Call the <a href="/_docs/scalar" target="_blank" rel="noopener" class="underline">API</a> with <code class="inline-code">Authorization: Bearer &lt;token&gt;</code>. Pass <code class="inline-code">assistantId</code> when opening a conversation to route it to a specific assistant (copy the ID from the Assistants tab).</p></li>
              </ol>
            </template>

            <!-- Feedback board -->
            <template v-else-if="tab === 'feedback'">
              <div class="panel-head">
                <p>A public board where users post ideas, vote and comment. {{ project.feedback?.enabled ? 'It is on.' : 'Turn it on from the Feedback page.' }}</p>
                <UButton :to="`/projects/${id}/feedback`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" label="Manage" />
              </div>
              <ol class="steps">
                <li><p class="step-title">Drop the board into any page</p><p class="step-text">Anyone can read it; pass the same token as the chat so signed-in users can post, vote and comment.</p><CodeBlock :code="feedbackSnippet" lang="html" /></li>
                <li><p class="step-title">Or build your own UI</p><p class="step-text">Use <code class="inline-code">/v1/feedback</code> (<a href="/_docs/scalar" target="_blank" rel="noopener" class="underline">API</a>): read with <code class="inline-code">?pk={{ project.publicKey }}</code>, write with the identity token. Add <code class="inline-code">role: "admin"</code> to a token to let one of your staff moderate. Bring old feedback over with <code class="inline-code">POST /v1/feedback/import</code> and the secret.</p></li>
              </ol>
            </template>

            <!-- Feature flags -->
            <template v-else-if="tab === 'flags'">
              <div class="panel-head">
                <p>Read flags from your server with the secret and decide them against your own admin check.</p>
                <UButton :to="`/projects/${id}/flags`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" label="Manage" />
              </div>
              <p class="step-text">Decide <code class="inline-code">admins</code> flags against your own admin check and each flag's <code class="inline-code">allow</code> list. Cache about 30 seconds, keep the last good answer through a blip, then use each flag's <code class="inline-code">fallback</code>; treat unknown flags as off. A browser can ask with <code class="inline-code">?pk=</code> or the identity token instead and gets <code class="inline-code">enabled</code> already worked out (<code class="inline-code">role: "admin"</code> counts as an admin).</p>
              <CodeBlock :code="flagsSnippet" lang="js" />
            </template>

            <!-- Error tracking -->
            <template v-else-if="tab === 'errors'">
              <div class="panel-head">
                <p v-if="project.errors?.connected">Reporting to {{ project.errors.providerName }}. <UButton variant="link" size="sm" class="p-0" label="Change URL or token" @click="connectErrorsOpen = true" /></p>
                <p v-else>Connect GlitchTip or Bugsink to give this project a Sentry-compatible DSN and send alerts to the inbox.</p>
                <UButton :to="`/projects/${id}/errors`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" label="Errors" />
              </div>
              <template v-if="project.errors?.connected">
                <p v-if="project.errors.alertWebhookUrl" class="step-text">To get alerts in the inbox, open the project's alerts in Bugsink, click Add, set Kind to <span class="font-medium">Custom</span> and use this Webhook url: <code class="inline-code break-all">{{ project.errors.alertWebhookUrl }}</code>.</p>
                <p class="step-text">Use this DSN in browser and server SDKs. Set the same stable HelpBites identity id as the Sentry user id to show a customer’s errors in their conversation.</p>
                <CodeBlock :code="sentrySnippet" lang="js" />
              </template>
              <UButton v-else size="sm" icon="i-lucide-plug" label="Connect error tracking" @click="connectErrorsOpen = true" />
              <ConnectErrorTrackingModal v-model:open="connectErrorsOpen" :project-id="id" :provider="project.errors?.provider || undefined" @connected="onErrorsConnected" />
            </template>

            <!-- Email -->
            <template v-else-if="tab === 'email'">
              <div class="panel-head">
                <p>Send from your server with the secret.</p>
                <div class="flex shrink-0 gap-1">
                  <UButton :to="`/projects/${id}/email?view=templates`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" label="Templates" />
                  <UButton :to="`/projects/${id}/email?view=log`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" label="Log" />
                </div>
              </div>
              <p class="step-text">Send one of this project's templates by its send key, your own HTML (in the body, or uploaded as an <code class="inline-code">html</code> file), or a plain message in the project's layout. Each recipient gets their own message and a row in the log; <code class="inline-code">GET /v1/email-logs</code> reads it back. The sender is set in <NuxtLink :to="`/projects/${id}/settings#email`" class="underline">project settings</NuxtLink>.</p>
              <CodeBlock :code="emailSnippet" lang="js" />
            </template>
          </div>
        </section>

        <!-- Security and webhooks -->
        <form id="security" class="scroll-mt-6 space-y-3" @submit.prevent="saveSecurity">
          <h2 class="section-title">Security and webhooks</h2>
          <div class="space-y-4 rounded-xl border border-default p-5">
            <UFormField label="Allowed origins" hint="One per line. Only these sites may host the widget.">
              <UTextarea v-model="security.allowedOriginsText" :rows="2" autoresize class="w-full font-mono text-xs" placeholder="https://app.example.com" />
            </UFormField>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Action webhook URL" hint="Receives signed operator actions"><UInput v-model="security.actionWebhookUrl" placeholder="https://api.example.com/helpbites/actions" class="w-full" /></UFormField>
              <UFormField label="Action webhook secret" :hint="project.hasActionWebhookSecret ? 'Leave blank to keep the current secret.' : 'At least 16 characters.'"><UInput v-model="security.actionWebhookSecret" type="password" placeholder="••••••••••••••••" class="w-full" autocomplete="new-password" /></UFormField>
            </div>
            <div class="flex items-center gap-3">
              <UButton type="submit" size="sm" :loading="saving" :disabled="!securityDirty">Save</UButton>
              <span v-if="saveError" class="text-[13px] text-error">{{ saveError }}</span>
              <span v-else-if="saved && !securityDirty" class="text-[13px] text-muted">Saved</span>
            </div>
          </div>
        </form>
      </div>
      <p v-else-if="error" class="p-8 text-[13px] text-error">{{ error }}</p>
      <div v-else class="mx-auto max-w-4xl space-y-3 px-6 py-8"><USkeleton v-for="i in 4" :key="i" class="h-20 rounded-xl" /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AdminProject } from '~~/server/utils/projects'

definePageMeta({ middleware: 'agent' })

type Tab = 'chat' | 'feedback' | 'flags' | 'errors' | 'email'
type Tone = 'ok' | 'warn' | 'off'

const { api, loadProjects } = useAgent()
const route = useRoute()
const id = String(route.params.id)

const project = ref<AdminProject | null>(null)
// A new project lands here with its secret in the URL, once.
const secret = ref(typeof route.query.secret === 'string' ? route.query.secret : '')
const justCreated = !!secret.value
const tabs: Tab[] = ['chat', 'feedback', 'flags', 'errors', 'email']
const tab = ref<Tab>(tabs.includes(route.query.tab as Tab) ? route.query.tab as Tab : 'chat')
const error = ref('')
const saving = ref(false)
const saved = ref(false)
const saveError = ref('')
const copied = ref('')
const connectErrorsOpen = ref(false)
const security = reactive({ allowedOriginsText: '', actionWebhookUrl: '', actionWebhookSecret: '' })

const dots: Record<Tone, string> = { ok: 'bg-success', warn: 'bg-warning', off: 'bg-(--ui-text-dimmed)' }
const integrations = computed(() => {
  const p = project.value!
  const origins = p.allowedOrigins.length
  const flags = p.flags?.length || 0
  return [
    { key: 'chat' as const, label: 'Chat widget', icon: 'i-lucide-message-circle-more', tone: (origins ? 'ok' : 'warn') as Tone, status: origins ? `${origins} allowed origin${origins === 1 ? '' : 's'}` : 'No allowed origins' },
    { key: 'feedback' as const, label: 'Feedback', icon: 'i-lucide-lightbulb', tone: (p.feedback?.enabled ? 'ok' : 'off') as Tone, status: p.feedback?.enabled ? 'Board on' : 'Off' },
    { key: 'flags' as const, label: 'Flags', icon: 'i-lucide-toggle-right', tone: (flags ? 'ok' : 'off') as Tone, status: flags ? `${flags} flag${flags === 1 ? '' : 's'}` : 'None yet' },
    { key: 'errors' as const, label: 'Errors', icon: 'i-lucide-bug', tone: (p.errors?.connected ? 'ok' : 'off') as Tone, status: p.errors?.connected ? p.errors.providerName : 'Not connected' },
    { key: 'email' as const, label: 'Email API', icon: 'i-lucide-mail', tone: 'ok' as Tone, status: p.fromEmail || 'Default sender' }
  ]
})

const securityDirty = computed(() => !!project.value && (
  security.allowedOriginsText.split(/\n/).map(s => s.trim()).filter(Boolean).join('\n') !== project.value.allowedOrigins.join('\n')
  || security.actionWebhookUrl !== (project.value.actionWebhookUrl || '')
  || !!security.actionWebhookSecret
))

function fill(p: AdminProject) {
  project.value = p
  security.allowedOriginsText = p.allowedOrigins.join('\n')
  security.actionWebhookUrl = p.actionWebhookUrl || ''
  security.actionWebhookSecret = ''
}

onMounted(async () => {
  try {
    const found = (await loadProjects()).find(p => p.id === id)
    if (!found) throw new Error('Project not found')
    fill(found)
    if (justCreated) await navigateTo({ path: route.path }, { replace: true })
  } catch (e: any) {
    error.value = e?.message || 'Could not load the project'
  }
})

async function reveal() {
  secret.value = (await api<{ secret: string }>(`/admin/projects/${id}/secret`)).secret
}

async function rotate() {
  if (!confirm('Rotate the secret? Tokens minted with the current one stop working right away.')) return
  secret.value = (await api<{ secret: string }>(`/admin/projects/${id}/rotate-secret`, { method: 'POST' })).secret
}

async function copy(text: string, key: string) {
  await navigator.clipboard?.writeText(text).catch(() => undefined)
  copied.value = key
  setTimeout(() => { if (copied.value === key) copied.value = '' }, 1500)
}

async function onErrorsConnected(connected: AdminProject) {
  fill(connected)
  await loadProjects()
}

async function saveSecurity() {
  saving.value = true
  saved.value = false
  saveError.value = ''
  try {
    const result = await api<{ project: AdminProject }>(`/admin/projects/${id}`, {
      method: 'PATCH',
      body: {
        allowedOrigins: security.allowedOriginsText.split(/\n/).map(s => s.trim()).filter(Boolean),
        actionWebhookUrl: security.actionWebhookUrl,
        ...(security.actionWebhookSecret ? { actionWebhookSecret: security.actionWebhookSecret } : {})
      }
    })
    fill(result.project)
    await loadProjects()
    saved.value = true
  } catch (e: any) {
    saveError.value = e?.message || 'Could not save'
  } finally {
    saving.value = false
  }
}

const appUrl = useAppUrl()

const mintSnippet = computed(() => `import { createHmac } from 'node:crypto'

// GET /api/support/token — only for a signed-in user of your app
export function mintSupportToken(user) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ iss: '${project.value?.publicKey}', sub: user.id, name: user.name, email: user.email, iat: now, exp: now + 3600 })
  const sig = createHmac('sha256', process.env.HELP_BITES_SECRET).update(head + '.' + body).digest('base64url')
  return head + '.' + body + '.' + sig
}`)
const feedbackSnippet = computed(() => `<div id="feedback"></div>
<script src="${appUrl.value}/feedback.js" data-project="${project.value?.publicKey}" data-target="#feedback" defer><\/script>
<script>
  window.HelpBitesFeedback = window.HelpBitesFeedback || []
  HelpBitesFeedback.push(['init', {
    // resolve to null when nobody is signed in: the board stays readable
    getToken: () => fetch('/api/support/token').then(r => r.ok ? r.json() : null).then(r => r && r.token),
    onSignIn: () => location.assign('/login') // where to send a visitor who tries to post
  }])
  // After your user signs in or out: HelpBitesFeedback.push(['refresh'])
<\/script>`)
const flagsSnippet = computed(() => `// GET /v1/flags → { flags: { ai_chat: { state: 'admins', fallback: 'off', targets: ['backend'], allow: ['user_123'] } } }
const { flags } = await fetch('${appUrl.value}/v1/flags?target=backend', {
  headers: { authorization: \`Bearer \${process.env.HELP_BITES_SECRET}\` }
}).then(r => r.json())

function isOn(key, user) {
  const flag = flags[key]
  if (!flag || flag.state === 'off') return false
  if (flag.state === 'on') return true
  return user.isAdmin || flag.allow.includes(user.id) || flag.allow.includes(user.email?.toLowerCase())
}`)
const emailSnippet = computed(() => `// POST /v1/emails/send → { id, sent, failed, suppressed, results: [{ to, status, logId }] }
await fetch('${appUrl.value}/v1/emails/send', {
  method: 'POST',
  headers: { authorization: \`Bearer \${process.env.HELP_BITES_SECRET}\`, 'content-type': 'application/json' },
  body: JSON.stringify({
    template: 'welcome', // or html: '<p>Hi {{name}}</p>' with a subject
    to: [{ email: user.email, name: user.name }],
    variables: { name: user.name },
    idempotencyKey: \`welcome-\${user.id}\` // a retry never sends twice
  })
})`)
const sentrySnippet = computed(() => `import * as Sentry from '@sentry/browser'

Sentry.init({ dsn: '${project.value?.errors?.dsn || ''}' })
Sentry.setUser({ id: user.id }) // the same stable value used as the HelpBites token's sub`)
const widgetSnippet = computed(() => `<script src="${appUrl.value}/widget.js" data-project="${project.value?.publicKey}" defer><\/script>
<script>
  window.HelpBites = window.HelpBites || []
  HelpBites.push(['init', {
    getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token),
    context: { type: 'page', id: location.pathname, label: document.title, url: location.href } // optional
  }])
<\/script>`)
</script>

<style scoped>
@reference "~/assets/css/main.css";
.section-title { @apply text-[15px] font-semibold text-highlighted; }
.cred { @apply grid gap-2 px-5 py-4 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-6; }
.cred-title { @apply text-[13px] font-medium text-highlighted; }
.cred-hint { @apply mt-0.5 text-xs text-muted; }
.cred-value { @apply flex min-w-0 items-center gap-0.5; }
.cred-code { @apply mr-1 min-w-0 flex-1 truncate rounded-lg bg-elevated px-2.5 py-1.5 font-mono text-xs select-all; }
.panel-head { @apply flex flex-wrap items-start justify-between gap-3 text-[13px] text-toned; }
.panel-head > p { @apply min-w-0 flex-1; }
.steps { @apply space-y-6; counter-reset: step; }
.steps > li { @apply relative space-y-2 pl-9; counter-increment: step; }
.steps > li::before { @apply absolute top-0 left-0 grid size-6 place-items-center rounded-full border border-default bg-elevated text-[11px] font-semibold text-toned tabular-nums; content: counter(step); }
.step-title { @apply text-[13px] leading-6 font-medium text-highlighted; }
.step-text { @apply text-[13px] text-toned; }
.inline-code { @apply rounded border border-default bg-elevated px-1 py-px font-mono text-xs; }
</style>
