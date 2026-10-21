<template>
  <div class="space-y-5">
    <div class="space-y-3">
      <USwitch v-model="model.enabled" :label="$t('projectPages.settings.hubEnabled')" :description="$t('projectPages.settings.hubEnabledHint')" />
      <div v-if="model.enabled" class="flex items-center gap-1 rounded-lg bg-elevated px-3 py-1.5">
        <code class="min-w-0 flex-1 truncate font-mono text-xs text-default">{{ hubUrl }}</code>
        <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectPages.settings.hubCopy')" @click="copy(hubUrl)" />
        <UButton icon="i-lucide-external-link" size="xs" color="neutral" variant="ghost" square :to="hubUrl" target="_blank" :aria-label="$t('projectPages.settings.hubOpen')" />
      </div>
      <p v-if="model.enabled" class="text-xs text-muted">{{ $t('projectPages.settings.hubSavedNote') }}</p>
    </div>

    <template v-if="model.enabled">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="$t('projectPages.settings.hubTitle')" :hint="$t('projectPages.settings.hubTitleHint')"><UInput v-model="model.title" :placeholder="projectName" class="w-full" maxlength="80" /></UFormField>
        <UFormField :label="$t('projectPages.settings.hubTagline')" :hint="$t('projectPages.settings.hubTaglineHint')"><UInput v-model="model.tagline" class="w-full" maxlength="200" /></UFormField>
      </div>

      <div class="space-y-2">
        <p class="text-[13px] font-medium text-highlighted">{{ $t('projectPages.settings.hubSections') }}</p>
        <p class="text-xs text-muted">{{ $t('projectPages.settings.hubSectionsHint') }}</p>
        <ul class="divide-y divide-default overflow-hidden rounded-lg border border-default">
          <li v-for="row in sectionRows" :key="row.key" class="flex items-center gap-2 px-3 py-1.5">
            <UCheckbox :model-value="row.on" :label="$t(`projectPages.settings.hubSection.${row.key}`)" class="flex-1" @update:model-value="toggleSection(row.key, $event === true)" />
            <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="!row.on || row.index === 0" :aria-label="$t('projectPages.settings.hubMoveUp')" @click="move(row.index, -1)" />
            <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" square :disabled="!row.on || row.index === model.sections.length - 1" :aria-label="$t('projectPages.settings.hubMoveDown')" @click="move(row.index, 1)" />
          </li>
        </ul>
      </div>

      <div class="space-y-2">
        <p class="text-[13px] font-medium text-highlighted">{{ $t('projectPages.settings.hubLinks') }}</p>
        <div v-for="(link, index) in model.links" :key="index" class="flex items-center gap-2">
          <UInput v-model="link.label" :placeholder="$t('projectPages.settings.hubLinkLabel')" class="w-40" maxlength="60" :aria-label="$t('projectPages.settings.hubLinkLabel')" />
          <UInput v-model="link.url" placeholder="https://" class="min-w-0 flex-1" maxlength="500" :aria-label="$t('projectPages.settings.hubLinkUrl')" />
          <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectPages.settings.remove')" @click="model.links.splice(index, 1)" />
        </div>
        <UButton v-if="model.links.length < HUB_LIMITS.links" size="xs" color="neutral" variant="outline" icon="i-lucide-plus" :label="$t('projectPages.settings.hubAddLink')" @click="model.links.push({ label: '', url: '' })" />
      </div>
    </template>

    <div class="space-y-3 border-t border-default pt-5">
      <USwitch v-model="model.widgetHome.enabled" :label="$t('projectPages.settings.hubWidgetHome')" :description="$t('projectPages.settings.hubWidgetHomeHint')" />
      <div v-if="model.widgetHome.enabled" class="space-y-2 pl-1">
        <UCheckbox
          v-for="section in HUB_HOME_SECTIONS"
          :key="section"
          :model-value="model.widgetHome.sections.includes(section)"
          :label="$t(`projectPages.settings.hubHome.${section}`)"
          @update:model-value="toggleHome(section, $event === true)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { HUB_HOME_SECTIONS, HUB_LIMITS, HUB_SECTIONS, type HubConfig, type HubHomeSection, type HubSection } from '#shared/hub'

// The project's public hub and the chat widget's Home tab (shared/hub.ts). The
// Settings page owns the form and saves it; this edits it in place.
const model = defineModel<HubConfig>({ required: true })
const props = defineProps<{ publicKey: string, projectName: string }>()

const { t } = useI18n()
const appUrl = useAppUrl()
const hubUrl = computed(() => `${appUrl.value}/hub/${props.publicKey}`)

// Listed sections first, in their order, then the ones left out.
const sectionRows = computed(() => [
  ...model.value.sections.map((key, index) => ({ key, on: true, index })),
  ...HUB_SECTIONS.filter(key => !model.value.sections.includes(key)).map(key => ({ key, on: false, index: -1 }))
])

function toggleSection(key: HubSection, on: boolean) {
  model.value.sections = on ? [...model.value.sections.filter(k => k !== key), key] : model.value.sections.filter(k => k !== key)
}

function move(index: number, by: number) {
  const list = [...model.value.sections]
  const to = index + by
  if (to < 0 || to >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(to, 0, item!)
  model.value.sections = list
}

function toggleHome(key: HubHomeSection, on: boolean) {
  const kept = model.value.widgetHome.sections.filter(k => k !== key)
  // Keep the canonical order whatever order they were ticked in.
  model.value.widgetHome.sections = HUB_HOME_SECTIONS.filter(k => (k === key ? on : kept.includes(k)))
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    useToast().add({ title: t('projectPages.settings.hubCopied'), icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {}
}
</script>
