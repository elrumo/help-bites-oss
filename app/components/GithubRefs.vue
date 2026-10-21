<template>
  <!-- Commits pushed to the default branch and pull requests merged into it that mention this item as #N. -->
  <section v-if="refs.length" class="space-y-2">
    <h3 v-if="heading" class="text-sm font-semibold">{{ heading }} <span class="font-normal text-muted">{{ refs.length }}</span></h3>
    <ul class="divide-y divide-default rounded-lg border border-default">
      <li v-for="ref in refs" :key="ref.id" class="flex items-center gap-2.5 px-2.5 py-2 text-[13px]">
        <UIcon :name="ref.kind === 'pull_request' ? 'i-lucide-git-pull-request' : 'i-lucide-git-commit-horizontal'" class="size-3.5 shrink-0 text-muted" :aria-label="ref.kind === 'pull_request' ? $t('github.pullRequest') : $t('github.commit')" />
        <component :is="ref.url ? 'a' : 'span'" v-bind="ref.url ? { href: ref.url, target: '_blank', rel: 'noopener' } : {}" class="min-w-0 flex-1 truncate" :class="ref.url ? 'hover:underline' : ''">
          <span class="mr-1 tabular-nums text-muted">{{ label(ref) }}</span>{{ ref.title }}
        </component>
        <span v-if="ref.closes" class="shrink-0 rounded-full bg-success/10 px-1.5 text-[11px] text-success" :title="$t('github.closesTitle')">{{ $t('github.closes') }}</span>
        <span class="shrink-0 text-xs text-muted">{{ ref.repo }}</span>
        <time v-if="ref.at" class="shrink-0 text-xs tabular-nums text-muted" :datetime="ref.at">{{ new Date(ref.at).toLocaleDateString() }}</time>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { GithubRefLink } from '#shared/githubRefs'

// Used by the board item editor and the feedback post editor. Empty (and
// invisible) until GitHub has told HelpBites about a commit or merge that
// names the item; docs/GITHUB.md says how.

const props = defineProps<{ projectId: string, kind: 'board' | 'feedback', targetId: string, heading?: string }>()

const { api } = useAgent()

const refs = ref<GithubRefLink[]>([])
const label = (ref: GithubRefLink) => (ref.kind === 'pull_request' ? `#${ref.ref}` : ref.ref.slice(0, 7))

async function load() {
  if (!props.targetId) { refs.value = []; return }
  const wanted = props.targetId
  try {
    const found = (await api<{ refs: GithubRefLink[] }>('/admin/github-refs', { query: { project: props.projectId, kind: props.kind, id: wanted } })).refs
    if (props.targetId === wanted) refs.value = found
  } catch {
    // Nothing to show is the same as nothing linked.
    if (props.targetId === wanted) refs.value = []
  }
}

watch(() => props.targetId, load, { immediate: true })
</script>
