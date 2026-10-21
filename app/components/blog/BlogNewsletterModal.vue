<template>
  <UModal v-model:open="open" :title="$t('blog.newsletterTitle')" :description="$t('blog.newsletterModalDescription')">
    <template #body>
      <form class="space-y-4" @submit.prevent="send('now')">
        <UFormField :label="$t('blog.subject')">
          <UInput v-model="subject" class="w-full" :maxlength="300" :placeholder="post.title" />
        </UFormField>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="$t('blog.topic')" :description="$t('blog.topicHint')">
            <USelect v-model="topic" :items="topicItems" class="w-full" />
          </UFormField>
          <UFormField :label="$t('blog.segment')" :description="$t('blog.segmentHint')">
            <USelect v-model="segment" :items="segmentItems" class="w-full" />
          </UFormField>
        </div>
        <UFormField :label="$t('blog.scheduleFor')" :description="$t('blog.scheduleForHint')">
          <UInput v-model="scheduledAt" type="datetime-local" class="w-full" />
        </UFormField>
        <p v-if="!postalAddress" class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">{{ $t('blog.needsAddress') }} <NuxtLink :to="`/projects/${projectId}/campaigns`" class="underline underline-offset-2">{{ $t('sections.campaigns') }}</NuxtLink>{{ $t('blog.needsAddressEnd') }}</p>
        <p class="text-xs text-muted">{{ $t('blog.newsletterGoesOnce') }}</p>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-2">
        <UButton :label="$t('blog.saveDraftCampaign')" color="neutral" variant="ghost" :loading="busy === 'draft'" @click="send('draft')" />
        <UButton class="ml-auto" :label="$t('common.cancel')" color="neutral" variant="ghost" @click="open = false" />
        <UButton v-if="scheduledAt" :label="$t('blog.schedule')" icon="i-lucide-calendar-clock" :loading="busy === 'schedule'" @click="send('schedule')" />
        <UButton v-else :label="$t('blog.sendNow')" icon="i-lucide-send" :loading="busy === 'now'" @click="send('now')" />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { BlogPost } from '#shared/blog'
import type { Campaign, MarketingTopic } from '#shared/marketing'
import { fromLocalInput } from '~/utils/blogDraft'

// Email a published post to the project's subscribers. It becomes a campaign
// (test sends, pause, numbers under Campaigns); "Save as a draft" stops there
// so the operator can send a test first.

const props = defineProps<{ post: BlogPost, projectId: string, topics: MarketingTopic[], defaultTopic: string, postalAddress: string }>()
const emit = defineEmits<{ sent: [post: BlogPost, campaign: Campaign] }>()
const open = defineModel<boolean>('open', { default: false })

const { api } = useAgent()
const { t } = useI18n()
const toast = useToast()
const NONE = '__none__'
const subject = ref('')
const topic = ref(NONE)
const segment = ref(NONE)
const scheduledAt = ref('')
const segments = ref<{ id: string, name: string }[]>([])
const busy = ref<'' | 'now' | 'schedule' | 'draft'>('')
const error = ref('')

const topicItems = computed(() => [{ label: t('blog.everySubscriber'), value: NONE }, ...props.topics.map(item => ({ label: item.name || item.key, value: item.key }))])
const segmentItems = computed(() => [{ label: t('blog.noSegment'), value: NONE }, ...segments.value.map(item => ({ label: item.name, value: item.id }))])

watch(open, async (isOpen) => {
  if (!isOpen) return
  subject.value = props.post.title
  topic.value = props.defaultTopic || NONE
  segment.value = NONE
  scheduledAt.value = ''
  error.value = ''
  segments.value = await api<{ segments: { id: string, name: string }[] }>('/segments', { query: { project: props.projectId } }).then(r => r.segments).catch(() => [])
})

async function send(mode: 'now' | 'schedule' | 'draft') {
  busy.value = mode
  error.value = ''
  try {
    const result = await api<{ campaign: Campaign, post: BlogPost }>(`/admin/blog/posts/${props.post.id}/newsletter`, {
      method: 'POST',
      body: {
        subject: subject.value.trim() || props.post.title,
        audience: { topic: topic.value === NONE ? '' : topic.value, segment: segment.value === NONE ? '' : segment.value },
        send: mode,
        ...(mode === 'schedule' ? { scheduledAt: fromLocalInput(scheduledAt.value) } : {})
      }
    })
    emit('sent', result.post, result.campaign)
    toast.add({ title: mode === 'draft' ? t('blog.campaignDrafted') : mode === 'schedule' ? t('blog.newsletterScheduled') : t('blog.newsletterSending'), icon: 'i-lucide-mail-check', color: 'success' })
    open.value = false
  } catch (e: any) {
    error.value = e?.message || t('blog.newsletterError')
  } finally {
    busy.value = ''
  }
}
</script>
