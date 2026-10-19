<script setup lang="ts">
/** A project's broadcasts, newest first, with how each did. */
import type { Campaign } from '#shared/marketing'
import type { AdminProject } from '~~/server/utils/projects'
import CampaignsTabs from '~/components/campaigns/CampaignsTabs.vue'
import { CAMPAIGN_STATUS, percent } from '~/utils/campaignStatus'
import { logTime } from '~/utils/emailStatus'

const props = defineProps<{ project: AdminProject }>()

const { api } = useAgent()
const toast = useToast()
const { t } = useI18n()

const campaigns = ref<Campaign[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    campaigns.value = (await api<{ campaigns: Campaign[] }>('/campaigns', { query: { project: props.project.id } })).campaigns
  } catch (e: any) {
    toast.add({ title: e?.message || t('campaigns.loadError'), color: 'error' })
  } finally {
    loading.value = false
  }
})

const creating = ref(false)
async function create() {
  creating.value = true
  try {
    const { campaign } = await api<{ campaign: Campaign }>('/campaigns', { method: 'POST', body: { project: props.project.id, name: 'Untitled campaign' } })
    await navigateTo(`/projects/${props.project.id}/campaigns/${campaign.id}`)
  } catch (e: any) {
    toast.add({ title: e?.message || t('campaigns.createError'), color: 'error' })
  } finally {
    creating.value = false
  }
}

const campaignStatusLabel = (status: string) => t(`campaigns.status.${status}`)
const when = (c: Campaign) => logTime(c.finishedAt || c.startedAt || c.scheduledAt || c.updatedAt || '')
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project.id" :title="$t('campaigns.title')">
      <template #title><CampaignsTabs current="campaigns" /></template>
      <template #actions>
        <UButton icon="i-lucide-plus" :label="$t('campaigns.new')" size="sm" :loading="creating" @click="create" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 5" :key="i" class="h-11" /></div>
      <EmptyState v-else-if="!campaigns.length" icon="i-lucide-megaphone" :title="$t('campaigns.emptyTitle')" :description="$t('campaigns.emptyDescription')" />
      <ul v-else class="py-2" :aria-label="$t('campaigns.listLabel')">
        <li v-for="c in campaigns" :key="c.id">
          <NuxtLink :to="`/projects/${project.id}/campaigns/${c.id}`" class="mx-2 flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors hover:bg-elevated">
            <UBadge :icon="CAMPAIGN_STATUS[c.status].icon" :label="campaignStatusLabel(c.status)" :color="CAMPAIGN_STATUS[c.status].color" variant="subtle" size="sm" class="w-28 shrink-0 justify-start" />
            <span class="min-w-0 flex-1 truncate font-medium text-highlighted">{{ c.name }}</span>
            <span class="hidden w-40 truncate text-xs text-muted md:block">{{ c.templateName || $t('campaigns.noTemplate') }}</span>
            <span class="hidden w-24 text-right text-xs tabular-nums text-muted lg:block" :title="$t('campaigns.sent')">{{ c.stats.sent ? c.stats.sent.toLocaleString() : '' }}</span>
            <span class="hidden w-16 text-right text-xs tabular-nums text-muted lg:block" :title="$t('campaigns.opened')">{{ c.stats.sent ? percent(c.stats.opened, c.stats.delivered || c.stats.sent) : '' }}</span>
            <span class="w-14 text-right text-xs text-muted">{{ when(c) }}</span>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
