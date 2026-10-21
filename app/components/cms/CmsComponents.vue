<script setup lang="ts">
/** The component library: the project's own components, then the built-ins (read-only; duplicate one to change it). */
import type { CmsComponentDef } from '#shared/cms/content'

const props = defineProps<{ projectId: string }>()
const { api } = useAgent()
const { t } = useI18n()
const toast = useToast()

const components = ref<CmsComponentDef[]>([])
const loading = ref(true)
const error = ref('')
const own = computed(() => components.value.filter(c => !c.builtin))
const builtins = computed(() => components.value.filter(c => c.builtin))

async function duplicate(def: CmsComponentDef) {
  const taken = new Set(components.value.map(c => c.key))
  let key = `${def.key}_custom`
  for (let n = 2; taken.has(key); n++) key = `${def.key}_custom${n}`
  try {
    const { component } = await api<{ component: CmsComponentDef }>('/admin/cms/components', { method: 'POST', body: { project: props.projectId, ...def, id: undefined, builtin: undefined, example: undefined, key, name: t('projectTools.pages.copyOf', { name: def.name }) } })
    await navigateTo(`/projects/${props.projectId}/pages/components/${component.id}`)
  } catch (e: any) {
    toast.add({ title: t('projectTools.pages.saveError'), description: e?.data?.statusMessage || e?.message, color: 'error' })
  }
}

onMounted(async () => {
  try {
    components.value = (await api<{ components: CmsComponentDef[] }>('/admin/cms/components', { query: { project: props.projectId } })).components
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pages.loadError')
  } finally {
    loading.value = false
  }
})

const kind = (c: CmsComponentDef) => c.root && c.nestable ? t('projectTools.pages.kindBoth') : c.root ? t('projectTools.pages.kindRoot') : t('projectTools.pages.kindBlock')
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
    <div v-if="loading" class="space-y-2"><USkeleton v-for="n in 4" :key="n" class="h-12 w-full" /></div>
    <template v-else>
      <section class="space-y-2">
        <h3 class="text-xs font-semibold text-muted">{{ $t('projectTools.pages.yourComponents') }}</h3>
        <p v-if="!own.length" class="rounded-xl border border-dashed border-default px-4 py-6 text-center text-[13px] text-muted">{{ $t('projectTools.pages.noOwnComponents') }}</p>
        <ul v-else class="divide-y divide-default overflow-hidden rounded-xl border border-default">
          <li v-for="c in own" :key="c.id">
            <NuxtLink :to="`/projects/${projectId}/pages/components/${c.id}`" class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-elevated/60">
              <UIcon name="i-lucide-puzzle" class="size-4 text-dimmed" />
              <div class="min-w-0 flex-1 basis-60">
                <p class="truncate text-[13px] font-medium text-highlighted">{{ c.name }}</p>
                <p class="truncate text-xs text-muted">{{ c.description || $t('projectTools.pages.fieldCount', c.fields.length) }}</p>
              </div>
              <code class="font-mono text-xs text-dimmed">{{ c.key }}</code>
              <UBadge :label="kind(c)" color="neutral" variant="soft" size="sm" />
              <UBadge v-if="!c.html" :label="$t('projectTools.pages.dataOnly')" color="info" variant="soft" size="sm" />
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section class="space-y-2">
        <h3 class="text-xs font-semibold text-muted">{{ $t('projectTools.pages.builtIn') }}</h3>
        <ul class="grid gap-2 sm:grid-cols-2">
          <li v-for="c in builtins" :key="c.key" class="flex items-start gap-3 rounded-xl border border-default px-3.5 py-3">
            <UIcon name="i-lucide-box" class="mt-0.5 size-4 shrink-0 text-dimmed" />
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-medium text-highlighted">{{ c.name }} <code class="ms-1 font-mono text-[11px] font-normal text-dimmed">{{ c.key }}</code></p>
              <p class="line-clamp-2 text-xs text-muted">{{ c.description }}</p>
            </div>
            <UButton icon="i-lucide-copy-plus" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.pages.duplicateToEdit')" @click="duplicate(c)" />
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
