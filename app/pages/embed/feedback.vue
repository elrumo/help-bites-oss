<template>
  <div
    ref="rootRef"
    class="sb-board bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100"
    :style="rootStyle"
    :class="inline ? 'min-h-[420px]' : 'h-full flex flex-col'"
  >
    <!-- Header: who this board belongs to, the views, and the way to post. -->
    <header
      v-if="headerVisible"
      class="shrink-0 border-b border-stone-200/80 dark:border-stone-800/80"
      :class="inline ? '' : 'bg-white/80 dark:bg-stone-900/80 backdrop-blur-xl'"
    >
      <div class="mx-auto px-4 pt-4" :class="contentWidth">
        <div class="flex items-start gap-3">
          <template v-if="showHeader">
            <img v-if="logoUrl" :src="logoUrl" alt="" class="size-9 shrink-0 rounded-lg bg-elevated object-cover">
            <span v-else class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500 text-sm font-semibold text-white" aria-hidden="true">{{ initials }}</span>
            <div class="min-w-0 flex-1">
              <h1 class="text-[17px] font-semibold leading-tight truncate">{{ boardTitle }}</h1>
              <p class="text-[13px] text-stone-500 dark:text-stone-400 line-clamp-2">{{ boardDescription }}</p>
            </div>
          </template>
          <UButton
            v-if="config && screen === 'list' && !only"
            icon="i-lucide-plus"
            :label="$t('embed.feedback.newPost')"
            color="primary"
            size="sm"
            class="ml-auto shrink-0"
            @click="startCompose"
          />
          <UButton
            v-if="!inline && inFrame"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            class="rounded-full shrink-0 -mr-1"
            :aria-label="$t('embed.close')"
            @click="post({ type: 'close' })"
          />
        </div>

        <!-- Linear's view pills -->
        <nav v-if="tabs.length > 1" class="mt-3 flex gap-1.5 pb-3" role="tablist" :aria-label="$t('embed.feedback.views')">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            :aria-selected="view === tab.key && screen === 'list'"
            class="chip"
            :class="view === tab.key && screen === 'list' ? 'chip-active' : ''"
            @click="setView(tab.key)"
          >
            <UIcon :name="tab.icon" class="size-3.5" />{{ tab.label }}
          </button>
        </nav>
        <div v-else class="h-3" />
      </div>
    </header>

    <!-- Signed out: reading is open, writing needs the host's sign-in. -->
    <Transition name="fade">
      <div v-if="config && !viewer.signedIn && !guestOpen && screen === 'list' && !onlyChangelog" class="mx-auto w-full px-4 pt-3" :class="contentWidth">
        <div class="flex items-center gap-3 rounded-lg border border-default bg-default px-3.5 py-2.5 text-[13px]">
          <UIcon name="i-lucide-log-in" class="size-4 shrink-0 text-muted" />
          <span class="min-w-0 flex-1">{{ onlyRoadmap ? $t('embed.feedback.signInToVote') : $t('embed.feedback.signInToPost') }}</span>
          <UButton v-if="canSignIn" :label="$t('embed.feedback.signIn')" size="xs" color="primary" @click="requestSignIn('post')" />
        </div>
      </div>
    </Transition>

    <!-- Transient notices (errors, "sign in to vote") -->
    <Transition name="fade">
      <div v-if="notice" class="fixed bottom-4 left-1/2 z-50 max-w-[90%] -translate-x-1/2 rounded-xl border border-default bg-default px-4 py-2.5 text-[13px] text-highlighted shadow-xl" role="status">
        {{ notice }}
      </div>
    </Transition>

    <main class="relative" :class="inline ? '' : 'flex-1 min-h-0 overflow-y-auto'">
      <div v-if="loadError" class="px-6 py-16 text-center text-sm text-stone-500 dark:text-stone-400">{{ loadError }}</div>

      <Transition v-else :name="nav" mode="out-in">
        <!-- ============================================================ list -->
        <div v-if="screen === 'list'" :key="`list-${view}`" class="mx-auto px-4 py-4" :class="contentWidth">
          <!-- Board -->
          <template v-if="view === 'board'">
            <div class="flex flex-wrap items-center gap-2">
              <UInput v-model="search" icon="i-lucide-search" :placeholder="$t('embed.feedback.searchPlaceholder')" size="sm" variant="outline" class="min-w-0 flex-1 basis-48" :aria-label="$t('embed.feedback.searchPlaceholder')" />
              <div class="flex rounded-lg bg-elevated p-0.5 text-xs font-medium" role="group" :aria-label="$t('embed.feedback.sort')">
                <button v-for="option in sortOptions" :key="option.key" type="button" class="h-7 rounded-md px-3 transition-colors" :class="sort === option.key ? 'bg-default text-highlighted shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-default'" :aria-pressed="sort === option.key" @click="sort = option.key">{{ option.label }}</button>
              </div>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                v-for="status in config?.statuses || []"
                :key="status.key"
                type="button"
                class="chip h-6 px-2.5 text-xs"
                :class="statusFilter.includes(status.key) ? 'chip-active' : 'border-transparent text-dimmed'"
                :aria-pressed="statusFilter.includes(status.key)"
                @click="toggleStatus(status.key)"
              >{{ status.label }}<span class="tabular-nums opacity-70">{{ statusCounts[status.key] || 0 }}</span></button>
              <span class="mx-1 h-4 w-px bg-accented" aria-hidden="true" />
              <button
                v-for="type in config?.types || []"
                :key="type.key"
                type="button"
                class="chip h-6 px-2.5 text-xs"
                :class="typeFilter === type.key ? 'chip-active' : ''"
                :aria-pressed="typeFilter === type.key"
                @click="typeFilter = typeFilter === type.key ? '' : type.key"
              ><FeedbackIcon :icon="type.icon" class="size-3" />{{ type.label }}</button>
              <button
                v-if="viewer.signedIn && !viewer.isAdmin"
                type="button"
                class="chip h-6 px-2.5 text-xs"
                :class="mineOnly ? 'chip-active' : ''"
                :aria-pressed="mineOnly"
                @click="mineOnly = !mineOnly"
              ><UIcon name="i-lucide-user" class="size-3" />{{ $t('embed.feedback.mine') }}</button>
            </div>

            <div v-if="listLoading && !boardPosts.length" class="mt-4 space-y-2.5" aria-busy="true">
              <div v-for="i in 4" :key="i" class="flex gap-3 rounded-2xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-stone-900 p-3.5">
                <div class="w-12 h-14 rounded-xl bg-stone-200 dark:bg-stone-800 animate-pulse" />
                <div class="flex-1 space-y-2 py-1"><div class="h-3.5 w-2/3 rounded bg-stone-200 dark:bg-stone-800 animate-pulse" /><div class="h-3 w-full rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse" /><div class="h-3 w-1/3 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse" /></div>
              </div>
            </div>
            <TransitionGroup v-else-if="boardPosts.length" tag="div" name="list" class="relative mt-4 space-y-2.5">
              <FeedbackPostRow v-for="item in boardPosts" :key="item.id" :post="item" :config="config!" @open="openPost(item.id)" @vote="vote(item)" />
            </TransitionGroup>
            <EmptyState v-else icon="i-lucide-lightbulb" :title="search || typeFilter || mineOnly ? $t('embed.feedback.nothingMatches') : $t('embed.feedback.noPostsYet')" :description="search || typeFilter || mineOnly ? $t('embed.feedback.tryAnother') : $t('embed.feedback.firstPost')">
              <UButton :label="$t('embed.feedback.newPost')" icon="i-lucide-plus" size="sm" @click="startCompose" />
            </EmptyState>
          </template>

          <!-- Roadmap: board items when the project board drives it, else posts -->
          <template v-else-if="view === 'roadmap'">
            <div v-if="(roadmapSource === 'board' ? roadmapLoading || (listLoading && !roadmap) : listLoading) && !roadmapCards.length" class="py-12 text-center text-sm text-stone-500">{{ $t('embed.loading') }}</div>
            <p v-else-if="roadmapError" class="py-12 text-center text-sm text-stone-500">{{ roadmapError }}</p>
            <FeedbackRoadmapView v-else :groups="roadmapGrouped" :layout="roadmapLayout" :statuses="roadmapStatuses" :labels="roadmap?.labels" @open="openPost" />
          </template>

          <!-- Changelog -->
          <template v-else>
            <div v-if="changelogLoading && !changelogItems.length" class="py-12 text-center text-sm text-stone-500">{{ $t('embed.loading') }}</div>
            <p v-else-if="changelogError" class="py-12 text-center text-sm text-stone-500">{{ changelogError }}</p>
            <EmptyState v-else-if="!changelogItems.length" icon="i-lucide-sparkles" :title="$t('embed.changelog.empty')" :description="$t('embed.changelog.emptyDescription')" />
            <ol v-else class="relative space-y-8 border-l border-stone-200 dark:border-stone-800 pl-5">
              <li v-for="item in changelogItems" :key="item.kind === 'release' ? `r-${item.release.id}` : `e-${item.entry.id}`" class="relative">
                <span class="absolute -left-[27px] top-1 grid size-3.5 place-items-center rounded-full bg-primary-600 ring-4 ring-stone-50 dark:ring-stone-950" aria-hidden="true" />
                <template v-if="item.kind === 'release'">
                  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h2 :id="`release-${item.release.version}`" class="scroll-mt-4 text-base font-semibold leading-snug">{{ item.release.version }}<template v-if="item.release.title"> · {{ item.release.title }}</template></h2>
                    <time v-if="item.date" class="text-xs text-stone-500 dark:text-stone-400" :datetime="item.date">{{ shortDate(item.date) }}</time>
                  </div>
                  <MarkdownBlock v-if="item.release.summary" :text="item.release.summary" class="mt-1" />
                  <div class="mt-3 space-y-4">
                    <FeedbackChangelogEntryItem v-for="entry in item.release.entries" :key="entry.id" :entry="entry" />
                  </div>
                </template>
                <FeedbackChangelogEntryItem v-else :entry="item.entry" show-date />
              </li>
            </ol>
          </template>
        </div>

        <!-- ============================================================ post -->
        <div v-else-if="screen === 'post'" key="post" class="mx-auto px-4 py-4" :class="contentWidth">
          <button type="button" class="inline-flex items-center gap-1 text-[13px] font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white transition-colors" @click="back">
            <UIcon name="i-lucide-chevron-left" class="size-4" />{{ backLabel }}
          </button>

          <div v-if="activePost" class="mt-3">
            <div class="flex gap-3.5">
              <FeedbackVote :count="activePost.voteCount" :voted="activePost.hasVoted" :closed="!votingOpen(activePost.statusCategory) || (activePost.locked && !activePost.canVote)" @vote="vote(activePost)" />
              <div class="min-w-0 flex-1">
                <h2 class="text-xl font-semibold leading-snug break-words"><span v-if="activePost.number" class="font-normal text-stone-400 tabular-nums">#{{ activePost.number }} </span>{{ activePost.title }}</h2>
                <div class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-stone-500 dark:text-stone-400">
                  <FeedbackStatusBadge :status="feedbackStatusFor(config, activePost.status)" />
                  <span v-if="feedbackTypeFor(config, activePost.type)" class="inline-flex items-center gap-1"><FeedbackIcon :icon="feedbackTypeFor(config, activePost.type)!.icon" fallback="i-lucide-tag" class="size-3.5" />{{ feedbackTypeFor(config, activePost.type)!.label }}</span>
                  <span v-if="feedbackPlatformLabel(config, activePost.platform)" class="inline-flex items-center gap-1"><UIcon name="i-lucide-monitor-smartphone" class="size-3.5" />{{ feedbackPlatformLabel(config, activePost.platform) }}</span>
                  <span v-for="tag in activePost.tags" :key="tag" class="rounded-full bg-stone-100 dark:bg-stone-800 px-1.5 py-px text-[11px]">{{ config?.tags?.find(t => t.key === tag)?.label || tag }}</span>
                  <span v-if="activePost.locked" class="inline-flex items-center gap-1"><UIcon name="i-lucide-lock" class="size-3.5" />{{ $t('embed.feedback.locked') }}</span>
                  <span v-if="activePost.hidden" class="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><UIcon name="i-lucide-eye-off" class="size-3.5" />{{ $t('embed.feedback.hidden') }}</span>
                </div>
                <p class="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                  {{ authorLabel(activePost.author, activePost.isMine) }} · <span :title="shortDate(activePost.createdAt)">{{ timeAgo(activePost.createdAt) }}</span>
                </p>
              </div>
            </div>

            <MarkdownBlock v-if="activePost.body" :text="activePost.body" class="mt-4 !text-[15px] leading-relaxed" />

            <div v-if="activePost.canEdit || activePost.canDelete" class="mt-4 flex items-center gap-2">
              <UButton v-if="activePost.canEdit" :label="$t('embed.feedback.edit')" icon="i-lucide-pencil" size="xs" color="neutral" variant="outline" @click="startEdit(activePost)" />
              <UButton
                v-if="activePost.canDelete"
                :label="confirmDelete ? $t('embed.feedback.deleteAgain') : $t('embed.feedback.delete')"
                icon="i-lucide-trash-2"
                size="xs"
                :color="confirmDelete ? 'error' : 'neutral'"
                :variant="confirmDelete ? 'solid' : 'outline'"
                :loading="deleting"
                @click="removePost(activePost)"
              />
            </div>

            <!-- Moderation, for the host's own staff -->
            <section v-if="viewer.isAdmin" class="mt-5 rounded-xl border border-default bg-default p-3.5">
              <p class="section-label mb-2.5">{{ $t('embed.feedback.manage') }}</p>
              <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
                <USelect :model-value="activePost.status" :items="statusItems" size="sm" class="w-44" :aria-label="$t('embed.feedback.status')" @update:model-value="moderate(activePost, { status: $event })" />
                <USwitch :model-value="activePost.featured" :label="$t('embed.feedback.featured')" size="sm" @update:model-value="moderate(activePost, { featured: $event })" />
                <USwitch :model-value="activePost.hidden" :label="$t('embed.feedback.hidden')" size="sm" @update:model-value="moderate(activePost, { hidden: $event })" />
              </div>
            </section>

            <!-- Comments -->
            <section class="mt-6 border-t border-stone-200 dark:border-stone-800 pt-4">
              <h3 class="text-[13px] font-semibold">{{ $t('embed.feedback.comments') }} <span class="font-normal text-stone-500 tabular-nums">{{ activePost.commentCount }}</span></h3>

              <div v-if="commentsLoading" class="py-6 text-center text-xs text-stone-500">{{ $t('embed.loading') }}</div>
              <ul v-else class="mt-3 space-y-4">
                <li v-for="comment in comments" :key="comment.id" class="flex gap-2.5">
                  <span
                    class="size-8 shrink-0 rounded-full grid place-items-center text-xs font-semibold"
                    :class="comment.author?.isTeam ? 'bg-primary-600 text-white' : 'bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-300'"
                    aria-hidden="true"
                  >
                    <UIcon v-if="comment.author?.isTeam" name="i-lucide-badge-check" class="size-4" />
                    <template v-else>{{ (comment.author?.name || (comment.isMine ? $t('embed.you') : '?')).slice(0, 1).toUpperCase() }}</template>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 text-xs">
                      <span class="font-semibold">{{ authorLabel(comment.author, comment.isMine, true) }}</span>
                      <span v-if="comment.author?.isTeam" class="rounded-full bg-primary-600/10 px-1.5 py-px text-[10px] font-semibold text-primary-700 dark:text-primary-300">{{ $t('embed.feedback.team') }}</span>
                      <span class="text-stone-500" :title="shortDate(comment.createdAt)">{{ timeAgo(comment.createdAt) }}<template v-if="comment.editedAt"> · {{ $t('embed.feedback.edited') }}</template></span>
                      <span v-if="comment.visibility === 'internal'" class="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-300">{{ $t('embed.feedback.teamOnly') }}</span>
                      <button
                        v-if="comment.canDelete"
                        type="button"
                        class="ml-auto rounded-full px-1.5 text-[11px] transition-colors"
                        :class="confirmCommentId === comment.id ? 'bg-rose-600 text-white' : 'text-stone-400 hover:text-rose-600'"
                        :aria-label="confirmCommentId === comment.id ? $t('embed.feedback.confirmDelete') : $t('embed.feedback.deleteComment')"
                        @click="removeComment(comment)"
                      >{{ confirmCommentId === comment.id ? $t('embed.feedback.deleteQuestion') : '✕' }}</button>
                    </div>
                    <MarkdownBlock :text="comment.body" class="mt-0.5 !text-[14px]" />
                  </div>
                </li>
                <li v-if="!comments.length" class="py-3 text-center text-xs text-stone-500">{{ $t('embed.feedback.noComments') }}</li>
              </ul>

              <form v-if="config?.allowComments || viewer.isAdmin" class="mt-4" @submit.prevent="submitComment">
                <UTextarea
                  v-model="commentDraft"
                  :rows="2"
                  :maxrows="8"
                  autoresize
                  :placeholder="viewer.signedIn || guestOpen ? $t('embed.feedback.addComment') : $t('embed.feedback.signInToComment')"
                  class="w-full"
                  :ui="{ base: 'text-[14px]' }"
                  :maxlength="8000"
                  @focus="!viewer.signedIn && needSignIn('comment')"
                  @keydown.meta.enter.prevent="submitComment"
                  @keydown.ctrl.enter.prevent="submitComment"
                />
                <div class="mt-2 flex items-center justify-between gap-2">
                  <p class="text-[11px] text-stone-400">{{ commentError || $t('embed.feedback.markdownHint') }}</p>
                  <UButton type="submit" :label="$t('embed.feedback.comment')" size="sm" color="primary" :disabled="!commentDraft.trim()" :loading="commentSending" />
                </div>
              </form>
            </section>
          </div>
          <div v-else class="py-12 text-center text-sm text-stone-500">{{ $t('embed.loading') }}</div>
        </div>

        <!-- ========================================================= compose -->
        <div v-else key="compose" class="mx-auto px-4 py-4" :class="contentWidth">
          <button type="button" class="inline-flex items-center gap-1 text-[13px] font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white transition-colors" @click="back">
            <UIcon name="i-lucide-chevron-left" class="size-4" />{{ $t('embed.feedback.back') }}
          </button>
          <h2 class="mt-3 text-xl font-semibold">{{ editingId ? $t('embed.feedback.editPost') : $t('embed.feedback.newPost') }}</h2>

          <form class="mt-4 space-y-4" @submit.prevent="submitPost">
            <div v-if="config?.types.length" class="space-y-1.5">
              <p class="text-xs font-medium text-stone-500 dark:text-stone-400">{{ $t('embed.feedback.whatIsIt') }}</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="type in config.types"
                  :key="type.key"
                  type="button"
                  class="chip"
                  :class="form.type === type.key ? 'chip-active' : ''"
                  :aria-pressed="form.type === type.key"
                  @click="form.type = type.key"
                ><FeedbackIcon :icon="type.icon" class="size-3.5" />{{ type.label }}</button>
              </div>
            </div>

            <UFormField :label="$t('embed.feedback.titleLabel')" :hint="`${form.title.length}/200`">
              <UInput v-model="form.title" :maxlength="200" :placeholder="$t('embed.feedback.titlePlaceholder')" class="w-full" size="lg" autofocus />
            </UFormField>

            <Transition name="fade">
              <div v-if="similar.length" class="rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3">
                <p class="text-xs font-medium text-amber-900 dark:text-amber-200">{{ $t('embed.feedback.alreadyPosted') }}</p>
                <ul class="mt-2 space-y-1.5">
                  <li v-for="item in similar" :key="item.id" class="flex items-center gap-2">
                    <FeedbackVote :count="item.voteCount" :voted="item.hasVoted" :closed="!votingOpen(item.statusCategory) || (item.locked && !item.canVote)" size="sm" @vote="vote(item)" />
                    <button type="button" class="min-w-0 flex-1 text-left text-[13px] font-medium hover:underline truncate" @click="openPost(item.id)">{{ item.title }}</button>
                    <FeedbackStatusBadge :status="feedbackStatusFor(config, item.status)" />
                  </li>
                </ul>
              </div>
            </Transition>

            <UFormField :label="$t('embed.feedback.details')" :hint="$t('embed.feedback.markdownWorks')">
              <UTextarea v-model="form.body" :rows="5" :maxrows="16" autoresize :placeholder="$t('embed.feedback.detailsPlaceholder')" class="w-full" :maxlength="20000" />
            </UFormField>

            <div v-if="config?.platforms.length" class="space-y-1.5">
              <p class="text-xs font-medium text-stone-500 dark:text-stone-400">{{ $t('embed.feedback.where') }}</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="platform in config.platforms"
                  :key="platform.key"
                  type="button"
                  class="chip"
                  :class="form.platform === platform.key ? 'chip-active' : ''"
                  :aria-pressed="form.platform === platform.key"
                  @click="form.platform = form.platform === platform.key ? '' : platform.key"
                >{{ platform.label }}</button>
              </div>
            </div>

            <p v-if="formError" class="text-sm text-error">{{ formError }}</p>
            <div class="flex items-center justify-end gap-2 pt-1">
              <UButton :label="$t('common.cancel')" color="neutral" variant="ghost" @click="back" />
              <UButton type="submit" :label="editingId ? $t('embed.feedback.save') : $t('embed.feedback.post')" color="primary" :disabled="!form.title.trim()" :loading="submitting" />
            </div>
          </form>
        </div>
      </Transition>
    </main>

    <p v-if="projectInfo?.poweredBy" class="shrink-0 py-3 text-center text-[11px] leading-tight">
      <a :href="projectInfo.poweredBy.url" target="_blank" rel="noopener" class="text-dimmed transition-colors hover:text-muted">{{ $t('embed.poweredBy') }}</a>
    </p>
  </div>
</template>

<script setup lang="ts">
import Fuse from 'fuse.js'
import {
  ACTIVE_FEEDBACK_CATEGORIES,
  feedbackPlainText,
  votingOpen,
  type FeedbackAuthor,
  type FeedbackBoardConfig,
  type FeedbackComment,
  type FeedbackEvent,
  type FeedbackPost,
  type FeedbackViewer
} from '#shared/feedback'
import { BOARD_ROADMAP_LAYOUTS, ROADMAP_CATEGORIES, roadmapGroups, type BoardRoadmapLayout, type RoadmapResponse } from '#shared/board'
import { changelogTimeline, type PublicChangelog } from '#shared/changelog'
import type { GuestSurface } from '#shared/guest'
import type { ResolvedStyle } from '#shared/projectStyle'
import type { RoadmapCard } from '~/components/feedback/RoadmapView.vue'

// The plug-and-play feedback board, inside the host site's iframe (see
// public/feedback.js). Anyone can read it with the project's public key; the
// host hands over an identity token for its signed-in user over postMessage —
// exactly like the chat embed — and is asked to sign the user in when they try
// to vote, post or comment without one.

definePageMeta({ layout: 'bare' })

const route = useRoute()
// ?header=0 (data-header="false") leaves out the logo, title and description, for a page that already shows them.
// The view tabs and the New post button stay.
const showHeader = computed(() => !['0', 'false', 'off'].includes(String(route.query.header || '').toLowerCase()))
const pk = String(route.query.pk || '')
// Inline: part of the host page, grows to its content (the loader resizes the
// frame). Otherwise a fixed panel that scrolls inside.
const inline = route.query.inline === '1'
const defaultPlatform = String(route.query.platform || '')
// `only=roadmap` / `only=changelog`: the public roadmap (/roadmap/<pk>) or changelog
// (/changelog/<pk>) page — one locked view, no tabs, no posting.
const only = route.query.only === 'roadmap' || route.query.only === 'changelog' ? route.query.only : ''
const onlyRoadmap = only === 'roadmap'
const onlyChangelog = only === 'changelog'
// `layout=` overrides the board's own roadmap layout.
const layoutParam = (BOARD_ROADMAP_LAYOUTS as readonly string[]).includes(String(route.query.layout)) ? route.query.layout as BoardRoadmapLayout : null
const inFrame = import.meta.client && window.parent !== window

const colorMode = useColorMode()
const themeParam = String(route.query.theme || '')
if (['light', 'dark', 'system'].includes(themeParam)) colorMode.preference = themeParam

type ProjectInfo = { name: string, publicKey: string, theme: { accent?: string }, feedbackStyle?: ResolvedStyle, brandLogoUrl: string, allowedOrigins: string[], guestSurfaces?: GuestSurface[], poweredBy?: { url: string } | null }
type View = 'board' | 'roadmap' | 'changelog'

const { t } = useI18n()
const rootRef = ref<HTMLElement | null>(null)
const config = ref<FeedbackBoardConfig | null>(null)
const projectInfo = ref<ProjectInfo | null>(null)
const viewer = ref<FeedbackViewer>({ signedIn: false, isAdmin: false, name: '' })
const token = ref<string | null>(null)
const canSignIn = ref(false)
const parentOrigin = ref('')
const loadError = ref('')

const view = ref<View>(onlyRoadmap ? 'roadmap' : onlyChangelog ? 'changelog' : ['roadmap', 'changelog'].includes(String(route.query.view)) ? route.query.view as View : 'board')
/** Where the Roadmap view's cards come from: the project board, or the board's own posts. */
const roadmapSource = ref<'board' | 'posts'>('posts')
const screen = ref<'list' | 'post' | 'compose'>('list')
const nav = ref<'push' | 'pop'>('push')

const contentWidth = computed(() => (view.value === 'roadmap' && screen.value === 'list' && roadmapLayout.value !== 'list' ? 'max-w-5xl' : 'max-w-3xl'))
// With the title block left out, the header is only worth its space while it still holds controls.
const headerVisible = computed(() => showHeader.value || tabs.value.length > 1 || (Boolean(config.value) && screen.value === 'list' && !only) || (!inline && inFrame))
const boardTitle = computed(() => (only
  ? (projectInfo.value?.name ? (onlyRoadmap ? t('embed.roadmap.namedTitle', { name: projectInfo.value.name }) : t('embed.changelog.namedTitle', { name: projectInfo.value.name })) : onlyRoadmap ? t('embed.roadmap.title') : t('embed.changelog.title'))
  : config.value?.title || (projectInfo.value?.name ? t('embed.feedback.namedTitle', { name: projectInfo.value.name }) : t('embed.feedback.title'))))
const boardDescription = computed(() => (onlyRoadmap ? t('embed.roadmap.description') : onlyChangelog ? t('embed.changelog.description') : config.value?.description || t('embed.feedback.description')))
const initials = computed(() => (projectInfo.value?.name || 'F').trim().slice(0, 1).toUpperCase())
const tabs = computed(() => (only ? [] : [
  { key: 'board' as const, label: t('embed.feedback.title'), icon: 'i-lucide-messages-square' },
  ...(config.value?.roadmap ? [{ key: 'roadmap' as const, label: t('embed.roadmap.title'), icon: 'i-lucide-map' }] : []),
  ...(config.value?.changelog ? [{ key: 'changelog' as const, label: t('embed.changelog.title'), icon: 'i-lucide-sparkles' }] : [])
]))
const backLabel = computed(() => (view.value === 'board' ? t('embed.feedback.allPosts') : view.value === 'roadmap' ? t('embed.roadmap.title') : t('embed.changelog.title')))

// Nuxt UI's theme is `inline`, so utilities read the --ui-color-* scale
// directly: derive the shades from the project accent.
// It wears the board's style (the project's, with the board's own choices over it), in light or dark.
const style = computed(() => embedStyle(projectInfo.value?.feedbackStyle, route.query))
const mode = computed<'light' | 'dark'>(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
const logoUrl = computed(() => (mode.value === 'dark' ? style.value.logoDarkUrl : style.value.logoUrl) || style.value.iconUrl || projectInfo.value?.brandLogoUrl || '')
const rootStyle = computed(() => styleRootStyle(style.value, mode.value))
// A style that fixes the scheme applies it, unless the embed's own ?theme asked for one.
watch(() => style.value.scheme, (scheme) => {
  if (!themeParam && scheme !== 'auto') colorMode.preference = scheme
}, { immediate: true })
useHead({ title: boardTitle, htmlAttrs: { style: computed(() => accentStyle(style.value[mode.value].accent)) } })

// ---- notices ----
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function showNotice(text: string) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = '' }, 3200)
}

// ---- host bridge ----
function post(message: Record<string, unknown>) {
  if (!inFrame) return
  window.parent.postMessage({ source: 'help-bites-feedback', ...message }, parentOrigin.value || '*')
}

function isAllowedOrigin(origin: string): boolean {
  const allowed = projectInfo.value?.allowedOrigins || []
  return allowed.includes(origin) || origin === window.location.origin
}

let tokenWaiters: ((value: string | null) => void)[] = []
function requestToken(): Promise<string | null> {
  return new Promise((resolve) => {
    tokenWaiters.push(resolve)
    post({ type: 'token-needed' })
    setTimeout(() => resolve(null), 8000)
  })
}

function setToken(next: string | null) {
  const changed = next !== token.value
  token.value = next
  for (const resolve of tokenWaiters) resolve(next)
  tokenWaiters = []
  // Viewer-relative fields (your votes, your posts) depend on who is asking.
  if (changed && config.value) {
    void loadPosts()
    if (screen.value === 'post' && activeId.value) void loadActivePost(activeId.value)
  }
}

// Guests: a host that gave the board no sign-in of its own, and a project that lets guests post here,
// make a visitor a guest the first time they act (never on load, so a reader costs no session).
const guests = useGuestSession(pk)
const guestOpen = computed(() => !canSignIn.value && Boolean(projectInfo.value?.guestSurfaces?.includes('feedback')))

/** True when the visitor still cannot write (and has been told how to sign in). */
async function needSignIn(reason: 'vote' | 'post' | 'comment'): Promise<boolean> {
  if (token.value) return false
  if (guestOpen.value) {
    const guest = await guests.start(projectInfo.value?.guestSurfaces, 'feedback')
    if (guest) { setToken(guest); return false }
  }
  requestSignIn(reason)
  return true
}

function requestSignIn(reason: 'vote' | 'post' | 'comment') {
  if (canSignIn.value) {
    post({ type: 'sign-in', reason })
    return
  }
  const reasonText = t(`embed.feedback.reason.${reason}`)
  showNotice(projectInfo.value?.name ? t('embed.feedback.signInForReasonProject', { name: projectInfo.value.name, reason: reasonText }) : t('embed.feedback.signInForReason', { reason: reasonText }))
}

function onMessage(event: MessageEvent) {
  // Only the host page itself, never another frame on it.
  if (event.source !== window.parent) return
  const data = event.data
  if (!data || data.source !== 'help-bites-feedback-host') return
  const allowed = isAllowedOrigin(event.origin)
  if (data.type === 'token' && !allowed) {
    // Reading stays open; only identity needs an allowed origin.
    console.warn(`[help-bites] ${event.origin} is not an allowed origin for this project; staying signed out.`)
    canSignIn.value = false
    return
  }
  // Any host may steer the view (it could put ?view= and ?post= on the frame
  // anyway); only an allowed one becomes the origin the board posts to.
  if (allowed) parentOrigin.value = event.origin
  if (data.type === 'token') {
    canSignIn.value = Boolean(data.canSignIn)
    // No token from the host: the guest this browser already is, if any (a new one waits for a first action).
    setToken(typeof data.token === 'string' && data.token ? data.token : (canSignIn.value ? null : guests.restore()))
  }
  if (data.type === 'open-post' && typeof data.postId === 'string') void openPost(data.postId)
  if (data.type === 'set-view' && ['board', 'roadmap', 'changelog'].includes(data.view) && !only) setView(data.view)
}

// ---- api ----
class SignInNeeded extends Error {}

async function api<T = any>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown, retry?: boolean } = {}): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const url = `/v1${path}${token.value ? '' : `${separator}pk=${encodeURIComponent(pk)}`}`
  try {
    return await $fetch<T>(url, { method: options.method || 'GET', body: options.body as any, headers: token.value ? { Authorization: `Bearer ${token.value}` } : {} })
  } catch (error: any) {
    const status = error?.statusCode || error?.status
    if (status === 401 && token.value && token.value === guests.restore()) {
      // The server dropped this guest (expired, or guests were switched off): read as a visitor again.
      guests.forget()
      token.value = null
      viewer.value = { signedIn: false, isAdmin: false, name: '' }
      if (options.retry !== false && (options.method || 'GET') === 'GET') return api<T>(path, { ...options, retry: false })
    } else if (status === 401 && token.value && options.retry !== false) {
      token.value = await requestToken()
      return api<T>(path, { ...options, retry: false })
    }
    if (status === 401) throw new SignInNeeded(error?.data?.statusMessage || t('embed.feedback.signInRequired'))
    throw new Error(error?.data?.statusMessage || error?.message || t('embed.feedback.somethingWrong'))
  }
}

// ---- posts ----
const byId = ref<Record<string, FeedbackPost>>({})
const listLoading = ref(true)
const allPosts = computed(() => Object.values(byId.value))

function upsert(item: FeedbackPost) {
  byId.value = { ...byId.value, [item.id]: mergeFeedbackPost(byId.value[item.id], item) }
}
function replace(item: FeedbackPost) {
  byId.value = { ...byId.value, [item.id]: item }
}
function drop(id: string) {
  const next = { ...byId.value }
  delete next[id]
  byId.value = next
}

async function loadPosts() {
  listLoading.value = true
  try {
    const admin = viewer.value.isAdmin ? '&includeHidden=1' : ''
    const result = await api<{ posts: FeedbackPost[], viewer: FeedbackViewer }>(`/feedback?limit=500${admin}`)
    viewer.value = result.viewer
    const next: Record<string, FeedbackPost> = {}
    for (const item of result.posts) next[item.id] = item
    byId.value = next
    // An admin only learns they are one from this response; fetch hidden posts too.
    if (result.viewer.isAdmin && !admin) return loadPosts()
    if (view.value !== 'board') await loadView(view.value)
  } catch (error) {
    if (!(error instanceof SignInNeeded)) showNotice((error as Error).message)
  } finally {
    listLoading.value = false
  }
}

// The board fetch covers most boards; the other views top up older history.
async function loadView(next: View) {
  if (next === 'board') return
  if (next === 'roadmap' && roadmapSource.value === 'board') return loadRoadmap()
  if (next === 'changelog') return loadChangelog()
  try {
    const result = await api<{ posts: FeedbackPost[] }>(`/feedback?view=${next}&limit=200`)
    for (const item of result.posts) upsert(item)
  } catch {}
}

// ---- board filters ----
const search = ref('')
const sortOptions = computed(() => [{ key: 'top' as const, label: t('embed.feedback.sortTop') }, { key: 'new' as const, label: t('embed.feedback.sortNew') }])
const sort = ref<'top' | 'new'>('top')
const statusFilter = ref<string[]>([])
const typeFilter = ref('')
const mineOnly = ref(false)

function toggleStatus(key: string) {
  statusFilter.value = statusFilter.value.includes(key) ? statusFilter.value.filter(k => k !== key) : [...statusFilter.value, key]
}

const statusCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const item of allPosts.value) counts[item.status] = (counts[item.status] || 0) + 1
  return counts
})

const boardPosts = computed(() => {
  let list = allPosts.value.filter(item =>
    (!statusFilter.value.length || statusFilter.value.includes(item.status))
    && (!typeFilter.value || item.type === typeFilter.value)
    && (!mineOnly.value || item.isMine))
  const text = search.value.trim()
  if (text) return new Fuse(list, { keys: [{ name: 'title', weight: 2 }, 'body'], threshold: 0.38, ignoreLocation: true }).search(text).map(r => r.item)
  list = [...list]
  if (sort.value === 'top') list.sort((a, b) => b.voteCount - a.voteCount || b.createdAt.localeCompare(a.createdAt))
  else list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return list
})

// ---- roadmap ----
const roadmap = ref<RoadmapResponse | null>(null)
const roadmapLoading = ref(false)
const roadmapError = ref('')

async function loadRoadmap() {
  roadmapLoading.value = true
  try {
    roadmap.value = await api<RoadmapResponse>('/feedback/roadmap')
    roadmapError.value = ''
  } catch (error) {
    if (!(error instanceof SignInNeeded)) roadmapError.value = (error as Error).message
  } finally {
    roadmapLoading.value = false
  }
}

const roadmapLayout = computed<BoardRoadmapLayout>(() => layoutParam || (roadmapSource.value === 'board' ? roadmap.value?.options.layout : null) || 'columns')
const roadmapStatuses = computed(() => (roadmapSource.value === 'board'
  ? roadmap.value?.statuses || []
  : (config.value?.statuses || []).filter(status => ROADMAP_CATEGORIES.includes(status.category))))

// Board items sum their posts' votes; the live post (votes land over SSE) wins over the snapshot.
const roadmapCards = computed<RoadmapCard[]>(() => {
  if (roadmapSource.value === 'board') {
    return (roadmap.value?.items || []).map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      status: item.status,
      labels: item.labels,
      targetDate: item.targetDate,
      posts: item.posts.map(p => ({ id: p.id, title: p.title, voteCount: byId.value[p.id]?.voteCount ?? p.voteCount })),
      voteCount: item.posts.reduce((n, p) => n + (byId.value[p.id]?.voteCount ?? p.voteCount), 0)
    }))
  }
  const keys = roadmapStatuses.value.map(status => status.key)
  return allPosts.value
    .filter(item => keys.includes(item.status) && !item.hidden)
    .sort((a, b) => b.voteCount - a.voteCount)
    .map(item => ({
      id: item.id,
      title: item.title,
      description: feedbackPlainText(item.body, 240),
      status: item.status,
      voteCount: item.voteCount,
      posts: [{ id: item.id, title: item.title, voteCount: item.voteCount }],
      type: feedbackTypeFor(config.value, item.type)
    }))
})

const roadmapGrouped = computed(() => {
  const groups = roadmapGroups(roadmapCards.value, roadmapStatuses.value, roadmapLayout.value)
  if (roadmapSource.value === 'board') return groups
  // Post roadmaps keep their old shape: the top 50 per status, the 12 most-voted shipped.
  return groups.map(group => ({ ...group, items: group.items.slice(0, group.status?.category === 'done' ? 12 : 50) }))
})

// ---- changelog ----
const changelog = ref<PublicChangelog>({ releases: [], entries: [] })
const changelogLoading = ref(false)
const changelogError = ref('')
const changelogItems = computed(() => changelogTimeline(changelog.value))

async function loadChangelog() {
  changelogLoading.value = true
  try {
    changelog.value = await api<PublicChangelog>('/changelog')
    changelogError.value = ''
    // An RSS item links to #entry-<number>; the page only has it now.
    await nextTick()
    const anchor = import.meta.client ? decodeURIComponent(location.hash.slice(1)) : ''
    if (anchor) document.getElementById(anchor)?.scrollIntoView()
  } catch (error) {
    if (!(error instanceof SignInNeeded)) changelogError.value = (error as Error).message
  } finally {
    changelogLoading.value = false
  }
}

function setView(next: View) {
  nav.value = screen.value === 'list' ? 'push' : 'pop'
  screen.value = 'list'
  activeId.value = ''
  view.value = next
  void loadView(next)
}

// ---- voting ----
async function vote(item: FeedbackPost) {
  if (!votingOpen(item.statusCategory)) return
  if (await needSignIn('vote')) return
  const before = byId.value[item.id] || item
  const want = !before.hasVoted
  replace({ ...before, hasVoted: want, voteCount: Math.max(0, before.voteCount + (want ? 1 : -1)) })
  try {
    const result = await api<{ post: FeedbackPost }>(`/feedback/${item.id}/vote`, { method: 'POST', body: { voted: want } })
    replace(result.post)
  } catch (error) {
    replace(before)
    if (error instanceof SignInNeeded) requestSignIn('vote')
    else showNotice((error as Error).message)
  }
}

// ---- one post ----
const activeId = ref('')
const activePost = computed(() => (activeId.value ? byId.value[activeId.value] || null : null))
const comments = ref<FeedbackComment[]>([])
const commentsLoading = ref(false)
const confirmDelete = ref(false)
const deleting = ref(false)

async function loadActivePost(id: string) {
  const result = await api<{ post: FeedbackPost, comments: FeedbackComment[], viewer: FeedbackViewer }>(`/feedback/${encodeURIComponent(id)}`)
  replace(result.post)
  if (activeId.value === id) activeId.value = result.post.id
  comments.value = result.comments
  viewer.value = result.viewer
}

async function openPost(id: string) {
  nav.value = 'push'
  activeId.value = id
  screen.value = 'post'
  comments.value = []
  commentDraft.value = ''
  commentError.value = ''
  confirmDelete.value = false
  commentsLoading.value = true
  try {
    await loadActivePost(id)
  } catch {
    showNotice(t('embed.feedback.postUnavailable'))
    back()
  } finally {
    commentsLoading.value = false
  }
}

function back() {
  nav.value = 'pop'
  if (screen.value === 'compose' && editingId.value && byId.value[editingId.value]) {
    screen.value = 'post'
    activeId.value = editingId.value
    editingId.value = ''
    return
  }
  screen.value = 'list'
  activeId.value = ''
  editingId.value = ''
}

async function removePost(item: FeedbackPost) {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    setTimeout(() => { confirmDelete.value = false }, 3500)
    return
  }
  deleting.value = true
  try {
    await api(`/feedback/${item.id}`, { method: 'DELETE' })
    drop(item.id)
    back()
    showNotice(t('embed.feedback.postDeleted'))
  } catch (error) {
    showNotice((error as Error).message)
  } finally {
    deleting.value = false
    confirmDelete.value = false
  }
}

const statusItems = computed(() => (config.value?.statuses || []).map(s => ({ label: s.label, value: s.key })))

async function moderate(item: FeedbackPost, patch: Record<string, unknown>) {
  const before = byId.value[item.id] || item
  replace({ ...before, ...patch } as FeedbackPost)
  try {
    const result = await api<{ post: FeedbackPost }>(`/feedback/${item.id}`, { method: 'PATCH', body: patch })
    replace(result.post)
  } catch (error) {
    replace(before)
    showNotice((error as Error).message)
  }
}

function authorLabel(author: FeedbackAuthor | null, isMine?: boolean, short = false): string {
  if (isMine) return short ? t('embed.you') : t('embed.feedback.postedByYou')
  const name = author?.name || (author?.isTeam ? projectInfo.value?.name || t('embed.feedback.team') : '')
  if (short) return name || t('embed.feedback.member')
  return name ? t('embed.feedback.postedBy', { name }) : t('embed.feedback.postedByMember')
}

// ---- comments ----
const commentDraft = ref('')
const commentSending = ref(false)
const commentError = ref('')
const confirmCommentId = ref('')

async function submitComment() {
  const body = commentDraft.value.trim()
  if (!body || !activePost.value || commentSending.value) return
  if (await needSignIn('comment')) return
  commentSending.value = true
  commentError.value = ''
  try {
    const result = await api<{ comment: FeedbackComment, post: FeedbackPost }>(`/feedback/${activePost.value.id}/comments`, { method: 'POST', body: { body } })
    if (!comments.value.some(c => c.id === result.comment.id)) comments.value = [...comments.value, result.comment]
    replace(result.post)
    commentDraft.value = ''
  } catch (error) {
    if (error instanceof SignInNeeded) requestSignIn('comment')
    else commentError.value = (error as Error).message
  } finally {
    commentSending.value = false
  }
}

async function removeComment(comment: FeedbackComment) {
  if (confirmCommentId.value !== comment.id) {
    confirmCommentId.value = comment.id
    setTimeout(() => { if (confirmCommentId.value === comment.id) confirmCommentId.value = '' }, 3500)
    return
  }
  confirmCommentId.value = ''
  const before = comments.value
  comments.value = comments.value.filter(c => c.id !== comment.id)
  try {
    const result = await api<{ post: FeedbackPost }>(`/feedback/${comment.postId}/comments/${comment.id}`, { method: 'DELETE' })
    replace(result.post)
  } catch (error) {
    comments.value = before
    showNotice((error as Error).message)
  }
}

// ---- compose / edit ----
const editingId = ref('')
const form = reactive({ title: '', body: '', type: '', platform: '' })
const submitting = ref(false)
const formError = ref('')

async function startCompose() {
  if (await needSignIn('post')) return
  nav.value = 'push'
  editingId.value = ''
  Object.assign(form, { title: search.value.trim(), body: '', type: typeFilter.value || config.value?.types[0]?.key || '', platform: config.value?.platforms.some(p => p.key === defaultPlatform) ? defaultPlatform : '' })
  formError.value = ''
  screen.value = 'compose'
}

function startEdit(item: FeedbackPost) {
  nav.value = 'push'
  editingId.value = item.id
  Object.assign(form, { title: item.title, body: item.body, type: item.type, platform: item.platform })
  formError.value = ''
  screen.value = 'compose'
}

// Duplicates are the bane of every board: surface look-alikes while typing.
const similar = computed(() => {
  const text = form.title.trim()
  if (editingId.value || text.length < 4) return []
  return new Fuse(allPosts.value, { keys: ['title'], threshold: 0.45, ignoreLocation: true, includeScore: true })
    .search(text)
    .filter(r => (r.score ?? 1) < 0.45)
    .slice(0, 3)
    .map(r => r.item)
})

async function submitPost() {
  if (!form.title.trim() || submitting.value) return
  submitting.value = true
  formError.value = ''
  const body = { title: form.title.trim(), body: form.body.trim(), type: form.type, platform: form.platform }
  try {
    const result = editingId.value
      ? await api<{ post: FeedbackPost }>(`/feedback/${editingId.value}`, { method: 'PATCH', body })
      : await api<{ post: FeedbackPost }>('/feedback', { method: 'POST', body })
    replace(result.post)
    const wasEditing = Boolean(editingId.value)
    editingId.value = ''
    search.value = ''
    if (!statusFilter.value.includes(result.post.status)) statusFilter.value = [...statusFilter.value, result.post.status]
    await openPost(result.post.id)
    showNotice(wasEditing ? t('embed.feedback.saved') : t('embed.feedback.postedThanks'))
  } catch (error) {
    if (error instanceof SignInNeeded) requestSignIn('post')
    else formError.value = (error as Error).message
  } finally {
    submitting.value = false
  }
}

// ---- live ----
useEventStream<FeedbackEvent>(computed(() => (config.value ? `/v1/feedback/events?pk=${encodeURIComponent(pk)}` : null)), token, (event) => {
  if (event.type === 'feedback.post.created' || event.type === 'feedback.post.updated') {
    upsert(event.post)
  } else if (event.type === 'feedback.post.deleted') {
    drop(event.postId)
    if (activeId.value === event.postId && screen.value === 'post') {
      back()
      showNotice(t('embed.feedback.postRemoved'))
    }
  } else if (event.type === 'feedback.comment.created') {
    if (activeId.value === event.postId && !comments.value.some(c => c.id === event.comment.id)) comments.value = [...comments.value, { isMine: false, canDelete: viewer.value.isAdmin, ...event.comment }]
    const item = byId.value[event.postId]
    if (item) replace({ ...item, commentCount: event.commentCount })
  } else if (event.type === 'feedback.comment.updated') {
    if (activeId.value === event.postId) comments.value = comments.value.map(c => (c.id === event.comment.id ? { ...c, ...event.comment, isMine: c.isMine, canEdit: c.canEdit, canDelete: c.canDelete, reactions: event.comment.reactions.map(r => ({ ...r, reacted: c.reactions?.find(x => x.key === r.key)?.reacted ?? false })) } : c))
    const item = byId.value[event.postId]
    if (item) replace({ ...item, commentCount: event.commentCount })
  } else if (event.type === 'feedback.comment.deleted') {
    if (activeId.value === event.postId) comments.value = comments.value.filter(c => c.id !== event.commentId)
    const item = byId.value[event.postId]
    if (item) replace({ ...item, commentCount: event.commentCount })
  }
}, () => { void loadPosts() }, { anonymous: true })

// ---- tell the host where we are and how tall we are ----
watch([screen, activeId, view], () => {
  post({ type: 'navigate', postId: screen.value === 'post' ? activeId.value : null, view: view.value })
})

let resizeObserver: ResizeObserver | null = null
let lastHeight = 0
function reportHeight() {
  const height = Math.ceil(rootRef.value?.getBoundingClientRect().height || 0)
  if (height && Math.abs(height - lastHeight) > 1) {
    lastHeight = height
    post({ type: 'resize', height })
  }
}

onMounted(async () => {
  window.addEventListener('message', onMessage)
  // Standalone (no host frame): a token in the URL, for demos and tests.
  const direct = takeUrlToken()
  if (inline) {
    // The frame is sized to us, so the document must not stretch to the frame.
    document.documentElement.style.height = 'auto'
    document.body.style.height = 'auto'
    const nuxtRoot = document.getElementById('__nuxt')
    if (nuxtRoot) nuxtRoot.style.height = 'auto'
    resizeObserver = new ResizeObserver(reportHeight)
    if (rootRef.value) resizeObserver.observe(rootRef.value)
  }
  if (!pk) {
    loadError.value = t('embed.feedback.missingKey')
    return
  }
  try {
    const result = await $fetch<{ config: FeedbackBoardConfig, roadmapSource?: 'board' | 'posts', project: ProjectInfo, viewer: FeedbackViewer }>(`/v1/feedback/config?pk=${encodeURIComponent(pk)}`)
    if (onlyRoadmap && !result.config.roadmap) {
      loadError.value = t('embed.roadmap.none')
      return
    }
    if (onlyChangelog && !result.config.changelog) {
      loadError.value = t('embed.changelog.none')
      return
    }
    config.value = result.config
    roadmapSource.value = result.roadmapSource === 'board' ? 'board' : 'posts'
    projectInfo.value = result.project
    statusFilter.value = result.config.statuses.filter(s => ACTIVE_FEEDBACK_CATEGORIES.includes(s.category)).map(s => s.key)
  } catch (error: any) {
    loadError.value = error?.statusCode === 404 ? (onlyRoadmap ? t('embed.roadmap.none') : onlyChangelog ? t('embed.changelog.none') : t('embed.feedback.noBoard')) : (onlyRoadmap ? t('embed.roadmap.loadFailed') : onlyChangelog ? t('embed.changelog.loadFailed') : t('embed.feedback.loadFailed'))
    return
  }
  if (direct) token.value = direct
  else if (window.parent === window) token.value = guests.restore()
  // Read straight away; a token from the host only refines the view.
  await loadPosts()
  post({ type: 'ready' })
  const wanted = typeof route.query.post === 'string' ? route.query.post : ''
  if (wanted) void openPost(wanted)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  resizeObserver?.disconnect()
})
</script>

<style scoped>
.list-move, .list-enter-active, .list-leave-active { transition: transform .28s cubic-bezier(.32, .72, 0, 1), opacity .2s ease; }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateY(6px); }
.list-leave-active { position: absolute; width: 100%; }
</style>
