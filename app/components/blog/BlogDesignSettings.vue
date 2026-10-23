<template>
  <div class="space-y-5 text-[13px]">
    <p v-if="!canManage" class="rounded-lg border border-default bg-elevated px-3 py-2 text-muted">{{ $t('blog.adminsOnly') }}</p>

    <StyleProjectActions :project-id="project.id" :from="styleOffer" :disabled="!canManage" />

    <UFormField :label="$t('blog.design.layout')">
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="item in layouts"
          :key="item.value"
          type="button"
          :disabled="!canManage"
          class="flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs transition-colors"
          :class="design.layout === item.value ? 'border-primary bg-primary/5 text-highlighted' : 'border-default text-muted hover:border-accented'"
          :aria-pressed="design.layout === item.value"
          @click="save({ layout: item.value })"
        >
          <UIcon :name="item.icon" class="size-5" />
          {{ item.label }}
        </button>
      </div>
    </UFormField>

    <div class="grid grid-cols-2 gap-3">
      <UFormField :label="$t('blog.design.font')">
        <USelect :model-value="design.font" :items="fonts" :disabled="!canManage" class="w-full" @update:model-value="save({ font: $event as BlogFont })" />
      </UFormField>
      <UFormField :label="$t('blog.design.colorScheme')">
        <USelect :model-value="design.colorScheme" :items="schemes" :disabled="!canManage" class="w-full" @update:model-value="save({ colorScheme: $event as BlogColorScheme })" />
      </UFormField>
    </div>

    <UFormField :label="$t('blog.design.accent')" :description="$t('blog.design.accentHint')">
      <div class="flex items-center gap-2">
        <input type="color" :value="design.accent || projectAccent" :disabled="!canManage" class="size-8 shrink-0 cursor-pointer rounded border border-default bg-transparent" :aria-label="$t('blog.design.accent')" @change="save({ accent: ($event.target as HTMLInputElement).value })">
        <code class="text-xs text-muted">{{ design.accent || projectAccent }}</code>
        <UButton v-if="design.accent" :label="$t('blog.design.useProjectAccent')" size="xs" color="neutral" variant="ghost" :disabled="!canManage" @click="save({ accent: '' })" />
      </div>
    </UFormField>

    <UFormField v-for="key in IMAGE_KEYS" :key="key" :label="$t(`blog.design.${key}`)" :description="$t(`blog.design.${key}Hint`)">
      <div class="space-y-2">
        <img v-if="text[key]" :src="text[key]" alt="" class="rounded-lg border border-default object-cover" :class="key === 'logoUrl' ? 'size-12' : 'aspect-[3/1] w-full'">
        <div class="flex gap-2">
          <UInput v-model="text[key]" :disabled="!canManage" class="min-w-0 flex-1" placeholder="https://…" @blur="saveText(key)" />
          <UButton icon="i-lucide-upload" color="neutral" variant="soft" :disabled="!canManage" :loading="uploading === key" :aria-label="$t('blog.uploadCover')" @click="pick(key)" />
        </div>
      </div>
    </UFormField>
    <MediaUploadCompression />
    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="upload">

    <USeparator :label="$t('blog.design.navigation')" />
    <p class="text-xs text-muted">{{ $t('blog.design.navigationHint') }}</p>
    <div class="space-y-2">
      <div v-for="(link, index) in nav" :key="index" class="flex items-center gap-2">
        <UInput v-model="link.label" :disabled="!canManage" class="w-32 shrink-0" :maxlength="40" :placeholder="$t('blog.design.linkLabel')" @blur="saveNav" />
        <UInput v-model="link.url" :disabled="!canManage" class="min-w-0 flex-1 font-mono" placeholder="/about" @blur="saveNav" />
        <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square :disabled="!canManage" :aria-label="$t('blog.design.removeLink')" @click="nav.splice(index, 1); saveNav()" />
      </div>
      <UButton v-if="nav.length < BLOG_NAVIGATION_MAX" icon="i-lucide-plus" :label="$t('blog.design.addLink')" size="xs" color="neutral" variant="soft" :disabled="!canManage" @click="nav.push({ label: '', url: '' })" />
    </div>

    <USeparator :label="$t('blog.design.social')" />
    <div class="grid gap-2 sm:grid-cols-2">
      <UFormField v-for="network in BLOG_SOCIAL_NETWORKS" :key="network" :label="SOCIAL_LABELS[network]">
        <UInput v-model="social[network]" :disabled="!canManage" class="w-full" placeholder="https://…" @blur="saveSocial(network)" />
      </UFormField>
    </div>

    <UFormField :label="$t('blog.design.footer')" :description="$t('blog.design.footerHint')">
      <UInput v-model="text.footer" :disabled="!canManage" class="w-full" :maxlength="300" @blur="saveText('footer')" />
    </UFormField>

    <p class="text-xs text-muted">{{ saving ? $t('blog.saving') : saved ? $t('common.saved') : $t('blog.savesAsChange') }}</p>
    <p v-if="error" class="text-sm text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { styleFrom } from '#shared/projectStyle'
import { BLOG_NAVIGATION_MAX, BLOG_SOCIAL_NETWORKS, DEFAULT_BLOG_DESIGN, type BlogColorScheme, type BlogDesign, type BlogFont, type BlogLayout, type BlogNavLink, type BlogSocialNetwork } from '#shared/blog'
import type { AdminProject } from '~~/server/utils/projects'

// How the hosted blog looks (Ghost's Design settings): the layout of the
// front page, type, colours, the logo and a cover, the links in its header,
// social profiles and a footer line. Each change saves on its own, as a
// partial `{ blog: { design } }` patch.

const props = defineProps<{ project: AdminProject, canManage: boolean }>()
const emit = defineEmits<{ saved: [project: AdminProject] }>()

const { api } = useAgent()
const compression = useUploadCompression()
const { t } = useI18n()

const SOCIAL_LABELS: Record<BlogSocialNetwork, string> = { x: 'X', bluesky: 'Bluesky', mastodon: 'Mastodon', github: 'GitHub', linkedin: 'LinkedIn', instagram: 'Instagram', youtube: 'YouTube', website: t('blog.design.website') }
const IMAGE_KEYS = ['logoUrl', 'coverImageUrl'] as const

const design = computed<BlogDesign>(() => props.project.blog?.design || DEFAULT_BLOG_DESIGN)
// The blog's `sans` is the project style's `system`; its own scheme is `auto`, `light` or `dark`.
const styleOffer = computed(() => styleFrom({ accent: design.value.accent, font: design.value.font === 'sans' ? 'system' : design.value.font, scheme: design.value.colorScheme, logoUrl: design.value.logoUrl }))
const projectAccent = computed(() => props.project.theme?.accent || '#4f46e5')
const layouts = computed<{ value: BlogLayout, label: string, icon: string }[]>(() => [
  { value: 'list', label: t('blog.design.layouts.list'), icon: 'i-lucide-rows-3' },
  { value: 'grid', label: t('blog.design.layouts.grid'), icon: 'i-lucide-layout-grid' },
  { value: 'magazine', label: t('blog.design.layouts.magazine'), icon: 'i-lucide-layout-panel-top' }
])
const fonts = computed(() => [{ label: t('blog.design.fonts.sans'), value: 'sans' }, { label: t('blog.design.fonts.serif'), value: 'serif' }])
const schemes = computed(() => [{ label: t('blog.design.schemes.auto'), value: 'auto' }, { label: t('blog.design.schemes.light'), value: 'light' }, { label: t('blog.design.schemes.dark'), value: 'dark' }])

const text = reactive({ logoUrl: '', coverImageUrl: '', footer: '' })
const nav = ref<BlogNavLink[]>([])
const social = reactive<Record<string, string>>({})
watch(design, (next) => {
  Object.assign(text, { logoUrl: next.logoUrl, coverImageUrl: next.coverImageUrl, footer: next.footer })
  nav.value = next.navigation.map(link => ({ ...link }))
  for (const network of BLOG_SOCIAL_NETWORKS) social[network] = next.social[network] || ''
}, { immediate: true })

const saving = ref(false)
const saved = ref(false)
const error = ref('')

async function save(patch: Partial<BlogDesign>) {
  if (!props.canManage) return
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    const { project } = await api<{ project: AdminProject }>(`/admin/projects/${props.project.id}`, { method: 'PATCH', body: { blog: { design: patch } } })
    emit('saved', project)
    saved.value = true
  } catch (e: any) {
    error.value = e?.message || t('blog.saveError')
  } finally {
    saving.value = false
  }
}

function saveText(key: 'logoUrl' | 'coverImageUrl' | 'footer') {
  if (text[key].trim() !== design.value[key]) void save({ [key]: text[key].trim() })
}

/** Rows still being typed (no label or address yet) wait; the rest go. */
function saveNav() {
  const links = nav.value.map(link => ({ label: link.label.trim(), url: link.url.trim() })).filter(link => link.label && link.url)
  if (JSON.stringify(links) !== JSON.stringify(design.value.navigation)) void save({ navigation: links })
}

function saveSocial(network: BlogSocialNetwork) {
  if ((social[network] || '').trim() !== (design.value.social[network] || '')) void save({ social: { [network]: (social[network] || '').trim() } })
}

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref<'' | 'logoUrl' | 'coverImageUrl'>('')
let target: 'logoUrl' | 'coverImageUrl' = 'logoUrl'

function pick(key: 'logoUrl' | 'coverImageUrl') {
  target = key
  fileInput.value?.click()
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = target
  error.value = ''
  try {
    const form = new FormData()
    form.append('project', props.project.id)
    form.append('file', file)
    compression.apply(form)
    const { url } = await api<{ url: string }>('/admin/blog/images', { method: 'POST', body: form })
    text[target] = url
    await save({ [target]: url })
  } catch (e: any) {
    error.value = e?.message || t('blog.uploadError')
  } finally {
    uploading.value = ''
  }
}
</script>
