<template>
  <!-- The feedback posts a conversation is behind: open one, unlink it, file a new one as the customer, or add an existing one. They follow what is linked. -->
  <div class="space-y-1.5">
    <div v-for="post in posts" :key="post.id" class="group -mx-1 flex items-center gap-1.5 rounded-lg px-1 text-[13px] transition-colors hover:bg-elevated">
      <NuxtLink :to="`/projects/${projectId}/feedback?post=${post.id}`" class="flex min-w-0 flex-1 items-center gap-2 py-1">
        <span class="size-2 shrink-0 rounded-full" :class="dotTone(post.statusCategory)" :title="post.statusLabel || post.status" />
        <span v-if="post.number" class="shrink-0 tabular-nums text-muted">#{{ post.number }}</span>
        <span class="min-w-0 truncate text-default">{{ post.title }}</span>
        <UIcon :name="post.following ? 'i-lucide-bell-ring' : 'i-lucide-bell-off'" class="size-3 shrink-0" :class="post.following ? 'text-primary' : 'text-dimmed'" :title="post.following ? $t('inbox.hub.feedbackFollowing') : $t('inbox.hub.feedbackNotFollowing')" />
      </NuxtLink>
      <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" :aria-label="$t('inbox.hub.feedbackUnlink', { number: post.number ?? '', title: post.title })" :loading="busy === post.id" @click="unlink(post)" />
    </div>
    <p v-if="!posts.length && !composing" class="text-xs text-muted">{{ $t('inbox.hub.feedbackNoPosts') }}</p>

    <form v-if="composing" class="space-y-1.5 pt-0.5" @submit.prevent="create">
      <p class="text-xs text-muted">{{ $t('inbox.hub.feedbackNewDescription', { name: contact.name || contact.email || contact.externalId }) }}</p>
      <UInput v-model="newTitle" size="xs" class="w-full" :maxlength="200" autofocus :placeholder="$t('inbox.hub.feedbackTitleLabel')" :aria-label="$t('inbox.hub.feedbackTitleLabel')" />
      <UTextarea v-model="newBody" size="xs" class="w-full" :rows="3" autoresize :maxrows="8" :placeholder="$t('inbox.hub.feedbackBodyLabel')" :aria-label="$t('inbox.hub.feedbackBodyLabel')" />
      <div class="flex items-center gap-1.5">
        <UButton type="submit" :label="$t('inbox.hub.feedbackFile')" size="xs" :loading="creating" :disabled="!newTitle.trim()" />
        <UButton :label="$t('common.cancel')" size="xs" color="neutral" variant="ghost" @click="composing = false" />
      </div>
    </form>
    <div v-else class="flex flex-wrap items-center gap-1.5 pt-0.5">
      <UButton icon="i-lucide-plus" :label="$t('inbox.hub.feedbackFileNew')" size="xs" color="neutral" variant="outline" :disabled="!canAuthor" @click="startComposing" />
      <USelectMenu
        v-model="picked"
        v-model:search-term="term"
        :items="candidates"
        value-key="value"
        size="xs"
        class="min-w-0 flex-1"
        ignore-filter
        :placeholder="$t('inbox.hub.feedbackAddExisting')"
        :search-input="{ placeholder: $t('inbox.hub.feedbackSearch') }"
        :loading="searching"
        @update:open="open => open && search()"
        @update:model-value="addExisting"
      />
    </div>
    <p v-if="!canAuthor" class="text-xs text-muted">{{ $t('inbox.hub.feedbackNoUserId') }}</p>
    <p v-if="error" class="text-xs text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { feedbackPlainText, type FeedbackPost } from '#shared/feedback'
import type { FeedbackLinkResponse, HubContact, HubFeedbackPost } from '#shared/conversationHub'

// Used by the inbox's customer panel. The parent loads the conversation's
// context once and owns the list (`v-model:posts`); this component changes it
// through POST /admin/conversations/:id/feedback-posts.

const props = defineProps<{ projectId: string, conversationId: string, contact: Pick<HubContact, 'id' | 'name' | 'email' | 'externalId'>, title?: string, description?: string }>()
const posts = defineModel<HubFeedbackPost[]>('posts', { required: true })

const { api } = useAgent()
const { t } = useI18n()

const busy = ref('')
const error = ref('')
const composing = ref(false)
const creating = ref(false)
const newTitle = ref('')
const newBody = ref('')
const picked = ref<string | undefined>(undefined)
const term = ref('')
const found = ref<FeedbackPost[]>([])
const searching = ref(false)

// A post needs an author with a user id; without one only linking works.
const canAuthor = computed(() => Boolean(props.contact.externalId))

const TONES: Record<string, string> = { open: 'bg-stone-400', planned: 'bg-sky-500', active: 'bg-primary-500', done: 'bg-emerald-500', closed: 'bg-stone-300' }
const dotTone = (category: string) => TONES[category] || TONES.open

const candidates = computed(() => found.value
  .filter(post => !posts.value.some(linked => linked.id === post.id))
  .map(post => ({ label: `${post.number ? `#${post.number} ` : ''}${post.title}`, value: post.id })))

async function change(body: Record<string, unknown>): Promise<FeedbackLinkResponse> {
  return await api<FeedbackLinkResponse>(`/admin/conversations/${props.conversationId}/feedback-posts`, { method: 'POST', body })
}

let timer: ReturnType<typeof setTimeout> | null = null
async function search() {
  searching.value = true
  try {
    found.value = (await api<{ posts: FeedbackPost[] }>('/feedback', { query: { project: props.projectId, includeHidden: 1, limit: 30, sort: 'new', q: term.value.trim().replace(/^#/, '') || undefined } })).posts
  } catch (e: any) {
    error.value = e?.message || t('inbox.hub.feedbackLoadError')
  } finally {
    searching.value = false
  }
}
watch(term, () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void search(), 250) })
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

async function addExisting(postId: string | undefined) {
  if (!postId) return
  busy.value = postId
  error.value = ''
  try {
    const result = await change({ postId, linked: true })
    if (!posts.value.some(post => post.id === result.post.id)) posts.value = [...posts.value, result.post]
    else posts.value = posts.value.map(post => (post.id === result.post.id ? result.post : post))
  } catch (e: any) {
    error.value = e?.message || t('inbox.hub.feedbackLinkError')
  } finally {
    busy.value = ''
    picked.value = undefined
  }
}

async function unlink(post: HubFeedbackPost) {
  busy.value = post.id
  error.value = ''
  try {
    await change({ postId: post.id, linked: false })
    posts.value = posts.value.filter(item => item.id !== post.id)
  } catch (e: any) {
    error.value = e?.message || t('inbox.hub.feedbackUnlinkError')
  } finally {
    busy.value = ''
  }
}

// Starts from the ticket's subject and the customer's own words; both are editable.
function startComposing() {
  const text = (props.description || '').trim()
  newTitle.value = (props.title || '').trim() || feedbackPlainText(text, 80).split('\n')[0] || ''
  newBody.value = text
  error.value = ''
  composing.value = true
}

async function create() {
  creating.value = true
  error.value = ''
  try {
    const result = await change({ create: { title: newTitle.value.trim().slice(0, 200), body: newBody.value.trim() } })
    posts.value = [...posts.value, result.post]
    composing.value = false
  } catch (e: any) {
    error.value = e?.message || t('inbox.hub.feedbackCreateError')
  } finally {
    creating.value = false
  }
}
</script>
