<template>
  <div class="flex-1 min-h-0 flex flex-col">
    <PageHeader :project-id="id" :title="$t('sections.feedback')">
      <template #title>
        <span v-if="config?.enabled" class="ml-1 hidden text-xs font-normal tabular-nums text-muted sm:inline">{{ $t('feedback.postCount', posts.length) }}, {{ $t('feedback.voteCount', totalVotes) }}</span>
        <span v-else-if="config" class="ml-1 text-xs font-normal text-warning">{{ $t('feedback.boardOff') }}</span>
      </template>
      <template v-if="config && (config.enabled || showSettings)" #actions>
        <UButton icon="i-lucide-sparkles" :label="$t('feedback.publicChangelog')" color="neutral" variant="ghost" size="sm" @click="copyChangelogUrl" />
        <UButton v-if="changelogReady" icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" square :to="changelogUrl" target="_blank" :aria-label="$t('feedback.openChangelog')" />
        <UButton icon="i-lucide-palette" :label="$t('style.title')" color="neutral" variant="ghost" size="sm" @click="showStyle = true" />
        <UButton icon="i-lucide-settings-2" :label="$t('nav.settings')" color="neutral" variant="ghost" size="sm" @click="showSettings = true" />
        <UButton icon="i-lucide-sparkles" :label="$t('aiCards.button')" color="neutral" variant="soft" size="sm" @click="showAi = true" />
        <UButton icon="i-lucide-plus" :label="$t('feedback.newPost')" size="sm" @click="openNew" />
      </template>
    </PageHeader>

    <!-- Not set up yet -->
    <div v-if="config && !config.enabled && !showSettings" class="flex-1 overflow-y-auto">
      <EmptyState icon="i-lucide-lightbulb" :title="$t('feedback.setupTitle', { name: project?.name || $t('feedback.thisProject') })" :description="$t('feedback.setupDescription')">
        <UButton :label="$t('feedback.customizeFirst')" color="neutral" variant="outline" @click="showSettings = true" />
        <UButton :label="$t('feedback.turnOn')" :loading="saving" @click="saveConfig({ enabled: true })" />
      </EmptyState>
      <p v-if="saveError" class="text-center text-[13px] text-error">{{ saveError }}</p>
    </div>

    <template v-else-if="config">
      <!-- View toolbar: status filters on the left, search and layout on the right -->
      <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-default px-4 py-2.5">
        <button
          v-for="status in config.statuses"
          :key="status.key"
          type="button"
          class="chip h-6 px-2.5 text-xs"
          :class="statusFilter.includes(status.key) ? 'chip-active' : 'border-transparent text-dimmed'"
          :aria-pressed="statusFilter.includes(status.key)"
          @click="statusFilter = statusFilter.includes(status.key) ? statusFilter.filter(k => k !== status.key) : [...statusFilter, status.key]"
        >{{ status.label }}<span class="tabular-nums opacity-70">{{ counts[status.key] || 0 }}</span></button>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <UCheckbox v-model="showHidden" :label="$t('feedback.hidden')" size="sm" />
          <UInput v-model="search" icon="i-lucide-search" :placeholder="$t('common.search')" size="sm" class="w-40 sm:w-52" />
          <USelect v-model="typeFilter" :items="typeItems" size="sm" class="w-36" :aria-label="$t('feedback.type')" />
          <div class="inline-flex rounded-lg bg-elevated p-0.5" role="radiogroup" :aria-label="$t('feedback.layout')">
            <button v-for="option in [{ value: 'list', icon: 'i-lucide-list', label: $t('feedback.listView') }, { value: 'board', icon: 'i-lucide-columns-3', label: $t('feedback.boardView') }] as const" :key="option.value" type="button" role="radio" :aria-checked="layout === option.value" :aria-label="option.label" class="grid h-6 w-7 place-items-center rounded-md transition-colors" :class="layout === option.value ? 'bg-default text-highlighted shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-default'" @click="layout = option.value">
              <UIcon :name="option.icon" class="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="loading" class="space-y-2 p-4"><USkeleton v-for="i in 4" :key="i" class="h-16" /></div>
      <p v-else-if="error" class="p-8 text-[13px] text-error">{{ error }}</p>

      <!-- List -->
      <div v-else-if="layout === 'list'" class="flex-1 min-h-0 overflow-y-auto">
        <div class="mx-auto max-w-4xl px-4 py-4 md:px-6">
          <EmptyState v-if="!visible.length" icon="i-lucide-lightbulb" :title="posts.length ? $t('feedback.noMatches') : $t('feedback.noPosts')" :description="posts.length ? $t('feedback.noMatchesHint') : $t('feedback.noPostsHint')">
            <UButton v-if="!posts.length" icon="i-lucide-plus" :label="$t('feedback.newPost')" @click="openNew" />
          </EmptyState>
          <TransitionGroup v-else tag="div" name="fade" class="space-y-2">
            <UContextMenu v-for="post in visible" :key="post.id" :items="postMenu(post)">
              <FeedbackPostRow :post="post" :config="config" readonly-votes @open="openPost(post.id)" />
            </UContextMenu>
          </TransitionGroup>
        </div>
      </div>

      <!-- Kanban: drag a card to change its status -->
      <div v-else class="flex-1 min-h-0 overflow-x-auto">
        <div class="flex h-full gap-3 p-4 md:px-6">
          <section
            v-for="status in config.statuses"
            :key="status.key"
            class="flex w-72 shrink-0 flex-col rounded-xl bg-elevated/60 transition-shadow"
            :class="dragOver === status.key ? 'ring-2 ring-primary' : ''"
            @dragover.prevent="dragOver = status.key"
            @dragleave="dragOver = dragOver === status.key ? '' : dragOver"
            @drop.prevent="dropOn(status.key)"
          >
            <header class="flex items-center justify-between px-3 pt-3 pb-2">
              <FeedbackStatusBadge :status="status" />
              <span class="text-xs tabular-nums text-muted">{{ (byStatus[status.key] || []).length }}</span>
            </header>
            <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-2">
              <UContextMenu v-for="post in byStatus[status.key] || []" :key="post.id" :items="postMenu(post)">
              <button
                type="button"
                draggable="true"
                class="w-full cursor-grab rounded-lg border border-default bg-default p-3 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,opacity] hover:border-accented active:cursor-grabbing"
                :class="dragging === post.id ? 'opacity-40' : ''"
                @dragstart="dragging = post.id"
                @dragend="dragging = ''; dragOver = ''"
                @click="openPost(post.id)"
              >
                <span class="flex items-start gap-2">
                  <span class="min-w-0 flex-1 text-[13px] font-medium leading-snug line-clamp-3">{{ post.title }}</span>
                  <UIcon v-if="post.hidden" name="i-lucide-eye-off" class="size-3.5 shrink-0 text-dimmed" />
                </span>
                <span class="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
                  <span class="inline-flex items-center gap-0.5 font-semibold tabular-nums"><UIcon name="i-lucide-chevron-up" class="size-3" />{{ post.voteCount }}</span>
                  <span class="inline-flex items-center gap-0.5"><UIcon name="i-lucide-message-circle" class="size-3" />{{ post.commentCount }}</span>
                  <span v-if="feedbackTypeFor(config, post.type)" class="inline-flex items-center gap-1 truncate"><FeedbackIcon :icon="feedbackTypeFor(config, post.type)!.icon" class="size-3" />{{ feedbackTypeFor(config, post.type)!.label }}</span>
                </span>
              </button>
              </UContextMenu>
            </div>
          </section>
        </div>
      </div>
    </template>

    <div v-else-if="error" class="p-8 text-sm text-error">{{ error }}</div>
    <div v-else class="p-8 text-sm text-muted">{{ $t('feedback.loading') }}</div>

    <!-- Post editor -->
    <USlideover v-model:open="editorOpen" :title="editing.id ? (current?.number ? $t('feedback.postNumber', { number: current.number }) : $t('feedback.postHeading')) : $t('feedback.newPost')" :description="editing.id ? editing.id : $t('feedback.postedAsTeam')" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <form v-if="config" id="feedback-post-form" class="space-y-5" @submit.prevent="savePost">
          <div v-if="current" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span class="inline-flex items-center gap-1 font-semibold text-default"><UIcon name="i-lucide-chevron-up" class="size-3.5" />{{ $t('feedback.voteCount', current.voteCount) }}</span>
            <span>{{ $t('feedback.commentCount', current.commentCount) }}</span>
            <span :title="current.createdAt">{{ $t('feedback.posted', { time: timeAgo(current.createdAt) }) }}</span>
            <span v-if="current.author">
              {{ $t('feedback.by') }} <span class="font-medium text-default">{{ current.author.isTeam ? $t('feedback.teamAuthor', { name: current.author.name || $t('feedback.team') }) : current.author.name || $t('feedback.aUser') }}</span>
              <span v-if="current.author.email"> · <a :href="`mailto:${current.author.email}`" class="underline">{{ current.author.email }}</a></span>
              <span v-if="current.author.externalId" class="font-mono"> · {{ current.author.externalId }}</span>
            </span>
          </div>

          <UFormField :label="$t('feedback.title')" required><UInput v-model="editing.title" class="w-full" :maxlength="200" /></UFormField>
          <UFormField :label="$t('feedback.text')" :hint="$t('feedback.markdownOrHtml')"><UTextarea v-model="editing.body" :rows="5" autoresize :maxrows="16" class="w-full" /></UFormField>

          <div class="grid sm:grid-cols-3 gap-3">
            <UFormField :label="$t('feedback.status')"><USelect v-model="editing.status" :items="statusItems" class="w-full" /></UFormField>
            <UFormField :label="$t('feedback.type')"><USelect v-model="editing.type" :items="typeChoice" class="w-full" /></UFormField>
            <UFormField :label="$t('feedback.platform')"><USelect v-model="editing.platform" :items="platformChoice" class="w-full" :disabled="!config.platforms.length" /></UFormField>
          </div>

          <UFormField v-if="config.tags.length" :label="$t('feedback.tags')" :hint="$t('feedback.tagsHint')">
            <USelectMenu v-model="editing.tags" :items="tagItems" value-key="value" multiple class="w-full" :placeholder="$t('feedback.noTags')" />
          </UFormField>

          <UFormField :label="$t('attachments.title')"><AttachmentsField v-model="editing.attachments" :project-id="id" /></UFormField>

          <div class="grid sm:grid-cols-2 gap-3">
            <USwitch v-model="editing.featured" :label="$t('feedback.featured')" :description="$t('feedback.featuredDescription')" />
            <USwitch v-model="editing.hidden" :label="$t('feedback.hidden')" :description="$t('feedback.hiddenDescription')" />
            <USwitch v-model="editing.locked" :label="$t('feedback.locked')" :description="$t('feedback.lockedDescription')" />
          </div>

          <div class="grid sm:grid-cols-3 gap-3">
            <UFormField :label="$t('feedback.shippedIn')" :hint="$t('feedback.shippedInHint')"><UInput v-model="editing.shippedIn" class="w-full" placeholder="v2.4" /></UFormField>
            <UFormField :label="$t('feedback.shippedOn')"><UInput v-model="editing.completedAt" type="date" class="w-full" /></UFormField>
            <UFormField v-if="editing.id" :label="$t('feedback.duplicateOf')" :hint="current?.duplicateOf ? `#${current.duplicateOf.number ?? '?'} ${current.duplicateOf.title}` : $t('feedback.mergeHint')">
              <div class="flex gap-2">
                <UInput v-model="mergeInto" class="flex-1" placeholder="#12" />
                <UButton :label="current?.duplicateOf && !mergeInto ? $t('feedback.unlink') : $t('feedback.merge')" color="neutral" variant="soft" :loading="merging" :disabled="!mergeInto && !current?.duplicateOf" @click="mergePost" />
              </div>
            </UFormField>
          </div>

          <UFormField :label="$t('feedback.teamNote')" :hint="$t('feedback.teamNoteHint')"><UTextarea v-model="editing.adminNote" :rows="2" autoresize class="w-full" /></UFormField>

          <details v-if="current && (current.externalId || Object.keys(current.metadata || {}).length)" class="text-xs">
            <summary class="cursor-pointer text-muted">{{ $t('feedback.integrationData') }}</summary>
            <pre class="mt-2 overflow-x-auto rounded-lg bg-elevated p-3 font-mono">{{ JSON.stringify({ externalId: current.externalId, metadata: current.metadata }, null, 2) }}</pre>
          </details>

          <p v-if="editorError" class="text-sm text-error">{{ editorError }}</p>
        </form>

        <!-- Board items this post feeds -->
        <section v-if="current" class="mt-8 border-t border-muted pt-5">
          <h3 class="mb-2 text-sm font-semibold">{{ $t('sections.board') }}</h3>
          <BoardLinks :key="planningKey" :project-id="id" kind="feedback" :target-id="current.id" :title="current.title" :description="current.body" />
        </section>

        <!-- Changelog entries this post is behind -->
        <section v-if="current" class="mt-8 border-t border-muted pt-5">
          <h3 class="mb-2 text-sm font-semibold">{{ $t('sections.changelog') }}</h3>
          <ChangelogLinks :project-id="id" kind="feedback" :target-id="current.id" :source="{ title: current.title, body: current.body, type: current.type, changelogTitle: current.changelogTitle, changelogBody: current.changelogBody }" />
        </section>

        <!-- Commits and pull requests that mention this post as #N -->
        <GithubRefs v-if="current" class="mt-8 border-t border-muted pt-5" :project-id="id" kind="feedback" :target-id="current.id" :heading="$t('github.linkedWork')" />

        <!-- Comments -->
        <section v-if="current" class="mt-8 border-t border-muted pt-5">
          <h3 class="text-sm font-semibold">{{ $t('feedback.comments') }} <span class="font-normal text-muted">{{ comments.length }}</span></h3>
          <ul class="mt-3 space-y-4">
            <li v-for="comment in comments" :key="comment.id" class="flex gap-2.5 rounded-lg" :class="[comment.parentId ? 'ml-9' : '', comment.visibility === 'internal' ? 'bg-warning/10 p-2' : '', comment.visibility === 'hidden' ? 'opacity-50' : '']">
              <span class="size-7 shrink-0 rounded-full grid place-items-center text-[11px] font-semibold" :class="comment.author?.isTeam ? 'bg-primary text-inverted' : 'bg-elevated text-toned'">
                <UIcon v-if="comment.author?.isTeam" name="i-lucide-badge-check" class="size-3.5" />
                <template v-else>{{ (comment.author?.name || '?').slice(0, 1).toUpperCase() }}</template>
              </span>
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-1.5 text-xs">
                  <span class="font-semibold">{{ comment.author?.name || $t('feedback.user') }}</span>
                  <span v-if="comment.author?.isTeam" class="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">{{ $t('feedback.team') }}</span>
                  <span v-if="comment.author?.email" class="text-muted">{{ comment.author.email }}</span>
                  <span class="text-muted">{{ timeAgo(comment.createdAt) }}<template v-if="comment.editedAt"> · {{ $t('feedback.edited') }}</template></span>
                  <span v-if="comment.visibility !== 'public'" class="rounded-full bg-elevated px-1.5 text-[11px] font-medium capitalize">{{ comment.visibility === 'internal' ? $t('feedback.visibilityInternal') : $t('feedback.visibilityHidden') }}</span>
                  <UIcon v-if="current?.pinnedCommentId === comment.id" name="i-lucide-pin" class="size-3.5 text-primary" />
                  <span class="ml-auto flex">
                    <UButton v-if="comment.visibility === 'public' && !comment.parentId" :icon="current?.pinnedCommentId === comment.id ? 'i-lucide-pin-off' : 'i-lucide-pin'" size="xs" color="neutral" variant="ghost" square :aria-label="current?.pinnedCommentId === comment.id ? $t('feedback.unpin') : $t('feedback.pin')" @click="pinComment(comment)" />
                    <UButton v-if="comment.visibility !== 'internal'" :icon="comment.visibility === 'hidden' ? 'i-lucide-eye' : 'i-lucide-eye-off'" size="xs" color="neutral" variant="ghost" square :aria-label="comment.visibility === 'hidden' ? $t('feedback.showComment') : $t('feedback.hideComment')" @click="setCommentVisibility(comment, comment.visibility === 'hidden' ? 'public' : 'hidden')" />
                    <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="$t('feedback.deleteComment')" @click="deleteComment(comment)" />
                  </span>
                </p>
                <MarkdownBlock :text="comment.body" />
              </div>
            </li>
            <li v-if="!comments.length" class="text-xs text-muted">{{ $t('feedback.noComments') }}</li>
          </ul>
          <form class="mt-4 flex items-end gap-2" @submit.prevent="sendComment">
            <UTextarea v-model="commentDraft" :rows="1" :maxrows="6" autoresize :placeholder="internalNote ? $t('feedback.noteForTeamPlaceholder') : $t('feedback.replyPlaceholder')" class="flex-1" @keydown.meta.enter.prevent="sendComment" @keydown.ctrl.enter.prevent="sendComment" />
            <UTooltip :text="$t('feedback.internalNoteTooltip')"><UButton icon="i-lucide-lock" :color="internalNote ? 'warning' : 'neutral'" :variant="internalNote ? 'soft' : 'ghost'" square :aria-label="$t('feedback.internalNote')" @click="internalNote = !internalNote" /></UTooltip>
            <UButton type="submit" :label="internalNote ? $t('feedback.addNote') : $t('feedback.reply')" color="primary" :disabled="!commentDraft.trim()" :loading="commenting" />
          </form>
        </section>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UButton v-if="editing.id" :label="confirmDelete ? $t('feedback.clickAgainToDelete') : $t('feedback.delete')" icon="i-lucide-trash-2" :color="confirmDelete ? 'error' : 'neutral'" :variant="confirmDelete ? 'solid' : 'ghost'" @click="deletePost" />
          <UButton v-if="current && planning.enabled.value" icon="i-lucide-square-kanban" :label="$t('feedbackPlan.button')" color="neutral" variant="soft" @click="planPost(current)" />
          <UButton v-if="current && config?.postUrlTemplate" icon="i-lucide-external-link" :label="$t('feedback.openOnSite')" color="neutral" variant="ghost" :to="feedbackPostUrl(config, '', current)" target="_blank" />
          <UButton class="ml-auto" :label="$t('common.cancel')" color="neutral" variant="ghost" @click="editorOpen = false" />
          <UButton type="submit" form="feedback-post-form" :label="editing.id ? $t('feedback.save') : $t('feedback.submitPost')" color="primary" :loading="savingPost" :disabled="!editing.title.trim()" />
        </div>
      </template>
    </USlideover>

    <AiCardsChat v-model:open="showAi" :project-id="id" kind="feedback" @created="loadPosts" />

    <PlanningPickerModal v-model:open="showPlanning" :project-id="id" :post="planningPost" @changed="planningKey++" />

    <!-- Style -->
    <USlideover v-model:open="showStyle" :title="$t('feedback.styleTitle')" :description="$t('feedback.styleDescription')" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <StyleChoicePanel v-if="project" :project="project" target="feedback" />
      </template>
    </USlideover>

    <!-- Board settings -->
    <USlideover v-model:open="showSettings" :title="$t('feedback.boardSettings')" :description="$t('feedback.boardSettingsDescription')" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <FeedbackBoardSettings v-if="config" :config="config" :saving="saving" :saved="saved" :error="saveError" @save="saveConfig" />
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import Fuse from 'fuse.js'
import { ACTIVE_FEEDBACK_CATEGORIES, feedbackPostUrl, type FeedbackBoardConfig, type FeedbackComment, type FeedbackEvent, type FeedbackPost } from '#shared/feedback'
import type { ItemAttachment } from '#shared/itemAttachments'
import type { AdminProject } from '~~/server/utils/projects'

// The operator's side of a project's feedback board: triage (list or kanban),
// edit and moderate posts, reply as the team, and configure the board. Uses
// the same /v1/feedback API as every other client, as an operator.

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const id = String(route.params.id)
const { api, token, projects, loadProjects } = useAgent()
const project = computed<AdminProject | null>(() => projects.value.find(p => p.id === id) || null)
const toast = useToast()
const appUrl = useAppUrl()
const { t } = useI18n()

// ---- the changelog link ----
const changelogUrl = computed(() => (project.value ? `${appUrl.value}/changelog/${project.value.publicKey}` : ''))
// The public changelog has its own switch (Changelog → Settings); it does not need the feedback board.
const changelogReady = computed(() => Boolean(project.value?.changelog?.enabled))

async function copyChangelogUrl() {
  if (!changelogReady.value) {
    toast.add({ title: t('feedback.changelogFirstTitle'), description: t('feedback.changelogFirstDescription'), icon: 'i-lucide-info', color: 'warning' })
    return
  }
  try {
    await navigator.clipboard.writeText(changelogUrl.value)
    toast.add({ title: t('feedback.changelogLinkCopied'), description: changelogUrl.value, icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {
    toast.add({ title: t('feedback.yourChangelog'), description: changelogUrl.value, icon: 'i-lucide-sparkles' })
  }
}

const config = ref<FeedbackBoardConfig | null>(null)
const posts = ref<FeedbackPost[]>([])
const loading = ref(true)
const error = ref('')
const layout = ref<'list' | 'board'>('list')
const search = ref('')
const typeFilter = ref('__all__')
const statusFilter = ref<string[]>([])
const showHidden = ref(true)

const typeItems = computed(() => [{ label: t('feedback.allTypes'), value: '__all__' }, ...(config.value?.types || []).map(t => ({ label: t.label, value: t.key }))])
const statusItems = computed(() => (config.value?.statuses || []).map(s => ({ label: s.label, value: s.key })))
const typeChoice = computed(() => [{ label: t('feedback.none'), value: '__none__' }, ...(config.value?.types || []).map(t => ({ label: t.label, value: t.key }))])
const tagItems = computed(() => (config.value?.tags || []).map(t => ({ label: t.label, value: t.key })))
const platformChoice = computed(() => [{ label: t('feedback.none'), value: '__none__' }, ...(config.value?.platforms || []).map(p => ({ label: p.label, value: p.key }))])
const totalVotes = computed(() => posts.value.reduce((sum, p) => sum + p.voteCount, 0))
const counts = computed(() => posts.value.reduce<Record<string, number>>((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {}))

const filtered = computed(() => {
  let list = posts.value.filter(p => (showHidden.value || !p.hidden) && (typeFilter.value === '__all__' || p.type === typeFilter.value))
  const text = search.value.trim()
  if (text) list = new Fuse(list, { keys: ['title', 'body', 'author.name', 'author.email'], threshold: 0.38, ignoreLocation: true }).search(text).map(r => r.item)
  return list
})
const visible = computed(() => filtered.value.filter(p => !statusFilter.value.length || statusFilter.value.includes(p.status)))
const byStatus = computed(() => filtered.value.reduce<Record<string, FeedbackPost[]>>((acc, p) => { (acc[p.status] ||= []).push(p); return acc }, {}))

async function loadConfig() {
  const result = await api<{ config: FeedbackBoardConfig }>('/feedback/config', { query: { project: id } })
  config.value = result.config
  if (!statusFilter.value.length) statusFilter.value = result.config.statuses.filter(s => ACTIVE_FEEDBACK_CATEGORIES.includes(s.category)).map(s => s.key)
}

async function loadPosts() {
  const result = await api<{ posts: FeedbackPost[] }>('/feedback', { query: { project: id, includeHidden: 1, limit: 500, sort: 'new' } })
  posts.value = result.posts
}

function upsert(post: FeedbackPost) {
  const index = posts.value.findIndex(p => p.id === post.id)
  if (index === -1) posts.value = [post, ...posts.value]
  else posts.value.splice(index, 1, mergeFeedbackPost(posts.value[index], post))
}

// ---- planning: right click a post, or use the editor's Planning button ----
const planning = useFeedbackPlanning(id)
const showPlanning = ref(false)
const planningPost = ref<{ id: string, number: number | null, title: string } | null>(null)
// Bumped when a post is filed or attached, so the editor's list of linked items reloads.
const planningKey = ref(0)

function planPost(post: FeedbackPost) {
  planningPost.value = { id: post.id, number: post.number, title: post.title }
  showPlanning.value = true
}

async function createPlanningItem(post: FeedbackPost) {
  if ((await planning.createFor(post)).length) planningKey.value++
}

function postMenu(post: FeedbackPost) {
  return [[
    { label: t('feedbackPlan.openPost'), icon: 'i-lucide-panel-right-open', onSelect: () => openPost(post.id) }
  ], ...(planning.enabled.value
    ? [[
        { label: t('feedbackPlan.createItem'), icon: 'i-lucide-sparkles', onSelect: () => createPlanningItem(post) },
        { label: t('feedbackPlan.addToItem'), icon: 'i-lucide-square-kanban', onSelect: () => planPost(post) }
      ]]
    : [])]
}

// ---- settings ----
const showSettings = ref(false)
const showStyle = ref(false)
const showAi = ref(false)
const saving = ref(false)
const saved = ref(false)
const saveError = ref('')

async function saveConfig(next: Partial<FeedbackBoardConfig>) {
  saving.value = true
  saved.value = false
  saveError.value = ''
  try {
    const result = await api<{ project: AdminProject }>(`/admin/projects/${id}`, { method: 'PATCH', body: { feedback: next } })
    config.value = result.project.feedback
    saved.value = true
    await loadProjects().catch(() => {})
    if (!posts.value.length) await loadPosts().catch(() => {})
  } catch (e: any) {
    saveError.value = e?.message || t('feedback.saveError')
  } finally {
    saving.value = false
  }
}

// ---- editor ----
const editorOpen = ref(false)
const editing = reactive({ id: '', title: '', body: '', status: '', type: '__none__', platform: '__none__', tags: [] as string[], attachments: [] as ItemAttachment[], featured: false, hidden: false, locked: false, shippedIn: '', adminNote: '', completedAt: '' })
const current = computed(() => posts.value.find(p => p.id === editing.id) || null)
const comments = ref<FeedbackComment[]>([])
const editorError = ref('')
const savingPost = ref(false)
const confirmDelete = ref(false)
const mergeInto = ref('')
const merging = ref(false)

function fill(post: FeedbackPost | null) {
  Object.assign(editing, {
    id: post?.id || '',
    title: post?.title || '',
    body: post?.body || '',
    status: post?.status || config.value?.statuses.find(s => s.isDefault)?.key || config.value?.statuses[0]?.key || '',
    type: post?.type || '__none__',
    platform: post?.platform || '__none__',
    tags: [...(post?.tags || [])],
    attachments: [...(post?.attachments || [])],
    featured: post?.featured || false,
    hidden: post?.hidden || false,
    locked: post?.locked || false,
    shippedIn: post?.shippedIn || '',
    adminNote: post?.adminNote || '',
    completedAt: post?.completedAt ? post.completedAt.slice(0, 10) : ''
  })
  editorError.value = ''
  confirmDelete.value = false
  mergeInto.value = ''
}

function openNew() {
  fill(null)
  comments.value = []
  editorOpen.value = true
}

async function openPost(postId: string) {
  fill(posts.value.find(p => p.id === postId) || null)
  comments.value = []
  editorOpen.value = true
  try {
    const result = await api<{ post: FeedbackPost, comments: FeedbackComment[] }>(`/feedback/${postId}`)
    upsert(result.post)
    comments.value = result.comments
    if (editing.id === postId) fill(result.post)
  } catch (e: any) {
    editorError.value = e?.message || t('feedback.loadPostError')
  }
}

async function savePost() {
  savingPost.value = true
  editorError.value = ''
  const body = {
    title: editing.title,
    body: editing.body,
    status: editing.status,
    type: editing.type === '__none__' ? '' : editing.type,
    platform: editing.platform === '__none__' ? '' : editing.platform,
    ...(config.value?.tags.length ? { tags: editing.tags } : {}),
    attachments: editing.attachments,
    featured: editing.featured,
    hidden: editing.hidden,
    locked: editing.locked,
    shippedIn: editing.shippedIn || null,
    adminNote: editing.adminNote || null,
    ...(editing.id || editing.completedAt ? { completedAt: editing.completedAt ? new Date(`${editing.completedAt}T12:00:00Z`).toISOString() : null } : {})
  }
  try {
    const result = editing.id
      ? await api<{ post: FeedbackPost }>(`/feedback/${editing.id}`, { method: 'PATCH', body })
      : await api<{ post: FeedbackPost }>('/feedback', { method: 'POST', body, query: { project: id } })
    upsert(result.post)
    fill(result.post)
    if (!statusFilter.value.includes(result.post.status)) statusFilter.value = [...statusFilter.value, result.post.status]
  } catch (e: any) {
    editorError.value = e?.message || t('feedback.saveError')
  } finally {
    savingPost.value = false
  }
}

async function deletePost() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    setTimeout(() => { confirmDelete.value = false }, 3500)
    return
  }
  try {
    await api(`/feedback/${editing.id}`, { method: 'DELETE' })
    posts.value = posts.value.filter(p => p.id !== editing.id)
    editorOpen.value = false
  } catch (e: any) {
    editorError.value = e?.message || t('feedback.deleteError')
  }
}

async function mergePost() {
  merging.value = true
  editorError.value = ''
  try {
    const into = mergeInto.value.trim().replace(/^#/, '') || null
    const result = await api<{ post: FeedbackPost, into: FeedbackPost | null }>(`/feedback/${editing.id}/merge`, { method: 'POST', body: { into } })
    upsert(result.post)
    if (result.into) upsert(result.into)
    fill(result.post)
  } catch (e: any) {
    editorError.value = e?.message || t('feedback.mergeError')
  } finally {
    merging.value = false
  }
}

// ---- kanban ----
const dragging = ref('')
const dragOver = ref('')
async function dropOn(status: string) {
  const post = posts.value.find(p => p.id === dragging.value)
  dragging.value = ''
  dragOver.value = ''
  if (!post || post.status === status) return
  const before = { ...post }
  upsert({ ...post, status })
  try {
    upsert((await api<{ post: FeedbackPost }>(`/feedback/${post.id}`, { method: 'PATCH', body: { status } })).post)
  } catch (e: any) {
    upsert(before)
    error.value = e?.message || t('feedback.moveError')
  }
}

// ---- comments ----
const commentDraft = ref('')
const commenting = ref(false)
const internalNote = ref(false)
async function sendComment() {
  const body = commentDraft.value.trim()
  if (!body || !editing.id) return
  commenting.value = true
  try {
    const result = await api<{ comment: FeedbackComment, post: FeedbackPost }>(`/feedback/${editing.id}/comments`, { method: 'POST', body: { body, ...(internalNote.value ? { visibility: 'internal' } : {}) } })
    if (!comments.value.some(c => c.id === result.comment.id)) comments.value = [...comments.value, result.comment]
    upsert(result.post)
    commentDraft.value = ''
  } catch (e: any) {
    editorError.value = e?.message || t('feedback.replyError')
  } finally {
    commenting.value = false
  }
}

function replaceComment(comment: FeedbackComment) {
  comments.value = comments.value.map(c => (c.id === comment.id ? { ...c, ...comment } : c))
}

async function setCommentVisibility(comment: FeedbackComment, visibility: FeedbackComment['visibility']) {
  try {
    const result = await api<{ comment: FeedbackComment, post: FeedbackPost }>(`/feedback/${comment.postId}/comments/${comment.id}`, { method: 'PATCH', body: { visibility } })
    replaceComment(result.comment)
    upsert(result.post)
  } catch (e: any) {
    editorError.value = e?.message || t('feedback.commentChangeError')
  }
}

async function pinComment(comment: FeedbackComment) {
  try {
    const pinned = current.value?.pinnedCommentId === comment.id
    upsert((await api<{ post: FeedbackPost }>(`/feedback/${comment.postId}`, { method: 'PATCH', body: { pinnedCommentId: pinned ? null : comment.id } })).post)
  } catch (e: any) {
    editorError.value = e?.message || t('feedback.pinError')
  }
}

async function deleteComment(comment: FeedbackComment) {
  if (!confirm(t('feedback.deleteCommentConfirm'))) return
  try {
    const result = await api<{ post: FeedbackPost }>(`/feedback/${comment.postId}/comments/${comment.id}`, { method: 'DELETE' })
    comments.value = comments.value.filter(c => c.id !== comment.id)
    upsert(result.post)
  } catch (e: any) {
    editorError.value = e?.message || t('feedback.commentDeleteError')
  }
}

// ---- live ----
useEventStream<FeedbackEvent>(computed(() => (config.value ? `/v1/feedback/events?project=${id}` : null)), token, (event) => {
  if (event.type === 'feedback.post.created' || event.type === 'feedback.post.updated') upsert(event.post)
  else if (event.type === 'feedback.post.deleted') posts.value = posts.value.filter(p => p.id !== event.postId)
  else if (event.type === 'feedback.comment.created' && event.postId === editing.id && editorOpen.value && !comments.value.some(c => c.id === event.comment.id)) void openPost(event.postId)
  else if (event.type === 'feedback.comment.updated' && event.postId === editing.id) replaceComment({ ...event.comment, isMine: false })
  else if (event.type === 'feedback.comment.deleted' && event.postId === editing.id) comments.value = comments.value.filter(c => c.id !== event.commentId)
}, () => { void loadPosts() })

onMounted(async () => {
  try {
    if (!project.value) await loadProjects().catch(() => {})
    await loadConfig()
    await loadPosts()
    // `?post=<id>` opens that post: the inbox links the posts a conversation is behind.
    const wanted = typeof route.query.post === 'string' ? route.query.post : ''
    if (wanted) void openPost(wanted)
  } catch (e: any) {
    error.value = e?.message || t('feedback.loadBoardError')
  } finally {
    loading.value = false
  }
})
</script>
