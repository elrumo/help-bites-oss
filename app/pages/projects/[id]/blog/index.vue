<template>
  <div class="flex-1 min-h-0 flex flex-col">
    <PageHeader :project-id="id" :title="$t('sections.blog')">
      <template #title>
        <span v-if="!loading && !error" class="ml-1 hidden text-xs font-normal tabular-nums text-muted sm:inline">{{ $t('blog.liveCount', liveCount) }}, {{ $t('blog.draftCount', draftCount) }}</span>
      </template>
      <template #actions>
        <UButton v-if="blogOn" icon="i-lucide-external-link" :label="$t('blog.openPublic')" color="neutral" variant="ghost" size="sm" :to="blogUrl" target="_blank" />
        <UButton v-if="blogOn" icon="i-lucide-rss" color="neutral" variant="ghost" size="sm" square :aria-label="$t('blog.copyFeed')" @click="copy(feedUrl, $t('blog.feed'))" />
        <UButton icon="i-lucide-settings-2" :label="$t('nav.settings')" color="neutral" variant="ghost" size="sm" @click="showSettings = true" />
        <UButton icon="i-lucide-plus" :label="$t('blog.newPost')" size="sm" :to="`/projects/${id}/blog/new`" />
      </template>
    </PageHeader>

    <div v-if="error" class="p-8 text-sm text-error">{{ error }}</div>
    <div v-else-if="loading" class="space-y-2 p-4"><USkeleton v-for="i in 4" :key="i" class="h-16" /></div>

    <div v-else class="flex-1 min-h-0 overflow-y-auto">
      <div class="mx-auto max-w-4xl space-y-4 px-4 py-4 md:px-6">
        <p v-if="project && !blogOn" class="rounded-lg border border-default bg-elevated px-3 py-2 text-[13px] text-muted">
          {{ $t('blog.offBefore') }} <button type="button" class="font-medium text-default underline underline-offset-2" @click="showSettings = true">{{ $t('blog.settingsTitle') }}</button>{{ $t('blog.offAfter') }}
        </p>

        <UTabs v-model="tab" :items="tabs" variant="link" size="sm" :content="false" class="w-full" />

        <template v-if="tab === 'posts'">
          <EmptyState v-if="!posts.length" icon="i-lucide-newspaper" :title="$t('blog.nothingYet')" :description="$t('blog.emptyDescription')">
            <UButton icon="i-lucide-plus" :label="$t('blog.newPost')" :to="`/projects/${id}/blog/new`" />
          </EmptyState>
          <template v-else>
            <div class="flex flex-wrap items-center gap-2">
              <UInput v-model="search" icon="i-lucide-search" size="sm" :placeholder="$t('blog.search')" class="w-full sm:w-64" />
              <USelect v-model="statusFilter" :items="statusItems" size="sm" class="w-40" />
            </div>
            <ul class="divide-y divide-default rounded-lg border border-default">
              <li v-for="post in shown" :key="post.id">
                <NuxtLink :to="`/projects/${id}/blog/${post.id}`" class="flex items-center gap-3 px-3 py-2.5 text-[13px] transition-colors hover:bg-elevated">
                  <img v-if="post.coverImageUrl" :src="post.coverImageUrl" alt="" class="size-12 shrink-0 rounded-md bg-elevated object-cover">
                  <span v-else class="grid size-12 shrink-0 place-items-center rounded-md bg-elevated text-dimmed"><UIcon name="i-lucide-newspaper" class="size-5" /></span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium text-highlighted">{{ post.title }}</span>
                    <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      <span class="rounded-full px-1.5 text-[11px] font-medium" :class="STATE_CLASS[stateOf(post)]">{{ stateLabel(post) }}</span>
                      <time v-if="post.publishedAt" :datetime="post.publishedAt">{{ shortDate(post.publishedAt) }}</time>
                      <span v-for="tag in post.tags.slice(0, 3)" :key="tag">#{{ tag }}</span>
                    </span>
                  </span>
                  <span class="hidden shrink-0 items-center gap-3 text-xs tabular-nums text-muted sm:flex">
                    <span v-if="post.newsletter" class="flex items-center gap-1" :title="$t('blog.sentAsNewsletter')"><UIcon name="i-lucide-mail" class="size-3.5" />{{ campaignLabel(post.newsletter.status) }}</span>
                    <span class="flex items-center gap-1"><UIcon name="i-lucide-message-circle" class="size-3.5" />{{ post.commentCount }}</span>
                    <span class="flex items-center gap-1"><UIcon name="i-lucide-heart" class="size-3.5" />{{ reactionTotal(post) }}</span>
                  </span>
                </NuxtLink>
              </li>
            </ul>
            <p v-if="!shown.length" class="py-6 text-center text-sm text-muted">{{ $t('blog.noMatch') }}</p>
          </template>
        </template>

        <template v-else>
          <div class="flex items-center gap-2">
            <USelect v-model="commentFilter" :items="commentFilterItems" size="sm" class="w-40" />
            <span class="text-xs tabular-nums text-muted">{{ $t('blog.commentTotal', commentTotal) }}</span>
          </div>
          <EmptyState v-if="!comments.length && !loadingComments" icon="i-lucide-message-circle" :title="$t('blog.noComments')" :description="$t('blog.noCommentsDescription')" />
          <ul v-else class="divide-y divide-default rounded-lg border border-default">
            <li v-for="comment in comments" :key="comment.id" class="space-y-1.5 px-3 py-3 text-[13px]" :class="comment.status === 'hidden' ? 'opacity-60' : ''">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span class="font-medium text-highlighted">{{ comment.authorName }}</span>
                <UBadge v-if="comment.authorIsStaff" :label="$t('blog.team')" size="sm" variant="soft" />
                <UBadge v-if="comment.status === 'hidden'" :label="$t('blog.hidden')" size="sm" color="warning" variant="soft" />
                <span class="text-xs text-muted">{{ timeAgo(comment.createdAt) }} · <NuxtLink :to="`/projects/${id}/blog/${comment.postId}`" class="hover:underline">{{ comment.postTitle }}</NuxtLink></span>
                <span class="ml-auto flex items-center gap-1">
                  <UButton :icon="comment.status === 'hidden' ? 'i-lucide-eye' : 'i-lucide-eye-off'" size="xs" color="neutral" variant="ghost" square :aria-label="comment.status === 'hidden' ? $t('blog.show') : $t('blog.hide')" @click="moderate(comment, comment.status === 'hidden' ? 'visible' : 'hidden')" />
                  <UButton icon="i-lucide-reply" size="xs" color="neutral" variant="ghost" square :aria-label="$t('blog.reply')" @click="replyTo = replyTo === comment.id ? '' : comment.id" />
                  <UButton :icon="confirmDelete === comment.id ? 'i-lucide-check' : 'i-lucide-trash-2'" size="xs" :color="confirmDelete === comment.id ? 'error' : 'neutral'" variant="ghost" square :aria-label="confirmDelete === comment.id ? $t('blog.clickAgainDelete') : $t('blog.delete')" @click="removeComment(comment)" />
                </span>
              </div>
              <!-- eslint-disable-next-line vue/no-v-html -- sanitised on the server when it was written -->
              <div class="prose-comment text-default" v-html="comment.bodyHtml" />
              <form v-if="replyTo === comment.id" class="flex items-start gap-2 pt-1" @submit.prevent="sendReply(comment)">
                <UTextarea v-model="replyText" :rows="2" autoresize :maxrows="8" class="flex-1" :placeholder="$t('blog.replyPlaceholder')" />
                <UButton type="submit" :label="$t('blog.reply')" size="sm" :loading="replying" :disabled="!replyText.trim()" />
              </form>
            </li>
          </ul>
          <div v-if="commentsHaveMore" class="text-center">
            <UButton :label="$t('blog.loadMore')" color="neutral" variant="ghost" size="sm" :loading="loadingComments" @click="loadComments(true)" />
          </div>
        </template>
      </div>
    </div>

    <!-- Settings -->
    <USlideover v-model:open="showSettings" :title="$t('blog.settingsTitle')" :description="$t('blog.settingsDescription')" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-5">
          <p v-if="!canManage" class="rounded-lg border border-default bg-elevated px-3 py-2 text-[13px] text-muted">{{ $t('blog.adminsOnly') }}</p>
          <USwitch :model-value="settings.enabled" :disabled="!canManage" :label="$t('blog.enabled')" :description="$t('blog.enabledDescription')" @update:model-value="saveSettings({ enabled: $event })" />
          <UFormField :label="$t('blog.blogTitle')" :description="$t('blog.blogTitleHint')">
            <UInput v-model="settingsDraft.title" :disabled="!canManage" class="w-full" :maxlength="120" :placeholder="defaultTitle" @blur="saveText('title')" />
          </UFormField>
          <UFormField :label="$t('blog.blogDescription')">
            <UTextarea v-model="settingsDraft.description" :disabled="!canManage" :rows="2" autoresize class="w-full" :maxlength="300" @blur="saveText('description')" />
          </UFormField>
          <USwitch :model-value="settings.reactions" :disabled="!canManage" :label="$t('blog.reactions')" :description="$t('blog.reactionsDescription')" @update:model-value="saveSettings({ reactions: $event })" />
          <USwitch :model-value="settings.comments" :disabled="!canManage" :label="$t('blog.comments')" :description="$t('blog.commentsDescription')" @update:model-value="saveSettings({ comments: $event })" />
          <p v-if="settings.comments && project && !project.allowAnonymousUsers" class="-mt-2 text-xs text-muted">{{ $t('blog.emailOnlyHint') }} <NuxtLink :to="`/projects/${id}/settings`" class="underline underline-offset-2">{{ $t('nav.settings') }}</NuxtLink>{{ $t('blog.emailOnlyHintEnd') }}</p>
          <UFormField :label="$t('blog.commentNotify')" :description="$t('blog.commentNotifyHint')">
            <UInput v-model="settingsDraft.commentNotify" :disabled="!canManage" class="w-full" placeholder="you@example.com" @blur="saveText('commentNotify')" />
          </UFormField>
          <UFormField :label="$t('blog.postUrl')" :description="$t('blog.postUrlHint')">
            <UInput v-model="settingsDraft.postUrl" :disabled="!canManage" class="w-full font-mono" placeholder="{siteUrl}/blog/{slug}" @blur="saveText('postUrl')" />
          </UFormField>

          <USeparator :label="$t('blog.newsletter')" />
          <p class="text-xs text-muted">{{ $t('blog.newsletterDescription') }} <NuxtLink :to="`/projects/${id}/campaigns`" class="underline underline-offset-2">{{ $t('sections.campaigns') }}</NuxtLink>{{ $t('blog.newsletterDescriptionEnd') }}</p>
          <USwitch :model-value="settings.subscribeForm" :disabled="!canManage" :label="$t('blog.subscribeForm')" :description="$t('blog.subscribeFormDescription')" @update:model-value="saveSettings({ subscribeForm: $event })" />
          <UFormField :label="$t('blog.newsletterTopic')" :description="$t('blog.newsletterTopicHint')">
            <USelect :model-value="settings.newsletterTopic || NONE" :items="topicItems" :disabled="!canManage" class="w-full" @update:model-value="saveSettings({ newsletterTopic: $event === NONE ? '' : String($event) })" />
          </UFormField>

          <USeparator :label="$t('blog.embed')" />
          <p class="text-xs text-muted">{{ $t('blog.embedDescription') }}</p>
          <CodeBlock :code="embedSnippet" lang="html" />
          <div class="flex flex-wrap gap-2">
            <UButton icon="i-lucide-copy" :label="$t('blog.copySnippet')" size="xs" color="neutral" variant="soft" @click="copy(embedSnippet, $t('blog.snippet'))" />
            <UButton icon="i-lucide-book-open" :label="$t('blog.readDocs')" size="xs" color="neutral" variant="ghost" to="/docs/blog" target="_blank" />
          </div>

          <p class="text-xs text-muted">{{ savingSettings ? $t('blog.saving') : settingsSaved ? $t('common.saved') : $t('blog.savesAsChange') }}</p>
          <p v-if="settingsError" class="text-sm text-error">{{ settingsError }}</p>
        </div>
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import { blogTitle, DEFAULT_BLOG_CONFIG, isBlogPostLive, type BlogCommentStatus, type BlogCommentWithPost, type BlogConfig, type BlogPost } from '#shared/blog'
import { can } from '#shared/roles'
import type { AdminProject } from '~~/server/utils/projects'
import { shortDate, timeAgo } from '~/utils/feedbackFormat'

// A project's blog: its posts (written in the editor at ./[postId].vue), the
// comments readers leave on them, and the settings. Nothing is public until
// the blog is on and a post is published; scheduled posts go live on their own.

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const id = String(route.params.id)
const { api, projects, loadProjects, context } = useAgent()
const toast = useToast()
const { t } = useI18n()
const appUrl = useAppUrl()

const project = computed<AdminProject | null>(() => projects.value.find(p => p.id === id) || null)
const settings = computed<BlogConfig>(() => project.value?.blog || DEFAULT_BLOG_CONFIG)
const canManage = computed(() => can(context.value?.role, 'projects.manage'))
const blogOn = computed(() => settings.value.enabled)
const blogUrl = computed(() => (project.value ? `${appUrl.value}/blog/${project.value.publicKey}` : ''))
const feedUrl = computed(() => (project.value ? `${appUrl.value}/v1/projects/${project.value.publicKey}/blog.rss` : ''))
const defaultTitle = computed(() => blogTitle({ title: '' }, project.value?.name || ''))
const embedSnippet = computed(() => `<div id="blog"></div>\n<script src="${appUrl.value}/blog.js" data-project="${project.value?.publicKey || 'pk_…'}" data-target="#blog" defer><\/script>`)

const posts = ref<BlogPost[]>([])
const loading = ref(true)
const error = ref('')
const tab = ref<'posts' | 'comments'>(route.query.tab === 'comments' ? 'comments' : 'posts')
const tabs = computed(() => [{ label: t('blog.posts'), value: 'posts', icon: 'i-lucide-newspaper' }, { label: t('blog.commentsTab'), value: 'comments', icon: 'i-lucide-message-circle' }])

// ---- posts ----
type PostState = 'live' | 'scheduled' | 'draft'
const STATE_CLASS: Record<PostState, string> = { live: 'bg-success/10 text-success', scheduled: 'bg-info/10 text-info', draft: 'bg-elevated text-toned' }
const search = ref('')
const statusFilter = ref<'all' | PostState>('all')
const statusItems = computed(() => [{ label: t('blog.allPosts'), value: 'all' }, { label: t('blog.live'), value: 'live' }, { label: t('blog.scheduled'), value: 'scheduled' }, { label: t('blog.draft'), value: 'draft' }])

function stateOf(post: BlogPost): PostState {
  if (isBlogPostLive(post)) return 'live'
  return post.status === 'published' ? 'scheduled' : 'draft'
}
function stateLabel(post: BlogPost): string {
  const state = stateOf(post)
  return state === 'live' ? t('blog.live') : state === 'scheduled' ? t('blog.scheduled') : t('blog.draft')
}
const reactionTotal = (post: BlogPost) => post.reactions.reduce((sum, r) => sum + r.count, 0)
const campaignLabel = (status: string) => t(`blog.campaign.${['draft', 'scheduled', 'sending', 'paused', 'sent', 'canceled'].includes(status) ? status : 'draft'}`)

const liveCount = computed(() => posts.value.filter(p => stateOf(p) === 'live').length)
const draftCount = computed(() => posts.value.filter(p => stateOf(p) !== 'live').length)
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return posts.value.filter(post => (statusFilter.value === 'all' || stateOf(post) === statusFilter.value)
    && (!q || post.title.toLowerCase().includes(q) || post.tags.some(tag => tag.toLowerCase().includes(q))))
})

async function loadPosts() {
  posts.value = (await api<{ posts: BlogPost[] }>('/admin/blog/posts', { query: { project: id } })).posts
}

// ---- comments ----
const comments = ref<BlogCommentWithPost[]>([])
const commentTotal = ref(0)
const commentsHaveMore = ref(false)
const loadingComments = ref(false)
const commentFilter = ref<'all' | BlogCommentStatus>('all')
const commentFilterItems = computed(() => [{ label: t('blog.allComments'), value: 'all' }, { label: t('blog.visible'), value: 'visible' }, { label: t('blog.hidden'), value: 'hidden' }])
const confirmDelete = ref('')
const replyTo = ref('')
const replyText = ref('')
const replying = ref(false)

async function loadComments(more = false) {
  loadingComments.value = true
  try {
    const page = await api<{ comments: BlogCommentWithPost[], total: number, hasMore: boolean }>('/admin/blog/comments', { query: { project: id, status: commentFilter.value === 'all' ? undefined : commentFilter.value, skip: more ? comments.value.length : 0 } })
    comments.value = more ? [...comments.value, ...page.comments] : page.comments
    commentTotal.value = page.total
    commentsHaveMore.value = page.hasMore
  } catch (e: any) {
    toast.add({ title: t('blog.loadCommentsError'), description: e?.message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    loadingComments.value = false
  }
}

async function moderate(comment: BlogCommentWithPost, status: 'visible' | 'hidden') {
  try {
    await api(`/blog/comments/${comment.id}`, { method: 'PATCH', body: { status } })
    comment.status = status
  } catch (e: any) {
    toast.add({ title: t('blog.moderateError'), description: e?.message, color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function removeComment(comment: BlogCommentWithPost) {
  if (confirmDelete.value !== comment.id) {
    confirmDelete.value = comment.id
    return
  }
  try {
    await api(`/blog/comments/${comment.id}`, { method: 'DELETE' })
    comments.value = comments.value.filter(c => c.id !== comment.id)
    commentTotal.value = Math.max(0, commentTotal.value - 1)
  } catch (e: any) {
    toast.add({ title: t('blog.moderateError'), description: e?.message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    confirmDelete.value = ''
  }
}

async function sendReply(comment: BlogCommentWithPost) {
  replying.value = true
  try {
    await api(`/blog/${encodeURIComponent(comment.postId)}/comments`, { method: 'POST', query: { project: id }, body: { body: replyText.value, parentId: comment.id } })
    replyText.value = ''
    replyTo.value = ''
    toast.add({ title: t('blog.replied'), icon: 'i-lucide-check', color: 'success' })
    await loadComments()
  } catch (e: any) {
    toast.add({ title: t('blog.replyError'), description: e?.message, color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    replying.value = false
  }
}

watch(commentFilter, () => loadComments())
watch(tab, (next) => {
  if (next === 'comments' && !comments.value.length) void loadComments()
})

// ---- settings ----
const NONE = '__none__'
const showSettings = ref(false)
const savingSettings = ref(false)
const settingsSaved = ref(false)
const settingsError = ref('')
const settingsDraft = reactive({ title: '', description: '', commentNotify: '', postUrl: '' })
const topicItems = computed(() => [{ label: t('blog.everySubscriber'), value: NONE }, ...(project.value?.marketing.topics || []).map(topic => ({ label: topic.name || topic.key, value: topic.key }))])

watch(settings, (next) => {
  Object.assign(settingsDraft, { title: next.title, description: next.description, commentNotify: next.commentNotify.join(', '), postUrl: next.postUrl })
}, { immediate: true })

function saveText(key: keyof typeof settingsDraft) {
  const current = key === 'commentNotify' ? settings.value.commentNotify.join(', ') : settings.value[key]
  if (settingsDraft[key].trim() === current) return
  void saveSettings({ [key]: settingsDraft[key] })
}

async function saveSettings(next: Partial<Record<keyof BlogConfig, unknown>>) {
  savingSettings.value = true
  settingsSaved.value = false
  settingsError.value = ''
  try {
    const { project: saved } = await api<{ project: AdminProject }>(`/admin/projects/${id}`, { method: 'PATCH', body: { blog: next } })
    projects.value = projects.value.map(p => (p.id === saved.id ? saved : p))
    settingsSaved.value = true
  } catch (e: any) {
    settingsError.value = e?.message || t('blog.saveError')
  } finally {
    savingSettings.value = false
  }
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('blog.copied', { what }), icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {
    toast.add({ title: what, description: text })
  }
}

onMounted(async () => {
  try {
    if (!project.value) await loadProjects()
    if (!project.value) throw new Error(t('blog.projectNotFound'))
    await loadPosts()
    if (tab.value === 'comments') await loadComments()
  } catch (e: any) {
    error.value = e?.message || t('blog.loadError')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
@reference "~/assets/css/main.css";
.prose-comment :deep(p) { @apply my-1; }
.prose-comment :deep(a) { @apply text-primary underline underline-offset-2; }
.prose-comment :deep(code) { @apply rounded bg-elevated px-1 text-[12px]; }
.prose-comment :deep(blockquote) { @apply border-l-2 border-default pl-2 text-muted; }
</style>
