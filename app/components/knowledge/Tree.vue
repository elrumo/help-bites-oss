<template>
  <div class="space-y-4">
    <form class="flex gap-2" @submit.prevent="addNode">
      <UInput v-model="newName" size="sm" class="flex-1" :placeholder="selectedId ? $t('knowledge.tree.subPathPlaceholder', { name: selectedNode?.name }) : $t('knowledge.tree.topLevelPlaceholder')" />
      <UButton type="submit" size="sm" color="neutral" variant="soft" icon="i-lucide-plus" :loading="adding">{{ $t('knowledge.tree.add') }}</UButton>
      <UButton v-if="selectedId" size="sm" color="neutral" variant="ghost" @click="selectedId = ''">{{ $t('knowledge.tree.clear') }}</UButton>
    </form>

    <p v-if="!nodes.length && !loading" class="text-sm text-muted border border-dashed border-accented rounded-xl p-6 text-center">
      {{ $t('knowledge.tree.empty') }}
    </p>

    <ul v-else class="text-sm">
      <li v-for="n in ordered" :key="n.id">
        <div
          class="group flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-elevated"
          :class="selectedId === n.id ? 'bg-elevated' : ''"
          :style="{ paddingLeft: `${0.5 + n.depth * 1.1}rem` }"
          @click="select(n.id)"
        >
          <UIcon name="i-lucide-folder" class="size-4 text-dimmed shrink-0" />
          <span v-if="editingId !== n.id" class="truncate">{{ n.name }}</span>
          <UInput v-else v-model="editName" size="xs" autofocus @keyup.enter="rename(n)" @click.stop />
          <span class="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100">
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-square-pen" :aria-label="$t('knowledge.tree.rename')" @click.stop="startRename(n)" />
            <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-trash-2" :aria-label="$t('knowledge.delete')" @click.stop="remove(n)" />
          </span>
        </div>
      </li>
    </ul>

    <div v-if="selectedNode" class="rounded-lg border border-default p-3 text-sm space-y-2">
      <p class="font-medium">{{ selectedNode.pathCache }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <UFormField :label="$t('knowledge.tree.moveUnder')" class="flex-1">
          <OptionalSelect v-model="moveTarget" :items="moveItems" :none-label="$t('knowledge.tree.topLevel')" size="sm" class="w-full" @update:model-value="move" />
        </UFormField>
      </div>
    </div>
    <p v-if="error" class="text-sm text-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import type { KnowledgeNode } from '~~/server/utils/knowledgeNodes'

const props = defineProps<{ modelId: string }>()
const emit = defineEmits<{ select: [nodeId: string], changed: [] }>()

const { api } = useAgent()
const { t } = useI18n()
const nodes = ref<KnowledgeNode[]>([])
const loading = ref(true)
const adding = ref(false)
const error = ref('')
const newName = ref('')
const selectedId = ref('')
const editingId = ref('')
const editName = ref('')
const moveTarget = ref('')

const ordered = computed(() => [...nodes.value].sort((a, b) => a.pathCache.localeCompare(b.pathCache)))
const selectedNode = computed(() => nodes.value.find(n => n.id === selectedId.value) || null)
const moveItems = computed(() => nodes.value
  .filter(n => n.id !== selectedId.value && !n.pathCache.startsWith(`${selectedNode.value?.pathCache}/`))
  .map(n => ({ label: n.pathCache, value: n.id })))

async function load() {
  loading.value = true
  try {
    nodes.value = (await api<{ nodes: KnowledgeNode[] }>(`/admin/knowledge/nodes?modelId=${props.modelId}`)).nodes
    moveTarget.value = selectedNode.value?.parentId || ''
  } finally {
    loading.value = false
  }
}

function select(id: string) {
  selectedId.value = selectedId.value === id ? '' : id
  moveTarget.value = selectedNode.value?.parentId || ''
  emit('select', selectedId.value)
}

async function addNode() {
  const name = newName.value.trim()
  if (!name) return
  adding.value = true
  error.value = ''
  try {
    await api('/admin/knowledge/nodes', { method: 'POST', body: { modelId: props.modelId, name, parentId: selectedId.value || undefined } })
    newName.value = ''
    await load()
    emit('changed')
  } catch (e: any) { error.value = e?.message || t('knowledge.tree.couldNotAdd') } finally { adding.value = false }
}

function startRename(n: KnowledgeNode) { editingId.value = n.id; editName.value = n.name }
async function rename(n: KnowledgeNode) {
  const name = editName.value.trim()
  editingId.value = ''
  if (!name || name === n.name) return
  try { await api(`/admin/knowledge/nodes/${n.id}`, { method: 'PATCH', body: { name } }); await load(); emit('changed') }
  catch (e: any) { error.value = e?.message || t('knowledge.tree.couldNotRename') }
}

async function move(target: string) {
  if (!selectedId.value) return
  try { await api(`/admin/knowledge/nodes/${selectedId.value}`, { method: 'PATCH', body: { parentId: target } }); await load(); emit('changed') }
  catch (e: any) { error.value = e?.message || t('knowledge.tree.couldNotMove') }
}

async function remove(n: KnowledgeNode) {
  try {
    const impact = await api<{ deleted: boolean, impact?: { children: number, faqs: number } }>(`/admin/knowledge/nodes/${n.id}`, { method: 'DELETE' })
    if (!impact.deleted) {
      const msg = t('knowledge.tree.deleteConfirm', { name: n.name, subPaths: t('knowledge.units.subPath', impact.impact?.children || 0), faqs: t('knowledge.units.faq', impact.impact?.faqs || 0) })
      if (!confirm(msg)) return
      await api(`/admin/knowledge/nodes/${n.id}?confirm=true`, { method: 'DELETE' })
    }
    if (selectedId.value === n.id) selectedId.value = ''
    await load()
    emit('changed')
  } catch (e: any) { error.value = e?.message || t('knowledge.tree.couldNotDelete') }
}

defineExpose({ reload: load })
onMounted(load)
</script>
