<template>
  <!-- Linear's properties column: quiet rows that open a menu, labels as chips, then the customer. -->
  <aside class="flex h-full min-h-0 flex-col">
    <div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-4">
      <section class="space-y-px">
        <p class="section-label px-2 pb-1.5">{{ $t('inbox.properties') }}</p>
        <USelect v-model="status" :items="statusItems" variant="ghost" size="sm" class="w-full" :ui="property" :aria-label="$t('inbox.status')" @update:model-value="save({ status })">
          <template #leading><StatusIcon :category="statusCategory" /></template>
        </USelect>
        <USelect v-model="priority" :items="priorityItems" variant="ghost" size="sm" class="w-full" :ui="property" :aria-label="$t('inbox.priority')" @update:model-value="save({ priority })">
          <template #leading><PriorityIcon :priority="priority" /></template>
        </USelect>
        <USelect v-model="assigneeId" :items="assigneeItems" variant="ghost" size="sm" class="w-full" :ui="property" :aria-label="$t('inbox.assignee')" @update:model-value="saveAssignee">
          <template #leading>
            <span v-if="assignee" class="grid size-4 place-items-center rounded-full bg-accented text-[8px] font-semibold text-toned">{{ initialsOf(assignee.name || assignee.username) }}</span>
            <UIcon v-else name="i-lucide-circle-user-round" class="size-4 text-dimmed" />
          </template>
        </USelect>
      </section>

      <section class="space-y-1">
        <p class="section-label px-2">{{ $t('inbox.labels') }}</p>
        <UInputTags v-model="tags" variant="ghost" size="sm" :placeholder="$t('inbox.addLabel')" class="w-full" :ui="{ base: 'px-2', item: 'rounded-full px-2 bg-transparent ring-default text-xs' }" :aria-label="$t('inbox.labels')" @update:model-value="saveTags" />
      </section>

      <section class="space-y-2 px-2">
        <p class="section-label">{{ $t('inbox.customer') }}</p>
        <div class="flex items-center gap-2.5">
          <span class="grid size-7 shrink-0 place-items-center rounded-full bg-elevated text-[11px] font-semibold text-toned">{{ initialsOf(user.name || user.email || user.externalId) }}</span>
          <div class="min-w-0 text-[13px]">
            <p class="truncate font-medium text-highlighted">{{ user.name || user.email || user.externalId }}</p>
            <p v-if="user.email && user.name" class="truncate text-muted">{{ user.email }}</p>
          </div>
        </div>
        <dl class="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5 pt-1 text-[13px]">
          <dt class="text-muted">{{ $t('inbox.project') }}</dt>
          <dd class="flex min-w-0 items-center gap-1.5 text-default"><ProjectDot v-if="project" :project-id="project.id" :accent="project.theme?.accent" :icon-url="project.iconUrl" /><span class="truncate">{{ project?.name || $t('inbox.unknown') }}</span></dd>
          <dt class="text-muted">{{ $t('inbox.id') }}</dt>
          <dd class="min-w-0 truncate font-mono text-xs leading-5 text-toned" :title="user.externalId">{{ user.externalId }}</dd>
        </dl>
      </section>

      <section v-if="type?.fields.length" class="space-y-3 px-2">
        <p class="section-label">{{ $t('inbox.typeFields', { type: type.name }) }}</p>
        <template v-for="field in type.fields" :key="field.key">
          <UCheckbox v-if="field.type === 'bool'" :model-value="Boolean(fieldValues[field.key])" :label="field.label" @update:model-value="saveField(field.key, $event)" />
          <UFormField v-else :label="field.label" size="sm">
            <USelect v-if="field.type === 'select'" :model-value="String(fieldValues[field.key] || '')" :items="(field.options || []).map(value => ({ label: value, value }))" size="sm" class="w-full" @update:model-value="saveField(field.key, $event)" />
            <UTextarea v-else-if="field.type === 'longtext'" :model-value="String(fieldValues[field.key] || '')" :rows="3" size="sm" class="w-full" @blur="saveField(field.key, ($event.target as HTMLTextAreaElement).value)" />
            <UInput v-else :model-value="String(fieldValues[field.key] || '')" :type="field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'" size="sm" class="w-full" @blur="saveField(field.key, ($event.target as HTMLInputElement).value)" />
          </UFormField>
        </template>
      </section>

      <section v-if="project" class="space-y-1.5 px-2">
        <p class="section-label">{{ $t('sections.board') }}</p>
        <BoardLinks :project-id="project.id" kind="conversation" :target-id="conversation.id" :title="conversation.subject" :description="lastUserMessage" />
      </section>

      <section v-if="project" class="space-y-1.5 px-2">
        <p class="section-label">{{ $t('sections.changelog') }}</p>
        <ChangelogLinks :project-id="project.id" kind="conversation" :target-id="conversation.id" :source="{ type: conversation.type }" />
      </section>

      <section v-if="conversation.subjectRef" class="space-y-1.5 px-2">
        <p class="section-label">{{ $t('inbox.about') }}</p>
        <a :href="conversation.subjectRef.url || undefined" :target="conversation.subjectRef.url ? '_blank' : undefined" rel="noopener noreferrer" class="-mx-1 flex h-9 items-center gap-2 rounded-lg px-1 text-[13px] text-default transition-colors hover:bg-elevated">
          <img v-if="conversation.subjectRef.thumbnailUrl" :src="conversation.subjectRef.thumbnailUrl" alt="" class="size-6 rounded-md object-cover outline outline-1 outline-black/10 dark:outline-white/10">
          <UIcon v-else name="i-lucide-link" class="size-4 shrink-0 text-muted" />
          <span class="min-w-0 truncate">{{ conversation.subjectRef.label }}</span>
          <UIcon v-if="conversation.subjectRef.url" name="i-lucide-arrow-up-right" class="ml-auto size-3.5 shrink-0 text-dimmed" />
        </a>
      </section>

      <section v-if="recentErrors.length" class="space-y-1.5 px-2">
        <p class="section-label">{{ $t('inbox.recentErrors') }}</p>
        <a v-for="issue in recentErrors" :key="issue.id" :href="issue.conversationId ? `/inbox?c=${issue.conversationId}` : issue.url" :target="issue.conversationId ? undefined : '_blank'" rel="noopener noreferrer" class="-mx-1 flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] hover:bg-elevated">
          <UIcon name="i-lucide-bug" class="size-3.5 shrink-0 text-error" /><span class="min-w-0 flex-1 truncate">{{ issue.title }}</span><UIcon name="i-lucide-arrow-up-right" class="size-3 shrink-0 text-dimmed" />
        </a>
      </section>

      <section v-if="type?.actions.length" class="space-y-1.5 px-2">
        <p class="section-label">{{ $t('inbox.actions') }}</p>
        <div class="flex flex-wrap gap-1.5">
          <UButton v-for="action in type.actions" :key="action.key" :label="action.label" :color="action.destructive ? 'error' : 'neutral'" :variant="action.destructive ? 'soft' : 'outline'" size="sm" @click="emit('action', action)" />
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { Conversation, ConversationAction, ConversationPriority, ConversationType, StatusCategory } from '#shared/support'
import type { AdminProject } from '~~/server/utils/projects'

export type InboxEndUser = { id: string, externalId: string, name: string, email: string }
type HumanAgent = { id: string, username: string, email: string, name: string }

// `lastUserMessage` prefills a board item filed from here.
const props = defineProps<{ conversation: Conversation, user: InboxEndUser, project: AdminProject | null, type: ConversationType | null, agents: HumanAgent[], lastUserMessage?: string }>()
const emit = defineEmits<{ triage: [body: Record<string, unknown>], action: [action: ConversationAction] }>()

// A property row: the value reads as plain text until you hover it.
const property = { base: 'h-8 w-full rounded-md ps-8 text-[13px] text-default', trailing: 'opacity-0 transition-opacity group-hover:opacity-100' }

const status = ref('')
const assigneeId = ref('')
const priority = ref<ConversationPriority>('normal')
const tags = ref<string[]>([])
const fieldValues = ref<Record<string, unknown>>({})
const recentErrors = ref<{ id: string, title: string, url: string, conversationId: string }[]>([])
const { api } = useAgent()
const { t } = useI18n()

const initialsOf = (name: string) => (name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
const statusItems = computed(() => (props.type?.statuses || [{ key: 'open', label: t('inbox.open') }, { key: 'done', label: t('inbox.done') }]).map(item => ({ label: item.label, value: item.key })))
// The picked status's category drives the glyph before the save round-trips.
const statusCategory = computed<StatusCategory>(() => props.type?.statuses.find(item => item.key === status.value)?.category || (status.value === props.conversation.status ? props.conversation.statusCategory : status.value === 'done' ? 'resolved' : 'open'))
const assignee = computed(() => props.agents.find(agent => agent.id === assigneeId.value) || null)
const assigneeItems = computed(() => [{ label: t('inbox.unassigned'), value: 'unassigned' }, ...props.agents.map(agent => ({ label: agent.name || agent.username, value: agent.id }))])
const priorityItems = computed(() => [{ label: t('inbox.low'), value: 'low' }, { label: t('inbox.normal'), value: 'normal' }, { label: t('inbox.high'), value: 'high' }, { label: t('inbox.urgent'), value: 'urgent' }])

watch(() => props.conversation, (conversation) => {
  status.value = conversation.status
  assigneeId.value = conversation.assigneeId || 'unassigned'
  priority.value = conversation.priority || 'normal'
  tags.value = [...conversation.tags]
  fieldValues.value = { ...conversation.fields }
}, { immediate: true, deep: true })

watch(() => [props.project?.id, props.project?.errors?.connected, props.user.externalId], async () => {
  if (!props.project?.errors?.connected || ['glitchtip-alerts', 'bugsink-alerts'].includes(props.user.externalId)) { recentErrors.value = []; return }
  try {
    recentErrors.value = (await api<{ issues: typeof recentErrors.value }>('/admin/errors', { query: { project: props.project.id, user: props.user.externalId, limit: 5 } })).issues
  } catch { recentErrors.value = [] }
}, { immediate: true })

function save(body: Record<string, unknown>) { emit('triage', body) }
function saveAssignee() { emit('triage', { assigneeId: assigneeId.value === 'unassigned' ? '' : assigneeId.value }) }
function saveTags() { emit('triage', { tags: tags.value.map(tag => tag.trim()).filter(Boolean) }) }
function saveField(key: string, value: unknown) {
  fieldValues.value = { ...fieldValues.value, [key]: value }
  emit('triage', { fields: fieldValues.value })
}
</script>
