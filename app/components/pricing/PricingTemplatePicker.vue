<template>
  <div class="grid gap-2 sm:grid-cols-5" role="radiogroup" :aria-label="$t('projectTools.pricing.template')">
    <button
      v-for="item in PRICING_TEMPLATES" :key="item" type="button" role="radio" :aria-checked="model === item"
      class="flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors"
      :class="model === item ? 'border-primary bg-primary/5' : 'border-default hover:border-accented'"
      @click="model = item"
    >
      <!-- A sketch of the layout, not a picture of the table. -->
      <svg viewBox="0 0 60 36" class="h-9 w-full text-muted" aria-hidden="true">
        <g v-if="item === 'tiers'" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="3" y="7" width="16" height="26" rx="2" /><rect x="22" y="4" width="16" height="29" rx="2" class="text-primary" stroke="currentColor" /><rect x="41" y="7" width="16" height="26" rx="2" />
        </g>
        <g v-else-if="item === 'rows'" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="4" y="5" width="52" height="8" rx="2" /><rect x="4" y="15" width="52" height="8" rx="2" class="text-primary" stroke="currentColor" /><rect x="4" y="25" width="52" height="8" rx="2" />
        </g>
        <g v-else-if="item === 'paywall'" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="18" y="2" width="24" height="32" rx="3" /><path d="M22 8h12M22 11h9" /><rect x="21" y="15" width="18" height="5" rx="1.5" class="text-primary" stroke="currentColor" /><rect x="21" y="22" width="18" height="5" rx="1.5" /><rect x="21" y="29" width="18" height="3" rx="1.5" fill="currentColor" />
        </g>
        <g v-else-if="item === 'matrix'" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="3" y="4" width="54" height="29" rx="2" /><path d="M3 12h54M3 19h54M3 26h54M21 4v29M33 4v29M45 4v29" />
        </g>
        <g v-else fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="4" y="6" width="52" height="25" rx="3" class="text-primary" stroke="currentColor" /><path d="M9 12h14M9 16h20M9 20h17" /><rect x="35" y="11" width="16" height="15" rx="2" />
        </g>
      </svg>
      <span class="text-xs font-medium text-highlighted">{{ $t(`projectTools.pricing.templates.${item}.label`) }}</span>
      <span class="text-[11px] leading-snug text-muted">{{ $t(`projectTools.pricing.templates.${item}.hint`) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { PRICING_TEMPLATES, type PricingTemplate } from '#shared/pricing'

const model = defineModel<PricingTemplate>({ required: true })
</script>
