<script setup lang="ts">
/**
 * A project's people: the app's own users (from identity tokens), imports,
 * database syncs, lead forms and newsletter sign-ups, newest first, each with
 * how they got here. Search, filter by subscription, segment or how they were
 * added, import a CSV, or open someone for the full picture.
 */
import { useInfiniteScroll, useVirtualList, watchDebounced } from '@vueuse/core'
import { CONTACT_ORIGIN_TYPES, type Contact, type ContactOriginType, type ContactSubscription } from '#shared/contacts'
import type { ContactSegment } from '#shared/segments'
import { BILLING_FILTERS, STRIPE_ATTR, formatMoney, type StripeConnection } from '#shared/stripe'
import type { AdminProject } from '~~/server/utils/projects'
import ContactsTabs from '~/components/contacts/ContactsTabs.vue'
import ContactDrawer from '~/components/contacts/ContactDrawer.vue'
import CsvImportModal from '~/components/contacts/CsvImportModal.vue'
import { SUBSCRIPTION_STATUS } from '~/utils/contactStatus'
import { ORIGIN_ICONS, originText } from '~/utils/contactOrigin'
import { logTime } from '~/utils/emailStatus'

const props = defineProps<{ project: AdminProject }>()

const { api } = useAgent()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { t } = useI18n()

const contacts = ref<Contact[]>([])
const segments = ref<ContactSegment[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')

const search = ref('')
const subscription = ref<ContactSubscription | 'all'>('all')
const segment = ref(String(route.query.segment || 'all'))
const origin = ref<ContactOriginType | 'all'>((CONTACT_ORIGIN_TYPES as string[]).includes(String(route.query.origin)) ? route.query.origin as ContactOriginType : 'all')
// Lead forms and database syncs by id, so a contact's origin reads "Lead form · Waitlist".
const originNames = ref<Record<string, string>>({})
const originKind = (type: ContactOriginType) => t(`contacts.origin.${type}`)
const originLabel = (c: Contact) => originText(c.origin, originKind, originNames.value)
// Stripe filters appear once Stripe is connected (a sync writes stripe_* attributes on contacts).
const stripe = ref<StripeConnection | null>(null)
const billing = ref('all')
const minRevenue = ref('')
const revenueOf = (c: Contact) => Number(c.attributes[STRIPE_ATTR.revenue]) || 0

const subscriptionLabel = (value: string) => t(`contacts.subscription.${value}.label`)
const subscriptionItems = computed(() => [{ label: t('contacts.filter.anyone'), value: 'all' }, ...Object.entries(SUBSCRIPTION_STATUS).map(([value, s]) => ({ label: subscriptionLabel(value), value, icon: s.icon }))])
const billingItems = computed(() => BILLING_FILTERS.map(f => ({ label: t(`contacts.billingFilter.${f.value}`), value: f.value })))
// Who to show: everyone, a segment, or everyone added one way ("origin:<type>"), in one select.
const audienceItems = computed(() => [
  [{ label: t('contacts.filter.everyone'), value: 'all' }, ...segments.value.map(s => ({ label: s.name, value: s.id }))],
  [{ type: 'label' as const, label: t('contacts.filter.origin'), value: '' }, ...CONTACT_ORIGIN_TYPES.map(value => ({ label: originKind(value), value: `origin:${value}`, icon: ORIGIN_ICONS[value] }))]
])
const audience = computed({
  get: () => (origin.value !== 'all' ? `origin:${origin.value}` : segment.value),
  set: (value: string) => {
    if (value.startsWith('origin:')) { origin.value = value.slice(7) as ContactOriginType; segment.value = 'all' } else { origin.value = 'all'; segment.value = value }
  }
})

const query = computed(() => ({
  project: props.project.id,
  q: search.value.trim() || undefined,
  subscription: subscription.value === 'all' ? undefined : subscription.value,
  segment: segment.value === 'all' ? undefined : segment.value,
  origin: origin.value === 'all' ? undefined : origin.value,
  billing: billing.value === 'all' ? undefined : billing.value,
  minRevenue: Number(minRevenue.value) > 0 ? Number(minRevenue.value) : undefined
}))
const filtered = computed(() => Boolean(query.value.q || query.value.subscription || query.value.segment || query.value.origin || query.value.billing || query.value.minRevenue))

// Only the rows in view are rendered; scrolling near the bottom fetches the next page.
const ROW_HEIGHT = 44
const { list: rows, containerProps, wrapperProps, scrollTo } = useVirtualList(contacts, { itemHeight: ROW_HEIGHT, overscan: 8 })
useInfiniteScroll(containerProps.ref, () => loadMore(), {
  distance: 300,
  canLoadMore: () => Boolean(nextCursor.value) && !loading.value && !loadingMore.value
})

async function load() {
  error.value = ''
  try {
    const res = await api<{ contacts: Contact[], nextCursor: string | null }>('/contacts', { query: query.value })
    contacts.value = res.contacts
    nextCursor.value = res.nextCursor
    scrollTo(0)
  } catch (e: any) {
    error.value = e?.message || t('contacts.loadError')
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
    toast.add({ title: e?.message || t('contacts.loadMoreError'), color: 'error' })
  } finally {
    loadingMore.value = false
  }
}

onMounted(() => {
  load()
  api<{ connection: StripeConnection }>('/admin/stripe', { query: { project: props.project.id } }).then((r) => { stripe.value = r.connection.connected ? r.connection : null }).catch(() => {})
  api<{ segments: ContactSegment[] }>('/segments', { query: { project: props.project.id } }).then(r => { segments.value = r.segments }).catch(() => {})
  api<{ forms: { id: string, name: string }[] }>('/admin/lead-forms', { query: { project: props.project.id } }).then((r) => { for (const f of r.forms) originNames.value[f.id] = f.name }).catch(() => {})
  api<{ sources: { id: string, name: string }[] }>('/admin/contact-sources', { query: { project: props.project.id } }).then((r) => { for (const s of r.sources) originNames.value[s.id] = s.name }).catch(() => {})
})
watchDebounced(query, load, { debounce: 300, deep: true })
watch(segment, (value) => { router.replace({ query: { ...route.query, segment: value === 'all' ? undefined : value } }) })
watch(origin, (value) => { router.replace({ query: { ...route.query, origin: value === 'all' ? undefined : value } }) })

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
    toast.add({ title: e?.message || t('contacts.addError'), color: 'error' })
  } finally {
    adding.value = false
  }
}

function changed(contact: Contact | null, id: string) {
  if (!contact) { contacts.value = contacts.value.filter(c => c.id !== id); return }
  const i = contacts.value.findIndex(c => c.id === contact.id)
  if (i >= 0) contacts.value[i] = contact
}

const displayName = (c: Contact) => c.name || c.email || c.externalId || t('contacts.unnamed')
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project.id" :title="$t('contacts.title')">
      <template #title><ContactsTabs current="people" /></template>
      <template #actions>
        <UInput v-model="search" icon="i-lucide-search" :placeholder="$t('contacts.searchPlaceholder')" size="sm" class="hidden w-48 sm:block" :aria-label="$t('contacts.searchLabel')" />
        <USelect v-model="audience" :items="audienceItems" value-key="value" size="sm" class="hidden w-36 md:flex" :aria-label="$t('contacts.filter.segment')" />
        <USelect v-model="subscription" :items="subscriptionItems" value-key="value" size="sm" class="hidden w-36 lg:flex" :aria-label="$t('contacts.filter.subscription')" />
        <template v-if="stripe">
          <USelect v-model="billing" :items="billingItems" value-key="value" size="sm" class="hidden w-36 xl:flex" :aria-label="$t('contacts.filter.billing')" />
          <UInput v-model="minRevenue" type="number" min="0" :placeholder="$t('contacts.filter.spentOver')" size="sm" class="hidden w-28 xl:block" :aria-label="$t('contacts.filter.spentMoreThan')" />
        </template>
        <UButton icon="i-lucide-file-up" :label="$t('contacts.import')" size="sm" color="neutral" variant="outline" @click="importOpen = true" />
        <UButton icon="i-lucide-plus" :label="$t('contacts.add')" size="sm" @click="addOpen = true" />
      </template>
    </PageHeader>

    <div v-bind="containerProps" class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loading" class="space-y-1 p-4"><USkeleton v-for="i in 8" :key="i" class="h-11" /></div>
      <p v-else-if="error" class="p-6 text-[13px] text-error">{{ error }}</p>
      <EmptyState
        v-else-if="!contacts.length"
        icon="i-lucide-users"
        :title="filtered ? $t('contacts.empty.filteredTitle') : $t('contacts.empty.title')"
        :description="filtered ? $t('contacts.empty.filteredDescription') : $t('contacts.empty.description')"
      />
      <ul v-else v-bind="wrapperProps" :aria-label="$t('contacts.listLabel')">
        <li v-for="{ data: c } in rows" :key="c.id" class="h-11">
          <button type="button" class="mx-2 flex h-11 w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-3 text-left text-[13px] transition-colors hover:bg-elevated" @click="openId = c.id">
            <UAvatar :src="c.avatarUrl || undefined" :alt="displayName(c)" size="xs" />
            <span class="w-44 shrink-0 truncate font-medium text-highlighted">{{ displayName(c) }}</span>
            <span class="min-w-0 flex-1 truncate text-muted">{{ c.name ? c.email : '' }}</span>
            <span class="hidden min-w-0 max-w-56 shrink items-center gap-1 overflow-hidden md:flex">
              <UBadge v-for="tag in c.tags.slice(0, 3)" :key="tag" :label="tag" color="neutral" variant="soft" size="sm" />
            </span>
            <span class="hidden w-40 shrink-0 items-center gap-1.5 truncate text-xs text-muted lg:flex" :title="$t('contacts.drawer.addedVia')">
              <template v-if="c.origin"><UIcon :name="ORIGIN_ICONS[c.origin.type]" class="size-3.5 shrink-0" /><span class="truncate">{{ originLabel(c) }}</span></template>
            </span>
            <span v-if="stripe" class="hidden w-20 shrink-0 text-right text-xs tabular-nums text-muted xl:block" :title="$t('contacts.revenueTitle')">{{ revenueOf(c) ? formatMoney(revenueOf(c), stripe.currency) : '' }}</span>
            <UTooltip :text="$t(`contacts.subscription.${c.subscription}.hint`)">
              <UBadge :icon="SUBSCRIPTION_STATUS[c.subscription].icon" :label="subscriptionLabel(c.subscription)" :color="SUBSCRIPTION_STATUS[c.subscription].color" variant="subtle" size="sm" class="w-32 shrink-0 justify-start" />
            </UTooltip>
            <span class="hidden w-20 shrink-0 text-right text-xs text-muted lg:block" :title="c.lastSeenAt ? $t('contacts.lastSeen') : $t('contacts.added')">{{ logTime(c.lastSeenAt || c.createdAt || '') }}</span>
          </button>
        </li>
      </ul>
      <div v-if="loadingMore" class="flex justify-center py-4"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-muted" /></div>
    </div>

    <ContactDrawer v-model:id="openId" :project="project" @changed="changed" />
    <CsvImportModal v-model:open="importOpen" :project="project" @imported="load" />

    <UModal v-model:open="addOpen" :title="$t('contacts.addModal.title')" :description="$t('contacts.addModal.description')">
      <template #body>
        <form class="space-y-4" @submit.prevent="add">
          <UFormField :label="$t('contacts.form.email')"><UInput v-model="form.email" type="email" placeholder="ada@example.com" class="w-full" autofocus /></UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="$t('common.name')"><UInput v-model="form.name" :placeholder="$t('contacts.form.optional')" class="w-full" /></UFormField>
            <UFormField :label="$t('contacts.form.userId')" :hint="$t('contacts.form.userIdHint')"><UInput v-model="form.externalId" :placeholder="$t('contacts.form.optional')" class="w-full" /></UFormField>
          </div>
          <UCheckbox v-model="form.optedIn" :label="$t('contacts.form.optedIn')" :description="$t('contacts.form.optedInDescription')" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="addOpen = false">{{ $t('common.cancel') }}</UButton>
            <UButton type="submit" :loading="adding" :disabled="!form.email.trim() && !form.externalId.trim()">{{ $t('contacts.add') }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
