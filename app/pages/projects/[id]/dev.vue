<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.dev')">
      <template #actions>
        <UButton to="/developer" icon="i-lucide-book-open" :label="$t('projectPages.dev.guide')" color="neutral" variant="ghost" size="sm" class="hidden sm:inline-flex" />
        <UButton to="/_docs/scalar" target="_blank" icon="i-lucide-code-xml" :label="$t('projectPages.dev.apiReference')" color="neutral" variant="outline" size="sm" />
      </template>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="project" class="mx-auto max-w-4xl space-y-10 px-6 py-8">
        <header class="space-y-1">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ $t('projectPages.dev.connect', { name: project.name }) }}</h1>
          <p class="text-[13px] text-muted">{{ $t('projectPages.dev.intro') }} <NuxtLink :to="`/projects/${id}/settings`" class="font-medium text-default underline-offset-2 hover:underline">{{ $t('projectPages.dev.projectSettings') }}</NuxtLink>{{ $t('projectPages.dev.introEnd') }}</p>
        </header>

        <!-- Credentials -->
        <section class="space-y-3">
          <h2 class="section-title">{{ $t('projectPages.dev.credentials') }}</h2>
          <div class="divide-y divide-default overflow-hidden rounded-xl border border-default">
            <div class="cred">
              <div><p class="cred-title">{{ $t('projectPages.dev.publicKey') }}</p><p class="cred-hint">{{ $t('projectPages.dev.publicKeyHint') }}</p></div>
              <div class="cred-value">
                <code class="cred-code">{{ project.publicKey }}</code>
                <UTooltip :text="copied === 'pk' ? $t('projectPages.dev.copied') : $t('projectPages.dev.copy')"><UButton :icon="copied === 'pk' ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('projectPages.dev.copyPublicKey')" @click="copy(project.publicKey, 'pk')" /></UTooltip>
              </div>
            </div>
            <div class="cred">
              <div><p class="cred-title">{{ $t('projectPages.dev.secretKey') }}</p><p class="cred-hint">{{ $t('projectPages.dev.secretKeyHint') }}</p></div>
              <div class="cred-value">
                <code class="cred-code" :class="secret ? '' : 'tracking-widest text-dimmed'">{{ secret || '••••••••••••••••••••••••' }}</code>
                <UTooltip v-if="secret" :text="copied === 'sk' ? $t('projectPages.dev.copied') : $t('projectPages.dev.copy')"><UButton :icon="copied === 'sk' ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('projectPages.dev.copySecret')" @click="copy(secret, 'sk')" /></UTooltip>
                <UTooltip :text="secret ? $t('projectPages.dev.hide') : $t('projectPages.dev.reveal')"><UButton :icon="secret ? 'i-lucide-eye-off' : 'i-lucide-eye'" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="secret ? $t('projectPages.dev.hideSecret') : $t('projectPages.dev.revealSecret')" @click="secret ? (secret = '') : reveal()" /></UTooltip>
                <UTooltip :text="$t('projectPages.dev.rotate')"><UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('projectPages.dev.rotateSecret')" @click="rotate" /></UTooltip>
              </div>
            </div>
            <div class="cred">
              <div><p class="cred-title">{{ $t('projectPages.dev.baseUrl') }}</p><p class="cred-hint">{{ $t('projectPages.dev.baseUrlHint') }}</p></div>
              <div class="cred-value">
                <code class="cred-code">{{ appUrl }}</code>
                <UTooltip :text="copied === 'url' ? $t('projectPages.dev.copied') : $t('projectPages.dev.copy')"><UButton :icon="copied === 'url' ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('projectPages.dev.copyBaseUrl')" @click="copy(appUrl, 'url')" /></UTooltip>
              </div>
            </div>
          </div>
          <p v-if="justCreated" class="flex items-start gap-2 text-xs text-muted"><UIcon name="i-lucide-info" class="mt-0.5 size-3.5 shrink-0" />{{ $t('projectPages.dev.justCreated') }}</p>
        </section>

        <!-- Integrations: each tile is a tab for its guide below. -->
        <section id="integrations" class="scroll-mt-6 space-y-3">
          <h2 class="section-title">{{ $t('projectPages.dev.integrations') }}</h2>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="tablist" :aria-label="$t('projectPages.dev.integrations')">
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
                <p>{{ $t('projectPages.dev.chatIntro') }}</p>
                <UButton :to="`/projects/${id}/settings#widget`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="$t('projectPages.dev.widgetSettings')" />
              </div>
              <ol class="steps">
                <li><p class="step-title">{{ $t('projectPages.dev.mintTitle') }}</p><p class="step-text">{{ $t('projectPages.dev.mintText') }}</p><CodeBlock :code="mintSnippet" lang="js" /></li>
                <li><p class="step-title">{{ $t('projectPages.dev.loadTitle') }}</p><p class="step-text">{{ $t('projectPages.dev.onlyThe') }} <a href="#security" class="underline">{{ $t('projectPages.dev.allowedOriginsLink') }}</a> {{ $t('projectPages.dev.belowMayHost') }}</p><CodeBlock :code="widgetSnippet" lang="html" /></li>
                <li><p class="step-title">{{ $t('projectPages.dev.ownUiTitle') }}</p><p class="step-text">{{ $t('projectPages.dev.callThe') }} <a href="/_docs/scalar" target="_blank" rel="noopener" class="underline">API</a> {{ $t('projectPages.dev.withToken') }} <code class="inline-code">Authorization: Bearer &lt;token&gt;</code>{{ $t('projectPages.dev.passAssistant') }} <code class="inline-code">assistantId</code> {{ $t('projectPages.dev.assistantRoute') }}</p></li>
              </ol>
            </template>

            <!-- Feedback board -->
            <template v-else-if="tab === 'feedback'">
              <div class="panel-head">
                <p>{{ $t('projectPages.dev.feedbackIntro') }} {{ project.feedback?.enabled ? $t('projectPages.dev.feedbackOn') : $t('projectPages.dev.feedbackOff') }}</p>
                <UButton :to="`/projects/${id}/feedback`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="$t('projectPages.dev.manage')" />
              </div>
              <ol class="steps">
                <li><p class="step-title">{{ $t('projectPages.dev.dropTitle') }}</p><p class="step-text">{{ $t('projectPages.dev.dropText') }}</p><CodeBlock :code="feedbackSnippet" lang="html" /></li>
                <li><p class="step-title">{{ $t('projectPages.dev.ownUiTitle') }}</p><p class="step-text">{{ $t('projectPages.dev.useThe') }} <code class="inline-code">/v1/feedback</code> (<a href="/_docs/scalar" target="_blank" rel="noopener" class="underline">API</a>){{ $t('projectPages.dev.feedbackRead') }} <code class="inline-code">?pk={{ project.publicKey }}</code>{{ $t('projectPages.dev.feedbackWrite') }} <code class="inline-code">role: "admin"</code> {{ $t('projectPages.dev.feedbackModerate') }} <code class="inline-code">POST /v1/feedback/import</code> {{ $t('projectPages.dev.feedbackImport') }}</p></li>
              </ol>
            </template>

            <!-- Feature flags -->
            <template v-else-if="tab === 'flags'">
              <div class="panel-head">
                <p>{{ $t('projectPages.dev.flagsIntro') }}</p>
                <UButton :to="`/projects/${id}/flags`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="$t('projectPages.dev.manage')" />
              </div>
              <p class="step-text">{{ $t('projectPages.dev.flagsDecide') }} <code class="inline-code">admins</code> {{ $t('projectPages.dev.flagsAgainst') }} <code class="inline-code">allow</code> {{ $t('projectPages.dev.flagsCache') }} <code class="inline-code">fallback</code>{{ $t('projectPages.dev.flagsUnknown') }} <code class="inline-code">?pk=</code> {{ $t('projectPages.dev.flagsOr') }} <code class="inline-code">enabled</code> {{ $t('projectPages.dev.flagsWorked') }}<code class="inline-code">role: "admin"</code> {{ $t('projectPages.dev.flagsCounts') }}</p>
              <CodeBlock :code="flagsSnippet" lang="js" />
            </template>

            <!-- Error tracking -->
            <template v-else-if="tab === 'errors'">
              <div class="panel-head">
                <p v-if="project.errors?.connected">{{ $t('projectPages.dev.reportingTo', { providers: project.errorLinks.length > 1 ? project.errorLinks.map(item => item.label).join(', ') : project.errors.providerName }) }} <UButton variant="link" size="sm" class="p-0" :label="$t('projectPages.dev.manageServers')" @click="settingsTab = 'error-tracking'" /> <UButton variant="link" size="sm" class="p-0" :label="$t('projectPages.dev.connectAnother')" @click="connectErrorsOpen = true" /></p>
                <p v-else>{{ $t('projectPages.dev.connectErrorsIntro') }}</p>
                <UButton :to="`/projects/${id}/errors`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="$t('sections.errors')" />
              </div>
              <template v-if="project.errors?.connected">
                <p v-for="item in project.errorLinks.filter(link => link.alertWebhookUrl)" :key="item.id" class="step-text">{{ $t(project.errorLinks.length > 1 ? 'projectPages.dev.alertsForNamed' : 'projectPages.dev.alertsFor', { label: item.label }) }} <span class="font-medium">Slack</span> {{ $t('projectPages.dev.alertsUrl') }} <code class="inline-code break-all">{{ item.alertWebhookUrl }}</code>{{ $t('projectPages.dev.period') }}</p>
                <p class="step-text">{{ $t('projectPages.dev.dsnIntro', { sdk: project.errorLinks.length > 1 ? ` (${project.errorLinks[0]?.label})` : '' }) }}</p>
                <CodeBlock :code="sentrySnippet" lang="js" />
                <p v-for="item in project.errorLinks.slice(1)" :key="item.id" class="step-text">{{ $t('projectPages.dev.dsnFor', { label: item.label }) }} <code class="inline-code break-all">{{ item.dsn }}</code></p>
              </template>
              <UButton v-else size="sm" icon="i-lucide-plug" :label="$t('projectPages.dev.connectErrorTracking')" @click="connectErrorsOpen = true" />
              <ConnectErrorTrackingModal v-model:open="connectErrorsOpen" :project-id="id" @connected="onErrorsConnected" />
            </template>

            <!-- Email -->
            <template v-else-if="tab === 'email'">
              <div class="panel-head">
                <p>{{ $t('projectPages.dev.emailIntro') }}</p>
                <div class="flex shrink-0 gap-1">
                  <UButton :to="`/projects/${id}/email?view=templates`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="$t('projectPages.dev.templates')" />
                  <UButton :to="`/projects/${id}/email?view=log`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="$t('projectPages.dev.log')" />
                </div>
              </div>
              <p class="step-text">{{ $t('projectPages.dev.emailSendPart') }} <code class="inline-code">html</code> {{ $t('projectPages.dev.emailFilePart') }} <code class="inline-code">GET /v1/email-logs</code> {{ $t('projectPages.dev.emailReadPart') }} <NuxtLink :to="`/projects/${id}/email?view=settings`" class="underline">{{ $t('projectPages.settings.senderMovedLink') }}</NuxtLink>{{ $t('projectPages.dev.period') }}</p>
              <CodeBlock :code="emailSnippet" lang="js" />
            </template>
          </div>
        </section>

        <!-- Security and webhooks -->
        <form id="security" class="scroll-mt-6 space-y-3" @submit.prevent="saveSecurity">
          <h2 class="section-title">{{ $t('projectPages.dev.securityWebhooks') }}</h2>
          <div class="space-y-4 rounded-xl border border-default p-5">
            <UFormField :label="$t('projectPages.dev.allowedOrigins')" :hint="$t('projectPages.dev.allowedOriginsHint')">
              <UTextarea v-model="security.allowedOriginsText" :rows="2" autoresize class="w-full font-mono text-xs" placeholder="https://app.example.com" />
            </UFormField>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField :label="$t('projectPages.dev.actionWebhookUrl')" :hint="$t('projectPages.dev.actionWebhookUrlHint')"><UInput v-model="security.actionWebhookUrl" placeholder="https://api.example.com/helpbites/actions" class="w-full" /></UFormField>
              <UFormField :label="$t('projectPages.dev.actionWebhookSecret')" :hint="project.hasActionWebhookSecret ? $t('projectPages.dev.secretKeep') : $t('projectPages.dev.secretLength')"><UInput v-model="security.actionWebhookSecret" type="password" placeholder="••••••••••••••••" class="w-full" autocomplete="new-password" /></UFormField>
            </div>
            <div class="flex items-center gap-3">
              <UButton type="submit" size="sm" :loading="saving" :disabled="!securityDirty">{{ $t('projectPages.dev.save') }}</UButton>
              <span v-if="saveError" class="text-[13px] text-error">{{ saveError }}</span>
              <span v-else-if="saved && !securityDirty" class="text-[13px] text-muted">{{ $t('common.saved') }}</span>
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
const { t } = useI18n()
const route = useRoute()
const id = String(route.params.id)

const project = ref<AdminProject | null>(null)
// A new project lands here with its secret, once, handed over in memory by
// the default layout.
const newProjectSecret = useState<{ id: string, secret: string } | null>('new-project-secret', () => null)
const secret = ref(newProjectSecret.value?.id === id ? newProjectSecret.value.secret : '')
const justCreated = !!secret.value
newProjectSecret.value = null
const tabs: Tab[] = ['chat', 'feedback', 'flags', 'errors', 'email']
const tab = ref<Tab>(tabs.includes(route.query.tab as Tab) ? route.query.tab as Tab : 'chat')
const error = ref('')
const saving = ref(false)
const saved = ref(false)
const saveError = ref('')
const copied = ref('')
const connectErrorsOpen = ref(false)
const settingsTab = useState('settings-tab', () => '')
const security = reactive({ allowedOriginsText: '', actionWebhookUrl: '', actionWebhookSecret: '' })

const dots: Record<Tone, string> = { ok: 'bg-success', warn: 'bg-warning', off: 'bg-(--ui-text-dimmed)' }
const integrations = computed(() => {
  const p = project.value!
  const origins = p.allowedOrigins.length
  const flags = p.flags?.length || 0
  return [
    // Green only once the widget has loaded on a host page: allowing an origin is not installing it.
    { key: 'chat' as const, label: t('projectPages.dev.chatWidget'), icon: 'i-lucide-message-circle-more', tone: (origins && p.widgetSeenAt ? 'ok' : 'warn') as Tone, status: !origins ? t('projectPages.dev.noOrigins') : p.widgetSeenAt ? t('projectPages.dev.originsCount', origins) : t('projectPages.dev.widgetNotSeen') },
    { key: 'feedback' as const, label: t('sections.feedback'), icon: 'i-lucide-lightbulb', tone: (p.feedback?.enabled ? 'ok' : 'off') as Tone, status: p.feedback?.enabled ? t('projectPages.dev.boardOn') : t('projectPages.dev.off') },
    { key: 'flags' as const, label: t('sections.flags'), icon: 'i-lucide-toggle-right', tone: (flags ? 'ok' : 'off') as Tone, status: flags ? t('projectPages.dev.flagsCount', flags) : t('projectPages.dev.noneYet') },
    { key: 'errors' as const, label: t('sections.errors'), icon: 'i-lucide-bug', tone: (p.errors?.connected ? 'ok' : 'off') as Tone, status: p.errors?.connected ? p.errors.providerName : t('projectPages.dev.notConnected') },
    { key: 'email' as const, label: t('projectPages.dev.emailApi'), icon: 'i-lucide-mail', tone: 'ok' as Tone, status: p.fromEmail || t('projectPages.dev.defaultSender') }
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
    if (!found) throw new Error(t('projectPages.dev.projectNotFound'))
    fill(found)
  } catch (e: any) {
    error.value = e?.message || t('projectPages.dev.loadError')
  }
})

async function reveal() {
  secret.value = (await api<{ secret: string }>(`/admin/projects/${id}/secret`)).secret
}

async function rotate() {
  if (!confirm(t('projectPages.dev.rotateConfirm'))) return
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
    saveError.value = e?.message || t('projectPages.dev.saveError')
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
