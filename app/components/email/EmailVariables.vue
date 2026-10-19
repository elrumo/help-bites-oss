<script setup lang="ts">
/**
 * Template variables panel. Mustache placeholders ({{ key }}) are detected from
 * the document; here the user gives each a friendly label and a default/sample
 * value (used for previews and as the API fallback). Defaults are merged into
 * the live document for an accurate preview without mutating the saved copy.
 */
import type { EmailDocument } from '#shared/email/blocks'
import { extractTemplateVariables } from '#shared/email/placeholders'
import type { TemplateVariable } from '#shared/email/resolve'

const props = defineProps<{
  document: EmailDocument
  variables: TemplateVariable[]
}>()

const emit = defineEmits<{
  (e: 'update:variables', value: TemplateVariable[]): void
}>()

// Keys actually present in the document right now.
const detected = computed(() => extractTemplateVariables(props.document))

// Merge detected keys with stored metadata so newly-typed placeholders appear.
const rows = computed<TemplateVariable[]>(() => {
  const byKey = new Map(props.variables.map(v => [v.key, v]))
  return detected.value.map(key => byKey.get(key) ?? { key })
})

function update(key: string, field: 'label' | 'defaultValue', value: string) {
  const next = rows.value.map(v => v.key === key ? { ...v, [field]: value } : { ...v })
  emit('update:variables', next)
}

// Literal mustache braces can't live inside Vue template interpolation, so build
// the example strings here.
const exampleVar = '{{ firstName }}'
const examplePlaceholder = '{{ placeholder }}'
function wrap(key: string) {
  return `{{ ${key} }}`
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-2 border-b border-default px-4 py-3">
      <UIcon name="i-lucide-braces" class="size-4 text-primary" />
      <span class="text-sm font-semibold text-highlighted">{{ $t('emailLibrary.variables.title') }}</span>
    </div>

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <i18n-t keypath="emailLibrary.variables.intro" tag="p" class="text-xs text-muted leading-relaxed">
        <template #example><code class="rounded bg-elevated px-1 py-0.5">{{ exampleVar }}</code></template>
      </i18n-t>

      <div v-if="!rows.length" class="rounded-lg border border-dashed border-default p-6 text-center">
        <UIcon name="i-lucide-braces" class="size-6 mx-auto text-dimmed" />
        <i18n-t keypath="emailLibrary.variables.none" tag="p" class="mt-2 text-xs text-muted">
          <template #placeholder><code>{{ examplePlaceholder }}</code></template>
        </i18n-t>
      </div>

      <div v-for="v in rows" :key="v.key" class="rounded-lg border border-default p-3 space-y-2.5">
        <div class="flex items-center gap-2">
          <code class="text-xs font-medium text-primary">{{ wrap(v.key) }}</code>
        </div>
        <UFormField :label="$t('emailLibrary.variables.label')" size="xs">
          <UInput
            :model-value="v.label ?? ''"
            :placeholder="$t('emailLibrary.variables.labelPlaceholder')"
            size="sm"
            class="w-full"
            @update:model-value="update(v.key, 'label', String($event))"
          />
        </UFormField>
        <UFormField :label="$t('emailLibrary.variables.sampleValue')" size="xs">
          <UInput
            :model-value="v.defaultValue ?? ''"
            placeholder="Ada"
            size="sm"
            class="w-full"
            @update:model-value="update(v.key, 'defaultValue', String($event))"
          />
        </UFormField>
      </div>
    </div>
  </div>
</template>
