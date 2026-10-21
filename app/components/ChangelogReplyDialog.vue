<template>
  <!-- Tell the people a published entry answers. Nothing is sent until the button is pressed. -->
  <UModal v-model:open="open" :title="$t('changelog.reply.title')" :description="$t('changelog.reply.description')" :ui="{ content: 'sm:max-w-xl' }">
    <template #body>
      <div class="space-y-4">
        <UFormField :label="$t('changelog.reply.message')">
          <UTextarea v-model="body" :rows="4" autoresize :maxrows="12" class="w-full" :maxlength="8000" :disabled="!!result" />
        </UFormField>

        <div class="space-y-1.5">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium text-highlighted">{{ $t('changelog.reply.conversations') }}</p>
            <span class="text-xs tabular-nums text-muted">{{ $t('changelog.reply.chosen', { chosen: chosen.size, total: linked.count }) }}</span>
            <UButton v-if="!result" size="xs" color="neutral" variant="ghost" class="ml-auto" :label="chosen.size === linked.conversations.length ? $t('changelog.reply.none') : $t('changelog.reply.all')" @click="toggleAll" />
          </div>
          <ul class="max-h-64 divide-y divide-default overflow-y-auto rounded-lg border border-default">
            <li v-for="conversation in linked.conversations" :key="conversation.id" class="flex items-center gap-2.5 px-2.5 py-2 text-[13px]">
              <UCheckbox :model-value="chosen.has(conversation.id)" :disabled="!!result" :aria-label="conversation.subject || $t('changelog.conversation')" @update:model-value="toggle(conversation.id)" />
              <NuxtLink :to="`/inbox?c=${conversation.id}`" class="min-w-0 flex-1 truncate hover:underline">
                <span class="text-default">{{ conversation.subject || $t('changelog.conversation') }}</span>
                <span v-if="conversation.endUserName" class="text-muted"> · {{ conversation.endUserName }}</span>
              </NuxtLink>
              <span v-if="outcomeOf(conversation.id)" class="shrink-0 rounded-full px-1.5 text-[11px]" :class="outcomeOf(conversation.id)!.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error'" :title="outcomeOf(conversation.id)!.error">
                {{ outcomeOf(conversation.id)!.ok ? (outcomeOf(conversation.id)!.emailSent ? $t('changelog.reply.sentEmailed') : $t('changelog.reply.sent')) : $t('changelog.reply.failed') }}
              </span>
              <span v-else class="shrink-0 rounded-full bg-elevated px-1.5 text-[11px] text-toned">{{ conversation.status }}</span>
            </li>
          </ul>
        </div>

        <USwitch v-model="notifyByEmail" :disabled="!!result" :label="$t('changelog.reply.email')" :description="$t('changelog.reply.emailDescription')" />

        <p v-if="result" class="text-sm" :class="result.failed ? 'text-warning' : 'text-success'">{{ $t('changelog.reply.summary', { sent: result.sent, failed: result.failed }) }}</p>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>

        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="result ? $t('changelog.close') : $t('common.cancel')" @click="open = false" />
          <UButton v-if="!result" icon="i-lucide-send" :label="$t('changelog.reply.send', chosen.size)" :loading="sending" :disabled="!body.trim() || !chosen.size" @click="send" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { ChangelogLinkedConversations, ChangelogReplyResult } from '#shared/changelogReply'

// "Reply to N linked conversations": after an entry ships, the person whose
// request it answers hears it from the team, in the thread they already have.
// The message starts as the entry's title and public address and is yours to
// edit; the conversations are the entry's own and its board items'. This only
// ever sends on the button.

const props = defineProps<{ projectId: string, entryId: string, linked: ChangelogLinkedConversations }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ sent: [result: ChangelogReplyResult] }>()

const { api } = useAgent()
const { t } = useI18n()

const body = ref('')
const notifyByEmail = ref(true)
const chosen = ref(new Set<string>())
const result = ref<ChangelogReplyResult | null>(null)
const sending = ref(false)
const error = ref('')

// A fresh start every time it opens: the text from the entry, everyone ticked.
watch(open, (isOpen) => {
  if (!isOpen) return
  body.value = props.linked.defaultBody
  chosen.value = new Set(props.linked.conversations.map(c => c.id))
  notifyByEmail.value = true
  result.value = null
  error.value = ''
})

function toggle(id: string) {
  const next = new Set(chosen.value)
  if (!next.delete(id)) next.add(id)
  chosen.value = next
}

function toggleAll() {
  chosen.value = chosen.value.size === props.linked.conversations.length ? new Set() : new Set(props.linked.conversations.map(c => c.id))
}

const outcomeOf = (conversationId: string) => result.value?.results.find(r => r.conversationId === conversationId) || null

async function send() {
  sending.value = true
  error.value = ''
  try {
    result.value = await api<ChangelogReplyResult>(`/admin/changelog/entries/${props.entryId}/reply-conversations`, {
      method: 'POST',
      query: { project: props.projectId },
      body: { body: body.value, conversationIds: [...chosen.value], notifyByEmail: notifyByEmail.value }
    })
    emit('sent', result.value)
  } catch (cause: any) {
    error.value = cause?.message || t('changelog.reply.error')
  } finally {
    sending.value = false
  }
}
</script>
