<template>
  <div class="space-y-6">
    <section class="space-y-4 rounded-xl border border-default p-4">
      <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.brand.style.words') }}</h3>
      <UFormField :label="$t('projectTools.brand.style.tagline')" :hint="`${config.tagline.length} / ${BRAND_LIMITS.tagline}`">
        <UInput v-model="config.tagline" :maxlength="BRAND_LIMITS.tagline" :placeholder="$t('projectTools.brand.style.taglinePlaceholder')" class="w-full" />
      </UFormField>
      <UFormField :label="$t('projectTools.brand.style.about')" :hint="$t('projectTools.brand.style.aboutHint')">
        <UTextarea v-model="config.about" :maxlength="BRAND_LIMITS.about" autoresize :rows="3" :maxrows="12" class="w-full" />
      </UFormField>
    </section>

    <section class="rounded-xl border border-default p-4">
      <div class="flex items-baseline justify-between">
        <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.brand.style.colours') }}</h3>
        <span class="text-xs tabular-nums text-dimmed">{{ config.colors.length }} / {{ BRAND_LIMITS.colors }}</span>
      </div>
      <p v-if="!config.colors.length" class="mt-2 text-[13px] text-muted">{{ $t('projectTools.brand.style.noColours') }}</p>
      <ul class="mt-3 space-y-2">
        <li v-for="(colour, i) in config.colors" :key="i" class="flex flex-wrap items-center gap-2">
          <input type="color" :value="validHex(colour.hex) ? colour.hex : '#000000'" class="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-default bg-transparent" :aria-label="$t('projectTools.brand.style.colourN', { n: i + 1 })" @input="colour.hex = ($event.target as HTMLInputElement).value">
          <UInput v-model="colour.name" :maxlength="BRAND_LIMITS.name" :placeholder="$t('projectTools.brand.style.colourName')" class="min-w-0 flex-1 basis-32" />
          <UInput v-model="colour.hex" placeholder="#000000" class="w-28 font-mono" :color="validHex(colour.hex) ? undefined : 'error'" :aria-label="$t('projectTools.brand.style.hex')" />
          <UInput v-model="colour.usage" :maxlength="BRAND_LIMITS.usage" :placeholder="$t('projectTools.brand.style.usage')" class="min-w-0 flex-[2] basis-48" />
          <div class="flex">
            <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="i === 0" :aria-label="$t('projectTools.brand.moveUp')" @click="move(config.colors, i, -1)" />
            <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" square :disabled="i === config.colors.length - 1" :aria-label="$t('projectTools.brand.moveDown')" @click="move(config.colors, i, 1)" />
            <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.brand.remove')" @click="config.colors.splice(i, 1)" />
          </div>
        </li>
      </ul>
      <UButton icon="i-lucide-plus" :label="$t('projectTools.brand.style.addColour')" size="sm" color="neutral" variant="soft" class="mt-3" :disabled="config.colors.length >= BRAND_LIMITS.colors" @click="config.colors.push({ name: '', hex: '#000000', usage: '' })" />
    </section>

    <section class="rounded-xl border border-default p-4">
      <div class="flex items-baseline justify-between">
        <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.brand.style.fonts') }}</h3>
        <span class="text-xs tabular-nums text-dimmed">{{ config.fonts.length }} / {{ BRAND_LIMITS.fonts }}</span>
      </div>
      <p class="mt-1 text-[13px] text-muted">{{ $t('projectTools.brand.style.fontsHint') }}</p>
      <div class="mt-3 space-y-3">
        <div v-for="(font, i) in config.fonts" :key="i" class="rounded-lg border border-default p-3">
          <div class="flex flex-wrap items-center gap-2">
            <UInput v-model="font.name" :maxlength="BRAND_LIMITS.name" :placeholder="$t('projectTools.brand.style.fontName')" class="min-w-0 flex-1 basis-40 font-medium" />
            <USelect v-model="font.role" :items="roleItems" class="w-40" :aria-label="$t('projectTools.brand.style.role')" />
            <UInput v-model="font.weights" :maxlength="BRAND_LIMITS.weights" :placeholder="$t('projectTools.brand.style.weights')" class="w-36" />
            <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.brand.remove')" @click="config.fonts.splice(i, 1)" />
          </div>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            <UFormField :label="$t('projectTools.brand.style.cssUrl')" :hint="$t('projectTools.brand.style.cssUrlHint')" :error="font.cssUrl && !googleFontsCssUrl(font.cssUrl) ? $t('projectTools.brand.style.cssUrlInvalid') : undefined">
              <UInput v-model="font.cssUrl" placeholder="https://fonts.googleapis.com/css2?family=…" class="w-full font-mono" size="sm" />
            </UFormField>
            <UFormField :label="$t('projectTools.brand.style.downloadUrl')">
              <UInput v-model="font.downloadUrl" placeholder="https://" class="w-full font-mono" size="sm" />
            </UFormField>
          </div>
          <UFormField :label="$t('projectTools.brand.style.sample')" class="mt-2">
            <UInput v-model="font.sample" :maxlength="BRAND_LIMITS.sample" :placeholder="$t('projectTools.brand.style.samplePlaceholder')" class="w-full" size="sm" />
          </UFormField>
        </div>
      </div>
      <UButton icon="i-lucide-plus" :label="$t('projectTools.brand.style.addFont')" size="sm" color="neutral" variant="soft" class="mt-3" :disabled="config.fonts.length >= BRAND_LIMITS.fonts" @click="addFont" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { BRAND_FONT_ROLES, BRAND_LIMITS, googleFontsCssUrl, type BrandConfig } from '#shared/brand'

const config = defineModel<BrandConfig>({ required: true })
const { t } = useI18n()

const validHex = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex)
const roleItems = computed(() => BRAND_FONT_ROLES.map(value => ({ value, label: t(`projectTools.brand.roles.${value}`) })))

function move<T>(list: T[], index: number, by: number) {
  const [item] = list.splice(index, 1)
  list.splice(index + by, 0, item!)
}

function addFont() {
  const role = config.value.fonts.some(f => f.role === 'display') ? 'body' : 'display'
  config.value.fonts.push({ name: '', role, cssUrl: '', downloadUrl: '', weights: '', sample: '' })
}
</script>
