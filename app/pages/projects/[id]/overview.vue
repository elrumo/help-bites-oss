<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.overview')">
      <template #actions>
        <UTooltip :text="$t('projectPages.overview.refresh')"><UButton icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="ghost" square class="text-muted" :aria-label="$t('projectPages.overview.refresh')" :loading="loading" @click="load" /></UTooltip>
      </template>
    </PageHeader>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-4xl space-y-10 px-6 py-8">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />

        <section :aria-label="$t('projectPages.overview.atAGlance')">
          <div v-if="!overview" class="grid grid-cols-2 gap-3 lg:grid-cols-4"><USkeleton v-for="n in 4" :key="n" class="h-[66px] rounded-xl" /></div>
          <div v-else class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <NuxtLink v-for="tile in overview.stats" :key="tile.key" :to="link(tile.section)" class="rounded-xl border border-default bg-default px-4 py-3 transition-colors hover:bg-elevated/60">
              <p class="text-xs text-muted">{{ said(`stats.${tile.key}`, tile.label) }}</p>
              <p class="mt-1 text-2xl font-semibold text-highlighted">{{ compactCount(tile.value) }}</p>
            </NuxtLink>
          </div>
        </section>

        <section v-if="overview" class="space-y-3">
          <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('projectPages.overview.needsAttention') }}</h2>
          <AttentionList v-if="overview.attention.length" :items="overview.attention" />
          <p v-else class="flex items-center gap-2 text-sm text-muted"><UIcon name="i-lucide-circle-check" class="size-4 text-success" />{{ $t('projectPages.overview.allClear') }}</p>
        </section>

        <section v-if="overview" class="space-y-3">
          <div class="flex items-baseline gap-2">
            <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('setup.title') }}</h2>
            <span class="text-xs tabular-nums text-muted">{{ $t('setup.progress', { done: overview.setup.done, total: overview.setup.total }) }}</span>
          </div>
          <SetupChecklist :project-id="id" :setup="overview.setup" />
        </section>

        <section v-if="overview" class="space-y-3">
          <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('projectPages.overview.latestActivity') }}</h2>
          <div v-if="overview.activity.length" class="divide-y divide-default overflow-hidden rounded-xl border border-default">
            <NuxtLink v-for="item in overview.activity" :key="item.id" :to="item.conversationId ? `/inbox?c=${item.conversationId}` : link(item.section)" class="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-elevated/60">
              <UIcon :name="iconOf(item.section)" class="size-4 shrink-0 text-muted" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-highlighted">{{ item.titleKey ? said(`activityTitle.${item.titleKey}`, item.title, item.params) : item.title }}</p>
                <p v-if="item.detail" class="truncate text-xs text-muted">{{ item.detail }}</p>
              </div>
              <span class="shrink-0 text-xs text-dimmed">{{ timeAgo(item.at) }}</span>
            </NuxtLink>
          </div>
          <EmptyState v-else icon="i-lucide-clock" :title="$t('projectPages.overview.nothingYet')" :description="$t('projectPages.overview.activityEmpty')" />
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ProjectOverview } from '~~/server/utils/overview'
import { compactCount } from '~/utils/emailStatus'

definePageMeta({ middleware: 'agent' })
const route = useRoute()
const id = String(route.params.id)
const { api } = useAgent()
const { t, te } = useI18n()

const overview = ref<ProjectOverview | null>(null)
const loading = ref(false)
const error = ref('')

const link = (section: string) => `/projects/${id}/${section}`
const iconOf = (section: string) => projectSections.find(s => s.path === section)?.icon || 'i-lucide-activity'
/** The server's words in this language, by key; its English for a key this panel does not know yet. */
function said(key: string, english: string, params: Record<string, string | number> = {}) {
  const path = `projectPages.overview.${key}`
  if (!te(path)) return english
  return typeof params.count === 'number' ? t(path, params.count, { named: params }) : t(path, params)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    overview.value = await api<ProjectOverview>(`/admin/projects/${id}/overview`)
  } catch (e: any) {
    error.value = e?.message || t('projectPages.overview.loadError')
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
