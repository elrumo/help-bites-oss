<template>
  <div v-if="locked(feature)" class="flex shrink-0 items-center gap-2 text-xs text-muted" :class="inline ? 'rounded-lg border border-default bg-elevated px-3 py-2' : 'border-b border-default bg-elevated px-4 py-1.5'">
    <UIcon name="i-lucide-lock" class="size-3.5 shrink-0" />
    <span class="min-w-0 flex-1">{{ $t('workspaceSettings.planLock.notInPlan', { feature: FEATURE_LABELS[feature!], plan: context?.plan.name || '' }) }}</span>
    <button v-if="upgrade" type="button" class="shrink-0 font-medium text-default hover:text-highlighted" @click="upgrade()">{{ $t('workspaceSettings.upgrade') }}</button>
  </div>
</template>

<script setup lang="ts">
import { FEATURE_LABELS, type Feature } from '#shared/entitlements'

// A strip under a page's header (or, `inline`, a note inside a section) when
// the plan leaves its feature out. What is already there stays usable to look
// at; the server refuses anything new with a 402 either way.
defineProps<{ feature: Feature | null | undefined, inline?: boolean }>()

const { context } = useAgent()
const { locked } = usePlanLocks()
const { upgrade } = editionUi()
</script>
