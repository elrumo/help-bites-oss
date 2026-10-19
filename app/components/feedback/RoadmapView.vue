<template>
  <!-- The public roadmap in one of three layouts. Cards are board items or, on
       boards without one, single posts; either way a card opens a post. -->
  <EmptyState v-if="!cardCount" icon="i-lucide-map" title="Nothing on the roadmap yet" description="Planned, in-progress and shipped work shows up here." />

  <!-- Columns: one per status -->
  <div v-else-if="layout === 'columns'" class="grid gap-3" :class="groups.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'">
    <section v-for="group in groups" :key="group.key" class="min-w-0 rounded-xl bg-elevated/60 p-2">
      <header class="flex items-center justify-between px-1 pb-2">
        <FeedbackStatusBadge :status="group.status || statusFor(group.key)" />
        <span class="text-xs tabular-nums text-stone-500">{{ group.items.length }}</span>
      </header>
      <div class="space-y-2">
        <template v-for="card in group.items" :key="card.id">
          <component :is="card.posts.length === 1 ? 'button' : 'div'" :type="card.posts.length === 1 ? 'button' : undefined" class="block w-full rounded-lg border border-default bg-default p-2.5 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)]" :class="card.posts.length === 1 ? 'transition-colors hover:border-accented' : ''" @click="card.posts.length === 1 && emit('open', card.posts[0]!.id)">
            <span class="flex items-start gap-2.5">
              <span class="flex w-6 shrink-0 flex-col items-center pt-0.5 text-[11px] font-semibold tabular-nums text-stone-500" :title="`${card.voteCount} ${card.voteCount === 1 ? 'vote' : 'votes'}`"><UIcon name="i-lucide-chevron-up" class="size-3.5" />{{ card.voteCount }}</span>
              <span class="min-w-0 flex-1">
                <span class="block text-[13px] font-medium leading-snug line-clamp-3">{{ card.title }}</span>
                <span v-if="card.description" class="mt-1 block text-xs leading-relaxed text-stone-500 dark:text-stone-400 line-clamp-3">{{ plain(card.description) }}</span>
                <span v-if="hasMeta(card)" class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
                  <span v-if="card.type" class="inline-flex items-center gap-1"><FeedbackIcon :icon="card.type.icon" class="size-3" />{{ card.type.label }}</span>
                  <span v-for="label in card.labels || []" :key="label" class="inline-flex items-center gap-1 rounded-full bg-stone-100 px-1.5 py-px dark:bg-stone-800"><span class="size-1.5 rounded-full" :class="dot(labelFor(label)?.color)" />{{ labelFor(label)?.label || label }}</span>
                  <span v-if="card.targetDate" class="inline-flex items-center gap-1"><UIcon name="i-lucide-calendar" class="size-3" />{{ dayLabel(card.targetDate) }}</span>
                </span>
              </span>
            </span>
            <details v-if="card.posts.length > 1" class="mt-2 border-t border-default pt-1.5 text-xs">
              <summary class="cursor-pointer text-stone-500 hover:text-default">{{ card.posts.length }} requests</summary>
              <ul class="mt-1 space-y-0.5">
                <li v-for="post in card.posts" :key="post.id">
                  <button type="button" class="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-elevated" @click="emit('open', post.id)">
                    <span class="w-7 shrink-0 font-semibold tabular-nums text-stone-500"><UIcon name="i-lucide-chevron-up" class="size-3" />{{ post.voteCount }}</span>
                    <span class="min-w-0 flex-1 truncate">{{ post.title }}</span>
                  </button>
                </li>
              </ul>
            </details>
          </component>
        </template>
        <p v-if="!group.items.length" class="px-1 py-4 text-center text-xs text-stone-400">Nothing here yet</p>
      </div>
    </section>
  </div>

  <!-- Timeline: one section per target quarter, undated last -->
  <div v-else-if="layout === 'timeline'" class="space-y-8">
    <section v-for="group in groups" :key="group.key">
      <h2 class="mb-3 flex items-center gap-2 text-xs font-medium text-muted">
        <UIcon :name="group.key === 'none' ? 'i-lucide-calendar-off' : 'i-lucide-calendar'" class="size-3.5" />{{ group.label }}
        <span class="tabular-nums text-stone-400">{{ group.items.length }}</span>
      </h2>
      <div class="grid items-start gap-2 sm:grid-cols-2">
        <component :is="card.posts.length === 1 ? 'button' : 'div'" v-for="card in group.items" :key="card.id" :type="card.posts.length === 1 ? 'button' : undefined" class="block w-full rounded-lg border border-default bg-default p-3 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)]" :class="card.posts.length === 1 ? 'transition-colors hover:border-accented' : ''" @click="card.posts.length === 1 && emit('open', card.posts[0]!.id)">
          <span class="flex items-center gap-2">
            <FeedbackStatusBadge :status="statusFor(card.status)" />
            <span v-if="card.targetDate" class="text-[11px] text-stone-500">{{ dayLabel(card.targetDate) }}</span>
            <span class="ml-auto inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums text-stone-500"><UIcon name="i-lucide-chevron-up" class="size-3.5" />{{ card.voteCount }}</span>
          </span>
          <span class="mt-1.5 block text-[13px] font-medium leading-snug">{{ card.title }}</span>
          <span v-if="card.description" class="mt-1 block text-xs leading-relaxed text-stone-500 dark:text-stone-400 line-clamp-3">{{ plain(card.description) }}</span>
          <span v-if="card.labels?.length || card.type" class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
            <span v-if="card.type" class="inline-flex items-center gap-1"><FeedbackIcon :icon="card.type.icon" class="size-3" />{{ card.type.label }}</span>
            <span v-for="label in card.labels || []" :key="label" class="inline-flex items-center gap-1 rounded-full bg-stone-100 px-1.5 py-px dark:bg-stone-800"><span class="size-1.5 rounded-full" :class="dot(labelFor(label)?.color)" />{{ labelFor(label)?.label || label }}</span>
          </span>
          <details v-if="card.posts.length > 1" class="mt-2 border-t border-default pt-1.5 text-xs">
            <summary class="cursor-pointer text-stone-500 hover:text-default">{{ card.posts.length }} requests</summary>
            <ul class="mt-1 space-y-0.5">
              <li v-for="post in card.posts" :key="post.id">
                <button type="button" class="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-elevated" @click="emit('open', post.id)">
                  <span class="w-7 shrink-0 font-semibold tabular-nums text-stone-500">{{ post.voteCount }}</span>
                  <span class="min-w-0 flex-1 truncate">{{ post.title }}</span>
                </button>
              </li>
            </ul>
          </details>
        </component>
      </div>
    </section>
  </div>

  <!-- List: compact rows under status headings -->
  <div v-else class="space-y-6">
    <section v-for="group in groups.filter(g => g.items.length)" :key="group.key">
      <h2 class="mb-1.5 flex items-center gap-2">
        <FeedbackStatusBadge :status="group.status || statusFor(group.key)" />
        <span class="text-xs tabular-nums text-stone-500">{{ group.items.length }}</span>
      </h2>
      <ul class="divide-y divide-default rounded-xl border border-default bg-default">
        <li v-for="card in group.items" :key="card.id">
          <component :is="card.posts.length === 1 ? 'button' : 'div'" :type="card.posts.length === 1 ? 'button' : undefined" class="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px]" :class="card.posts.length === 1 ? 'transition-colors hover:bg-elevated/60' : ''" @click="card.posts.length === 1 && emit('open', card.posts[0]!.id)">
            <span class="inline-flex w-9 shrink-0 items-center gap-0.5 text-[11px] font-semibold tabular-nums text-stone-500"><UIcon name="i-lucide-chevron-up" class="size-3.5" />{{ card.voteCount }}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ card.title }}</span>
              <span v-if="card.description" class="block truncate text-xs text-stone-500 dark:text-stone-400">{{ plain(card.description) }}</span>
              <details v-if="card.posts.length > 1" class="text-xs" @click.stop>
                <summary class="cursor-pointer text-stone-500 hover:text-default">{{ card.posts.length }} requests</summary>
                <ul class="mt-1 space-y-0.5">
                  <li v-for="post in card.posts" :key="post.id">
                    <button type="button" class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-elevated" @click="emit('open', post.id)">
                      <span class="w-7 shrink-0 font-semibold tabular-nums text-stone-500">{{ post.voteCount }}</span>
                      <span class="min-w-0 flex-1 truncate">{{ post.title }}</span>
                    </button>
                  </li>
                </ul>
              </details>
            </span>
            <span v-for="label in card.labels || []" :key="label" class="hidden shrink-0 items-center gap-1 rounded-full bg-stone-100 px-1.5 py-px text-[11px] text-stone-500 sm:inline-flex dark:bg-stone-800"><span class="size-1.5 rounded-full" :class="dot(labelFor(label)?.color)" />{{ labelFor(label)?.label || label }}</span>
            <span v-if="card.type" class="hidden shrink-0 items-center gap-1 text-[11px] text-stone-500 sm:inline-flex"><FeedbackIcon :icon="card.type.icon" class="size-3" />{{ card.type.label }}</span>
            <span v-if="card.targetDate" class="shrink-0 text-[11px] tabular-nums text-stone-500">{{ dayLabel(card.targetDate) }}</span>
          </component>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { feedbackPlainText, type FeedbackColor, type FeedbackStatusDefinition, type FeedbackTagDefinition } from '#shared/feedback'
import type { BoardRoadmapLayout, RoadmapGroup } from '#shared/board'

/** What a roadmap card shows, whichever source it came from. `voteCount` is the live total. */
export type RoadmapCard = {
  id: string
  title: string
  /** Markdown; shown as clamped plain text. */
  description: string
  status: string
  voteCount: number
  /** The posts behind the card: one opens straight away, several list in a disclosure. */
  posts: { id: string, title: string, voteCount: number }[]
  labels?: string[]
  targetDate?: string | null
  /** Post-based cards show the post's type. */
  type?: { icon: string, label: string } | null
}

const props = defineProps<{ groups: RoadmapGroup<RoadmapCard>[], layout: BoardRoadmapLayout, statuses: FeedbackStatusDefinition[], labels?: FeedbackTagDefinition[] }>()
const emit = defineEmits<{ open: [postId: string] }>()

const cardCount = computed(() => props.groups.reduce((n, group) => n + group.items.length, 0))
const statusFor = (key: string): FeedbackStatusDefinition => props.statuses.find(s => s.key === key) || { key, label: key, category: 'planned', color: 'neutral' }
const labelFor = (key: string) => props.labels?.find(l => l.key === key)
const plain = (text: string) => feedbackPlainText(text, 400)
const hasMeta = (card: RoadmapCard) => Boolean(card.type || card.labels?.length || card.targetDate)
/** Target dates are calendar days at UTC midnight. */
const dayLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const DOTS: Record<string, string> = { neutral: 'bg-stone-400', primary: 'bg-primary-500', info: 'bg-sky-500', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-rose-500' }
const dot = (color?: FeedbackColor) => DOTS[color || 'neutral'] || DOTS.neutral
</script>
