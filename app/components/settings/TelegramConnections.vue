<template>
  <div class="space-y-4">
    <p class="text-[13px] text-muted">{{ $t('workspaceSettings.telegram.intro') }}</p>
    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 2" :key="i" class="h-12" /></div>
    <EmptyState v-else-if="!projects.length" icon="i-lucide-send" :title="$t('workspaceSettings.noProjects')" :description="$t('workspaceSettings.telegram.emptyDescription')" class="rounded-xl border border-dashed border-default" />
    <ul v-else class="space-y-2">
      <li v-for="p in projects" :key="p.id" class="rounded-xl border border-default px-4 py-2">
        <div class="flex min-h-8 items-center gap-3">
          <ProjectDot tile :project-id="p.id" :accent="p.theme?.accent" :name="p.name" :icon-url="p.iconUrl" class="!size-6 !rounded-md !text-xs" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-medium text-highlighted">{{ p.name }}</span>
            <span class="block truncate text-xs text-muted">{{ state[p.id]?.connected ? `@${state[p.id]!.botName} → ${state[p.id]!.chatName}` : $t('workspaceSettings.notConnected') }}</span>
          </span>
          <UTooltip v-if="state[p.id]?.connected" :text="$t('workspaceSettings.disconnect')"><UButton size="sm" color="neutral" variant="ghost" square icon="i-lucide-unplug" class="text-muted" :aria-label="$t('workspaceSettings.telegram.disconnectAria')" @click="disconnect(p.id, p.name)" /></UTooltip>
          <UButton v-else-if="adding !== p.id" icon="i-lucide-plus" :label="$t('workspaceSettings.connect')" size="sm" color="neutral" variant="outline" @click="adding = p.id; token = ''; chatId = ''" />
        </div>
        <form v-if="adding === p.id" class="mt-2 space-y-2 border-t border-default pt-3" @submit.prevent="connect(p.id)">
          <UFormField :label="$t('workspaceSettings.telegram.botToken')" :help="$t('workspaceSettings.telegram.tokenHelp', { botFather: '@BotFather' })">
            <UInput v-model="token" type="password" placeholder="123456:ABC…" autocomplete="off" class="w-full" autofocus />
          </UFormField>
          <UFormField :label="$t('workspaceSettings.telegram.chatId')" :help="$t('workspaceSettings.telegram.chatIdHelp')">
            <UInput v-model="chatId" placeholder="-1001234567890" autocomplete="off" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" size="sm" @click="adding = ''">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" size="sm" :loading="saving" :disabled="!token.trim()">{{ $t('workspaceSettings.telegram.connectTelegram') }}</UButton>
          </div>
        </form>
      </li>
    </ul>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import type { TelegramConnection } from '~~/server/utils/telegram'

const { api, projects } = useAgent()
const { t } = useI18n()
const state = reactive<Record<string, TelegramConnection | undefined>>({})
const loading = ref(true)
const adding = ref('')
const token = ref('')
const chatId = ref('')
const saving = ref(false)
const error = ref('')

async function refresh(id: string) {
  const res = await api<{ connection: TelegramConnection }>('/admin/telegram', { query: { project: id } })
  state[id] = res.connection
}

async function connect(id: string) {
  saving.value = true
  error.value = ''
  try {
    state[id] = (await api<{ connection: TelegramConnection }>('/admin/telegram/connect', { method: 'POST', body: { project: id, botToken: token.value, chatId: chatId.value } })).connection
    adding.value = ''
    token.value = chatId.value = ''
  } catch (cause: any) { error.value = cause.message || t('workspaceSettings.telegram.connectFailed') } finally { saving.value = false }
}

async function disconnect(id: string, name: string) {
  if (!confirm(t('workspaceSettings.telegram.disconnectConfirm', { name }))) return
  error.value = ''
  try {
    await api('/admin/telegram', { method: 'DELETE', query: { project: id } })
    await refresh(id)
  } catch (cause: any) { error.value = cause.message || t('workspaceSettings.disconnectFailed') }
}

onMounted(async () => {
  await Promise.all(projects.value.map(p => refresh(p.id).catch(() => {})))
  loading.value = false
})
</script>
