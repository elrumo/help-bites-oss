<template>
  <article
    class="hb-card group relative flex gap-3 rounded-xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 p-3 sm:p-3.5 transition-[border-color,box-shadow,transform] duration-150 hover:border-stone-300 dark:hover:border-stone-700 hover:shadow-sm cursor-pointer"
    @click="emit('open')"
  >
    <FeedbackVote :count="post.voteCount" :voted="post.hasVoted" :closed="closed" :readonly="readonlyVotes" @vote="emit('vote')" />

    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2">
        <h3 class="min-w-0 flex-1 text-[15px] font-semibold leading-snug line-clamp-2">
          <button type="button" class="text-left rounded" @click.stop="emit('open')"><span v-if="post.number" class="font-normal text-stone-400 tabular-nums">#{{ post.number }} </span>{{ post.title }}</button>
        </h3>
        <UIcon v-if="post.locked" name="i-lucide-lock" class="size-4 shrink-0 text-stone-400 mt-0.5" :title="$t('feedback.locked')" />
        <UIcon v-if="post.hidden" name="i-lucide-eye-off" class="size-4 shrink-0 text-stone-400 mt-0.5" :title="$t('feedback.hiddenFromBoard')" />
      </div>
      <p v-if="excerpt" class="mt-0.5 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400 line-clamp-2">{{ excerpt }}</p>

      <div class="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-stone-500 dark:text-stone-400">
        <FeedbackStatusBadge :status="status" />
        <span v-if="type" class="inline-flex items-center gap-1">
          <FeedbackIcon :icon="type.icon" fallback="i-lucide-tag" class="size-3.5" />{{ type.label }}
        </span>
        <span v-if="platform" class="inline-flex items-center gap-1"><UIcon name="i-lucide-monitor-smartphone" class="size-3.5" />{{ platform }}</span>
        <span v-for="tag in tags" :key="tag" class="rounded-full bg-stone-100 dark:bg-stone-800 px-1.5 py-px text-[11px]">{{ tag }}</span>
        <span class="inline-flex items-center gap-1" :title="$t('feedback.commentCount', post.commentCount)"><UIcon name="i-lucide-message-circle" class="size-3.5" />{{ post.commentCount }}</span>
        <span class="ml-auto whitespace-nowrap" :title="shortDate(post.createdAt)">
          <span v-if="post.isMine" class="font-medium text-stone-600 dark:text-stone-300">{{ $t('feedback.you') }} · </span>
          <span v-else-if="post.author?.isTeam" class="font-medium text-primary-700 dark:text-primary-300">{{ $t('feedback.team') }} · </span>
          <span v-else-if="post.author?.name" class="font-medium text-stone-600 dark:text-stone-300">{{ post.author.name }} · </span>
          {{ timeAgo(post.createdAt) }}
        </span>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { feedbackPlainText, votingOpen, type FeedbackBoardConfig, type FeedbackPost } from '#shared/feedback'

const props = defineProps<{ post: FeedbackPost, config: FeedbackBoardConfig, readonlyVotes?: boolean }>()
const emit = defineEmits<{ (e: 'open' | 'vote'): void }>()

const status = computed(() => feedbackStatusFor(props.config, props.post.status))
const type = computed(() => feedbackTypeFor(props.config, props.post.type))
const platform = computed(() => feedbackPlatformLabel(props.config, props.post.platform))
const tags = computed(() => (props.post.tags || []).map(key => props.config.tags?.find(t => t.key === key)?.label || key))
const closed = computed(() => !votingOpen(props.post.statusCategory) || (props.post.locked && !props.post.canVote))
const excerpt = computed(() => feedbackPlainText(props.post.body, 220))
</script>
