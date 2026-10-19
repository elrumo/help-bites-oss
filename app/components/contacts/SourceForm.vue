<script setup lang="ts">
/**
 * Connect a database, see its columns and a few rows, say which column is
 * which, and save. Editing keeps the stored credential unless a new one is
 * typed in.
 */
import type { ContactFieldMapping } from '#shared/contacts'
import type { AdminProject } from '~~/server/utils/projects'
import type { ContactSourceDto, SourceConfig } from '~~/server/utils/contactSources'
import { attributeKeyFor } from '~/utils/contactStatus'

const props = defineProps<{ project: AdminProject, kinds: { kind: string, label: string }[], source: ContactSourceDto | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()

const { api } = useAgent()
const toast = useToast()
const { t } = useI18n()

const kind = ref('parse')
const name = ref('')
const conn = reactive({ serverUrl: '', appId: '', className: '_User', table: '', idField: 'id', updatedField: '', collection: 'users' })
const secret = reactive({ masterKey: '', url: '', json: '' })
const mapping = reactive({ email: '', externalId: '', name: '', tags: '', subscribed: '' })
const asAttributes = ref<string[]>([])
const consent = ref<'keep' | 'subscribed'>('keep')
const everyMinutes = ref(60)

const fields = ref<string[]>([])
const sample = ref<Record<string, unknown>[]>([])
const testing = ref(false)
const saving = ref(false)

watch(open, (value) => {
  if (!value) return
  const s = props.source
  kind.value = s?.kind || 'parse'
  name.value = s?.name || ''
  const c = s?.config
  Object.assign(conn, { serverUrl: c?.serverUrl || '', appId: c?.appId || '', className: c?.className || '_User', table: c?.table || '', idField: s?.kind === 'postgres' ? c?.idField || 'id' : 'id', updatedField: s?.kind === 'parse' ? '' : c?.updatedField || '', collection: c?.collection || 'users' })
  Object.assign(secret, { masterKey: '', url: '', json: '' })
  const m = c?.mapping || {}
  Object.assign(mapping, { email: m.email || '', externalId: m.externalId || '', name: m.name || '', tags: m.tags || '', subscribed: m.subscribed || '' })
  asAttributes.value = Object.values(m.attributes || {})
  consent.value = c?.consent || 'keep'
  everyMinutes.value = c?.everyMinutes ?? 60
  fields.value = []
  sample.value = []
})

const kindItems = computed(() => props.kinds.map(k => ({ label: k.label, value: k.kind })))
const scheduleItems = computed(() => [{ label: t('contacts.sources.every15'), value: 15 }, { label: t('contacts.sources.hourly'), value: 60 }, { label: t('contacts.sources.every6Hours'), value: 360 }, { label: t('contacts.sources.daily'), value: 1440 }, { label: t('contacts.sources.scheduleManual'), value: 0 }])
const fieldItems = computed(() => fields.value.map(f => ({ label: f, value: f })))

function secretBody(): unknown {
  if (kind.value === 'parse') return secret.masterKey ? { masterKey: secret.masterKey } : undefined
  if (kind.value === 'postgres') return secret.url ? { url: secret.url } : undefined
  return secret.json.trim() || undefined
}

function connectionConfig(): Partial<SourceConfig> {
  if (kind.value === 'parse') return { serverUrl: conn.serverUrl, appId: conn.appId, className: conn.className }
  if (kind.value === 'postgres') return { table: conn.table, idField: conn.idField, updatedField: conn.updatedField || undefined }
  return { collection: conn.collection, updatedField: conn.updatedField || undefined }
}

async function test() {
  testing.value = true
  try {
    const res = await api<{ fields: string[], sample: Record<string, unknown>[] }>('/admin/contact-sources/test', {
      method: 'POST',
      body: { project: props.project.id, ...(props.source ? { source: props.source.id } : { kind: kind.value }), config: connectionConfig(), secret: secretBody() }
    })
    fields.value = kind.value === 'firestore' ? [...new Set(['id', ...res.fields])] : res.fields
    sample.value = res.sample
    // First guess by name, only for what is still unmapped.
    const pick = (re: RegExp) => fields.value.find(f => re.test(f.toLowerCase().replace(/[\s_-]+/g, ''))) || ''
    mapping.email ||= pick(/^e?mail$/) || pick(/mail/)
    mapping.externalId ||= kind.value === 'parse' ? 'objectId' : kind.value === 'firestore' ? 'id' : conn.idField
    mapping.name ||= pick(/^(name|fullname|displayname|username)$/)
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.sources.connectError'), color: 'error' })
  } finally {
    testing.value = false
  }
}

const attributeColumns = computed(() => fields.value.filter(f => !Object.values(mapping).includes(f)))

async function save() {
  saving.value = true
  const fieldMapping: ContactFieldMapping = {
    ...Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
    attributes: Object.fromEntries(asAttributes.value.filter(c => attributeColumns.value.includes(c)).map(c => [attributeKeyFor(c), c]))
  }
  const config = { ...connectionConfig(), mapping: fieldMapping, consent: consent.value, everyMinutes: everyMinutes.value }
  try {
    if (props.source) await api(`/admin/contact-sources/${props.source.id}`, { method: 'PATCH', body: { project: props.project.id, name: name.value, config, secret: secretBody() } })
    else await api('/admin/contact-sources', { method: 'POST', body: { project: props.project.id, kind: kind.value, name: name.value, config, secret: secretBody() } })
    open.value = false
    emit('saved')
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.sources.saveError'), color: 'error' })
  } finally {
    saving.value = false
  }
}

const cell = (value: unknown) => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)).slice(0, 40)
</script>

<template>
  <UModal v-model:open="open" :title="source ? $t('contacts.sources.editTitle', { name: source.name }) : $t('contacts.sources.connect')" :description="$t('contacts.sources.formDescription')" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <form class="space-y-5 text-[13px]" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="$t('contacts.sources.kind')"><USelect v-model="kind" :items="kindItems" value-key="value" class="w-full" :disabled="Boolean(source)" /></UFormField>
          <UFormField :label="$t('common.name')"><UInput v-model="name" :placeholder="$t('contacts.sources.namePlaceholder')" class="w-full" /></UFormField>
        </div>

        <div v-if="kind === 'parse'" class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="$t('contacts.sources.serverUrl')" class="sm:col-span-2"><UInput v-model="conn.serverUrl" placeholder="https://api.example.com/parse" class="w-full" /></UFormField>
          <UFormField :label="$t('contacts.sources.appId')"><UInput v-model="conn.appId" class="w-full" /></UFormField>
          <UFormField :label="$t('contacts.sources.className')"><UInput v-model="conn.className" placeholder="_User" class="w-full font-mono" /></UFormField>
          <UFormField :label="$t('contacts.sources.masterKey')" :hint="source ? $t('contacts.sources.blankKeeps') : ''" class="sm:col-span-2"><UInput v-model="secret.masterKey" type="password" autocomplete="off" class="w-full" /></UFormField>
        </div>
        <div v-else-if="kind === 'postgres'" class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="$t('contacts.sources.connectionString')" :hint="source ? $t('contacts.sources.blankKeeps') : $t('contacts.sources.readOnlyHint')" class="sm:col-span-2"><UInput v-model="secret.url" type="password" autocomplete="off" placeholder="postgres://reader:…@db.example.com:5432/app" class="w-full" /></UFormField>
          <UFormField :label="$t('contacts.sources.table')" class="sm:col-span-2"><UInput v-model="conn.table" placeholder="public.users" class="w-full font-mono" /></UFormField>
          <UFormField :label="$t('contacts.sources.idColumn')"><UInput v-model="conn.idField" class="w-full font-mono" /></UFormField>
          <UFormField :label="$t('contacts.sources.updatedAtColumn')" :hint="$t('contacts.sources.updatedAtHint')"><UInput v-model="conn.updatedField" placeholder="updated_at" class="w-full font-mono" /></UFormField>
        </div>
        <div v-else class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="$t('contacts.sources.serviceAccountKey')" :hint="source ? $t('contacts.sources.blankKeeps') : $t('contacts.sources.serviceAccountHint')" class="sm:col-span-2"><UTextarea v-model="secret.json" :rows="3" placeholder="{ &quot;type&quot;: &quot;service_account&quot;, … }" class="w-full font-mono text-xs" /></UFormField>
          <UFormField :label="$t('contacts.sources.collection')"><UInput v-model="conn.collection" class="w-full font-mono" /></UFormField>
          <UFormField :label="$t('contacts.sources.updatedAtField')" :hint="$t('contacts.form.optional')"><UInput v-model="conn.updatedField" placeholder="updatedAt" class="w-full font-mono" /></UFormField>
        </div>

        <div class="flex justify-end">
          <UButton :label="fields.length ? $t('contacts.sources.connectAgain') : $t('contacts.sources.connectButton')" icon="i-lucide-plug" color="neutral" variant="outline" :loading="testing" @click="test" />
        </div>

        <template v-if="fields.length">
          <div v-if="sample.length" class="overflow-x-auto rounded-lg border border-default">
            <table class="w-full text-xs">
              <thead><tr><th v-for="f in Object.keys(sample[0]!)" :key="f" class="whitespace-nowrap border-b border-default px-2 py-1 text-left font-mono font-medium text-muted">{{ f }}</th></tr></thead>
              <tbody><tr v-for="(row, i) in sample" :key="i"><td v-for="f in Object.keys(sample[0]!)" :key="f" class="whitespace-nowrap px-2 py-1">{{ cell(row[f]) }}</td></tr></tbody>
            </table>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('contacts.form.email')"><OptionalSelect v-model="mapping.email" :items="fieldItems" class="w-full" /></UFormField>
            <UFormField :label="$t('contacts.form.userId')" :hint="$t('contacts.sources.userIdHint')"><OptionalSelect v-model="mapping.externalId" :items="fieldItems" class="w-full" /></UFormField>
            <UFormField :label="$t('common.name')"><OptionalSelect v-model="mapping.name" :items="fieldItems" class="w-full" /></UFormField>
            <UFormField :label="$t('contacts.form.tags')"><OptionalSelect v-model="mapping.tags" :items="fieldItems" class="w-full" /></UFormField>
            <UFormField :label="$t('contacts.sources.optedIn')" :hint="$t('contacts.sources.optedInHint')"><OptionalSelect v-model="mapping.subscribed" :items="fieldItems" class="w-full" /></UFormField>
            <UFormField :label="$t('contacts.sources.sync')"><USelect v-model="everyMinutes" :items="scheduleItems" value-key="value" class="w-full" /></UFormField>
          </div>
          <UFormField :label="$t('contacts.sources.keepAsAttributes')">
            <UCheckboxGroup v-model="asAttributes" :items="attributeColumns.map(c => ({ label: c, value: c }))" orientation="horizontal" class="flex-wrap" />
          </UFormField>
          <URadioGroup
            v-if="!mapping.subscribed"
            v-model="consent"
            :items="[{ label: $t('contacts.sources.consentKeep'), value: 'keep' }, { label: $t('contacts.sources.consentSubscribed'), value: 'subscribed', description: $t('contacts.sources.consentSubscribedDescription') }]"
          />
          <p v-if="!mapping.email && !mapping.externalId" class="text-error">{{ $t('contacts.sources.mapRequired') }}</p>
        </template>

        <div class="flex justify-end gap-2 border-t border-default pt-4">
          <UButton color="neutral" variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UButton>
          <UButton type="submit" :loading="saving" :disabled="!fields.length || (!mapping.email && !mapping.externalId)">{{ source ? $t('contacts.save') : $t('contacts.sources.saveAndSync') }}</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
