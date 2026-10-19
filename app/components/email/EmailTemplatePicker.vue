<script setup lang="ts">
import type { EmailDocument } from '#shared/email/blocks'
import {
  cloneBlankEmailDocument,
  cloneEmailTemplateDocument,
  EMAIL_TEMPLATES,
  type EmailTemplateDefinition,
  type EmailTemplateStyle,
  type EmailTemplateType
} from '#shared/email/templates'

const props = withDefaults(defineProps<{
  open: boolean
  busy?: boolean
  title?: string
  description?: string
  showBlank?: boolean
}>(), {
  title: 'Choose an email template',
  description: 'Start from a ready-made structure, then customize every block.',
  showBlank: true
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'select', payload: { template: EmailTemplateDefinition, document: EmailDocument }): void
  (e: 'blank', document: EmailDocument): void
}>()

type TypeFilter = 'All' | EmailTemplateType
type StyleFilter = 'All' | EmailTemplateStyle

const selectedType = ref<TypeFilter>('All')
const selectedStyle = ref<StyleFilter>('All')

const typeFilters = computed<TypeFilter[]>(() => [
  'All',
  ...Array.from(new Set(EMAIL_TEMPLATES.map(t => t.type)))
])
const styleFilters = computed<StyleFilter[]>(() => [
  'All',
  ...Array.from(new Set(EMAIL_TEMPLATES.map(t => t.style)))
])

const filteredTemplates = computed(() => EMAIL_TEMPLATES.filter((template) => {
  const typeMatches = selectedType.value === 'All' || template.type === selectedType.value
  const styleMatches = selectedStyle.value === 'All' || template.style === selectedStyle.value
  return typeMatches && styleMatches
}))

function choose(template: EmailTemplateDefinition) {
  const document = cloneEmailTemplateDocument(template.id)
  if (!document) return
  emit('select', { template, document })
}

function chooseBlank() {
  emit('blank', cloneBlankEmailDocument())
}
</script>

<template>
  <UModal
    :open="open"
    :title="props.title"
    :description="props.description"
    @update:open="(value: boolean) => emit('update:open', value)"
  >
    <template #body>
      <div class="space-y-5">
        <div class="space-y-3">
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="type in typeFilters"
              :key="type"
              :label="type"
              size="xs"
              :color="selectedType === type ? 'primary' : 'neutral'"
              :variant="selectedType === type ? 'soft' : 'outline'"
              @click="selectedType = type"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="style in styleFilters"
              :key="style"
              :label="style"
              size="xs"
              :color="selectedStyle === style ? 'primary' : 'neutral'"
              :variant="selectedStyle === style ? 'soft' : 'outline'"
              @click="selectedStyle = style"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            v-for="template in filteredTemplates"
            :key="template.id"
            type="button"
            class="group overflow-hidden rounded-lg border border-default bg-default text-left transition hover:border-primary/50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :disabled="busy"
            @click="choose(template)"
          >
            <div
              class="h-28 p-3"
              :style="{ backgroundColor: template.document.settings.backgroundColor }"
            >
              <div
                class="mx-auto h-full max-w-[180px] rounded-md p-3 shadow-sm ring-1 ring-black/5 overflow-hidden"
                :style="{ backgroundColor: template.document.settings.contentBackground }"
              >
                <div
                  class="mb-2 h-2 w-14 rounded"
                  :style="{ backgroundColor: template.accent }"
                />
                <div class="mb-1 h-3 w-24 rounded bg-neutral-300/70" />
                <div class="mb-3 h-3 w-32 rounded bg-neutral-200/80" />
                <div class="grid grid-cols-2 gap-2">
                  <div class="h-8 rounded bg-neutral-200/70" />
                  <div class="h-8 rounded bg-neutral-200/70" />
                </div>
              </div>
            </div>
            <div class="space-y-3 p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="template.icon"
                      class="size-4 shrink-0"
                      :style="{ color: template.accent }"
                    />
                    <h3 class="truncate text-sm font-semibold text-highlighted">
                      {{ template.name }}
                    </h3>
                  </div>
                  <p class="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted">
                    {{ template.description }}
                  </p>
                </div>
              </div>
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 flex-wrap gap-1.5">
                  <UBadge
                    :label="template.type"
                    color="neutral"
                    variant="soft"
                    size="sm"
                  />
                  <UBadge
                    :label="template.style"
                    color="neutral"
                    variant="outline"
                    size="sm"
                  />
                </div>
                <UIcon
                  name="i-lucide-arrow-right"
                  class="size-4 shrink-0 text-dimmed transition group-hover:translate-x-0.5 group-hover:text-primary"
                />
              </div>
            </div>
          </button>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-between gap-2">
        <UButton
          v-if="showBlank"
          label="Start blank"
          icon="i-lucide-file"
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="chooseBlank"
        />
        <span v-else />
        <UButton
          label="Close"
          color="neutral"
          variant="ghost"
          @click="emit('update:open', false)"
        />
      </div>
    </template>
  </UModal>
</template>
