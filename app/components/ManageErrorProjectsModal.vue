<template>
  <UModal v-model:open="open" :title="$t('errors.manage.title')" :description="$t('errors.manage.description')">
    <template #body>
      <div class="space-y-4">
        <p v-if="!links.length" class="text-sm text-muted">{{ $t('errors.manage.nothing') }}</p>
        <section v-for="link in links" :key="link.id" class="space-y-3 rounded-lg border border-default p-3">
          <div class="flex items-center gap-2">
            <UInput v-model="labels[link.id]" class="min-w-0 flex-1" :aria-label="$t('errors.manage.nameShownFor', { name: link.name })" @keyup.enter="rename(link)" />
            <UButton color="neutral" variant="soft" :label="$t('workspaceSettings.save')" :disabled="!labels[link.id]?.trim() || labels[link.id]?.trim() === link.label" :loading="busy === link.id" @click="rename(link)" />
          </div>
          <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt class="text-muted">{{ $t('errors.manage.tracker') }}</dt><dd>{{ link.providerName }} · {{ serverName(link) }}</dd>
            <dt class="text-muted">{{ $t('errors.manage.projectName') }}</dt><dd class="break-all">{{ link.name }}</dd>
            <template v-if="link.team"><dt class="text-muted">{{ $t('errors.manage.team') }}</dt><dd class="break-all">{{ link.team }}</dd></template>
            <dt class="text-muted">DSN</dt>
            <dd class="flex items-start gap-1"><code class="inline-code min-w-0 flex-1 break-all">{{ link.dsn }}</code><UButton color="neutral" variant="ghost" size="xs" :icon="copied === `${link.id}:dsn` ? 'i-lucide-check' : 'i-lucide-copy'" :aria-label="$t('errors.manage.copyDsn')" @click="copy(link.dsn, `${link.id}:dsn`)" /></dd>
            <template v-if="link.alertWebhookUrl">
              <dt class="text-muted">{{ $t('errors.manage.alertWebhook') }}</dt>
              <dd class="flex items-start gap-1"><code class="inline-code min-w-0 flex-1 break-all">{{ link.alertWebhookUrl }}</code><UButton color="neutral" variant="ghost" size="xs" :icon="copied === `${link.id}:hook` ? 'i-lucide-check' : 'i-lucide-copy'" :aria-label="$t('errors.manage.copyWebhook')" @click="copy(link.alertWebhookUrl, `${link.id}:hook`)" /></dd>
            </template>
            <template v-if="link.url"><dt class="text-muted">{{ $t('errors.manage.issues') }}</dt><dd><UButton :to="link.url" target="_blank" variant="link" size="sm" class="p-0" :label="$t('errors.openIn', { provider: link.providerName })" trailing-icon="i-lucide-arrow-up-right" /></dd></template>
          </dl>
          <div class="flex items-center justify-between gap-2 border-t border-default pt-3">
            <p class="text-xs text-muted">{{ removing === link.id ? $t('errors.manage.removeHelp', { provider: link.providerName }) : $t('errors.manage.fixedHelp') }}</p>
            <div class="flex shrink-0 gap-2">
              <UButton v-if="removing === link.id" color="neutral" variant="ghost" size="sm" :label="$t('common.cancel')" @click="removing = ''" />
              <UButton color="error" :variant="removing === link.id ? 'solid' : 'soft'" size="sm" :label="removing === link.id ? $t('workspaceSettings.remove') : $t('errors.manage.removeEllipsis')" :loading="busy === link.id" @click="remove(link)" />
            </div>
          </div>
        </section>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end">
          <UButton :label="$t('workspaceSettings.done')" @click="open = false" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { AdminProject } from '~~/server/utils/projects'
import type { ErrorLinkView } from '~~/server/utils/errorTracking'
import type { ErrorServerView } from '~/components/settings/ErrorServerForm.vue'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ (event: 'changed', project: AdminProject): void }>()

const { api, projects } = useAgent()
const { t } = useI18n()
const links = computed(() => projects.value.find(item => item.id === props.projectId)?.errorLinks || [])
const servers = ref<ErrorServerView[]>([])
const labels = ref<Record<string, string>>({})
const busy = ref('')
const removing = ref('')
const copied = ref('')
const error = ref('')

const serverName = (link: ErrorLinkView) => servers.value.find(server => server.id === link.serverId)?.name || (link.serverId ? t('errors.manage.removedServer') : link.providerName)

watch(open, async (value) => {
  if (!value) return
  error.value = ''; removing.value = ''
  try { servers.value = (await api<{ servers: ErrorServerView[] }>('/admin/errors/servers')).servers } catch { servers.value = [] }
}, { immediate: true })

watch(links, (list) => { labels.value = Object.fromEntries(list.map(link => [link.id, link.label])) }, { immediate: true })

async function copy(text: string, key: string) {
  try { await navigator.clipboard.writeText(text); copied.value = key; setTimeout(() => { if (copied.value === key) copied.value = '' }, 1500) } catch {}
}

async function change(link: ErrorLinkView, run: () => Promise<{ project: AdminProject }>, failure: string) {
  busy.value = link.id; error.value = ''
  try {
    const result = await run()
    projects.value = projects.value.map(item => item.id === props.projectId ? result.project : item)
    emit('changed', result.project)
  } catch (cause: any) { error.value = cause.message || failure } finally { busy.value = '' }
}

const rename = (link: ErrorLinkView) => change(link, () => api<{ project: AdminProject }>(`/admin/errors/links/${link.id}`, { method: 'PUT', body: { project: props.projectId, label: labels.value[link.id] } }), t('errors.manage.renameFailed'))

async function remove(link: ErrorLinkView) {
  if (removing.value !== link.id) { removing.value = link.id; return }
  removing.value = ''
  await change(link, () => api<{ project: AdminProject }>(`/admin/errors/links/${link.id}`, { method: 'DELETE', query: { project: props.projectId } }), t('errors.manage.removeFailed'))
}
</script>
