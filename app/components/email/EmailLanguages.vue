<script setup lang="ts">
/**
 * The email's languages: the one the design is written in, a translation per other
 * language (a flat map of the design's words, shared/email/translate.ts), and the AI
 * that fills them. Translations are saved on their own, apart from the design's
 * autosave; the send API picks one with `locale`. A linked template has none of its
 * own: it sends the master's.
 */
import type { EmailDocument } from '#shared/email/blocks'
import { emailTexts } from '#shared/email/translate'
import { localeName } from '#shared/locales'
import { useDebounceFn } from '@vueuse/core'
import type { EmailTemplate } from '~~/server/utils/emails'

const props = defineProps<{
  template: EmailTemplate
  document: EmailDocument
  /** Saves the design first, so the AI translates what is on screen. */
  flush: () => Promise<unknown>
}>()

const { api } = useAgent()
const { t, locale: uiLocale } = useI18n()
const toast = useToast()

const source = ref(props.template.locale)
const translations = ref<Record<string, Record<string, string>>>(JSON.parse(JSON.stringify(props.template.translations || {})))
const active = ref('')
const busy = ref('')
const error = ref('')

const texts = computed(() => emailTexts(props.document))
const keys = computed(() => Object.keys(texts.value))
const languages = computed(() => Object.entries(translations.value).map(([locale, strings]) => ({ locale, filled: keys.value.filter(k => strings[k]).length, total: keys.value.length })))

const FIELD_KIND: Record<string, string> = { text: 'heading', html: 'body', label: 'button', alt: 'imageAlt' }

/** What a key is, for the person reading it: the subject, a heading, a button label… */
function kindOf(key: string): string {
  if (key === 'subject' || key === 'preheader') return t(`translations.email.${key}`)
  if (key === 'text') return t('translations.email.plainText')
  const field = key.split('#')[1] || ''
  return field.startsWith('values.') ? t('translations.email.component', { field: field.slice(7) }) : t(`translations.email.${FIELD_KIND[field] || 'body'}`)
}

const patch = (body: Record<string, unknown>) => api<{ template: EmailTemplate }>(`/admin/emails/${props.template.id}`, { method: 'PATCH', body })

async function run(name: string, fn: () => Promise<void>) {
  busy.value = name
  error.value = ''
  try {
    await fn()
  } catch (e: any) {
    error.value = e?.message || t('projectTools.shared.somethingWrong')
  } finally {
    busy.value = ''
  }
}

const saveActive = useDebounceFn(() => {
  const tag = active.value
  if (!tag || !translations.value[tag]) return
  run('save', async () => { await patch({ translations: { [tag]: translations.value[tag] } }) })
}, 800)

function setString(key: string, value: string) {
  const tag = active.value
  translations.value[tag] = { ...translations.value[tag], [key]: value }
  saveActive()
}

function addLanguage(tag: string) {
  translations.value[tag] = {}
  active.value = tag
}

async function removeLanguage(tag: string) {
  if (!confirm(t('translations.removeConfirm', { language: localeName(tag, uiLocale.value) }))) return
  await run('remove', async () => {
    await patch({ translations: { [tag]: null } })
    delete translations.value[tag]
    if (active.value === tag) active.value = ''
  })
}

async function setSource(tag: string) {
  await run('source', async () => {
    const body: Record<string, unknown> = { locale: tag }
    if (tag in translations.value) body.translations = { [tag]: null }
    await patch(body)
    source.value = tag
    delete translations.value[tag]
    if (active.value === tag) active.value = ''
  })
}

async function translate(locales: string[], overwrite: boolean) {
  await run('translate', async () => {
    await props.flush()
    // Languages added here exist only on this page until now, and edits may still be waiting to save: send them all.
    await patch({ translations: Object.fromEntries(locales.map(l => [l, translations.value[l] || {}])) })
    const { template } = await api<{ template: EmailTemplate }>(`/admin/emails/${props.template.id}/translate`, { method: 'POST', body: { locales, overwrite } })
    translations.value = JSON.parse(JSON.stringify(template.translations))
    toast.add({ title: t('translations.translated', { n: locales.length }), icon: 'i-lucide-sparkles', color: 'success' })
  })
}
</script>

<template>
  <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
    <p v-if="template.masterId" class="rounded-lg border border-dashed border-default p-4 text-xs text-muted">{{ $t('translations.email.linked') }}</p>
    <template v-else>
      <LanguageTabs
        :source="source" :languages="languages" :active="active" :busy="busy === 'translate'" :error="error"
        @update:source="setSource" @select="active = $event" @add="addLanguage" @remove="removeLanguage" @translate="translate"
      />
      <ul v-if="active" class="space-y-3">
        <li v-for="key in keys" :key="key">
          <p class="text-xs font-medium text-muted">{{ kindOf(key) }}</p>
          <p class="mt-0.5 line-clamp-2 break-words text-xs text-dimmed">{{ texts[key] }}</p>
          <UTextarea :model-value="translations[active]?.[key] || ''" :placeholder="texts[key]" autoresize :rows="1" :maxrows="8" size="sm" class="mt-1 w-full" @update:model-value="setString(key, $event)" />
        </li>
      </ul>
      <p v-else class="text-xs text-dimmed">{{ $t('translations.email.sendHint') }}</p>
    </template>
  </div>
</template>
