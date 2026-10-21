<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.types')">
      <template #actions>
        <UButton icon="i-lucide-plus" :label="$t('projectTools.types.newType')" color="neutral" variant="outline" size="sm" @click="newType" />
      </template>
    </PageHeader>

    <div class="flex shrink-0 gap-1.5 overflow-x-auto border-b border-default px-4 py-2.5 [scrollbar-width:none]" role="tablist" :aria-label="$t('projectTools.types.typesLabel')">
      <button v-for="type in types" :key="type.key" type="button" role="tab" :aria-selected="selected?.key === type.key" class="chip" :class="selected?.key === type.key ? 'chip-active' : ''" @click="edit(type)">{{ type.name }}</button>
      <span v-if="selected && !selected.id" class="chip chip-active">{{ $t('projectTools.types.newType') }}</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <form v-if="selected" class="mx-auto max-w-2xl space-y-5 px-6 py-8" @submit.prevent="save">
        <div>
          <h2 class="text-[15px] font-semibold text-highlighted">{{ selected.id ? selected.name : $t('projectTools.types.newTicketType') }}</h2>
          <p class="mt-1 text-[13px] text-muted">{{ $t('projectTools.types.intro') }}</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('projectTools.types.key')" :hint="$t('projectTools.types.keyHint')"><UInput v-model="form.key" :disabled="Boolean(selected.id)" required class="w-full" /></UFormField>
          <UFormField :label="$t('common.name')"><UInput v-model="form.name" required class="w-full" /></UFormField>
        </div>
        <UFormField :label="$t('projectTools.shared.description')"><UInput v-model="form.description" class="w-full" /></UFormField>
        <UFormField :label="$t('projectTools.types.statuses')" :hint="$t('projectTools.types.statusesHint')"><UTextarea v-model="form.statuses" :rows="7" class="w-full font-mono text-xs" /></UFormField>
        <UFormField :label="$t('projectTools.types.fields')" :hint="$t('projectTools.types.fieldsHint')"><UTextarea v-model="form.fields" :rows="7" class="w-full font-mono text-xs" /></UFormField>
        <UFormField :label="$t('projectTools.types.actions')" :hint="$t('projectTools.types.actionsHint')"><UTextarea v-model="form.actions" :rows="6" class="w-full font-mono text-xs" /></UFormField>
        <!-- An action is signed to the project's webhook; with none, running it fails. -->
        <UAlert v-if="actionsWithoutWebhook" color="warning" variant="subtle" icon="i-lucide-webhook" :title="$t('projectTools.types.noWebhookTitle')" :description="$t('projectTools.types.noWebhookDescription')">
          <template #actions><UButton :to="`/projects/${id}/dev#security`" size="xs" color="warning" variant="outline" :label="$t('projectTools.types.noWebhookFix')" /></template>
        </UAlert>
        <div class="flex flex-wrap gap-x-6 gap-y-2"><UCheckbox v-model="form.assignable" :label="$t('projectTools.types.assignable')" /><UCheckbox v-model="form.userCanReopen" :label="$t('projectTools.types.userCanReopen')" /></div>
        <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
        <div class="flex items-center gap-2 border-t border-default pt-5">
          <UButton type="submit" :loading="saving">{{ selected.id ? $t('projectTools.types.saveType') : $t('projectTools.types.createType') }}</UButton>
          <UButton v-if="selected.id && selected.key !== 'support'" color="error" variant="ghost" @click="remove">{{ $t('projectTools.types.deleteType') }}</UButton>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { actionWebhookReady, type ConversationType } from '#shared/support'

definePageMeta({ middleware: 'agent' })
const { api, projects, loadProjects } = useAgent()
const { t } = useI18n()
const id = String(useRoute().params.id)
const project = computed(() => projects.value.find(p => p.id === id) || null)
const types = ref<ConversationType[]>([])
const selected = ref<ConversationType | null>(null)
const error = ref('')
const saving = ref(false)
const form = reactive({ key: '', name: '', description: '', statuses: '[]', fields: '[]', actions: '[]', assignable: true, userCanReopen: true })

// Whether the actions being edited (as typed, not only as saved) have no webhook to go to.
const actionsWithoutWebhook = computed(() => {
  if (!project.value || actionWebhookReady(project.value)) return false
  try { const actions = JSON.parse(form.actions); return Array.isArray(actions) && actions.length > 0 } catch { return false }
})

function edit(type: ConversationType) {
  selected.value = type
  Object.assign(form, { key: type.key, name: type.name, description: type.description, statuses: JSON.stringify(type.statuses, null, 2), fields: JSON.stringify(type.fields, null, 2), actions: JSON.stringify(type.actions, null, 2), assignable: type.assignable, userCanReopen: type.userCanReopen })
}
function newType() {
  edit({ key: '', name: '', description: '', icon: '', statuses: [{ key: 'open', label: t('projectTools.types.openStatus'), category: 'open', isDefault: true }], fields: [], actions: [], assignable: true, userCanReopen: true, defaultPriority: 'normal' })
}
async function load() {
  const result = await api<{ types: ConversationType[] }>(`/admin/projects/${id}/types`)
  types.value = result.types
  if (!selected.value) edit(types.value[0]!)
}
async function save() {
  if (!selected.value) return
  saving.value = true; error.value = ''
  try {
    const body = { key: form.key, name: form.name, description: form.description, statuses: JSON.parse(form.statuses), fields: JSON.parse(form.fields), actions: JSON.parse(form.actions), assignable: form.assignable, userCanReopen: form.userCanReopen }
    const result = selected.value.id
      ? await api<{ type: ConversationType }>(`/admin/projects/${id}/types/${selected.value.id}`, { method: 'PATCH', body })
      : await api<{ type: ConversationType }>(`/admin/projects/${id}/types`, { method: 'POST', body })
    selected.value = result.type
    await load()
  } catch (e: any) { error.value = e?.message || t('projectTools.types.saveError') }
  finally { saving.value = false }
}
async function remove() {
  if (!selected.value?.id || !confirm(t('projectTools.types.deleteConfirm', { name: selected.value.name }))) return
  try { await api(`/admin/projects/${id}/types/${selected.value.id}`, { method: 'DELETE' }); selected.value = null; await load() } catch (e: any) { error.value = e?.message || t('projectTools.types.deleteError') }
}
onMounted(() => {
  if (!project.value) loadProjects().catch(() => {})
  void load().catch(e => { error.value = e?.message || t('projectTools.types.loadError') })
})
</script>
