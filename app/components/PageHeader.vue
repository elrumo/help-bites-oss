<template>
  <!-- Linear's page bar: a breadcrumb on the left, the page's actions on the right. -->
  <header class="flex h-12 shrink-0 items-center gap-2 border-b border-default px-4">
    <nav class="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium" :aria-label="$t('shared.breadcrumb')">
      <template v-if="projectId">
        <NuxtLink :to="`/projects/${projectId}/overview`" class="flex min-w-0 shrink items-center gap-2 rounded-md text-muted transition-colors hover:text-highlighted">
          <ProjectDot tile :project-id="projectId" :accent="project?.theme?.accent" :name="project?.name" :icon-url="project?.iconUrl" />
          <span class="truncate">{{ project?.name || '…' }}</span>
        </NuxtLink>
        <UIcon name="i-lucide-chevron-right" class="size-3.5 shrink-0 text-dimmed" />
      </template>
      <template v-for="crumb in crumbs" :key="crumb.to">
        <NuxtLink :to="crumb.to" class="shrink truncate text-muted transition-colors hover:text-highlighted">{{ crumb.label }}</NuxtLink>
        <UIcon name="i-lucide-chevron-right" class="size-3.5 shrink-0 text-dimmed" />
      </template>
      <h1 class="truncate text-highlighted">{{ title }}</h1>
      <slot name="title" />
    </nav>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-1.5">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
const props = defineProps<{ title: string, projectId?: string, crumbs?: { label: string, to: string }[] }>()

const { projects, loadProjects } = useAgent()
const project = computed(() => projects.value.find(p => p.id === props.projectId) || null)
onMounted(() => { if (props.projectId && !project.value) loadProjects().catch(() => {}) })
</script>
