<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" title="Flags">
      <template #actions>
        <UButton icon="i-lucide-plus" label="Add flag" size="sm" @click="openEditor(-1)" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h2 class="text-[15px] font-semibold text-highlighted">Feature flags</h2>
          <p class="mt-1 text-[13px] text-muted">Switch features of your app on, off, or on for admins only. Your app reads them from <code class="font-mono text-xs">GET /v1/flags</code>; the Dev section shows how.</p>
        </div>

        <EmptyState v-if="!flags.length" icon="i-lucide-toggle-right" title="No flags yet" description="Add a flag, name it after the feature it gates, and your app can read it on its next poll." class="rounded-xl border border-dashed border-default">
          <UButton icon="i-lucide-plus" label="Add flag" @click="openEditor(-1)" />
        </EmptyState>

        <ul v-else class="divide-y divide-default overflow-hidden rounded-xl border border-default">
          <li v-for="(flag, i) in flags" :key="flag.key" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div class="min-w-0 flex-1 basis-60">
              <p class="truncate font-mono text-[13px] font-medium text-highlighted">{{ flag.key }}</p>
              <p v-if="flag.description" class="truncate text-[13px] text-muted">{{ flag.description }}</p>
              <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-dimmed">
                <UBadge v-for="t in flag.targets" :key="t" :label="t" color="neutral" variant="soft" size="sm" />
                <span v-if="flag.fallback !== 'off'">Fallback: {{ labelOf(flag.fallback) }}</span>
                <span v-if="flag.allow.length && (flag.state === 'admins' || flag.fallback === 'admins')">+{{ flag.allow.length }} allowed</span>
              </div>
            </div>

            <div class="ml-auto flex items-center gap-2">
              <div class="inline-flex shrink-0 rounded-lg bg-elevated p-0.5" role="radiogroup" :aria-label="`${flag.key} state`">
                <button
                  v-for="option in stateItems"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :aria-checked="flag.state === option.value"
                  :disabled="saving"
                  class="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-wait"
                  :class="flag.state === option.value ? 'bg-default text-highlighted shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-default'"
                  @click="setState(i, option.value)"
                >
                  <span class="size-1.5 rounded-full" :class="option.dot" aria-hidden="true" />{{ option.label }}
                </button>
              </div>
              <UButton icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="`Edit ${flag.key}`" @click="openEditor(i)" />
            </div>
          </li>
        </ul>
        <p v-if="error && !editorOpen" class="text-[13px] text-error">{{ error }}</p>
      </div>
    </div>

    <UModal v-model:open="editorOpen" :title="editing < 0 ? 'New flag' : 'Edit flag'">
      <template #body>
        <form class="space-y-4" @submit.prevent="saveEditor">
          <UFormField label="Key" :hint="editing < 0 ? 'Can’t be changed later' : undefined">
            <UInput v-model="form.key" placeholder="flag_key" class="w-full font-mono" :disabled="editing >= 0" required autofocus />
          </UFormField>
          <UFormField label="Description">
            <UInput v-model="form.description" placeholder="What it gates" class="w-full" />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="State">
              <USelect v-model="form.state" :items="stateItems" class="w-full" />
            </UFormField>
            <UFormField label="If unreachable" hint="HelpBites down">
              <USelect v-model="form.fallback" :items="stateItems" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Targets">
            <UInputTags v-model="form.targets" placeholder="frontend, backend…" class="w-full" />
          </UFormField>
          <UFormField v-if="form.state === 'admins' || form.fallback === 'admins'" label="Also on for" hint="User ids or emails treated as admins">
            <UInputTags v-model="form.allow" placeholder="user id or email" class="w-full" />
          </UFormField>

          <p v-if="error" class="text-sm text-error">{{ error }}</p>
          <div class="flex items-center gap-2 pt-2">
            <UButton v-if="editing >= 0" icon="i-lucide-trash-2" label="Delete" color="error" variant="ghost" :disabled="saving" @click="remove" />
            <UButton class="ml-auto" color="neutral" variant="ghost" label="Cancel" @click="editorOpen = false" />
            <UButton type="submit" :label="editing < 0 ? 'Create' : 'Save'" :loading="saving" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { FeatureFlag, FlagState } from '#shared/flags'
import type { AdminProject } from '~~/server/utils/projects'

definePageMeta({ middleware: 'agent' })

const { api, projects, loadProjects } = useAgent()
const id = String(useRoute().params.id)
const project = computed(() => projects.value.find(p => p.id === id) || null)
const flags = computed(() => project.value?.flags || [])

const stateItems: { label: string, value: FlagState, dot: string }[] = [
  { label: 'Off', value: 'off', dot: 'bg-error' },
  { label: 'Admins only', value: 'admins', dot: 'bg-warning' },
  { label: 'On', value: 'on', dot: 'bg-success' }
]
const labelOf = (state: FlagState) => stateItems.find(s => s.value === state)?.label

const saving = ref(false)
const error = ref('')

// The API takes the whole list, so every edit saves all flags.
async function persist(next: FeatureFlag[]) {
  saving.value = true
  error.value = ''
  try {
    const result = await api<{ project: AdminProject }>(`/admin/projects/${id}`, { method: 'PATCH', body: { flags: next } })
    projects.value = projects.value.map(p => (p.id === id ? result.project : p))
    return true
  } catch (e: any) {
    error.value = e?.message || 'Could not save flags'
    return false
  } finally {
    saving.value = false
  }
}

function setState(index: number, state: FlagState) {
  if (flags.value[index]?.state === state) return
  void persist(flags.value.map((f, i) => (i === index ? { ...f, state } : f)))
}

const editorOpen = ref(false)
const editing = ref(-1)
const form = ref<FeatureFlag>({ key: '', description: '', state: 'off', fallback: 'off', targets: [], allow: [] })

function openEditor(index: number) {
  const flag = flags.value[index]
  editing.value = flag ? index : -1
  form.value = flag
    ? { ...flag, targets: [...flag.targets], allow: [...flag.allow] }
    : { key: '', description: '', state: 'off', fallback: 'off', targets: [], allow: [] }
  error.value = ''
  editorOpen.value = true
}

async function saveEditor() {
  const flag = { ...form.value, key: form.value.key.trim() }
  const next = editing.value < 0 ? [...flags.value, flag] : flags.value.map((f, i) => (i === editing.value ? flag : f))
  if (await persist(next)) editorOpen.value = false
}

async function remove() {
  const flag = flags.value[editing.value]
  if (!flag || !confirm(`Delete “${flag.key}”? Apps reading it will treat it as off.`)) return
  if (await persist(flags.value.filter((_, i) => i !== editing.value))) editorOpen.value = false
}

onMounted(() => {
  if (!project.value) void loadProjects().catch(e => { error.value = e?.message || 'Could not load the project' })
})
</script>
