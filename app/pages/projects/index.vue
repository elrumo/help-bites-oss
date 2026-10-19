<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader title="Projects">
      <template #actions>
        <UButton icon="i-lucide-plus" label="New project" color="neutral" variant="outline" size="sm" @click="newProjectOpen = true" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading && !projects.length" class="space-y-1 p-4"><USkeleton v-for="i in 4" :key="i" class="h-9" /></div>
      <EmptyState v-else-if="!projects.length" icon="i-lucide-boxes" title="No projects yet" description="Each app you connect is a project, with its own keys, look and notification addresses.">
        <UButton icon="i-lucide-plus" label="New project" @click="newProjectOpen = true" />
      </EmptyState>
      <template v-else>
        <div class="grid h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-default px-6 text-xs font-medium text-muted md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_14rem]">
          <span>Name</span><span class="hidden md:block">Site</span><span>Public key</span>
        </div>
        <NuxtLink
          v-for="p in projects"
          :key="p.id"
          :to="`/projects/${p.id}/overview`"
          class="grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-muted px-6 text-[13px] transition-colors hover:bg-elevated md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_14rem]"
        >
          <span class="flex min-w-0 items-center gap-2.5 font-medium text-highlighted"><ProjectDot tile :project-id="p.id" :accent="p.theme?.accent" :name="p.name" :icon-url="p.iconUrl" /><span class="truncate">{{ p.name }}</span></span>
          <span class="hidden truncate text-muted md:block">{{ hostOf(p.siteUrl) || 'No site URL' }}</span>
          <code class="truncate font-mono text-xs text-muted">{{ p.publicKey }}</code>
        </NuxtLink>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'agent' })

const { projects, loadProjects } = useAgent()
const newProjectOpen = useState('new-project-open', () => false)
const loading = ref(true)

function hostOf(url: string) {
  try { return url ? new URL(url).host : '' } catch { return url }
}

onMounted(async () => {
  await loadProjects().catch(() => {})
  loading.value = false
})
</script>
