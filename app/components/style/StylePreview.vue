<template>
  <div class="grid gap-3 sm:grid-cols-2" aria-hidden="true">
    <div v-for="mode in MODES" :key="mode" class="p-4" :style="[styleVars(style, mode), frame]">
      <div class="p-3" :style="card">
        <div class="flex items-center gap-2">
          <img v-if="mode === 'dark' ? style.logoDarkUrl : style.logoUrl" :src="mode === 'dark' ? style.logoDarkUrl : style.logoUrl" alt="" class="size-6 object-contain">
          <span class="rounded-full px-1.5 py-px text-[10px] font-semibold" style="background: var(--hb-accent); color: var(--hb-accent-text)">{{ $t('style.previewTag') }}</span>
        </div>
        <p class="mt-2 text-sm font-semibold">{{ $t('style.previewTitle') }}</p>
        <p class="text-xs" style="color: var(--hb-muted)">{{ $t('style.previewBody') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { styleVars, type ResolvedStyle } from '#shared/projectStyle'

// A resolved style drawn once in light and once in dark: a tag, a title and a line of text on a card.
defineProps<{ style: ResolvedStyle }>()

const MODES = ['light', 'dark'] as const
const frame = { background: 'var(--hb-bg)', color: 'var(--hb-text)', fontFamily: 'var(--hb-font)', border: '1px solid var(--hb-border)', borderRadius: 'var(--hb-radius)' }
const card = { background: 'var(--hb-surface)', border: '1px solid var(--hb-border)', borderRadius: 'var(--hb-radius)', boxShadow: 'var(--hb-shadow)' }
</script>
