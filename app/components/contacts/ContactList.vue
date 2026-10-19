<script setup lang="ts">
/**
 * A project's people: the app's own users (from identity tokens), imports,
 * database syncs and newsletter sign-ups, newest first. Search, filter by
 * subscription or segment, import a CSV, or open someone for the full
 * picture.
 */
import { watchDebounced } from '@vueuse/core'
import type { Contact, ContactSubscription } from '#shared/contacts'
import type { ContactSegment } from '#shared/segments'
import { BILLING_FILTERS, STRIPE_ATTR, formatMoney, type StripeConnection } from '#shared/stripe'
import type { AdminProject } from '~~/server/utils/projects'
import ContactsTabs from '~/components/contacts/ContactsTabs.vue'
import ContactDrawer from '~/components/contacts/ContactDrawer.vue'
import CsvImportModal from '~/components/contacts/CsvImportModal.vue'
import { SUBSCRIPTION_STATUS } from '~/utils/contactStatus'
import { logTime } from '~/utils/emailStatus'

const props = defineProps<{ project: AdminProject }>()

const { api } = useAgent()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const contacts = ref<Contact[]>([])
const segments = ref<ContactSegment[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')

const search = ref('')
const subscription = ref<ContactSubscription | 'all'>('all')
const segment = ref(String(route.query.segment || 'all'))
// Stripe filters appear once Stripe is connected (a sync writes stripe_* attributes on contacts).
const stripe = ref<StripeConnection | null>(null)
const billing = ref('all')
const minRevenue = ref('')
const revenueOf = (c: Contact) => Number(c.attributes[STRIPE_ATTR.revenue]) || 0

const subscriptionItems = [{ label: 'Anyone', value: 'all' }, ...Object.entries(SUBSCRIPTION_STATUS).map(([value, s]) => ({ label: s.label, value, icon: s.icon }))]
const segmentItems = computed(() => [{ label: 'Everyone', value: 'all' }, ...segments.value.map(s => ({ label: s.name, value: s.id }))])

const query = computed(() => ({
  project: props.project.id,
  q: search.value.trim() || undefined,
  subscription: subscription.value === 'all' ? undefined : subscription.value,
  segment: segment.value === 'all' ? undefined : segment.value,
  billing: billing.value === 'all' ? undefined : billing.value,
  minRevenue: Number(minRevenue.value) > 0 ? Number(minRevenue.value) : undefined
}))
const filtered = computed(() => Boolean(query.value.q || query.value.subscription || query.value.segment || query.value.billing || query.value.minRevenue))

async function load() {
  error.value = ''
  try {
    const res = await api<{ contacts: Contact[], nextCursor: string | null }>('/contacts', { query: query.value })
    contacts.value = res.contacts
    nextCursor.value = res.nextCursor
  } catch (e: any) {
    error.value = e?.message || 'Could not load contacts'
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!nextCursor.value) return
  loadingMore.value = true
  try {
    const res = await api<{ contacts: Contact[], nextCursor: string | null }>('/contacts', { query: { ...query.value, cursor: nextCursor.value } })
    contacts.value.push(...res.contacts)
    nextCursor.value = res.nextCursor
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not load more', color: 'error' })
  } finally {
    loadingMore.value = false
  }
}

onMounted(() => {
  load()
  api<{ connection: StripeConnection }>('/admin/stripe', { query: { project: props.project.id } }).then((r) => { stripe.value = r.connection.connected ? r.connection : null }).catch(() => {})
  api<{ segments: ContactSegment[] }>('/segments', { query: { project: props.project.id } }).then(r => { segments.value = r.segments }).catch(() => {})
})
watchDebounced(query, load, { debounce: 300, deep: true })
watch(segment, (value) => { router.replace({ query: { ...route.query, segment: value === 'all' ? undefined : value } }) })

const openId = ref('')
const importOpen = ref(false)

// ---- adding one by hand ---------------------------------------------------------
const addOpen = ref(false)
const adding = ref(false)
const form = reactive({ email: '', name: '', externalId: '', optedIn: false })

async function add() {
  adding.value = true
  try {
    const res = await api<{ contact: Contact }>('/contacts', { method: 'POST', body: { project: props.project.id, email: form.email, name: form.name, externalId: form.externalId || undefined, ...(form.optedIn ? { subscription: 'subscribed' } : {}) } })
    addOpen.value = false
    Object.assign(form, { email: '', name: '', externalId: '', optedIn: false })
    await load()
    openId.value = res.contact.id
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not add them', color: 'error' })
  } finally {
    adding.value = false
  }
}

function changed(contact: Contact | null, id: string) {
  if (!contact) { contacts.value = contacts.value.filter(c => c.id !== id); return }
  const i = contacts.value.findIndex(c => c.id === contact.id)
  if (i >= 0) contacts.value[i] = contact
}

const displayName = (c: Contact) => c.name || c.email || c.externalId || 'Unnamed'
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project.id" title="Contacts">
      <template #title><ContactsTabs current="people" /></template>
      <template #actions>
        <UInput v-model="search" icon="i-lucide-search" placeholder="Name, email or id" size="sm" class="hidden w-48 sm:block" aria-label="Search contacts" />
        <USelect v-model="segment" :items="segmentItems" value-key="value" size="sm" class="hidden w-36 md:flex" aria-label="Segment" />
        <USelect v-model="subscription" :items="subscriptionItems" value-key="value" size="sm" class="hidden w-36 lg:flex" aria-label="Subscription" />
        <template v-if="stripe">
          <USelect v-model="billing" :items="[...BILLING_FILTERS]" value-key="value" size="sm" class="hidden w-36 xl:flex" aria-label="Billing" />
          <UInput v-model="minRevenue" type="number" min="0" placeholder="Spent over" size="sm" class="hidden w-28 xl:block" aria-label="Spent more than" />
        </template>
        <UButton icon="i-lucide-file-up" label="Import" size="sm" color="neutral" variant="outline" @click="importOpen = true" />
        <UButton icon="i-lucide-plus" label="Add" size="sm" @click="addOpen = true" />
      </template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 8" :key="i" class="h-11" /></div>
      <p v-else-if="error" class="p-6 text-[13px] text-error">{{ error }}</p>
      <EmptyState
        v-else-if="!contacts.length"
        icon="i-lucide-users"
        :title="filtered ? 'Nobody matches' : 'No contacts yet'"
        :description="filtered ? 'Try another filter.' : 'Your app\'s users show up here as they use support or feedback. Import a CSV, sync your database under Sources, or add people through the API.'"
      />
      <ul v-else class="py-2" aria-label="Contacts">
        <li v-for="c in contacts" :key="c.id">
          <button type="button" class="mx-2 flex h-11 w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-3 text-left text-[13px] transition-colors hover:bg-elevated" @click="openId = c.id">
            <UAvatar :src="c.avatarUrl || undefined" :alt="displayName(c)" size="xs" />
            <span class="w-44 shrink-0 truncate font-medium text-highlighted">{{ displayName(c) }}</span>
            <span class="min-w-0 flex-1 truncate text-muted">{{ c.name ? c.email : '' }}</span>
            <span class="hidden min-w-0 max-w-56 shrink items-center gap-1 overflow-hidden md:flex">
              <UBadge v-for="tag in c.tags.slice(0, 3)" :key="tag" :label="tag" color="neutral" variant="soft" size="sm" />
            </span>
            <span v-if="stripe" class="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted xl:block" title="Revenue from Stripe">{{ revenueOf(c) ? formatMoney(revenueOf(c), stripe.currency) : '' }}</span>
            <UTooltip :text="SUBSCRIPTION_STATUS[c.subscription].hint">
              <UBadge :icon="SUBSCRIPTION_STATUS[c.subscription].icon" :label="SUBSCRIPTION_STATUS[c.subscription].label" :color="SUBSCRIPTION_STATUS[c.subscription].color" variant="subtle" size="sm" class="w-32 shrink-0 justify-start" />
            </UTooltip>
            <span class="hidden w-20 shrink-0 text-right text-xs text-muted lg:block" :title="c.lastSeenAt ? 'Last seen' : 'Added'">{{ logTime(c.lastSeenAt || c.createdAt || '') }}</span>
          </button>
        </li>
      </ul>
      <div v-if="nextCursor && !loading" class="flex justify-center pb-6">
        <UButton label="Load more" color="neutral" variant="outline" size="sm" :loading="loadingMore" @click="loadMore" />
      </div>
    </div>

    <ContactDrawer v-model:id="openId" :project="project" @changed="changed" />
    <CsvImportModal v-model:open="importOpen" :project="project" @imported="load" />

    <UModal v-model:open="addOpen" title="Add a contact" description="Someone your app knows by email, by id, or both.">
      <template #body>
        <form class="space-y-4" @submit.prevent="add">
          <UFormField label="Email"><UInput v-model="form.email" type="email" placeholder="ada@example.com" class="w-full" autofocus /></UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Name"><UInput v-model="form.name" placeholder="Optional" class="w-full" /></UFormField>
            <UFormField label="User id" hint="Your app's id"><UInput v-model="form.externalId" placeholder="Optional" class="w-full" /></UFormField>
          </div>
          <UCheckbox v-model="form.optedIn" label="They asked to get marketing email" description="Records your panel as the consent source." />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">Cancel</UButton>
            <UButton type="submit" :loading="adding" :disabled="!form.email.trim() && !form.externalId.trim()">Add</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
