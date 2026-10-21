<template>
  <section class="space-y-3">
    <div class="flex items-baseline justify-between gap-2">
      <div>
        <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pricing.features') }}</h3>
        <p class="mt-0.5 text-xs text-muted">{{ $t('projectTools.pricing.matrixHint') }}</p>
      </div>
      <span class="shrink-0 text-xs tabular-nums text-dimmed">{{ features.length }} / {{ PRICING_LIMITS.features }}</span>
    </div>

    <div class="overflow-x-auto rounded-xl border border-default">
      <table class="w-full min-w-[620px] text-[13px]">
        <thead>
          <tr class="border-b border-default bg-elevated/40 text-left text-xs text-muted">
            <th class="min-w-52 px-3 py-2 font-medium">{{ $t('projectTools.pricing.featureText') }}</th>
            <th v-for="plan in plans" :key="plan.id" class="w-32 px-2 py-2 text-center font-medium">{{ plan.name || plan.key }}</th>
            <th class="w-24" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in features" :key="row.id" class="border-b border-default last:border-0" :class="row.kind === 'heading' ? 'bg-elevated/30' : ''">
            <td class="px-3 py-2 align-top">
              <UInput v-model="row.text" :maxlength="PRICING_LIMITS.feature" :placeholder="row.kind === 'heading' ? $t('projectTools.pricing.headingText') : $t('projectTools.pricing.featureText')" size="sm" class="w-full" :class="row.kind === 'heading' ? 'font-semibold uppercase' : ''" />
              <UInput v-if="row.kind === 'feature'" v-model="row.hint" :maxlength="PRICING_LIMITS.hint" :placeholder="$t('projectTools.pricing.hintPlaceholder')" size="xs" variant="ghost" class="mt-1 w-full" />
            </td>
            <template v-if="row.kind === 'feature'">
              <td v-for="plan in plans" :key="plan.id" class="px-2 py-2 align-top">
                <div class="flex items-center justify-center gap-1.5">
                  <UCheckbox :model-value="cell(plan, row.id) !== false" :aria-label="$t('projectTools.pricing.includedIn', { feature: row.text || '—', plan: plan.name || plan.key })" @update:model-value="setIncluded(plan, row.id, !!$event)" />
                  <UInput :model-value="typeof cell(plan, row.id) === 'string' ? cell(plan, row.id) as string : ''" :maxlength="PRICING_LIMITS.cell" :placeholder="$t('projectTools.pricing.valuePlaceholder')" size="xs" class="w-20" :disabled="cell(plan, row.id) === false" :aria-label="$t('projectTools.pricing.valueFor', { feature: row.text || '—', plan: plan.name || plan.key })" @update:model-value="setValue(plan, row.id, String($event))" />
                </div>
              </td>
            </template>
            <td v-else :colspan="plans.length" />
            <td class="px-1 py-2 text-right align-top">
              <div class="inline-flex">
                <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="i === 0" :aria-label="$t('projectTools.pricing.moveUp')" @click="move(i, -1)" />
                <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" square :disabled="i === features.length - 1" :aria-label="$t('projectTools.pricing.moveDown')" @click="move(i, 1)" />
                <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.pricing.removeFeature')" @click="remove(i)" />
              </div>
            </td>
          </tr>
          <tr v-if="!features.length">
            <td :colspan="plans.length + 2" class="px-3 py-6 text-center text-xs text-muted">{{ $t('projectTools.pricing.noFeatures') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="flex flex-wrap gap-2">
      <UButton icon="i-lucide-plus" :label="$t('projectTools.pricing.addFeature')" color="neutral" variant="soft" size="sm" :disabled="features.length >= PRICING_LIMITS.features" @click="add('feature')" />
      <UButton icon="i-lucide-heading" :label="$t('projectTools.pricing.addHeading')" color="neutral" variant="ghost" size="sm" :disabled="features.length >= PRICING_LIMITS.features" @click="add('heading')" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { PRICING_LIMITS, newFeatureId, type PricingCell, type PricingFeature, type PricingPlan } from '#shared/pricing'

const features = defineModel<PricingFeature[]>('features', { required: true })
const plans = defineModel<PricingPlan[]>('plans', { required: true })

const cell = (plan: PricingPlan, id: string): PricingCell => plan.features[id] ?? false

function setIncluded(plan: PricingPlan, id: string, on: boolean) {
  if (on) plan.features[id] = plan.features[id] || true
  else delete plan.features[id]
}

// An emptied value still counts as included: unticking is how a plan leaves it out.
function setValue(plan: PricingPlan, id: string, value: string) {
  plan.features[id] = value.trim() ? value : true
}

function add(kind: PricingFeature['kind']) {
  features.value.push({ id: newFeatureId(), kind, text: '', hint: '' })
}

function move(index: number, by: number) {
  const [row] = features.value.splice(index, 1)
  features.value.splice(index + by, 0, row!)
}

function remove(index: number) {
  const [row] = features.value.splice(index, 1)
  for (const plan of plans.value) delete plan.features[row!.id]
}
</script>
