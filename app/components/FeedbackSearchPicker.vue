<template>
  <USelectMenu
    v-model="picked"
    v-model:search-term="term"
    :items="candidates"
    value-key="value"
    ignore-filter
    size="sm"
    class="min-w-0"
    :placeholder="$t('board.attachFeedback')"
    :search-input="{ placeholder: $t('board.searchFeedback') }"
    :loading="loading"
    @update:open="open => open && load()"
    @update:model-value="pick"
  >
    <template #empty>{{ $t('board.noFeedbackMatches') }}</template>
  </USelectMenu>
</template>

<script setup lang="ts">
import Fuse from 'fuse.js'
import type { FeedbackPost } from '#shared/feedback'

// Search the project's feedback posts (title, text, author) and pick one. The caller decides what
// picking means: link it to an item, or hold it until the item is created.

const props = defineProps<{ projectId: string, exclude?: string[] }>()
const emit = defineEmits<{ pick: [post: FeedbackPost] }>()

const { api } = useAgent()
const posts = ref<FeedbackPost[]>([])
const loading = ref(false)
const loaded = ref(false)
const term = ref('')
const picked = ref<string | undefined>(undefined)

const available = computed(() => posts.value.filter(post => !props.exclude?.includes(post.id)))

const candidates = computed(() => {
  const text = term.value.trim()
  const number = /^#?(\d+)$/.exec(text)
  const list = !text
    ? available.value
    : number
      ? available.value.filter(post => String(post.number) === number[1])
      : new Fuse(available.value, { keys: ['title', 'body', 'author.name', 'author.email'], threshold: 0.38, ignoreLocation: true }).search(text).map(r => r.item)
  return list.slice(0, 50).map(post => ({ label: `${post.number ? `#${post.number} ` : ''}${post.title}`, value: post.id }))
})

async function load() {
  if (loaded.value || loading.value) return
  loading.value = true
  try {
    posts.value = (await api<{ posts: FeedbackPost[] }>('/feedback', { query: { project: props.projectId, includeHidden: 1, limit: 500, sort: 'new' } })).posts
    loaded.value = true
  } catch {
    posts.value = []
  } finally {
    loading.value = false
  }
}

function pick(id: string | undefined) {
  const post = id ? posts.value.find(p => p.id === id) : undefined
  if (post) emit('pick', post)
  picked.value = undefined
  term.value = ''
}
</script>
