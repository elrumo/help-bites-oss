<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" title="Overview">
      <template #actions>
        <UTooltip text="Refresh"><UButton icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="ghost" square class="text-muted" aria-label="Refresh" :loading="loading" @click="load" /></UTooltip>
      </template>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-4xl space-y-10 px-6 py-8">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />

        <section aria-label="At a glance">
          <div v-if="!overview" class="grid grid-cols-2 gap-3 lg:grid-cols-4"><USkeleton v-for="n in 4" :key="n" class="h-[66px] rounded-xl" /></div>
          <div v-else class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <NuxtLink v-for="tile in overview.stats" :key="tile.key" :to="link(tile.section)" class="rounded-xl border border-default bg-default px-4 py-3 transition-colors hover:bg-elevated/60">
              <p class="text-xs text-muted">{{ tile.label }}</p>
              <p class="mt-1 text-2xl font-semibold text-highlighted">{{ compactCount(tile.value) }}</p>
            </NuxtLink>
          </div>
        </section>

        <section v-if="overview" class="space-y-3">
          <h2 class="text-[15px] font-semibold text-highlighted">Needs attention</h2>
          <div v-if="overview.attention.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
            <NuxtLink v-for="item in overview.attention" :key="item.key" :to="link(item.section)" class="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-elevated/60">
              <UIcon name="i-lucide-circle-alert" class="size-4 shrink-0 text-warning" />
              <span class="min-w-0 flex-1 truncate text-highlighted">{{ item.label }}</span>
              <span class="tabular-nums text-muted">{{ item.count }}</span>
              <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
            </NuxtLink>
          </div>
          <p v-else class="flex items-center gap-2 text-sm text-muted"><UIcon name="i-lucide-circle-check" class="size-4 text-success" />All clear. Nothing needs you right now.</p>
        </section>

        <section v-if="overview" class="space-y-3">
          <h2 class="text-[15px] font-semibold text-highlighted">Status</h2>
          <div class="divide-y divide-default overflow-hidden rounded-xl border border-default">
            <NuxtLink v-for="row in overview.health" :key="row.key" :to="link(row.section)" class="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-elevated/60">
              <span class="size-2 shrink-0 rounded-full" :class="dots[row.state]" />
              <span class="shrink-0 text-highlighted">{{ row.label }}</span>
              <span class="ml-auto min-w-0 truncate text-muted">{{ row.detail }}</span>
              <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
            </NuxtLink>
          </div>
        </section>

        <section v-if="overview" class="space-y-3">
          <h2 class="text-[15px] font-semibold text-highlighted">Latest activity</h2>
          <div v-if="overview.activity.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
            <NuxtLink v-for="item in overview.activity" :key="item.id" :to="item.conversationId ? `/inbox?c=${item.conversationId}` : link(item.section)" class="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-elevated/60">
              <UIcon :name="iconOf(item.section)" class="size-4 shrink-0 text-muted" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-highlighted">{{ item.title }}</p>
                <p v-if="item.detail" class="truncate text-xs text-muted">{{ item.detail }}</p>
              </div>
              <span class="shrink-0 text-xs text-dimmed">{{ timeAgo(item.at) }}</span>
            </NuxtLink>
          </div>
          <EmptyState v-else icon="i-lucide-clock" title="Nothing yet" description="Conversations, feedback and finished board items will show up here." />
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { OverviewTone, ProjectOverview } from '~~/server/utils/overview'
import { compactCount } from '~/utils/emailStatus'

definePageMeta({ middleware: 'agent' })
const route = useRoute()
const id = String(route.params.id)
const { api } = useAgent()

const overview = ref<ProjectOverview | null>(null)
const loading = ref(false)
const error = ref('')

const dots: Record<OverviewTone, string> = { ok: 'bg-success', warn: 'bg-warning', off: 'bg-(--ui-text-dimmed)' }
const link = (section: string) => `/projects/${id}/${section}`
const iconOf = (section: string) => projectSections.find(s => s.path === section)?.icon || 'i-lucide-activity'

async function load() {
  loading.value = true
  error.value = ''
  try {
    overview.value = await api<ProjectOverview>(`/admin/projects/${id}/overview`)
  } catch (e: any) {
    error.value = e?.message || 'Could not load the overview'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
