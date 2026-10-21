<script setup lang="ts">
/**
 * Things that wait on someone: changelog drafts to approve, syncs that failed,
 * mail that bounced, alerts that fired, and a project's own backlog. The same
 * rows on the workspace overview and on each project's overview (see
 * shared/attention.ts); a row opens the page that deals with it.
 */
import type { AttentionItem, AttentionKind } from '#shared/attention'

const props = defineProps<{ items: AttentionItem[], /** Name the project on each row: the workspace list spans all of them. */ withProject?: boolean }>()
const { projects } = useAgent()

const icons: Record<AttentionKind, string> = {
  unread: 'i-lucide-inbox',
  drafts: 'i-lucide-file-pen-line',
  sync: 'i-lucide-refresh-cw-off',
  bounces: 'i-lucide-mail-warning',
  alerts: 'i-lucide-siren',
  paused: 'i-lucide-pause-circle',
  errors: 'i-lucide-bug',
  documents: 'i-lucide-file-warning',
  triage: 'i-lucide-lightbulb'
}

const projectOf = (id: string) => projects.value.find(p => p.id === id)
// A project's section, or, for what belongs to the workspace (a paused sender), the email log across projects.
function link(item: AttentionItem) {
  return item.projectId ? `/projects/${item.projectId}/${item.section}` : '/emails?view=log'
}
const rows = computed(() => props.items.map(item => ({ ...item, to: link(item), project: projectOf(item.projectId) })))
</script>

<template>
  <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default">
    <li v-for="item in rows" :key="item.key">
      <NuxtLink :to="item.to" class="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-elevated/60">
        <UIcon :name="icons[item.kind]" class="size-4 shrink-0 text-warning" />
        <ProjectDot v-if="withProject && item.project" :project-id="item.project.id" :accent="item.project.theme?.accent" :name="item.project.name" :icon-url="item.project.iconUrl" class="shrink-0" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-highlighted">
            <span v-if="withProject && item.project" class="mr-1.5 font-medium text-toned">{{ item.project.name }}</span>{{ $t(`attention.${item.kind}`, { count: item.count, value: item.value }, item.count) }}
          </span>
          <span v-if="item.detail" class="block truncate text-xs text-muted">{{ item.detail }}</span>
        </span>
        <span v-if="item.count > 1" class="shrink-0 tabular-nums text-muted">{{ item.count }}</span>
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
      </NuxtLink>
    </li>
  </ul>
</template>
