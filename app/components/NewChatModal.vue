<template>
  <UModal v-model:open="open" title="New conversation" description="Write to any user of a project. If they have never opened the chat, paste their id from your app and the conversation will be waiting for them.">
    <template #body>
      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="Project">
          <USelect v-model="projectId" :items="projectItems" value-key="value" class="w-full" />
        </UFormField>

        <UFormField label="Who" hint="Search known users, or type an id">
          <UInput v-model="query" placeholder="Name, email or user id" class="w-full" @input="search" />
          <div v-if="results.length" class="mt-2 border border-default rounded-lg divide-y divide-default max-h-40 overflow-y-auto">
            <button v-for="user in results" :key="user.id" type="button" class="w-full text-left px-3 py-2 text-sm hover:bg-elevated" @click="pick(user)">
              <span class="font-medium">{{ user.name || user.externalId }}</span>
              <span class="text-muted ml-2 text-xs">{{ user.email || user.externalId }}</span>
            </button>
          </div>
        </UFormField>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Name" hint="optional"><UInput v-model="name" class="w-full" /></UFormField>
          <UFormField label="Email" hint="optional"><UInput v-model="email" type="email" class="w-full" /></UFormField>
        </div>

        <UFormField label="Subject" hint="optional"><UInput v-model="subject" class="w-full" /></UFormField>
        <UFormField v-if="types.length > 1" label="Ticket type" :description="activeType?.description || undefined">
          <USelect v-model="typeKey" :items="typeItems" value-key="value" class="w-full" />
        </UFormField>
        <template v-for="field in intakeFields" :key="field.key">
          <UCheckbox v-if="field.type === 'bool'" v-model="fieldValues[field.key] as boolean | undefined" :label="field.label || field.key" :required="field.required" />
          <UFormField v-else :label="field.label || field.key" :required="field.required">
            <USelect v-if="field.type === 'select'" v-model="fieldValues[field.key] as string | undefined" :items="field.options || []" placeholder="None" class="w-full" />
            <UTextarea v-else-if="field.type === 'longtext'" v-model="fieldValues[field.key] as string | undefined" :rows="3" autoresize class="w-full" />
            <UInput v-else v-model="fieldValues[field.key] as string | undefined" :type="field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'" :placeholder="field.type === 'url' ? 'https://' : undefined" class="w-full" />
          </UFormField>
        </template>
        <UFormField label="Message"><UTextarea v-model="body" :rows="4" autoresize class="w-full" required /></UFormField>
        <UCheckbox v-model="notify" label="Also send by email" />

        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
          <UButton type="submit" color="primary" :loading="sending" :disabled="!projectId || !externalId || !body.trim()">Send</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { AdminProject } from '~~/server/utils/projects'
import { validateFields, type ConversationType } from '#shared/support'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ projects: AdminProject[], defaultProjectId?: string }>()
const emit = defineEmits<{ (event: 'created', conversationId: string): void }>()

const { api } = useAgent()

const projectId = ref(props.defaultProjectId || props.projects[0]?.id || '')
const query = ref('')
const results = ref<{ id: string, externalId: string, name: string, email: string }[]>([])
const externalId = ref('')
const name = ref('')
const email = ref('')
const subject = ref('')
const body = ref('')
const notify = ref(true)
const typesByProject = ref<Record<string, ConversationType[]>>({})
const typeKey = ref('support')
const fieldValues = ref<Record<string, string | boolean | undefined>>({})
const sending = ref(false)
const error = ref('')

const projectItems = computed(() => props.projects.map(p => ({ label: p.name, value: p.id })))
const types = computed(() => typesByProject.value[projectId.value] || [])
const typeItems = computed(() => types.value.map(type => ({ label: type.name, value: type.key })))
const activeType = computed(() => types.value.find(type => type.key === typeKey.value) || null)
const intakeFields = computed(() => (activeType.value?.fields || []).filter(field => field.editableBy !== 'none'))

watch([open, projectId], async () => {
  const id = projectId.value
  if (!open.value || !id) return
  if (!typesByProject.value[id]) {
    try { const { types } = await api<{ types: ConversationType[] }>(`/admin/projects/${id}/types`); typesByProject.value = { ...typesByProject.value, [id]: types } } catch { /* The built-in support type remains usable. */ }
  }
  if (id !== projectId.value) return
  const list = typesByProject.value[id] || []
  if (!list.some(type => type.key === typeKey.value)) typeKey.value = list.find(type => type.key === 'support')?.key || list[0]?.key || 'support'
})

watch(open, (value) => {
  if (!value) return
  projectId.value = props.defaultProjectId || props.projects[0]?.id || ''
  query.value = ''
  results.value = []
  externalId.value = ''
  name.value = ''
  email.value = ''
  subject.value = ''
  body.value = ''
  typeKey.value = 'support'
  fieldValues.value = {}
  error.value = ''
})

let timer: ReturnType<typeof setTimeout> | null = null
function search() {
  externalId.value = query.value.trim()
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    if (!query.value.trim() || !projectId.value) { results.value = []; return }
    try {
      const { endUsers } = await api<{ endUsers: typeof results.value }>('/admin/end-users', { query: { project: projectId.value, q: query.value.trim() } })
      results.value = endUsers
    } catch {
      results.value = []
    }
  }, 200)
}

function pick(user: { externalId: string, name: string, email: string }) {
  externalId.value = user.externalId
  query.value = user.externalId
  name.value = user.name
  email.value = user.email
  results.value = []
}

async function submit() {
  error.value = ''
  // Blank text means unset; the server re-validates with the same helper.
  const raw = Object.fromEntries(Object.entries(fieldValues.value)
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
    .filter(([, value]) => value !== undefined && value !== ''))
  const { values: fields, errors } = validateFields(raw, activeType.value?.fields || [], 'agent')
  if (errors.length) { error.value = errors.join('. '); return }
  sending.value = true
  try {
    const result = await api<{ conversation: { id: string } }>('/admin/conversations', {
      method: 'POST',
      body: { projectId: projectId.value, externalId: externalId.value, name: name.value, email: email.value, subject: subject.value, body: body.value, type: typeKey.value, fields, notifyByEmail: notify.value }
    })
    open.value = false
    emit('created', result.conversation.id)
  } catch (e: any) {
    error.value = e?.message || 'Could not send'
  } finally {
    sending.value = false
  }
}
</script>
