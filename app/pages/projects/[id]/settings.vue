<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" title="Settings" />
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="project" class="mx-auto flex max-w-5xl gap-12 px-6 pt-8 pb-4">
        <form class="min-w-0 flex-1 space-y-10" @submit.prevent="save">
          <!-- General -->
          <section id="general" class="section">
            <header><h2 class="section-title">General</h2><p class="section-hint">What the project is called and where it lives.</p></header>
            <div class="card">
              <UFormField label="Name" required><UInput v-model="form.name" class="w-full" required maxlength="80" /></UFormField>
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField label="Site URL" hint="Used in email links"><UInput v-model="form.siteUrl" placeholder="https://app.example.com" class="w-full" /></UFormField>
                <UFormField label="Inbox path" hint="Where the widget lives on that site"><UInput v-model="form.inboxPath" placeholder="/app" class="w-full" /></UFormField>
              </div>
            </div>
          </section>

          <!-- Branding -->
          <section id="branding" class="section">
            <header><h2 class="section-title">Branding</h2><p class="section-hint">How the project looks in this panel and in the widget your users see.</p></header>
            <div class="divide-y divide-default overflow-hidden rounded-xl border border-default">
              <div class="row">
                <div class="row-label"><p class="row-title">Logo</p><p class="section-hint">Shown in the sidebar, page headers and lists instead of the coloured initial. Square, at least 64×64.</p></div>
                <div class="flex items-center gap-3">
                  <ProjectDot tile :project-id="id" :accent="form.accent" :name="form.name" :icon-url="form.iconUrl" class="!size-12 !rounded-xl !text-lg" />
                  <div class="flex flex-col gap-1.5">
                    <div class="flex gap-1.5">
                      <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-upload" :loading="uploading === 'iconUrl'" @click="pick('iconUrl')">Upload</UButton>
                      <UButton v-if="form.iconUrl" size="xs" color="neutral" variant="ghost" @click="form.iconUrl = ''">Remove</UButton>
                    </div>
                    <span class="flex items-center gap-1.5 text-xs text-muted"><ProjectDot tile :project-id="id" :accent="form.accent" :name="form.name" :icon-url="form.iconUrl" />{{ form.name || 'Project' }} in the sidebar</span>
                  </div>
                </div>
              </div>

              <div class="row">
                <div class="row-label"><p class="row-title">Colour</p><p class="section-hint">The sidebar tile, the widget's send button and your chat bubbles.</p></div>
                <div class="space-y-2.5">
                  <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
                    <button
                      v-for="swatch in swatches"
                      :key="swatch"
                      type="button"
                      role="radio"
                      :aria-checked="form.accent === swatch"
                      :aria-label="swatch"
                      class="grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-(--ui-bg) transition-shadow"
                      :class="form.accent === swatch ? 'ring-2 ring-(--ui-text-highlighted)' : 'hover:ring-2 hover:ring-(--ui-border-accented)'"
                      :style="{ backgroundColor: swatch }"
                      @click="form.accent = swatch"
                    >
                      <UIcon v-if="form.accent === swatch" name="i-lucide-check" class="size-3.5 text-white" />
                    </button>
                  </div>
                  <div class="flex items-center gap-2">
                    <input :value="form.accent || fallbackColor" type="color" class="size-7 cursor-pointer rounded-md border border-default bg-transparent p-0.5" aria-label="Custom colour" @input="form.accent = ($event.target as HTMLInputElement).value">
                    <UInput v-model="form.accent" :placeholder="fallbackColor" class="w-28 font-mono text-xs" aria-label="Hex colour" />
                    <span v-if="form.accent && !validAccent" class="text-xs text-error">Use a hex colour like #4f46e5</span>
                  </div>
                </div>
              </div>

              <div class="row">
                <div class="row-label"><p class="row-title">Widget images</p><p class="section-hint">The brand logo heads the chat; the assistant avatar sits beside AI replies.</p></div>
                <div class="flex flex-wrap gap-6">
                  <div v-for="image in widgetImages" :key="image.field" class="flex items-center gap-3">
                    <img v-if="form[image.field]" :src="form[image.field]" :alt="image.label" class="size-12 rounded-xl bg-elevated object-contain">
                    <span v-else class="grid size-12 place-items-center rounded-xl border border-dashed border-accented text-dimmed"><UIcon :name="image.icon" class="size-5" /></span>
                    <div class="flex flex-col gap-1.5">
                      <span class="text-[13px] font-medium">{{ image.label }}</span>
                      <div class="flex gap-1.5">
                        <UButton size="xs" color="neutral" variant="outline" :loading="uploading === image.field" @click="pick(image.field)">Upload</UButton>
                        <UButton v-if="form[image.field]" size="xs" color="neutral" variant="ghost" @click="form[image.field] = ''">Remove</UButton>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- What a user sees, from the fields above: header, a reply, their own message. -->
              <div class="bg-muted/60 p-5">
                <p class="section-label mb-2">Widget preview</p>
                <div class="mx-auto max-w-sm overflow-hidden rounded-xl border border-default bg-default shadow-sm">
                  <div class="flex h-11 items-center gap-2 border-b border-default px-3">
                    <img v-if="form.brandLogoUrl" :src="form.brandLogoUrl" alt="" class="size-6 rounded-md bg-elevated object-cover">
                    <span v-else class="grid size-6 place-items-center rounded-md text-[11px] font-semibold text-white" :style="{ backgroundColor: widgetAccent }">{{ (form.name || '?').slice(0, 1).toUpperCase() }}</span>
                    <span class="truncate text-[13px] font-semibold text-highlighted">{{ form.name || 'Your project' }}</span>
                  </div>
                  <div class="space-y-2.5 p-3">
                    <ChatNotice :text="form.chatNotice" />
                    <div class="flex items-end gap-2">
                      <img v-if="form.assistantLogoUrl" :src="form.assistantLogoUrl" alt="" class="size-6 shrink-0 rounded-full bg-elevated object-cover">
                      <span v-else class="grid size-6 shrink-0 place-items-center rounded-full bg-elevated text-muted"><UIcon name="i-lucide-sparkles" class="size-3.5" /></span>
                      <p class="bubble-them max-w-[75%] rounded-2xl rounded-bl-md px-3 py-1.5 text-[13px]">Hi! How can we help?</p>
                    </div>
                    <p class="ml-auto w-fit max-w-[75%] rounded-2xl rounded-br-md px-3 py-1.5 text-[13px] text-white" :style="{ backgroundColor: widgetAccent }">My export is stuck</p>
                  </div>
                </div>
              </div>
            </div>
            <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="upload">
          </section>

          <!-- Chat widget -->
          <section id="widget" class="section">
            <header><h2 class="section-title">Chat widget</h2><p class="section-hint">What users can do when they start a chat.</p></header>
            <div class="card">
              <UFormField label="Chat notice" hint="Shown centered at the top of every new chat. Leave blank to hide.">
                <UTextarea v-model="form.chatNotice" :rows="2" autoresize class="w-full" maxlength="500" placeholder="A human will always read this chat, but an AI might answer your questions first." />
              </UFormField>
              <UCheckbox v-model="form.allowAttachments" label="Users can attach images" />
              <UCheckbox v-model="form.allowAnonymousUsers" label="Allow email-only users (no sign-in)" description="Apps without a backend can chat and post feedback with just an email address. After a few actions, the person must confirm the address with a code we email them." />
              <div class="space-y-2">
                <UCheckbox v-model="form.letUsersChooseType" label="Let users choose a request type when starting a chat" description="Only takes effect once the project has more than one ticket type." />
                <UCheckbox v-model="form.allowOtherType" label="Offer an “Other” option" description="Creates a plain support ticket." :disabled="!form.letUsersChooseType" class="pl-6" />
              </div>
            </div>
          </section>

          <!-- Email -->
          <section id="email" class="section">
            <header><h2 class="section-title">Email</h2><p class="section-hint">Who this project's email comes from — the send API, notifications and feedback updates — and who hears about new chats.</p></header>
            <div class="card">
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField label="Reply as" hint="Signs your replies and their emails"><UInput v-model="form.fromName" placeholder="Elías" class="w-full" /></UFormField>
                <UFormField label="Notify when a user writes" hint="Comma separated, up to 5"><UInput v-model="form.notifyEmailsText" placeholder="you@example.com" class="w-full" /></UFormField>
                <UFormField label="From address"><UInput v-model="form.fromEmail" type="email" :placeholder="emailSettings?.fromEmail || 'hello@mail.example.com'" class="w-full" /></UFormField>
                <UFormField label="Sending domain"><UInput v-model="form.mailDomain" :placeholder="emailSettings?.domain || 'mail.example.com'" class="w-full font-mono text-xs" /></UFormField>
                <UFormField label="Reply-to"><UInput v-model="form.replyTo" type="email" placeholder="Replies go to the from address" class="w-full" /></UFormField>
              </div>
              <UCheckbox v-model="form.emailLogContent" label="Keep a copy of each email in the log" description="Shows the message itself in the log. It can include sign-in and reset links." />
              <p class="text-xs text-muted">Blank fields use the server's defaults, shown greyed out. The sending domain must be in the same Mailgun account as the server's API key, and the from address should be on it.</p>
            </div>
          </section>

          <!-- Collaborators -->
          <section id="collaborators" class="section">
            <header><h2 class="section-title">Collaborators</h2><p class="section-hint">The people who answer {{ form.name || 'this project' }}'s chats.</p></header>
            <div class="card">
              <SettingsTeam :removable="false" add-label="Invite collaborator">
                <template #description>Everyone on your team can open this project and every other one. <button type="button" class="font-medium text-default underline-offset-2 hover:underline" @click="settingsTab = 'team'">Manage the team</button></template>
              </SettingsTeam>
            </div>
          </section>

          <!-- GitHub -->
          <section id="github" class="section">
            <header><h2 class="section-title">GitHub repos</h2><p class="section-hint">The code behind {{ form.name || 'this project' }}. AI error notes and legal documents read these; HelpBites never writes to them.</p></header>
            <div class="card"><SettingsProjectRepos :project-id="id" /></div>
          </section>

          <!-- Save bar: rides the bottom of the page while there is something to save. -->
          <div v-if="dirty || saveError" class="sticky bottom-4 z-10 flex justify-center">
            <div class="flex items-center gap-3 rounded-full border border-default bg-default/95 py-1.5 pr-1.5 pl-4 shadow-lg backdrop-blur" role="status">
              <span class="text-[13px]" :class="saveError ? 'text-error' : 'text-muted'">{{ saveError || 'Unsaved changes' }}</span>
              <UButton size="sm" color="neutral" variant="ghost" :disabled="saving" @click="discard">Discard</UButton>
              <UButton type="submit" size="sm" :loading="saving" :disabled="!validAccent">Save changes</UButton>
            </div>
          </div>
        </form>

        <aside class="hidden w-40 shrink-0 lg:block">
          <nav class="sticky top-8 space-y-1.5 text-sm" aria-label="On this page">
            <a v-for="s in sections" :key="s.id" :href="`#${s.id}`" class="block text-muted hover:text-highlighted">{{ s.label }}</a>
            <NuxtLink :to="`/projects/${id}/dev`" class="!mt-4 flex items-center gap-1.5 border-t border-default pt-3 text-muted hover:text-highlighted"><UIcon name="i-lucide-code-xml" class="size-3.5" />Keys and webhooks</NuxtLink>
          </nav>
        </aside>
      </div>
      <p v-else-if="error" class="p-8 text-[13px] text-error">{{ error }}</p>
      <div v-else class="mx-auto max-w-2xl space-y-3 px-6 py-8"><USkeleton v-for="i in 5" :key="i" class="h-24 rounded-xl" /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AdminProject } from '~~/server/utils/projects'
import { projectColor } from '~/utils/projectColor'

definePageMeta({ middleware: 'agent' })

type ImageField = 'iconUrl' | 'brandLogoUrl' | 'assistantLogoUrl'

const { api, loadProjects, agentHeaders } = useAgent()
const route = useRoute()
const id = String(route.params.id)
const settingsTab = useState('settings-tab', () => '')

const project = ref<AdminProject | null>(null)
const error = ref('')
const saving = ref(false)
const saveError = ref('')
const uploading = ref<ImageField | ''>('')
const fileInput = ref<HTMLInputElement | null>(null)
const emailSettings = ref<{ fromEmail: string, domain: string } | null>(null)
let uploadTarget: ImageField = 'iconUrl'

const sections = [
  { id: 'general', label: 'General' },
  { id: 'branding', label: 'Branding' },
  { id: 'widget', label: 'Chat widget' },
  { id: 'email', label: 'Email' },
  { id: 'collaborators', label: 'Collaborators' },
  { id: 'github', label: 'GitHub repos' }
]
const widgetImages = [
  { field: 'brandLogoUrl' as const, label: 'Brand logo', icon: 'i-lucide-image' },
  { field: 'assistantLogoUrl' as const, label: 'Assistant avatar', icon: 'i-lucide-sparkles' }
]
// Linear's indigo, then the colours projects without one are given.
const swatches = ['#5e6ad2', '#0f766e', '#0369a1', '#0e7490', '#4d7c0f', '#b45309', '#c2410c', '#be123c', '#7c3aed']

const blank = () => ({ name: '', siteUrl: '', inboxPath: '', iconUrl: '', brandLogoUrl: '', assistantLogoUrl: '', accent: '', chatNotice: '', allowAttachments: true, allowAnonymousUsers: false, letUsersChooseType: false, allowOtherType: false, fromName: '', notifyEmailsText: '', fromEmail: '', replyTo: '', mailDomain: '', emailLogContent: false })
const form = reactive(blank())
const snapshot = ref('')
const dirty = computed(() => !!snapshot.value && JSON.stringify(form) !== snapshot.value)
const validAccent = computed(() => !form.accent || /^#[0-9a-f]{6}$/i.test(form.accent.trim()))
const fallbackColor = computed(() => projectColor(id))
// The widget falls back to the panel's indigo, not the sidebar's hashed colour.
const widgetAccent = computed(() => (validAccent.value && form.accent) || '#5e6ad2')

function fill(p: AdminProject) {
  project.value = p
  Object.assign(form, {
    name: p.name,
    siteUrl: p.siteUrl,
    inboxPath: p.inboxPath,
    iconUrl: p.iconUrl || '',
    brandLogoUrl: p.brandLogoUrl || '',
    assistantLogoUrl: p.assistantLogoUrl || '',
    accent: p.theme?.accent || '',
    chatNotice: p.chatNotice || '',
    allowAttachments: p.allowAttachments,
    allowAnonymousUsers: p.allowAnonymousUsers === true,
    letUsersChooseType: p.letUsersChooseType,
    allowOtherType: p.allowOtherType,
    fromName: p.fromName,
    notifyEmailsText: p.notifyEmails.join(', '),
    fromEmail: p.fromEmail || '',
    replyTo: p.replyTo || '',
    mailDomain: p.mailDomain || '',
    emailLogContent: p.emailLogContent === true
  })
  snapshot.value = JSON.stringify(form)
}

function discard() {
  saveError.value = ''
  if (project.value) fill(project.value)
}

function pick(field: ImageField) {
  uploadTarget = field
  fileInput.value?.click()
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const field = uploadTarget
  uploading.value = field
  saveError.value = ''
  try {
    const body = new FormData()
    body.append('file', file)
    const res = await $fetch<{ url: string }>(`/v1/admin/projects/${id}/logo`, { method: 'POST', body, headers: agentHeaders() })
    form[field] = res.url
  } catch (e: any) {
    saveError.value = e?.data?.statusMessage || e?.message || 'Could not upload the image'
  } finally {
    uploading.value = ''
    input.value = ''
  }
}

async function save() {
  if (!dirty.value || saving.value || !validAccent.value) return
  saving.value = true
  saveError.value = ''
  try {
    const { accent, notifyEmailsText, ...rest } = form
    const result = await api<{ project: AdminProject }>(`/admin/projects/${id}`, {
      method: 'PATCH',
      // The server replaces theme wholesale; keep the keys this page doesn't edit.
      body: { ...rest, notifyEmails: notifyEmailsText, theme: { ...project.value?.theme, accent: accent.trim() } }
    })
    fill(result.project)
    await loadProjects()
    useToast().add({ title: 'Settings saved', icon: 'i-lucide-check', duration: 2000 })
  } catch (e: any) {
    saveError.value = e?.message || 'Could not save'
  } finally {
    saving.value = false
  }
}

defineShortcuts({ meta_s: { usingInput: true, handler: save } })
onBeforeRouteLeave(() => !dirty.value || confirm('Leave without saving your changes?'))

onMounted(async () => {
  api<{ fromEmail: string, domain: string }>('/admin/email-settings').then((s) => { emailSettings.value = s }).catch(() => {})
  try {
    const found = (await loadProjects()).find(p => p.id === id)
    if (!found) throw new Error('Project not found')
    fill(found)
  } catch (e: any) {
    error.value = e?.message || 'Could not load the project'
  }
})
</script>

<style scoped>
@reference "~/assets/css/main.css";
.section { @apply scroll-mt-6 space-y-3; }
.section-title { @apply text-[15px] font-semibold text-highlighted; }
.section-hint { @apply text-[13px] text-muted; }
.card { @apply space-y-4 overflow-hidden rounded-xl border border-default p-5; }
.row { @apply grid gap-4 p-5 sm:grid-cols-[12rem_1fr] sm:items-center; }
.row-title { @apply text-[13px] font-medium text-highlighted; }
.row-label .section-hint { @apply mt-0.5 text-xs; }
</style>
