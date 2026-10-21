<template>
  <UModal v-model:open="open" :title="$t('blog.import.title')" :description="$t('blog.import.description')">
    <template #body>
      <div class="space-y-4 text-[13px]">
        <template v-if="!result">
          <UFormField :label="$t('blog.import.file')" :description="$t('blog.import.fileHint')">
            <div class="flex items-center gap-2">
              <UButton icon="i-lucide-file-json" :label="fileName || $t('blog.import.choose')" color="neutral" variant="soft" @click="fileInput?.click()" />
              <span v-if="postCount !== null" class="text-xs text-muted">{{ $t('blog.import.found', postCount) }}</span>
            </div>
            <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="readFile">
          </UFormField>
          <UFormField :label="$t('blog.import.siteUrl')" :description="$t('blog.import.siteUrlHint')">
            <UInput v-model="siteUrl" class="w-full" placeholder="https://blog.example.com" />
          </UFormField>
          <USwitch v-model="update" :label="$t('blog.import.update')" :description="$t('blog.import.updateHint')" />
          <p class="text-xs text-muted">{{ $t('blog.import.members') }}</p>
        </template>
        <template v-else>
          <p class="font-medium text-highlighted">{{ $t('blog.import.done', { created: result.created, updated: result.updated, skipped: result.skipped }) }}</p>
          <ul v-if="result.warnings.length" class="list-disc space-y-1 pl-5 text-xs text-muted">
            <li v-for="(warning, index) in result.warnings" :key="index">{{ warning }}</li>
          </ul>
        </template>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="result ? $t('blog.import.close') : $t('common.cancel')" color="neutral" variant="ghost" @click="open = false" />
        <UButton v-if="!result" :label="$t('blog.import.run')" icon="i-lucide-download" :loading="busy" :disabled="!data" @click="run" />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
// Bring a Ghost blog over: its JSON export, read here and sent as is. The
// server maps it (server/utils/blogImport.ts) and says what came in.

type ImportResult = { created: number, updated: number, skipped: number, warnings: string[] }

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ imported: [result: ImportResult] }>()
const open = defineModel<boolean>('open', { default: false })

const { api } = useAgent()
const { t } = useI18n()
const fileInput = ref<HTMLInputElement | null>(null)
const fileName = ref('')
const data = ref<unknown>(null)
const postCount = ref<number | null>(null)
const siteUrl = ref('')
const update = ref(false)
const busy = ref(false)
const error = ref('')
const result = ref<ImportResult | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) return
  fileName.value = ''
  data.value = null
  postCount.value = null
  result.value = null
  error.value = ''
  update.value = false
})

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  error.value = ''
  try {
    const parsed = JSON.parse(await file.text()) as { db?: { data?: { posts?: unknown[] } }[], data?: { posts?: unknown[] } }
    const posts = parsed.db?.[0]?.data?.posts || parsed.data?.posts
    if (!Array.isArray(posts)) throw new Error(t('blog.import.notGhost'))
    data.value = parsed
    fileName.value = file.name
    postCount.value = posts.length
  } catch (e: any) {
    data.value = null
    postCount.value = null
    error.value = e instanceof SyntaxError ? t('blog.import.notJson') : e?.message
  }
}

async function run() {
  busy.value = true
  error.value = ''
  try {
    result.value = await api<ImportResult>('/admin/blog/import', { method: 'POST', body: { project: props.projectId, export: data.value, siteUrl: siteUrl.value.trim() || undefined, update: update.value } })
    emit('imported', result.value)
  } catch (e: any) {
    error.value = e?.message || t('blog.import.error')
  } finally {
    busy.value = false
  }
}
</script>
