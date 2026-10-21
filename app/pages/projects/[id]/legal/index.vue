<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="$t('sections.legal')">
      <template #actions>
        <UButton icon="i-lucide-palette" :label="$t('projectTools.legal.identityAndLook')" size="sm" color="neutral" variant="ghost" @click="lookOpen = true" />
        <UButton icon="i-lucide-scan-search" :label="$t('projectTools.legal.analyse')" size="sm" color="neutral" variant="ghost" @click="analyseOpen = true" />
        <UButton icon="i-lucide-plus" :label="$t('projectTools.legal.newDocument')" size="sm" @click="wizardOpen = true" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div>
          <h2 class="text-[15px] font-semibold text-highlighted">{{ $t('projectTools.legal.title') }}</h2>
          <p class="mt-1 text-[13px] text-muted">
            {{ $t('projectTools.legal.intro') }}
          </p>
        </div>

        <p v-if="error" class="text-[13px] text-error">{{ error }}</p>
        <div v-if="loading" class="space-y-2"><USkeleton v-for="n in 3" :key="n" class="h-14 w-full" /></div>

        <EmptyState v-else-if="!documents.length" icon="i-lucide-scale" :title="$t('projectTools.legal.emptyTitle')" :description="$t('projectTools.legal.emptyDescription')" class="rounded-xl border border-dashed border-default">
          <UButton icon="i-lucide-plus" :label="$t('projectTools.legal.newDocument')" @click="wizardOpen = true" />
        </EmptyState>

        <ul v-else class="divide-y divide-default overflow-hidden rounded-xl border border-default">
          <li v-for="doc in documents" :key="doc.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <NuxtLink :to="`/projects/${id}/legal/${doc.id}`" class="min-w-0 flex-1 basis-60">
              <p class="truncate text-[13px] font-medium text-highlighted">{{ doc.title }}</p>
              <p class="truncate font-mono text-xs text-muted">/legal/…/{{ doc.slug }}</p>
            </NuxtLink>
            <UBadge :label="LEGAL_DOC_LABELS[doc.type as LegalDocType]" color="neutral" variant="soft" size="sm" />
            <UBadge v-if="doc.locale" :label="localeName(doc.locale, uiLocale)" color="neutral" variant="outline" size="sm" />
            <UBadge :label="doc.status === 'published' ? $t('projectTools.legal.publishedVersion', { version: doc.version }) : $t('projectTools.legal.draft')" :color="doc.status === 'published' ? 'success' : 'neutral'" variant="soft" size="sm" />
            <UButton v-if="doc.status === 'published'" :to="publicUrl(doc)" target="_blank" icon="i-lucide-external-link" size="sm" color="neutral" variant="ghost" square :aria-label="$t('projectTools.legal.openPublicPage')" />
          </li>
        </ul>
      </div>
    </div>

    <LegalWizard v-model:open="wizardOpen" :project-id="id" @done="(doc, analyse) => navigateTo({ path: `/projects/${id}/legal/${doc.id}`, query: analyse ? { analyse: '1' } : {} })" />
    <LegalAnalyse v-model:open="analyseOpen" />
    <LegalLook v-model:open="lookOpen" :project-id="id" />
  </div>
</template>

<script setup lang="ts">
import { LEGAL_DOC_LABELS, type LegalDocType } from '#shared/legal/types'
import { localeName } from '#shared/locales'

definePageMeta({ middleware: 'agent' })

const { api } = useAgent()
const { t, locale: uiLocale } = useI18n()
const id = String(useRoute().params.id)
const documents = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const wizardOpen = ref(false)
const analyseOpen = ref(false)
const lookOpen = ref(false)

const publicUrl = (doc: { path: string }) => `${location.origin}${doc.path}`

onMounted(async () => {
  try {
    documents.value = (await api<{ documents: any[] }>('/admin/legal/documents', { query: { project: id } })).documents
  } catch (e: any) {
    error.value = e?.message || t('projectTools.legal.loadError')
  } finally {
    loading.value = false
  }
})
</script>
