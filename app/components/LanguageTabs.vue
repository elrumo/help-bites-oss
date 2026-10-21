<template>
  <section class="rounded-xl border border-default p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('translations.title') }}</h3>
      <USelect :model-value="source" :items="sourceItems" size="xs" class="w-44" :aria-label="$t('translations.writtenIn')" @update:model-value="emit('update:source', $event as string)" />
      <UButton v-if="languages.length" icon="i-lucide-sparkles" :label="$t('translations.translate')" size="xs" color="neutral" variant="soft" :loading="busy" :disabled="busy || !missing" @click="emit('translate', languages.map(l => l.locale), false)" />
    </div>
    <p class="mt-1 text-xs text-dimmed">{{ $t('translations.intro', { language: localeName(source, uiLocale) }) }}</p>

    <div class="mt-3 flex flex-wrap items-center gap-1.5" role="tablist">
      <button type="button" role="tab" :aria-selected="!active" class="h-7 rounded-md px-2.5 text-xs font-medium transition-colors" :class="!active ? 'bg-elevated text-highlighted' : 'text-muted hover:text-default'" @click="emit('select', '')">
        {{ localeName(source, uiLocale) }} <span class="text-dimmed">· {{ $t('translations.original') }}</span>
      </button>
      <div v-for="lang in languages" :key="lang.locale" class="inline-flex items-center rounded-md" :class="active === lang.locale ? 'bg-elevated' : ''">
        <button type="button" role="tab" :aria-selected="active === lang.locale" class="h-7 rounded-l-md pl-2.5 pr-1.5 text-xs font-medium transition-colors" :class="active === lang.locale ? 'text-highlighted' : 'text-muted hover:text-default'" @click="emit('select', lang.locale)">
          {{ localeName(lang.locale, uiLocale) }}
          <span class="tabular-nums" :class="lang.filled >= lang.total ? 'text-success' : 'text-dimmed'">{{ lang.filled }}/{{ lang.total }}</span>
        </button>
        <UDropdownMenu :items="menuFor(lang.locale)">
          <UButton icon="i-lucide-ellipsis" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.shared.more')" />
        </UDropdownMenu>
      </div>

      <USelectMenu v-if="addable.length" :model-value="undefined" :items="addable" value-key="value" :placeholder="$t('translations.add')" create-item="always" size="xs" class="w-44" @update:model-value="add($event as string)" @create="add($event)">
        <template #create-item-label="{ item }">{{ $t('translations.addTag', { tag: item }) }}</template>
      </USelectMenu>
    </div>
    <p v-if="error" class="mt-2 text-[13px] text-error">{{ error }}</p>
    <p v-if="active" class="mt-3 text-xs text-muted">{{ $t('translations.editing', { language: localeName(active, uiLocale), original: localeName(source, uiLocale) }) }}</p>
  </section>
</template>

<script setup lang="ts">
import { COMMON_LOCALES, localeName, normalizeLocale } from '#shared/locales'

// The language bar of anything with translations (onboarding, emails): the language it
// is written in, a tab per translation with how much of it is filled, and the AI action.
// The page owns the data and the saving; this only says what was asked.

const props = defineProps<{
  source: string
  /** The translations that exist, with how many of `total` strings each has. */
  languages: { locale: string, filled: number, total: number }[]
  /** The language being edited; '' is the original. */
  active: string
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{
  'update:source': [locale: string]
  select: [locale: string]
  add: [locale: string]
  remove: [locale: string]
  translate: [locales: string[], overwrite: boolean]
}>()

const { t, locale: uiLocale } = useI18n()
const toast = useToast()

const missing = computed(() => props.languages.some(l => l.filled < l.total))
const addable = computed(() => COMMON_LOCALES
  .filter(tag => tag.toLowerCase() !== props.source.toLowerCase() && !props.languages.some(l => l.locale.toLowerCase() === tag.toLowerCase()))
  .map(value => ({ value, label: `${localeName(value, uiLocale.value)} · ${value}` })))

// The language the original is written in: the common ones, plus whatever it is now.
const sourceItems = computed(() => [...new Set([props.source, ...COMMON_LOCALES])].map(value => ({ value, label: `${t('translations.writtenIn')}: ${localeName(value, uiLocale.value)}` })))

function add(tag: string) {
  const locale = normalizeLocale(tag)
  if (!locale) return toast.add({ title: t('translations.badTag'), color: 'error', icon: 'i-lucide-circle-alert' })
  if (locale.toLowerCase() === props.source.toLowerCase() || props.languages.some(l => l.locale.toLowerCase() === locale.toLowerCase())) return
  emit('add', locale)
}

const menuFor = (locale: string) => [[
  { label: t('translations.retranslate'), icon: 'i-lucide-sparkles', disabled: props.busy, onSelect: () => emit('translate', [locale], true) },
  { label: t('translations.remove'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => emit('remove', locale) }
]]
</script>
