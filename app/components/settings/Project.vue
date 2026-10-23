<template>
  <div class="flex h-[min(760px,92vh)] min-h-0 flex-col">
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default px-4">
      <ProjectDot tile :project-id="id" :accent="project?.theme?.accent" :name="project?.name" :icon-url="project?.iconUrl" />
      <h2 class="truncate text-[13px] font-medium text-highlighted">{{ project?.name || '…' }}<span class="text-dimmed"> / </span>{{ $t('sections.settings') }}</h2>
      <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square class="ml-auto text-muted" :aria-label="$t('settings.close')" @click="emit('close')" />
    </header>
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="project" class="mx-auto flex max-w-5xl gap-12 px-6 pt-8 pb-4">
        <form class="min-w-0 flex-1 space-y-10" @submit.prevent="save">
          <!-- General -->
          <section id="general" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.general') }}</h2><p class="section-hint">{{ $t('projectPages.settings.generalHint') }}</p></header>
            <div class="card">
              <UFormField :label="$t('common.name')" required><UInput v-model="form.name" class="w-full" required maxlength="80" /></UFormField>
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField :label="$t('projectPages.settings.siteUrl')" :hint="$t('projectPages.settings.siteUrlHint')"><UInput v-model="form.siteUrl" placeholder="https://app.example.com" class="w-full" /></UFormField>
                <UFormField :label="$t('projectPages.settings.inboxPath')" :hint="$t('projectPages.settings.inboxPathHint')"><UInput v-model="form.inboxPath" placeholder="/app" class="w-full" /></UFormField>
              </div>
            </div>
          </section>

          <!-- Branding -->
          <section id="branding" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.branding') }}</h2><p class="section-hint">{{ $t('projectPages.settings.brandingHint') }}</p></header>
            <div class="divide-y divide-default overflow-hidden rounded-xl border border-default">
              <div class="row">
                <div class="row-label"><p class="row-title">{{ $t('projectPages.settings.logo') }}</p><p class="section-hint">{{ $t('projectPages.settings.logoHint') }}</p></div>
                <div class="flex items-center gap-3">
                  <ProjectDot tile :project-id="id" :accent="form.accent" :name="form.name" :icon-url="form.iconUrl" class="!size-12 !rounded-xl !text-lg" />
                  <div class="flex flex-col gap-1.5">
                    <div class="flex gap-1.5">
                      <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-upload" :loading="uploading === 'iconUrl'" @click="pick('iconUrl')">{{ $t('projectPages.settings.upload') }}</UButton>
                      <UButton v-if="form.iconUrl" size="xs" color="neutral" variant="ghost" @click="form.iconUrl = ''">{{ $t('projectPages.settings.remove') }}</UButton>
                    </div>
                    <span class="flex items-center gap-1.5 text-xs text-muted"><ProjectDot tile :project-id="id" :accent="form.accent" :name="form.name" :icon-url="form.iconUrl" />{{ $t('projectPages.settings.inSidebar', { name: form.name || $t('projectPages.settings.projectFallback') }) }}</span>
                  </div>
                </div>
              </div>

              <div class="row">
                <div class="row-label">
                  <p class="row-title">{{ $t('projectPages.settings.colour') }}</p>
                  <p class="section-hint">{{ $t('projectPages.settings.colourHint') }}</p>
                  <p class="section-hint">
                    <i18n-t keypath="projectPages.settings.colourKit" tag="span">
                      <template #brand><NuxtLink :to="`/projects/${id}/brand`" class="font-medium text-default underline-offset-2 hover:underline">{{ $t('projectPages.settings.colourKitLink') }}</NuxtLink></template>
                    </i18n-t>
                  </p>
                </div>
                <div class="space-y-2.5">
                  <div class="flex flex-wrap gap-2" role="radiogroup" :aria-label="$t('projectPages.settings.accentColour')">
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
                    <input :value="form.accent || fallbackColor" type="color" class="size-7 cursor-pointer rounded-md border border-default bg-transparent p-0.5" :aria-label="$t('projectPages.settings.customColour')" @input="form.accent = ($event.target as HTMLInputElement).value">
                    <UInput v-model="form.accent" :placeholder="fallbackColor" class="w-28 font-mono text-xs" :aria-label="$t('projectPages.settings.hexColour')" />
                    <span v-if="form.accent && !validAccent" class="text-xs text-error">{{ $t('projectPages.settings.hexHint') }}</span>
                  </div>
                </div>
              </div>

              <div class="row">
                <div class="row-label"><p class="row-title">{{ $t('projectPages.settings.widgetImages') }}</p><p class="section-hint">{{ $t('projectPages.settings.widgetImagesHint') }}</p></div>
                <div class="flex flex-wrap gap-6">
                  <div v-for="image in widgetImages" :key="image.field" class="flex items-center gap-3">
                    <img v-if="form[image.field]" :src="form[image.field]" :alt="image.label" class="size-12 rounded-xl bg-elevated object-contain">
                    <span v-else class="grid size-12 place-items-center rounded-xl border border-dashed border-accented text-dimmed"><UIcon :name="image.icon" class="size-5" /></span>
                    <div class="flex flex-col gap-1.5">
                      <span class="text-[13px] font-medium">{{ image.label }}</span>
                      <div class="flex gap-1.5">
                        <UButton size="xs" color="neutral" variant="outline" :loading="uploading === image.field" @click="pick(image.field)">{{ $t('projectPages.settings.upload') }}</UButton>
                        <UButton v-if="form[image.field]" size="xs" color="neutral" variant="ghost" @click="form[image.field] = ''">{{ $t('projectPages.settings.remove') }}</UButton>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- What a user sees, from the fields above: header, a reply, their own message. -->
              <div class="bg-muted/60 p-5">
                <p class="section-label mb-2">{{ $t('projectPages.settings.widgetPreview') }}</p>
                <div class="mx-auto max-w-sm overflow-hidden rounded-xl border border-default bg-default shadow-sm">
                  <div class="flex h-11 items-center gap-2 border-b border-default px-3">
                    <img v-if="form.brandLogoUrl" :src="form.brandLogoUrl" alt="" class="size-6 rounded-md bg-elevated object-cover">
                    <span v-else class="grid size-6 place-items-center rounded-md text-[11px] font-semibold text-white" :style="{ backgroundColor: widgetAccent }">{{ (form.name || '?').slice(0, 1).toUpperCase() }}</span>
                    <span class="truncate text-[13px] font-semibold text-highlighted">{{ form.name || $t('projectPages.settings.yourProject') }}</span>
                  </div>
                  <div class="space-y-2.5 p-3">
                    <ChatNotice :text="form.chatNotice" />
                    <div class="flex items-end gap-2">
                      <img v-if="form.assistantLogoUrl" :src="form.assistantLogoUrl" alt="" class="size-6 shrink-0 rounded-full bg-elevated object-cover">
                      <span v-else class="grid size-6 shrink-0 place-items-center rounded-full bg-elevated text-muted"><UIcon name="i-lucide-sparkles" class="size-3.5" /></span>
                      <p class="bubble-them max-w-[75%] rounded-2xl rounded-bl-md px-3 py-1.5 text-[13px]">{{ $t('projectPages.settings.previewReply') }}</p>
                    </div>
                    <p class="ml-auto w-fit max-w-[75%] rounded-2xl rounded-br-md px-3 py-1.5 text-[13px] text-white" :style="{ backgroundColor: widgetAccent }">{{ $t('projectPages.settings.previewMessage') }}</p>
                  </div>
                </div>
              </div>
            </div>
            <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="upload">
          </section>

          <!-- Company -->
          <section id="company" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.company') }}</h2><p class="section-hint">{{ $t('projectPages.settings.companyHint') }}</p></header>
            <div class="card"><SettingsProjectCompany v-model="form.company" /></div>
          </section>

          <!-- Chat widget -->
          <section id="widget" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.chatWidget') }}</h2><p class="section-hint">{{ $t('projectPages.settings.chatWidgetHint') }}</p></header>
            <div class="card">
              <UFormField :label="$t('projectPages.settings.chatNotice')" :hint="$t('projectPages.settings.chatNoticeHint')">
                <UTextarea v-model="form.chatNotice" :rows="2" autoresize class="w-full" maxlength="500" :placeholder="$t('projectPages.settings.chatNoticePlaceholder')" />
              </UFormField>
              <UCheckbox v-model="form.allowAttachments" :label="$t('projectPages.settings.allowAttachments')" />
              <UCheckbox v-model="form.allowAnonymousUsers" :label="$t('projectPages.settings.allowAnonymous')" :description="$t('projectPages.settings.allowAnonymousDescription')" />
              <div class="space-y-2">
                <p class="text-sm font-medium">{{ $t('projectPages.settings.guestAccess') }}</p>
                <p class="text-xs text-muted">{{ $t('projectPages.settings.guestAccessDescription') }}</p>
                <UCheckbox v-for="surface in GUEST_SURFACES" :key="surface" :model-value="form.guestSurfaces.includes(surface)" :label="$t('projectPages.settings.guest.' + surface)" :description="$t('projectPages.settings.guest.' + surface + 'Description')" class="pl-6" @update:model-value="setGuestSurface(surface, $event === true)" />
              </div>
              <div class="flex items-center justify-between gap-3 border-t border-default pt-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium">{{ $t('projectPages.settings.widgetStyle') }}</p>
                  <p class="text-xs text-muted">{{ $t('projectPages.settings.widgetStyleHint') }}</p>
                </div>
                <UButton icon="i-lucide-palette" :label="$t('style.title')" color="neutral" variant="outline" size="sm" @click="showStyle = 'widget'" />
              </div>
              <div class="space-y-2">
                <UCheckbox v-model="form.letUsersChooseType" :label="$t('projectPages.settings.letUsersChoose')" :description="$t('projectPages.settings.letUsersChooseDescription')" />
                <UCheckbox v-model="form.allowOtherType" :label="$t('projectPages.settings.offerOther')" :description="$t('projectPages.settings.offerOtherDescription')" :disabled="!form.letUsersChooseType" class="pl-6" />
              </div>
            </div>
          </section>

          <!-- Public hub -->
          <section id="hub" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.hub') }}</h2><p class="section-hint">{{ $t('projectPages.settings.hubHint') }}</p></header>
            <div class="card">
              <SettingsProjectHub v-model="form.hub" :public-key="project.publicKey" :project-name="project.name" />
              <div v-if="form.hub.enabled" class="flex items-center justify-between gap-3 border-t border-default pt-4">
                <div class="min-w-0">
                  <p class="text-sm font-medium">{{ $t('projectPages.settings.hubStyle') }}</p>
                  <p class="text-xs text-muted">{{ $t('projectPages.settings.hubStyleHint') }}</p>
                </div>
                <UButton icon="i-lucide-palette" :label="$t('style.title')" color="neutral" variant="outline" size="sm" @click="showStyle = 'hub'" />
              </div>
            </div>
          </section>

          <!-- Custom domains -->
          <section id="domains" class="section">
            <header><h2 class="section-title">{{ $t('projectDomains.title') }}</h2><p class="section-hint">{{ $t('projectDomains.hint') }} <NuxtLink to="/docs/custom-domains" class="font-medium text-default underline-offset-2 hover:underline">{{ $t('projectDomains.docs') }}</NuxtLink></p></header>
            <div class="card"><SettingsProjectDomains :project-id="id" /></div>
          </section>

          <!-- Notifications -->
          <section id="notifications" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.notifications') }}</h2><p class="section-hint">{{ $t('projectPages.settings.notificationsHint') }}</p></header>
            <div class="card">
              <UFormField :label="$t('projectPages.settings.notifyWhenWrites')" :hint="$t('projectPages.settings.notifyHint')"><UInput v-model="form.notifyEmailsText" placeholder="you@example.com" class="w-full" /></UFormField>
              <p class="text-xs text-muted">{{ $t('projectPages.settings.senderMoved') }} <NuxtLink :to="`/projects/${id}/email?view=settings`" class="font-medium text-default underline-offset-2 hover:underline">{{ $t('projectPages.settings.senderMovedLink') }}</NuxtLink></p>
            </div>
          </section>

          <!-- Sidebar -->
          <section id="sidebar" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.sidebar') }}</h2><p class="section-hint">{{ $t('projectPages.settings.sidebarHint') }}</p></header>
            <div class="divide-y divide-default overflow-hidden rounded-xl border border-default">
              <div v-for="entry in sectionGroups" :key="entry.group" class="row">
                <div class="row-label"><p class="row-title">{{ $t('nav.groups.' + entry.group) }}</p></div>
                <div class="flex flex-wrap gap-x-5 gap-y-2">
                  <UCheckbox v-for="item in entry.sections" :key="item.path" :model-value="!form.hiddenSections.includes(item.path)" :label="$t('sections.' + item.path)" @update:model-value="showSection(item.path, $event === true)" />
                </div>
              </div>
            </div>
          </section>

          <!-- Collaborators -->
          <section id="collaborators" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.collaborators') }}</h2><p class="section-hint">{{ $t('projectPages.settings.collaboratorsHint', { name: form.name || $t('projectPages.settings.thisProject') }) }}</p></header>
            <div class="card">
              <SettingsTeam :removable="false" :add-label="$t('projectPages.settings.inviteCollaborator')">
                <template #description>{{ $t('projectPages.settings.teamNote') }} <button type="button" class="font-medium text-default underline-offset-2 hover:underline" @click="settingsTab = 'team'">{{ $t('projectPages.settings.manageTeam') }}</button></template>
              </SettingsTeam>
            </div>
          </section>

          <!-- GitHub -->
          <section id="github" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.githubRepos') }}</h2><p class="section-hint">{{ $t('projectPages.settings.githubHint', { name: form.name || $t('projectPages.settings.thisProject') }) }}</p></header>
            <div class="card"><SettingsProjectRepos :project-id="id" /></div>
          </section>

          <!-- Data -->
          <section v-if="canExport" id="data" class="section">
            <header><h2 class="section-title">{{ $t('projectPages.settings.data') }}</h2><p class="section-hint">{{ $t('projectPages.settings.dataHint') }}</p></header>
            <SettingsTransfer :project-id="id" />
          </section>

          <!-- Save bar: rides the bottom of the page while there is something to save. -->
          <div v-if="dirty || saveError" class="sticky bottom-4 z-10 flex justify-center">
            <div class="flex items-center gap-3 rounded-full border border-default bg-default/95 py-1.5 pr-1.5 pl-4 shadow-lg backdrop-blur" role="status">
              <span class="text-[13px]" :class="saveError ? 'text-error' : 'text-muted'">{{ saveError || $t('projectPages.settings.unsavedChanges') }}</span>
              <UButton size="sm" color="neutral" variant="ghost" :disabled="saving" @click="discard">{{ $t('projectPages.settings.discard') }}</UButton>
              <UButton type="submit" size="sm" :loading="saving" :disabled="!validAccent">{{ $t('projectPages.settings.saveChanges') }}</UButton>
            </div>
          </div>
        </form>

        <aside class="hidden w-40 shrink-0 lg:block">
          <nav class="sticky top-8 space-y-1.5 text-sm" :aria-label="$t('projectPages.settings.onThisPage')">
            <a v-for="s in sections" :key="s.id" :href="`#${s.id}`" class="block text-muted hover:text-highlighted">{{ s.label }}</a>
            <NuxtLink :to="`/projects/${id}/dev`" class="!mt-4 flex items-center gap-1.5 border-t border-default pt-3 text-muted hover:text-highlighted"><UIcon name="i-lucide-code-xml" class="size-3.5" />{{ $t('projectPages.settings.keysAndWebhooks') }}</NuxtLink>
            <NuxtLink :to="`/projects/${id}/email?view=settings`" class="flex items-center gap-1.5 text-muted hover:text-highlighted"><UIcon name="i-lucide-mail" class="size-3.5" />{{ $t('projectPages.settings.senderMovedLink') }}</NuxtLink>
          </nav>
        </aside>
      </div>
      <p v-else-if="error" class="p-8 text-[13px] text-error">{{ error }}</p>
      <div v-else class="mx-auto max-w-2xl space-y-3 px-6 py-8"><USkeleton v-for="i in 5" :key="i" class="h-24 rounded-xl" /></div>
    </div>

    <!-- The chat widget's and the public hub's style. It saves on its own, apart from this form. -->
    <USlideover v-model:open="styleOpen" :title="$t(`projectPages.settings.${showStyle || 'hub'}StyleTitle`)" :description="$t(`projectPages.settings.${showStyle || 'hub'}StyleDescription`)" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <StyleChoicePanel v-if="project && showStyle" :project="project" :target="showStyle" />
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import type { AdminProject } from '~~/server/utils/projects'
import { projectColor } from '~/utils/projectColor'
import { can } from '#shared/roles'
import { normalizeCompany } from '#shared/company'
import { GUEST_SURFACES, normalizeGuestSurfaces, type GuestSurface } from '#shared/guest'
import { normalizeHubConfig } from '#shared/hub'
import { groupSections } from '#shared/projectSections'

const props = defineProps<{ projectId: string, section?: string }>()
const emit = defineEmits<{ close: [] }>()

type ImageField = 'iconUrl' | 'brandLogoUrl' | 'assistantLogoUrl'

const { api, loadProjects, agentHeaders, context, projects } = useAgent()
const { t } = useI18n()
const id = props.projectId
const settingsTab = useState('settings-tab', () => '')
const scroller = ref<HTMLElement | null>(null)
// Exporting a project is the workspace's export action (an owner or admin).
const canExport = computed(() => can(context.value?.role, 'workspace.export'))

const project = ref<AdminProject | null>(null)
const showStyle = ref<'hub' | 'widget' | null>(null)
const styleOpen = computed({ get: () => showStyle.value !== null, set: (open) => { if (!open) showStyle.value = null } })
// The style panel saves on its own: pick its result up without touching the unsaved form.
watch(showStyle, (now) => {
  if (!now) project.value = projects.value.find(p => p.id === id) || project.value
})
const error = ref('')
const saving = ref(false)
const saveError = ref('')
const uploading = ref<ImageField | ''>('')
const fileInput = ref<HTMLInputElement | null>(null)
let uploadTarget: ImageField = 'iconUrl'

const sections = computed(() => [
  { id: 'general', label: t('projectPages.settings.general') },
  { id: 'branding', label: t('projectPages.settings.branding') },
  { id: 'company', label: t('projectPages.settings.company') },
  { id: 'widget', label: t('projectPages.settings.chatWidget') },
  { id: 'hub', label: t('projectPages.settings.hub') },
  { id: 'domains', label: t('projectDomains.title') },
  { id: 'notifications', label: t('projectPages.settings.notifications') },
  { id: 'sidebar', label: t('projectPages.settings.sidebar') },
  { id: 'collaborators', label: t('projectPages.settings.collaborators') },
  { id: 'github', label: t('projectPages.settings.githubRepos') },
  ...(canExport.value ? [{ id: 'data', label: t('projectPages.settings.data') }] : [])
])
const widgetImages = computed(() => [
  { field: 'brandLogoUrl' as const, label: t('projectPages.settings.brandLogo'), icon: 'i-lucide-image' },
  { field: 'assistantLogoUrl' as const, label: t('projectPages.settings.assistantAvatar'), icon: 'i-lucide-sparkles' }
])
// Linear's indigo, then the colours projects without one are given.
const swatches = ['#5e6ad2', '#0f766e', '#0369a1', '#0e7490', '#4d7c0f', '#b45309', '#c2410c', '#be123c', '#7c3aed']

const blank = () => ({ name: '', siteUrl: '', inboxPath: '', iconUrl: '', brandLogoUrl: '', assistantLogoUrl: '', accent: '', chatNotice: '', allowAttachments: true, allowAnonymousUsers: false, guestSurfaces: [] as GuestSurface[], letUsersChooseType: false, allowOtherType: false, company: normalizeCompany(null), hub: normalizeHubConfig(null), notifyEmailsText: '', hiddenSections: [] as string[] })
const form = reactive(blank())
const snapshot = ref('')
const dirty = computed(() => !!snapshot.value && JSON.stringify(form) !== snapshot.value)
const validAccent = computed(() => !form.accent || /^#[0-9a-f]{6}$/i.test(form.accent.trim()))
const fallbackColor = computed(() => projectColor(id))
// Every section a project can show or hide, by group. Overview and Settings are always there.
const sectionGroups = groupSections(projectSections).groups
function showSection(path: string, show: boolean) {
  form.hiddenSections = show ? form.hiddenSections.filter(item => item !== path) : [...form.hiddenSections, path]
}
// The widget falls back to the panel's indigo, not the sidebar's hashed colour.
const widgetAccent = computed(() => (validAccent.value && form.accent) || '#4f46e5')

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
    guestSurfaces: normalizeGuestSurfaces(p.guestSurfaces),
    letUsersChooseType: p.letUsersChooseType,
    allowOtherType: p.allowOtherType,
    company: normalizeCompany(p.company),
    hub: normalizeHubConfig(p.hub),
    notifyEmailsText: p.notifyEmails.join(', '),
    hiddenSections: [...(p.hiddenSections || [])]
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
    saveError.value = e?.data?.statusMessage || e?.message || t('projectPages.settings.uploadError')
  } finally {
    uploading.value = ''
    input.value = ''
  }
}

// The style panel saves `hub.style` on its own; the form must not send an older copy back.
const omitStyle = ({ style: _style, ...config }: typeof form.hub) => config

function setGuestSurface(surface: GuestSurface, on: boolean) {
  form.guestSurfaces = normalizeGuestSurfaces(on ? [...form.guestSurfaces, surface] : form.guestSurfaces.filter(item => item !== surface))
}

async function save() {
  if (!dirty.value || saving.value || !validAccent.value) return
  saving.value = true
  saveError.value = ''
  try {
    const { accent, notifyEmailsText, ...rest } = form
    // The accent is the Brand kit's: send it only when it changed here, so saving something else never pins it.
    const accentChanged = accent.trim() !== (project.value?.theme?.accent || '')
    const result = await api<{ project: AdminProject }>(`/admin/projects/${id}`, {
      method: 'PATCH',
      // The server replaces theme wholesale; keep the keys this page doesn't edit.
      // A link row left blank is dropped rather than rejected.
      body: { ...rest, hub: { ...omitStyle(rest.hub), links: rest.hub.links.filter(link => link.label.trim() || link.url.trim()) }, notifyEmails: notifyEmailsText, ...(accentChanged ? { theme: { ...project.value?.theme, accent: accent.trim() } } : {}) }
    })
    fill(result.project)
    await loadProjects()
    useToast().add({ title: t('projectPages.settings.settingsSaved'), icon: 'i-lucide-check', duration: 2000 })
  } catch (e: any) {
    saveError.value = e?.message || t('projectPages.settings.saveError')
  } finally {
    saving.value = false
  }
}

defineShortcuts({ meta_s: { usingInput: true, handler: save } })
defineExpose({ dirty })

onMounted(async () => {
  try {
    const found = (await loadProjects()).find(p => p.id === id)
    if (!found) throw new Error(t('projectPages.settings.projectNotFound'))
    fill(found)
    // A link to one section (…#company) lands on it.
    await nextTick()
    if (props.section) scroller.value?.querySelector(`#${props.section}`)?.scrollIntoView()
  } catch (e: any) {
    error.value = e?.message || t('projectPages.settings.loadError')
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
