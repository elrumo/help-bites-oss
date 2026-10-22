<template>
  <div class="flex-1 min-h-0 flex flex-col">
    <PageHeader :project-id="id" :title="draft.title.trim() || $t('blog.untitled')" :crumbs="[{ label: $t('sections.blog'), to: `/projects/${id}/blog${draft.type === 'page' ? '?tab=pages' : ''}` }]">
      <template #title>
        <span v-if="post" class="ml-1 shrink-0 rounded-full px-1.5 text-[11px] font-medium" :class="STATE_CLASS[state]">{{ stateLabel }}</span>
        <span class="ml-1 hidden shrink-0 text-xs font-normal text-muted sm:inline">{{ saveLabel }}</span>
      </template>
      <template #actions>
        <UButton v-if="post?.live" icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" square :to="post.url" target="_blank" :aria-label="$t('blog.viewPost')" />
        <UButton icon="i-lucide-eye" :label="$t('blog.preview.button')" color="neutral" variant="ghost" size="sm" class="max-sm:hidden" @click="openPreview()" />
        <UButton icon="i-lucide-eye" color="neutral" variant="ghost" size="sm" square class="sm:hidden" :aria-label="$t('blog.preview.button')" @click="openPreview()" />
        <UButton icon="i-lucide-panel-right" :label="$t('blog.preview.live')" color="neutral" :variant="livePreview ? 'soft' : 'ghost'" size="sm" class="max-lg:hidden" :aria-pressed="livePreview" @click="livePreview = !livePreview" />
        <UButton v-if="aiAllowed" :label="$t('blog.ai.button')" icon="i-lucide-sparkles" color="neutral" variant="soft" size="sm" class="max-sm:hidden" @click="openAi()" />
        <UButton v-if="aiAllowed" icon="i-lucide-sparkles" color="neutral" variant="ghost" size="sm" square class="sm:hidden" :aria-label="$t('blog.ai.button')" @click="openAi()" />
        <UButton icon="i-lucide-panel-right" color="neutral" variant="ghost" size="sm" square class="lg:hidden" :aria-label="$t('blog.postSettings')" @click="settingsOpen = true" />
        <UDropdownMenu v-if="post" :items="moreItems" :content="{ align: 'end' }">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" square :aria-label="$t('blog.more')" />
        </UDropdownMenu>
        <UButton v-if="liveOrScheduled" :label="$t('blog.update')" icon="i-lucide-check" size="sm" :loading="saving" :disabled="!dirty" @click="save()" />
        <UFieldGroup v-else-if="canEmail" size="sm">
          <UButton :label="willSchedule ? $t('blog.schedule') : $t('blog.publish')" :icon="willSchedule ? 'i-lucide-calendar-clock' : 'i-lucide-rocket'" :loading="saving" :disabled="!draft.title.trim()" @click="publish()" />
          <UDropdownMenu :items="publishItems" :content="{ align: 'end' }">
            <UButton icon="i-lucide-chevron-down" :disabled="!draft.title.trim() || saving" :aria-label="$t('blog.publishOptions')" />
          </UDropdownMenu>
        </UFieldGroup>
        <UButton v-else :label="willSchedule ? $t('blog.schedule') : $t('blog.publish')" :icon="willSchedule ? 'i-lucide-calendar-clock' : 'i-lucide-rocket'" size="sm" :loading="saving" :disabled="!draft.title.trim()" @click="publish()" />
      </template>
    </PageHeader>

    <div v-if="error" class="p-8 text-sm text-error">{{ error }}</div>
    <div v-else-if="loading" class="mx-auto w-full max-w-3xl space-y-3 p-8"><USkeleton class="h-10 w-2/3" /><USkeleton v-for="i in 6" :key="i" class="h-5" /></div>

    <div v-else class="flex flex-1 min-h-0">
      <main class="flex-1 min-w-0 overflow-y-auto">
        <div class="mx-auto max-w-3xl px-4 pb-24 pt-6 md:px-8">
          <img v-if="draft.coverImageUrl" :src="draft.coverImageUrl" alt="" class="mb-6 aspect-[2/1] w-full rounded-xl border border-default object-cover sm:mx-8 sm:w-[calc(100%-4rem)]">
          <textarea
            ref="titleRef"
            v-model="draft.title"
            :placeholder="draft.type === 'page' ? $t('blog.pageTitlePlaceholder') : $t('blog.titlePlaceholder')"
            rows="1"
            maxlength="200"
            class="block w-full resize-none overflow-hidden bg-transparent text-3xl font-bold leading-tight tracking-tight text-highlighted outline-none placeholder:text-dimmed sm:px-8"
            :aria-label="$t('blog.title')"
            @keydown.enter.prevent="focusBody"
          />
          <UEditor
            ref="editorRef"
            v-slot="{ editor }"
            v-model="draft.body"
            :content-type="draft.bodyFormat === 'html' ? 'html' : 'markdown'"
            :placeholder="$t('blog.bodyPlaceholder')"
            :handlers="handlers"
            :mention="false"
            class="mt-4 min-h-[50vh]"
            :ui="{ base: 'text-base' }"
          >
            <UEditorToolbar :editor="editor" :items="toolbarItems" class="sticky top-0 z-10 -mx-1 mb-3 overflow-x-auto border-b border-default bg-default/95 px-1 py-1 backdrop-blur" />
            <UEditorToolbar :editor="editor" :items="bubbleItems" layout="bubble" />
            <UEditorSuggestionMenu :editor="editor" :items="suggestionItems" />
            <UEditorDragHandle :editor="editor" />
          </UEditor>
          <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="insertImage">
          <p v-if="uploadingImage" class="mt-2 flex items-center gap-1.5 text-xs text-muted"><UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />{{ $t('blog.uploadingImage') }}</p>
          <p v-if="saveError" class="mt-3 text-sm text-error">{{ saveError }}</p>
        </div>
      </main>
      <aside v-if="livePreview" class="hidden w-[32rem] shrink-0 flex-col border-l border-default lg:flex xl:w-[40rem]">
        <p class="flex items-center justify-between border-b border-default px-4 py-2 text-xs font-medium text-muted">
          {{ $t('blog.preview.live') }}
          <UIcon v-if="previewLoading" name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
        </p>
        <iframe sandbox="" :srcdoc="previewHtml" :title="$t('blog.preview.live')" class="min-h-0 w-full flex-1 bg-white" />
      </aside>
      <aside v-else class="hidden w-80 shrink-0 overflow-y-auto border-l border-default p-4 lg:block">
        <BlogPostSettings v-model:draft="draft" :post="post" :project-id="id" :comments-allowed="blogConfig.comments" :can-market="canMarket" :blog-url="blogUrl" @newsletter="newsletterOpen = true" />
      </aside>
    </div>

    <USlideover v-model:open="settingsOpen" :title="$t('blog.postSettings')" :ui="{ content: 'sm:max-w-sm' }">
      <template #body>
        <BlogPostSettings v-model:draft="draft" :post="post" :project-id="id" :comments-allowed="blogConfig.comments" :can-market="canMarket" :blog-url="blogUrl" @newsletter="newsletterOpen = true" />
      </template>
    </USlideover>

    <UModal v-model:open="previewOpen" :title="$t('blog.preview.button')" :description="$t('blog.preview.hint')" :ui="{ content: 'sm:max-w-4xl' }">
      <template #body>
        <iframe sandbox="" :srcdoc="previewHtml" :title="$t('blog.preview.button')" class="h-[70vh] w-full rounded-md border border-default bg-white" />
      </template>
    </UModal>

    <BlogAiModal v-model:open="aiOpen" :scope="aiScope" :selection="aiSelection" :project-id="id" :title="draft.title" :body="draft.body" @apply="applyAi" />

    <BlogNewsletterModal v-if="post" v-model:open="newsletterOpen" :post="post" :project-id="id" :topics="project?.marketing.topics || []" :default-topic="blogConfig.newsletterTopic" :postal-address="project?.marketing.postalAddress || ''" @sent="onNewsletter" />
  </div>
</template>

<script setup lang="ts">
import type { DropdownMenuItem, EditorCustomHandlers, EditorSuggestionMenuItem, EditorToolbarItem } from '@nuxt/ui'
import type { Editor } from '@tiptap/vue-3'
import { DEFAULT_BLOG_CONFIG, isBlogPostLive, type BlogPost } from '#shared/blog'
import { can } from '#shared/roles'
import type { AdminProject } from '~~/server/utils/projects'
import { blogPostCreateBody, blogPostPatch, draftFromPost, emptyBlogDraft, fromLocalInput, type BlogAiResult, type BlogPostDraft } from '~/utils/blogDraft'

// One blog post or page in Nuxt UI's editor (TipTap), saved as Markdown (a
// post imported from Ghost stays HTML). A draft saves itself a moment after
// you stop typing; a live or scheduled post keeps your edits until you press
// Update, so half a sentence never goes public. `new` is a post not created
// yet (`?type=page` for a page): the first save creates it and the address
// becomes its id without reloading the editor. "Publish and email" publishes,
// then opens the newsletter.

definePageMeta({ middleware: 'agent', key: route => `blog-editor-${String(route.params.id)}` })

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)
const { api, agent, projects, loadProjects, context } = useAgent()
const toast = useToast()
const { t, locale } = useI18n()
const { locked } = usePlanLocks()
const appUrl = useAppUrl()

const project = computed<AdminProject | null>(() => projects.value.find(p => p.id === id) || null)
const blogConfig = computed(() => project.value?.blog || DEFAULT_BLOG_CONFIG)
const canMarket = computed(() => can(context.value?.role, 'marketing'))
const blogUrl = computed(() => (project.value ? `${appUrl.value}/blog/${project.value.publicKey}` : ''))
/** Whether this post can go out by email from here: a post (not a page), the plan has campaigns, the role may send them. */
const canEmail = computed(() => draft.value.type === 'post' && canMarket.value && !locked('campaigns'))

const postId = ref(String(route.params.postId || 'new'))
const post = ref<BlogPost | null>(null)
const draft = ref<BlogPostDraft>(emptyBlogDraft())
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const saveError = ref('')
const savedAt = ref<number | null>(null)
const settingsOpen = ref(false)
const newsletterOpen = ref(false)
const aiOpen = ref(false)
/** The AI writes Markdown, so a post kept as HTML (imported from Ghost) does not get it. */
const aiAllowed = computed(() => draft.value.bodyFormat !== 'html')
const aiScope = ref<'post' | 'insert' | 'selection'>('post')
const aiSelection = ref('')
/** Where the editor's AI blocks put their text: the cursor, or the range that was selected. */
let aiRange: { from: number, to: number } | null = null

// ---- state ----
type PostState = 'live' | 'scheduled' | 'draft'
const STATE_CLASS: Record<PostState, string> = { live: 'bg-success/10 text-success', scheduled: 'bg-info/10 text-info', draft: 'bg-elevated text-toned' }
const state = computed<PostState>(() => (!post.value ? 'draft' : isBlogPostLive(post.value) ? 'live' : post.value.status === 'published' ? 'scheduled' : 'draft'))
const stateLabel = computed(() => t(`blog.${state.value}`))
const liveOrScheduled = computed(() => post.value?.status === 'published')
const willSchedule = computed(() => !!draft.value.publishedAt && new Date(draft.value.publishedAt).getTime() > Date.now())
const patch = computed(() => (post.value ? blogPostPatch(draft.value, post.value) : {}))
const dirty = computed(() => (post.value ? Object.keys(patch.value).length > 0 : !!draft.value.title.trim() || !!draft.value.body.trim()))
const saveLabel = computed(() => {
  if (saving.value) return t('blog.saving')
  if (dirty.value) return liveOrScheduled.value ? t('blog.unsavedLive') : t('blog.unsaved')
  return savedAt.value ? t('blog.savedAt', { time: new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(savedAt.value) }) : ''
})

// ---- saving ----
let saveTimer: ReturnType<typeof setTimeout> | undefined
let queued = false

async function save(extra: Partial<BlogPostDraft> = {}): Promise<boolean> {
  clearTimeout(saveTimer)
  Object.assign(draft.value, extra)
  if (!draft.value.title.trim()) {
    saveError.value = t('blog.titleRequired')
    return false
  }
  if (saving.value) {
    queued = true
    return false
  }
  saving.value = true
  saveError.value = ''
  try {
    if (!post.value) {
      const created = (await api<{ post: BlogPost }>('/admin/blog/posts', { method: 'POST', body: blogPostCreateBody(draft.value, id) })).post
      post.value = created
      postId.value = created.id
      // The editor stays as it is (the page key ignores the post id); only the address changes.
      await router.replace(`/projects/${id}/blog/${created.id}`)
    } else if (Object.keys(patch.value).length) {
      post.value = (await api<{ post: BlogPost }>(`/admin/blog/posts/${post.value.id}`, { method: 'PATCH', body: patch.value })).post
    }
    // What the server settled on (a slug made unique, a date set on publishing) without losing typing that came in meanwhile.
    const fresh = draftFromPost(post.value!)
    draft.value.slug = fresh.slug
    if (!draft.value.publishedAt) draft.value.publishedAt = fresh.publishedAt
    savedAt.value = Date.now()
    return true
  } catch (e: any) {
    saveError.value = e?.message || t('blog.saveError')
    return false
  } finally {
    saving.value = false
    if (queued) {
      queued = false
      if (dirty.value && !liveOrScheduled.value) void save()
    }
  }
}

// Drafts save themselves; live and scheduled posts wait for Update.
watch(draft, () => {
  if (loading.value || liveOrScheduled.value || !dirty.value || !draft.value.title.trim()) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), 1200)
}, { deep: true })

async function publish(andEmail = false) {
  const ok = await save({ status: 'published' })
  if (!ok) return
  toast.add({ title: willSchedule.value ? t('blog.scheduledToast') : t('blog.publishedToast'), description: blogConfig.value.enabled ? undefined : t('blog.blogOffToast'), icon: 'i-lucide-rocket', color: 'success' })
  if (andEmail) newsletterOpen.value = true
}

const publishItems = computed<DropdownMenuItem[][]>(() => [[
  { label: willSchedule.value ? t('blog.scheduleAndEmail') : t('blog.publishAndEmail'), icon: 'i-lucide-send', onSelect: (): void => { void publish(true) } },
  { label: willSchedule.value ? t('blog.scheduleOnly') : t('blog.publishOnly'), icon: willSchedule.value ? 'i-lucide-calendar-clock' : 'i-lucide-rocket', onSelect: (): void => { void publish() } }
]])

async function unpublish() {
  if (await save({ status: 'draft' })) toast.add({ title: t('blog.unpublishedToast'), icon: 'i-lucide-eye-off' })
}

async function removePost() {
  if (!post.value || !confirm(t('blog.confirmDelete'))) return
  try {
    await api(`/admin/blog/posts/${post.value.id}`, { method: 'DELETE' })
    const page = post.value.type === 'page'
    post.value = null
    draft.value = emptyBlogDraft()
    await router.push(`/projects/${id}/blog${page ? '?tab=pages' : ''}`)
  } catch (e: any) {
    toast.add({ title: t('blog.deleteError'), description: e?.message, color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

const moreItems = computed<DropdownMenuItem[][]>(() => [[
  ...(liveOrScheduled.value ? [{ label: t('blog.unpublish'), icon: 'i-lucide-eye-off', onSelect: (): void => { void unpublish() } }] : []),
  ...(post.value?.type === 'post' ? [{ label: t('blog.sendNewsletter'), icon: 'i-lucide-send', disabled: post.value.status !== 'published' || !canEmail.value || (!!post.value.newsletter && !['draft', 'canceled'].includes(post.value.newsletter.status)), onSelect: (): void => { newsletterOpen.value = true } }] : []),
  ...(post.value?.newsletter ? [{ label: t('blog.openCampaign'), icon: 'i-lucide-arrow-up-right', to: `/projects/${id}/campaigns/${post.value.newsletter.campaignId}` }] : [])
], [
  { label: t('blog.deletePost'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: (): void => { void removePost() } }
]])

function onNewsletter(next: BlogPost) {
  post.value = next
}

// ---- write with AI ----
function openAi(scope: 'post' | 'insert' | 'selection' = 'post', range: { from: number, to: number } | null = null, selection = '') {
  aiScope.value = scope
  aiRange = range
  aiSelection.value = selection
  aiOpen.value = true
}

/** The proposal goes into the draft: the text replaces or follows what is there, the rest fills what it offers. */
function applyAi(mode: 'write' | 'continue' | 'improve' | 'meta' | 'insert', result: BlogAiResult) {
  const d = draft.value
  const editor = editorRef.value?.editor
  if (aiScope.value !== 'post' && aiRange && editor && result.body) {
    // From the `/` menu or the bubble: just this passage, at the cursor or over the selection.
    editor.chain().focus().insertContentAt(aiScope.value === 'selection' ? aiRange : aiRange.from, result.body, { contentType: 'markdown' }).run()
  } else {
    if (mode === 'continue') d.body = `${d.body.trimEnd()}\n\n${result.body}`
    else if (result.body) d.body = result.body
    if (mode === 'write' || mode === 'meta') {
      if (result.title && (mode === 'write' || !d.title.trim())) d.title = result.title
      if (result.excerpt) d.excerpt = result.excerpt
      if (result.metaDescription) d.metaDescription = result.metaDescription
      if (result.tags.length) d.tags = result.tags
    }
  }
  toast.add({ title: t('blog.ai.applied'), icon: 'i-lucide-sparkles' })
}

// ---- preview ----
// The unsaved draft, rendered by the server in the blog's own design (the same
// page readers get), shown in a script-less frame: one-off in a dialog, or
// beside the editor in place of the settings while "Live preview" is on.
const previewOpen = ref(false)
const livePreview = ref(false)
const previewHtml = ref('')
const previewLoading = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewRun = 0

async function renderPreview() {
  const run = ++previewRun
  const d = draft.value
  previewLoading.value = true
  try {
    const { html } = await api<{ html: string }>('/admin/blog/preview', {
      method: 'POST',
      body: { project: id, type: d.type, title: d.title, body: d.body, bodyFormat: d.bodyFormat, excerpt: d.excerpt, coverImageUrl: d.coverImageUrl, coverImageAlt: d.coverImageAlt, tags: d.tags, authorName: d.authorName, publishedAt: fromLocalInput(d.publishedAt) }
    })
    if (run === previewRun) previewHtml.value = html
  } catch (e: any) {
    if (run === previewRun) toast.add({ title: t('blog.preview.error'), description: e?.message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    if (run === previewRun) previewLoading.value = false
  }
}

function openPreview() {
  previewOpen.value = true
  void renderPreview()
}

// While a preview is showing it follows the typing, a moment after you pause.
watch([() => draft.value, livePreview], () => {
  if (loading.value || !(livePreview.value || previewOpen.value)) return
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => void renderPreview(), 500)
}, { deep: true })

// ---- the editor ----
const editorRef = ref<{ editor?: Editor } | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const uploadingImage = ref(false)
let imageTarget: Editor | null = null

const titleRef = ref<HTMLTextAreaElement | null>(null)

function focusBody() {
  editorRef.value?.editor?.commands.focus('start')
}

/** The title grows with its text, a line at a time (typed, loaded or saved). */
function fitTitle() {
  const el = titleRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// Images go to the project's storage, not into the Markdown as data.
const handlers: EditorCustomHandlers = {
  imageUpload: {
    canExecute: () => true,
    execute: (editor) => {
      imageTarget = editor
      imageInput.value?.click()
      return editor.chain()
    },
    isActive: () => false
  },
  // Write with AI: a new passage at the cursor (the `/` menu), or a rewrite of the selected text (the bubble).
  aiWrite: {
    canExecute: () => true,
    execute: (editor) => {
      openAi('insert', { from: editor.state.selection.from, to: editor.state.selection.from })
      return editor.chain()
    },
    isActive: () => false
  },
  aiImprove: {
    canExecute: editor => !editor.state.selection.empty,
    execute: (editor) => {
      const { from, to } = editor.state.selection
      const slice = editor.state.doc.slice(from, to)
      const text = editor.markdown?.serialize({ type: 'doc', content: slice.content.toJSON() }) || editor.state.doc.textBetween(from, to, '\n')
      openAi('selection', { from, to }, text)
      return editor.chain()
    },
    isActive: () => false
  }
}

const compression = useUploadCompression()

async function insertImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const editor = imageTarget || editorRef.value?.editor
  if (!file || !editor) return
  uploadingImage.value = true
  try {
    const form = new FormData()
    form.append('project', id)
    form.append('file', file)
    compression.apply(form)
    const { url } = await api<{ url: string }>('/admin/blog/images', { method: 'POST', body: form })
    editor.chain().focus().setImage({ src: url, alt: file.name.replace(/\.[a-z0-9]+$/i, '') }).run()
  } catch (e: any) {
    toast.add({ title: t('blog.uploadError'), description: e?.message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    uploadingImage.value = false
  }
}

const toolbarItems = computed<EditorToolbarItem[][]>(() => [[
  { kind: 'undo', icon: 'i-lucide-undo-2', tooltip: { text: t('blog.editor.undo') } },
  { kind: 'redo', icon: 'i-lucide-redo-2', tooltip: { text: t('blog.editor.redo') } }
], [
  {
    icon: 'i-lucide-heading',
    tooltip: { text: t('blog.editor.headings') },
    content: { align: 'start' },
    items: [
      { kind: 'paragraph', icon: 'i-lucide-pilcrow', label: t('blog.editor.paragraph') },
      { kind: 'heading', level: 2, icon: 'i-lucide-heading-2', label: t('blog.editor.heading', { level: 2 }) },
      { kind: 'heading', level: 3, icon: 'i-lucide-heading-3', label: t('blog.editor.heading', { level: 3 }) },
      { kind: 'heading', level: 4, icon: 'i-lucide-heading-4', label: t('blog.editor.heading', { level: 4 }) }
    ]
  }
], [
  { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: t('blog.editor.bold') } },
  { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: t('blog.editor.italic') } },
  { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: t('blog.editor.strike') } },
  { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: t('blog.editor.code') } }
], [
  { kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: t('blog.editor.bulletList') } },
  { kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: t('blog.editor.orderedList') } },
  { kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: t('blog.editor.quote') } },
  { kind: 'codeBlock', icon: 'i-lucide-square-code', tooltip: { text: t('blog.editor.codeBlock') } },
  { kind: 'horizontalRule', icon: 'i-lucide-separator-horizontal', tooltip: { text: t('blog.editor.divider') } }
], [
  { kind: 'link', icon: 'i-lucide-link', tooltip: { text: t('blog.editor.link') } },
  { kind: 'imageUpload', icon: 'i-lucide-image-plus', tooltip: { text: t('blog.editor.image') } }
]])

const bubbleItems = computed<EditorToolbarItem[][]>(() => [[
  { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold' },
  { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic' },
  { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough' },
  { kind: 'mark', mark: 'code', icon: 'i-lucide-code' },
  { kind: 'link', icon: 'i-lucide-link' }
], ...(aiAllowed.value ? [[{ kind: 'aiImprove' as const, icon: 'i-lucide-sparkles', label: t('blog.editor.aiImprove') }]] : [])])

const suggestionItems = computed<EditorSuggestionMenuItem[][]>(() => [[
  { type: 'label', label: t('blog.editor.blocks') },
  { kind: 'paragraph', label: t('blog.editor.paragraph'), icon: 'i-lucide-pilcrow' },
  { kind: 'heading', level: 2, label: t('blog.editor.heading', { level: 2 }), icon: 'i-lucide-heading-2' },
  { kind: 'heading', level: 3, label: t('blog.editor.heading', { level: 3 }), icon: 'i-lucide-heading-3' },
  { kind: 'bulletList', label: t('blog.editor.bulletList'), icon: 'i-lucide-list' },
  { kind: 'orderedList', label: t('blog.editor.orderedList'), icon: 'i-lucide-list-ordered' },
  { kind: 'blockquote', label: t('blog.editor.quote'), icon: 'i-lucide-text-quote' },
  { kind: 'codeBlock', label: t('blog.editor.codeBlock'), icon: 'i-lucide-square-code' }
], [
  { type: 'label', label: t('blog.editor.insert') },
  ...(aiAllowed.value ? [{ kind: 'aiWrite' as const, label: t('blog.editor.ai'), icon: 'i-lucide-sparkles' }] : []),
  { kind: 'imageUpload', label: t('blog.editor.image'), icon: 'i-lucide-image-plus' },
  { kind: 'horizontalRule', label: t('blog.editor.divider'), icon: 'i-lucide-separator-horizontal' }
]])

// ---- load, leave ----
async function load() {
  if (!project.value) await loadProjects()
  if (!project.value) throw new Error(t('blog.projectNotFound'))
  if (postId.value === 'new') {
    draft.value = { ...emptyBlogDraft(route.query.type === 'page' ? 'page' : 'post'), authorName: String(agent.value?.name || agent.value?.username || '') }
    return
  }
  post.value = (await api<{ post: BlogPost }>(`/admin/blog/posts/${postId.value}`)).post
  draft.value = draftFromPost(post.value)
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault()
    void save()
  }
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault()
}

onBeforeRouteLeave(() => {
  if (dirty.value && post.value?.status === 'published' && !confirm(t('blog.leaveUnsaved'))) return false
  // A draft's last keystrokes are saved on the way out.
  if (dirty.value && !liveOrScheduled.value && draft.value.title.trim()) void save()
})

// Another post opened from here (a link in a comment): load it into the same editor.
watch(() => route.params.postId, (next) => {
  const wanted = String(next || '')
  if (!wanted || wanted === postId.value || !route.path.startsWith(`/projects/${id}/blog/`)) return
  postId.value = wanted
  loading.value = true
  load().catch((e: any) => { error.value = e?.message || t('blog.loadError') }).finally(() => { loading.value = false })
})

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', beforeUnload)
  try {
    await load()
  } catch (e: any) {
    error.value = e?.message || t('blog.loadError')
  } finally {
    loading.value = false
  }
})

watch(() => draft.value.title, () => nextTick(fitTitle), { flush: 'post' })

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  clearTimeout(previewTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>
