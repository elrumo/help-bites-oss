<template>
  <div class="space-y-5 text-[13px]">
    <UFormField :label="$t('blog.status')">
      <USelect v-model="draft.status" :items="statusItems" class="w-full" />
    </UFormField>
    <UFormField :label="draft.status === 'published' ? $t('blog.publishedOn') : $t('blog.publishOn')" :description="$t('blog.publishOnHint')">
      <UInput v-model="draft.publishedAt" type="datetime-local" class="w-full" />
    </UFormField>
    <p v-if="scheduled" class="-mt-3 flex items-center gap-1.5 text-xs text-info"><UIcon name="i-lucide-clock" class="size-3.5" />{{ $t('blog.scheduledFor', { when: scheduledLabel }) }}</p>

    <UFormField :label="$t('blog.slug')" :hint="$t('blog.slugHint')">
      <UInput v-model="draft.slug" class="w-full font-mono" :placeholder="blogSlugify(draft.title) || 'my-post'" :maxlength="80" @blur="draft.slug = draft.slug ? blogSlugify(draft.slug) : ''" />
    </UFormField>

    <template v-if="!isPage">
      <USwitch v-model="draft.featured" :label="$t('blog.featured')" :description="$t('blog.featuredHint')" />
      <UFormField :label="$t('blog.visibility')" :description="draft.visibility === 'members' ? $t('blog.visibilityMembersHint') : $t('blog.visibilityPublicHint')">
        <USelect v-model="draft.visibility" :items="visibilityItems" class="w-full" />
      </UFormField>
    </template>

    <UFormField :label="$t('blog.excerpt')" :description="$t('blog.excerptHint')">
      <UTextarea v-model="draft.excerpt" :rows="3" autoresize :maxrows="8" class="w-full" :maxlength="300" :placeholder="post && !post.excerptWritten ? post.excerpt : $t('blog.excerptPlaceholder')" />
    </UFormField>

    <UFormField :label="$t('blog.cover')">
      <div class="space-y-2">
        <div v-if="draft.coverImageUrl" class="group relative overflow-hidden rounded-lg border border-default">
          <img :src="draft.coverImageUrl" alt="" class="aspect-[2/1] w-full object-cover">
          <UButton icon="i-lucide-x" size="xs" color="neutral" variant="solid" square class="absolute right-1.5 top-1.5" :aria-label="$t('blog.removeCover')" @click="draft.coverImageUrl = ''" />
        </div>
        <div class="flex gap-2">
          <UInput v-model="draft.coverImageUrl" class="min-w-0 flex-1" placeholder="https://…" />
          <UButton icon="i-lucide-upload" color="neutral" variant="soft" :loading="uploading" :aria-label="$t('blog.uploadCover')" @click="coverInput?.click()" />
        </div>
        <input ref="coverInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" @change="uploadCover">
        <UInput v-if="draft.coverImageUrl" v-model="draft.coverImageAlt" class="w-full" :maxlength="300" :placeholder="$t('blog.coverAlt')" :aria-label="$t('blog.coverAlt')" />
        <p v-if="uploadError" class="text-xs text-error">{{ uploadError }}</p>
      </div>
    </UFormField>

    <template v-if="!isPage">
      <UFormField :label="$t('blog.tags')" :description="$t('blog.tagsHint')">
        <UInputTags v-model="draft.tags" :max="10" class="w-full" :placeholder="$t('blog.addTag')" />
      </UFormField>

      <UFormField :label="$t('blog.author')">
        <UInput v-model="draft.authorName" class="w-full" :maxlength="120" />
      </UFormField>

      <USwitch v-model="draft.commentsOpen" :label="$t('blog.commentsOpen')" :description="commentsAllowed ? $t('blog.commentsOpenDescription') : $t('blog.commentsOffForBlog')" :disabled="!commentsAllowed" />
    </template>

    <UCollapsible v-model:open="seoOpen" class="rounded-lg border border-default">
      <button type="button" class="flex w-full items-center gap-1.5 px-3 py-2.5 text-left font-medium text-highlighted">
        <UIcon name="i-lucide-search" class="size-4" />
        <span class="flex-1">{{ $t('blog.seo.title') }}</span>
        <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform" :class="seoOpen ? 'rotate-180' : ''" />
      </button>
      <template #content>
        <div class="space-y-4 border-t border-default p-3">
          <div class="rounded-md bg-elevated p-3">
            <p class="truncate text-xs text-muted">{{ previewUrl }}</p>
            <p class="truncate text-[15px] font-medium text-info">{{ draft.metaTitle || draft.title || $t('blog.untitled') }}</p>
            <p class="line-clamp-2 text-xs text-muted">{{ draft.metaDescription || draft.excerpt || post?.excerpt || $t('blog.seo.noDescription') }}</p>
          </div>
          <UFormField :label="$t('blog.seo.metaTitle')" :hint="`${draft.metaTitle.length}/60`">
            <UInput v-model="draft.metaTitle" class="w-full" :maxlength="300" :placeholder="draft.title" />
          </UFormField>
          <UFormField :label="$t('blog.seo.metaDescription')" :hint="`${draft.metaDescription.length}/145`">
            <UTextarea v-model="draft.metaDescription" :rows="2" autoresize :maxrows="5" class="w-full" :maxlength="500" :placeholder="draft.excerpt || post?.excerpt || ''" />
          </UFormField>
          <UFormField :label="$t('blog.seo.ogImage')" :description="$t('blog.seo.ogImageHint')">
            <UInput v-model="draft.ogImageUrl" class="w-full" placeholder="https://…" />
          </UFormField>
          <UFormField :label="$t('blog.seo.canonical')" :description="$t('blog.seo.canonicalHint')">
            <UInput v-model="draft.canonicalUrl" class="w-full" placeholder="https://…" />
          </UFormField>
        </div>
      </template>
    </UCollapsible>

    <div v-if="post && !isPage" class="space-y-1.5 rounded-lg border border-default p-3 text-xs text-muted">
      <p class="flex items-center gap-1.5"><UIcon name="i-lucide-clock-3" class="size-3.5" />{{ $t('blog.minRead', post.readingMinutes) }}</p>
      <p class="flex items-center gap-1.5">
        <UIcon name="i-lucide-message-circle" class="size-3.5" />
        <NuxtLink :to="`/projects/${projectId}/blog?tab=comments`" class="hover:underline">{{ $t('blog.commentCount', post.commentCount) }}</NuxtLink>
      </p>
      <p v-if="post.reactions.length" class="flex flex-wrap items-center gap-2"><span v-for="r in post.reactions" :key="r.key">{{ BLOG_REACTION_EMOJI[r.key] }} {{ r.count }}</span></p>
    </div>

    <div v-if="post && !isPage" class="space-y-2 rounded-lg border border-default p-3">
      <p class="flex items-center gap-1.5 font-medium text-highlighted"><UIcon name="i-lucide-mail" class="size-4" />{{ $t('blog.newsletter') }}</p>
      <template v-if="post.newsletter && post.newsletter.status !== 'canceled'">
        <p class="text-xs text-muted">{{ $t('blog.newsletterState', { state: $t(`blog.campaign.${campaignStatus}`) }) }}</p>
        <UButton :label="$t('blog.openCampaign')" icon="i-lucide-arrow-up-right" size="xs" color="neutral" variant="soft" :to="`/projects/${projectId}/campaigns/${post.newsletter.campaignId}`" />
        <UButton v-if="post.newsletter.status === 'draft' && !locked('campaigns')" :label="$t('blog.sendNewsletter')" icon="i-lucide-send" size="xs" color="primary" variant="soft" :disabled="post.status !== 'published'" @click="emit('newsletter')" />
      </template>
      <template v-else>
        <p class="text-xs text-muted">{{ post.live ? $t('blog.newsletterReady') : post.status === 'published' ? $t('blog.newsletterWithPost') : $t('blog.newsletterPublishFirst') }}</p>
        <PlanLock v-if="locked('campaigns')" feature="campaigns" inline />
        <template v-else>
          <UButton :label="$t('blog.sendNewsletter')" icon="i-lucide-send" size="xs" color="primary" variant="soft" :disabled="post.status !== 'published' || !canMarket" @click="emit('newsletter')" />
          <p v-if="!canMarket" class="text-xs text-muted">{{ $t('blog.newsletterAdmins') }}</p>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BLOG_REACTION_EMOJI, blogSlugify, type BlogPost } from '#shared/blog'
import type { BlogPostDraft } from '~/utils/blogDraft'

// The post's settings beside the editor (and in a sheet on narrow screens):
// status and schedule, address, featured and who reads it, lead-in, cover,
// tags, author, comments, what search engines see, and the newsletter it can
// go out as. A page has no tags, author, comments or newsletter.

const props = defineProps<{ post: BlogPost | null, projectId: string, commentsAllowed: boolean, canMarket: boolean, blogUrl: string }>()
const emit = defineEmits<{ newsletter: [] }>()
const draft = defineModel<BlogPostDraft>('draft', { required: true })

const { api } = useAgent()
const { t, locale } = useI18n()
const { locked } = usePlanLocks()
const seoOpen = ref(false)
const isPage = computed(() => draft.value.type === 'page')
const visibilityItems = computed(() => [{ label: t('blog.visibilityPublic'), value: 'public' }, { label: t('blog.visibilityMembers'), value: 'members' }])
const previewUrl = computed(() => `${props.blogUrl.replace(/^https?:\/\//, '')}/${draft.value.slug || blogSlugify(draft.value.title) || ''}`)
const coverInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref('')

const statusItems = computed(() => [{ label: t('blog.draft'), value: 'draft' }, { label: t('blog.published'), value: 'published' }])
const scheduled = computed(() => draft.value.status === 'published' && !!draft.value.publishedAt && new Date(draft.value.publishedAt).getTime() > Date.now())
const scheduledLabel = computed(() => (draft.value.publishedAt ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(draft.value.publishedAt)) : ''))
const campaignStatus = computed(() => {
  const status = props.post?.newsletter?.status || 'draft'
  return ['draft', 'scheduled', 'sending', 'paused', 'sent', 'canceled'].includes(status) ? status : 'draft'
})

async function uploadCover(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  uploadError.value = ''
  try {
    const form = new FormData()
    form.append('project', props.projectId)
    form.append('file', file)
    draft.value.coverImageUrl = (await api<{ url: string }>('/admin/blog/images', { method: 'POST', body: form })).url
  } catch (e: any) {
    uploadError.value = e?.message || t('blog.uploadError')
  } finally {
    uploading.value = false
  }
}
</script>
