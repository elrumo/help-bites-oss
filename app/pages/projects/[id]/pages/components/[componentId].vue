<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="id" :title="form.name || $t('projectTools.pages.newComponent')">
      <template #actions>
        <UButton icon="i-lucide-arrow-left" :label="$t('projectTools.pages.tabs.components')" :to="`/projects/${id}/pages?tab=components`" size="sm" color="neutral" variant="ghost" />
        <UButton v-if="!isNew" icon="i-lucide-trash-2" :label="$t('projectTools.pages.delete')" size="sm" color="neutral" variant="ghost" @click="remove" />
        <UButton :label="isNew ? $t('projectTools.pages.create') : $t('projectTools.shared.save')" size="sm" :loading="saving" :disabled="!isNew && !dirty" @click="save" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="mx-auto max-w-6xl px-6 py-8"><USkeleton class="h-96 w-full" /></div>
      <div v-else class="mx-auto grid max-w-7xl gap-6 px-6 py-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div class="min-w-0 space-y-6">
          <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

          <section class="space-y-4 rounded-xl border border-default p-5">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField :label="$t('projectTools.pages.componentName')">
                <UInput v-model="form.name" :maxlength="CMS_LIMITS.name" class="w-full" @update:model-value="autoKey" />
              </UFormField>
              <UFormField :label="$t('projectTools.pages.componentKey')" :help="isNew ? $t('projectTools.pages.componentKeyHelp') : $t('projectTools.pages.componentKeyFixed')" :error="keyOk ? undefined : $t('projectTools.pages.componentKeyError')">
                <UInput v-model="form.key" :disabled="!isNew" class="w-full font-mono" @update:model-value="keyTouched = true" />
              </UFormField>
            </div>
            <UFormField :label="$t('projectTools.pages.componentDescription')" :help="$t('projectTools.pages.componentDescriptionHelp')">
              <UTextarea v-model="form.description" :maxlength="CMS_LIMITS.description" autoresize :rows="2" class="w-full" />
            </UFormField>
            <div class="flex flex-wrap gap-6">
              <USwitch v-model="form.nestable" :label="$t('projectTools.pages.nestable')" :description="$t('projectTools.pages.nestableHelp')" />
              <USwitch v-model="form.root" :label="$t('projectTools.pages.root')" :description="$t('projectTools.pages.rootHelp')" />
            </div>
          </section>

          <section class="space-y-3 rounded-xl border border-default p-5">
            <div class="flex items-center gap-2">
              <h3 class="mr-auto text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pages.fields') }}</h3>
              <UButton v-if="undeclared.length" icon="i-lucide-scan-text" :label="$t('projectTools.pages.detectFields', undeclared.length)" size="xs" color="neutral" variant="soft" @click="detect" />
              <UButton icon="i-lucide-plus" :label="$t('projectTools.pages.addField')" size="xs" color="neutral" variant="soft" :disabled="form.fields.length >= CMS_LIMITS.fields" @click="addField()" />
            </div>
            <p v-if="!form.fields.length" class="text-xs text-muted">{{ $t('projectTools.pages.noFields') }}</p>
            <div v-for="(f, i) in form.fields" :key="i" class="space-y-2 rounded-lg border border-default p-3">
              <div class="grid gap-2 sm:grid-cols-[1fr_1fr_9rem_auto]">
                <UInput v-model="f.key" placeholder="key" size="sm" class="font-mono" :aria-label="$t('projectTools.pages.fieldKey')" />
                <UInput v-model="f.label" :placeholder="fieldLabel(f.key || 'label')" size="sm" :aria-label="$t('projectTools.pages.fieldLabel')" />
                <USelect v-model="f.type" :items="CMS_FIELD_TYPES.map(v => ({ label: $t(`projectTools.pages.fieldTypes.${v}`), value: v }))" size="sm" :aria-label="$t('projectTools.pages.fieldType')" />
                <div class="flex gap-0.5">
                  <UButton icon="i-lucide-arrow-up" size="xs" color="neutral" variant="ghost" square :disabled="i === 0" :aria-label="$t('projectTools.pages.moveUp')" @click="moveField(i, -1)" />
                  <UButton icon="i-lucide-arrow-down" size="xs" color="neutral" variant="ghost" square :disabled="i === form.fields.length - 1" :aria-label="$t('projectTools.pages.moveDown')" @click="moveField(i, 1)" />
                  <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('projectTools.pages.remove')" @click="form.fields.splice(i, 1)" />
                </div>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <UInput v-if="f.type !== 'asset' && f.type !== 'blocks'" :model-value="f.default === undefined ? '' : String(f.default)" :placeholder="$t('projectTools.pages.fieldDefault')" size="sm" @update:model-value="setDefault(f, String($event))" />
                <UInput v-if="f.type === 'select' || f.type === 'icon'" :model-value="(f.options || []).join(', ')" :placeholder="f.type === 'icon' ? $t('projectTools.pages.iconOptions') : $t('projectTools.pages.fieldOptions')" size="sm" @update:model-value="f.options = String($event).split(',').map(s => s.trim()).filter(Boolean)" />
                <USelectMenu v-if="f.type === 'blocks'" v-model="f.allow" :items="nestableKeys" multiple :placeholder="$t('projectTools.pages.fieldAllowAny')" size="sm" />
                <USwitch v-model="f.required" :label="$t('projectTools.pages.required')" size="sm" />
              </div>
            </div>
          </section>

          <section class="space-y-3 rounded-xl border border-default p-5">
            <div>
              <h3 class="text-[13px] font-semibold text-highlighted">{{ $t('projectTools.pages.template') }}</h3>
              <p class="mt-1 text-xs text-muted">{{ $t('projectTools.pages.templateHelp') }}</p>
            </div>
            <UFormField label="HTML">
              <UTextarea v-model="form.html" :rows="12" autoresize :maxrows="30" spellcheck="false" class="w-full font-mono text-[12.5px]" placeholder="<section class=&quot;my-block&quot;>&#10;  <h2>{{@title}}</h2>&#10;</section>" />
            </UFormField>
            <UFormField label="CSS">
              <UTextarea v-model="form.css" :rows="8" autoresize :maxrows="30" spellcheck="false" class="w-full font-mono text-[12.5px]" placeholder=".my-block { padding: 48px 24px; color: var(--hb-text); }" />
            </UFormField>
            <p v-if="problem" class="text-xs text-error">{{ problem }}</p>
          </section>
        </div>

        <aside class="min-w-0 space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div class="h-[28rem] overflow-hidden rounded-xl border border-default">
            <CmsPreview :name="form.name" :content="sample" :page-style="DEFAULT_STYLE" :library="previewLibrary" :project-accent="project?.theme?.accent || ''" :pk="project?.publicKey || ''" :width="1100" />
          </div>
          <div class="flex h-[26rem] min-h-0 flex-col overflow-hidden rounded-xl border border-default">
            <p class="shrink-0 border-b border-default px-3 py-2 text-xs font-medium text-muted"><UIcon name="i-lucide-sparkles" class="me-1 inline size-3.5 align-[-2px]" />{{ $t('projectTools.pages.assistant') }}</p>
            <CmsChat :project-id="id" :component-id="isNew ? undefined : componentId" :library="previewLibrary" :disabled-reason="isNew ? $t('projectTools.pages.saveFirst') : ''" @component="reload" />
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  CMS_FIELD_TYPES, CMS_LIMITS, COMPONENT_KEY, DEFAULT_STYLE, fieldLabel, guessFieldType, newBlock, normalizeComponentInput, normalizeContent, templateKeys,
  type CmsComponentDef, type CmsField
} from '#shared/cms/content'
import { BUILTIN_KEYS, libraryOf } from '#shared/cms/library'

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const id = String(route.params.id)
const componentId = String(route.params.componentId)
const isNew = componentId === 'new'
const { api, projects } = useAgent()
const { t } = useI18n()
const toast = useToast()
const project = computed(() => projects.value.find(p => p.id === id))

type Form = Pick<CmsComponentDef, 'key' | 'name' | 'description' | 'root' | 'nestable' | 'html' | 'css'> & { fields: CmsField[] }
const blank = (): Form => ({ key: '', name: '', description: '', root: false, nestable: true, fields: [], html: '', css: '' })
const form = reactive<Form>(blank())
const saved = ref(JSON.stringify(blank()))
const others = ref<CmsComponentDef[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const keyTouched = ref(!isNew)

const dirty = computed(() => JSON.stringify(form) !== saved.value)
const keyOk = computed(() => !form.key || (COMPONENT_KEY.test(form.key) && !BUILTIN_KEYS.has(form.key)))
const nestableKeys = computed(() => [...BUILTIN_KEYS, ...others.value.filter(c => !c.builtin && c.nestable).map(c => c.key)])
const undeclared = computed(() => templateKeys(form.html).filter(k => !form.fields.some(f => f.key === k)))
const problem = computed(() => {
  if (!form.key || !form.name) return ''
  const res = normalizeComponentInput(form, BUILTIN_KEYS)
  return res.ok ? '' : res.error
})

function autoKey() {
  if (!keyTouched.value) form.key = form.name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c$1').slice(0, 40)
}

function addField(key = '') {
  form.fields.push({ key, label: key ? fieldLabel(key) : '', type: key ? guessFieldType(form.html, key) : 'text' })
}
function detect() {
  for (const key of undeclared.value) addField(key)
}
function moveField(i: number, by: number) {
  const [f] = form.fields.splice(i, 1)
  form.fields.splice(i + by, 0, f!)
}
function setDefault(f: CmsField, value: string) {
  if (!value) delete f.default
  else f.default = f.type === 'number' ? Number(value) : f.type === 'boolean' ? value === 'true' : value
}

// The preview shows one of it on a page, filled with its defaults; the library holds this draft.
const draftDef = computed<CmsComponentDef>(() => ({ id: 'draft', ...JSON.parse(JSON.stringify(form)), key: form.key || 'draft', fields: form.fields.filter(f => f.key) }))
const previewLibrary = computed(() => libraryOf([...others.value.filter(c => !c.builtin && c.key !== form.key), draftDef.value]))
const sample = computed(() => {
  const block = newBlock(draftDef.value)
  return normalizeContent(draftDef.value.root && !draftDef.value.nestable ? block : { component: 'page', body: [block] }, previewLibrary.value, draftDef.value.root && !draftDef.value.nestable ? draftDef.value.key : 'page').content
})

function fill(def: CmsComponentDef) {
  Object.assign(form, { key: def.key, name: def.name, description: def.description, root: def.root, nestable: def.nestable, html: def.html, css: def.css, fields: JSON.parse(JSON.stringify(def.fields)) })
  saved.value = JSON.stringify(form)
}

async function reload() {
  const { components } = await api<{ components: CmsComponentDef[] }>('/admin/cms/components', { query: { project: id } })
  others.value = components
  const mine = components.find(c => c.id === componentId)
  if (mine) fill(mine)
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const body = { ...JSON.parse(JSON.stringify(form)), fields: form.fields.filter(f => f.key) }
    if (isNew) {
      const { component } = await api<{ component: CmsComponentDef }>('/admin/cms/components', { method: 'POST', body: { project: id, ...body } })
      saved.value = JSON.stringify(form)
      await navigateTo(`/projects/${id}/pages/components/${component.id}`, { replace: true })
    } else {
      fill((await api<{ component: CmsComponentDef }>(`/admin/cms/components/${componentId}`, { method: 'PATCH', body })).component)
      toast.add({ title: t('projectTools.pages.componentSaved'), icon: 'i-lucide-check', color: 'success' })
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || t('projectTools.pages.saveError')
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!confirm(t('projectTools.pages.deleteComponentConfirm', { name: form.name }))) return
  try {
    await api(`/admin/cms/components/${componentId}`, { method: 'DELETE' })
    await navigateTo(`/projects/${id}/pages?tab=components`)
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pages.deleteError')
  }
}

onMounted(async () => {
  try {
    await reload()
  } catch (e: any) {
    error.value = e?.message || t('projectTools.pages.loadError')
  } finally {
    loading.value = false
  }
})
</script>
