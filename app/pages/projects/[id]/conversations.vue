<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" title="Conversations">
      <template #actions>
        <UButton icon="i-lucide-inbox" label="Open in inbox" color="neutral" variant="outline" size="sm" :to="`/inbox?project=${id}`" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto pb-4">
      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 5" :key="i" class="h-9" /></div>
      <p v-else-if="error" class="p-6 text-[13px] text-error">{{ error }}</p>
      <EmptyState v-else-if="!items.length" icon="i-lucide-messages-square" title="No conversations yet" description="When this project's users write from the widget, their conversations show up here." />
      <template v-for="group in groups" v-else :key="group.key">
        <div v-if="group.items.length" class="group-row">
          <StatusIcon :category="group.key === 'open' ? 'open' : 'resolved'" />{{ group.label }}<span class="font-normal tabular-nums text-muted">{{ group.items.length }}</span>
        </div>
        <NuxtLink
          v-for="c in group.items"
          :key="c.id"
          :to="`/inbox?project=${id}&c=${c.id}`"
          class="mx-2 flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors hover:bg-elevated"
        >
          <PriorityIcon :priority="c.priority" :title="`${c.priority} priority`" />
          <StatusIcon :category="c.statusCategory" />
          <span class="flex min-w-0 flex-1 items-baseline gap-2">
            <span class="max-w-[50%] shrink-0 truncate font-medium text-highlighted">{{ c.subject || c.context?.label || 'Conversation' }}</span>
            <span class="truncate text-muted">{{ c.lastMessageFrom === 'agent' ? 'You: ' : '' }}{{ c.lastMessagePreview }}</span>
          </span>
          <span v-if="c.unreadByAgent" class="rounded-full bg-primary-500 px-1.5 text-[11px] font-semibold leading-4 text-white tabular-nums">{{ c.unreadByAgent }}</span>
          <span class="grid size-5 shrink-0 place-items-center rounded-full bg-elevated text-[9px] font-semibold text-toned" :title="customerName(c)">{{ initials(customerName(c)) }}</span>
          <span class="w-14 shrink-0 text-right text-xs text-muted">{{ shortDate(c.lastMessageAt) }}</span>
        </NuxtLink>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Conversation } from '#shared/support'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const id = String(route.params.id)
const { api } = useAgent()

const items = ref<Conversation[]>([])
const endUsers = ref<Record<string, { name: string, email: string, externalId: string }>>({})
const loading = ref(true)
const error = ref('')

// Linear groups a list by status; here that's still open versus settled.
const groups = computed(() => {
  const open = items.value.filter(c => c.statusCategory === 'open' || c.statusCategory === 'pending')
  return [{ key: 'open', label: 'Open', items: open }, { key: 'done', label: 'Done', items: items.value.filter(c => !open.includes(c)) }]
})

function customerName(c: Conversation) {
  const user = endUsers.value[c.endUserId]
  return user?.name || user?.email || user?.externalId || 'Customer'
}
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
}
function shortDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

onMounted(async () => {
  try {
    const result = await api<{ conversations: Conversation[], endUsers: typeof endUsers.value }>('/admin/conversations', { query: { project: id } })
    items.value = result.conversations
    endUsers.value = result.endUsers || {}
  } catch (e: any) {
    error.value = e?.message || 'Could not load conversations'
  } finally {
    loading.value = false
  }
})
</script>
