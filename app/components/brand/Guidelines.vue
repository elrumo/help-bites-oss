<template>
  <div class="space-y-3">
    <p class="text-[13px] text-muted">{{ $t('projectTools.brand.guidelines.intro') }}</p>
    <EmptyState v-if="!guidelines.length" icon="i-lucide-list-checks" :title="$t('projectTools.brand.guidelines.emptyTitle')" :description="$t('projectTools.brand.guidelines.emptyDescription')" class="rounded-xl border border-dashed border-default">
      <UButton icon="i-lucide-plus" :label="$t('projectTools.brand.guidelines.add')" @click="add" />
    </EmptyState>
    <div v-for="(item, i) in guidelines" :key="item.id || i" class="rounded-xl border border-default p-4">
      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="item.title" :maxlength="BRAND_LIMITS.title" :placeholder="$t('projectTools.brand.guidelines.titlePlaceholder')" class="min-w-0 flex-1 basis-40 font-medium" :aria-label="$t('projectTools.brand.guidelines.titleOf', { n: i + 1 })" />
        <UButton icon="i-lucide-arrow-up" size="sm" color="neutral" variant="ghost" square :disabled="i === 0" :aria-label="$t('projectTools.brand.moveUp')" @click="move(i, -1)" />
        <UButton icon="i-lucide-arrow-down" size="sm" color="neutral" variant="ghost" square :disabled="i === guidelines.length - 1" :aria-label="$t('projectTools.brand.moveDown')" @click="move(i, 1)" />
        <UButton icon="i-lucide-trash-2" size="sm" color="neutral" variant="ghost" square :aria-label="$t('projectTools.brand.remove')" @click="guidelines.splice(i, 1)" />
      </div>
      <UTextarea v-model="item.body" :maxlength="BRAND_LIMITS.body" autoresize :rows="3" :maxrows="20" :placeholder="$t('projectTools.brand.guidelines.bodyPlaceholder')" class="mt-3 w-full font-mono text-[13px]" :aria-label="$t('projectTools.brand.guidelines.bodyOf', { n: i + 1 })" />
    </div>
    <UButton v-if="guidelines.length" icon="i-lucide-plus" :label="$t('projectTools.brand.guidelines.add')" color="neutral" variant="soft" size="sm" :disabled="guidelines.length >= BRAND_LIMITS.guidelines" @click="add" />
  </div>
</template>

<script setup lang="ts">
import { BRAND_LIMITS, newGuidelineId, type BrandGuideline } from '#shared/brand'

const guidelines = defineModel<BrandGuideline[]>({ required: true })

function add() {
  guidelines.value.push({ id: newGuidelineId(), title: '', body: '' })
}

function move(index: number, by: number) {
  const [item] = guidelines.value.splice(index, 1)
  guidelines.value.splice(index + by, 0, item!)
}
</script>
