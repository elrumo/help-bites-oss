<script setup lang="ts">
/**
 * One person, everything HelpBites knows: who they are (and in which of your
 * systems), how they got here, their attributes and tags, marketing consent
 * and the proof of it, and what happened between you: one timeline of their
 * conversations, feedback, emails, sequences and onboarding
 * (GET /v1/contacts/:id/activity), next to their billing.
 */
import { originTypeForVia, type Contact, type ContactAttributeValue, type ContactOriginType, type ContactSubscription } from '#shared/contacts'
import type { ActivityItem, ActivityType, ContactActivity } from '#shared/activity'
import { COMMON_LOCALES, localeName } from '#shared/locales'
import { STRIPE_ATTR, formatMoney, fromMinor, type StripeCustomerDto, type StripePaymentDto, type StripeSubscriptionDto } from '#shared/stripe'
import type { AdminProject } from '~~/server/utils/projects'
import { SUBSCRIPTION_STATUS } from '~/utils/contactStatus'
import { ORIGIN_ICONS, originText } from '~/utils/contactOrigin'
import { ACTIVITY_ICONS, BILLING_ACTIVITY, activityLink, relativeTime } from '~/utils/contactActivity'
import LeadFileList from '~/components/contacts/LeadFileList.vue'
import { EMAIL_STATUS, logTime } from '~/utils/emailStatus'
import AddToSequenceModal from '~/components/contacts/AddToSequenceModal.vue'

const props = defineProps<{ project: AdminProject }>()
const id = defineModel<string>('id', { default: '' })
const emit = defineEmits<{ changed: [contact: Contact | null, id: string] }>()

const { api } = useAgent()
const toast = useToast()
const { t, te, locale: uiLocale } = useI18n()

const open = computed({ get: () => Boolean(id.value), set: (v) => { if (!v) id.value = '' } })
const contact = ref<Contact | null>(null)
// Their timeline, newest first; `nextBefore` pages further back.
const activity = ref<ActivityItem[]>([])
const nextBefore = ref<string | null>(null)
const activityState = ref<'loading' | 'ready' | 'more' | 'error'>('loading')
const sequenceOpen = ref(false)
// Stripe: null until it says it is connected (a 403 for roles that may not see money also leaves it null).
const billing = ref<{ currency: string, customer: StripeCustomerDto | null, subscriptions: StripeSubscriptionDto[], payments: StripePaymentDto[] } | null>(null)
const saving = ref(false)
// Lead forms and syncs by id, for "Added via" and "Lead forms".
const names = ref<Record<string, string>>({})
const originKind = (type: ContactOriginType) => t(`contacts.origin.${type}`)
// Consent records the writer (form, import, a source id…): said the way origins are.
const consentSource = (source: string) => (names.value[source] || originKind(/^[A-Za-z0-9]{10}$/.test(source) ? 'sync' : originTypeForVia(source)))

const name = ref('')
const language = ref('')
const tags = ref<string[]>([])
const attributes = ref<{ key: string, value: string }[]>([])

async function load() {
  const current = id.value
  contact.value = null
  activity.value = []
  nextBefore.value = null
  activityState.value = 'loading'
  billing.value = null
  if (!current) return
  try {
    const { contact: c } = await api<{ contact: Contact }>(`/contacts/${current}`, { query: { project: props.project.id } })
    if (id.value !== current) return
    contact.value = c
    name.value = c.name
    language.value = c.language || ''
    tags.value = [...c.tags]
    attributes.value = Object.entries(c.attributes).map(([key, value]) => ({ key, value: String(value) }))
    loadActivity(false)
    api<NonNullable<typeof billing.value>>('/admin/stripe/contact', { query: { project: props.project.id, contact: c.id } }).then((r) => { if (id.value === current && r.currency) billing.value = r }).catch(() => {})
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.drawer.loadError'), color: 'error' })
    id.value = ''
  }
}
// Payments and subscriptions are in the Billing section, live from Stripe.
const ACTIVITY_KINDS = (Object.keys(ACTIVITY_ICONS) as ActivityType[]).filter(type => !BILLING_ACTIVITY.includes(type)).join(',')
const NuxtLink = resolveComponent('NuxtLink')
const linkOf = (item: ActivityItem) => activityLink(props.project.id, item.ref)

async function loadActivity(more: boolean) {
  const current = id.value
  if (!current) return
  activityState.value = more ? 'more' : 'loading'
  try {
    const res = await api<ContactActivity>(`/contacts/${current}/activity`, { query: { project: props.project.id, types: ACTIVITY_KINDS, limit: 20, before: more ? nextBefore.value || undefined : undefined } })
    if (id.value !== current) return
    activity.value = more ? [...activity.value, ...res.items.filter(item => !activity.value.some(known => known.id === item.id))] : res.items
    nextBefore.value = res.nextBefore
    activityState.value = 'ready'
  } catch {
    if (id.value === current) activityState.value = 'error'
  }
}

watch(id, load, { immediate: true })
onMounted(() => {
  api<{ forms: { id: string, name: string }[] }>('/admin/lead-forms', { query: { project: props.project.id } }).then((r) => { for (const f of r.forms) names.value[f.id] = f.name }).catch(() => {})
  api<{ sources: { id: string, name: string }[] }>('/admin/contact-sources', { query: { project: props.project.id } }).then((r) => { for (const s of r.sources) names.value[s.id] = s.name }).catch(() => {})
})

// What was typed back into the type it was stored as: numbers stay numbers.
function typed(value: string, before: ContactAttributeValue | undefined): ContactAttributeValue {
  if (typeof before === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  if (typeof before === 'boolean' && (value === 'true' || value === 'false')) return value === 'true'
  return value
}

async function save(body: Record<string, unknown>) {
  if (!contact.value) return
  saving.value = true
  try {
    const res = await api<{ contact: Contact }>(`/contacts/${contact.value.id}`, { method: 'PATCH', body: { project: props.project.id, ...body } })
    contact.value = res.contact
    emit('changed', res.contact, res.contact.id)
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.drawer.saveError'), color: 'error' })
  } finally {
    saving.value = false
  }
}

function saveProfile() {
  if (!contact.value) return
  const before = contact.value.attributes
  const next: Record<string, ContactAttributeValue | null> = {}
  for (const { key, value } of attributes.value) if (key.trim()) next[key.trim()] = typed(value, before[key.trim()])
  for (const key of Object.keys(before)) if (!(key in next)) next[key] = null
  save({ name: name.value, language: language.value, tags: tags.value, attributes: next })
}

async function setSubscription(value: ContactSubscription) {
  if (!contact.value) return
  if (contact.value.subscription === 'unsubscribed' && value === 'subscribed') {
    if (!window.confirm(t('contacts.drawer.resubscribeConfirm'))) return
    return save({ subscription: value, resubscribe: true })
  }
  return save({ subscription: value })
}

async function erase() {
  if (!contact.value) return
  if (!window.confirm(t('contacts.drawer.eraseConfirm', { who: contact.value.email || contact.value.externalId }))) return
  try {
    await api(`/contacts/${contact.value.id}`, { method: 'DELETE', query: { project: props.project.id } })
    emit('changed', null, contact.value.id)
    id.value = ''
  } catch (e: any) {
    toast.add({ title: e?.message || t('contacts.drawer.eraseError'), color: 'error' })
  }
}

const subscriptionItems = computed(() => (Object.keys(SUBSCRIPTION_STATUS) as ContactSubscription[])
  .filter(s => s !== 'pending' || contact.value?.subscription === 'pending')
  .map(value => ({ label: t(`contacts.subscription.${value}.label`), value, icon: SUBSCRIPTION_STATUS[value].icon })))
const money = (minor: number, currency: string) => formatMoney(fromMinor(minor, currency), currency)
const attr = (key: string) => contact.value?.attributes[key]
const INTERVALS = ['day', 'week', 'month', 'year']
const every = (s: StripeSubscriptionDto) => `${money(s.amount, s.currency)}/${s.intervalCount > 1 ? `${s.intervalCount} ` : ''}${INTERVALS.includes(s.interval) ? t(`contacts.intervals.${s.interval}`) : s.interval}`
const SUB_COLOR: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = { active: 'success', trialing: 'info', past_due: 'warning', unpaid: 'error', canceled: 'neutral' }
// The live customer when Stripe found one (and knows whether it is a test one), else the id the last sync linked.
const stripeUrl = computed(() => {
  const customerId = billing.value?.customer?.id || attr(STRIPE_ATTR.customer)
  return customerId ? `https://dashboard.stripe.com/${billing.value?.customer?.livemode === false ? 'test/' : ''}customers/${customerId}` : ''
})
const fullDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—')
const country = (code: string) => { try { return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) || code } catch { return code } }
// Stripe and conversation statuses come from outside the panel; unknown ones show as sent.
const statusText = (prefix: string, value: string) => (te(`${prefix}.${value}`) ? t(`${prefix}.${value}`) : value.replace('_', ' '))
// Their own language first (it may be one the picker does not list), then the common ones.
const languageItems = computed(() => [...new Set([contact.value?.language, ...COMMON_LOCALES].filter((tag): tag is string => Boolean(tag)))].map(value => ({ value, label: `${localeName(value, uiLocale.value)} · ${value}` })))
const dirty = computed(() => contact.value && (name.value !== contact.value.name || language.value !== (contact.value.language || '') || JSON.stringify(tags.value) !== JSON.stringify(contact.value.tags) || JSON.stringify(attributes.value) !== JSON.stringify(Object.entries(contact.value.attributes).map(([key, value]) => ({ key, value: String(value) })))))
</script>

<template>
  <USlideover v-model:open="open" :title="contact?.name || contact?.email || $t('contacts.contact')" :description="contact ? [contact.name ? contact.email : '', contact.externalId && $t('contacts.drawer.userIdLine', { id: contact.externalId })].filter(Boolean).join(' · ') : ''" :ui="{ content: 'max-w-xl' }">
    <template #body>
      <div v-if="!contact" class="space-y-2"><USkeleton v-for="i in 6" :key="i" class="h-8" /></div>
      <div v-else class="space-y-6 text-[13px]">
        <section class="space-y-3">
          <div class="flex items-center gap-2">
            <USelect :model-value="contact.subscription" :items="subscriptionItems" value-key="value" size="sm" class="w-44" :aria-label="$t('contacts.drawer.marketingEmail')" :disabled="saving" @update:model-value="setSubscription($event as ContactSubscription)" />
            <span class="text-xs text-muted">{{ $t(`contacts.subscription.${contact.subscription}.hint`) }}</span>
          </div>
          <p v-if="contact.consent" class="text-xs text-muted">
            {{ $t('contacts.drawer.optedIn', { source: consentSource(contact.consent.source), date: fullDate(contact.consent.at) }) }}<span v-if="contact.consent.confirmedAt">{{ $t('contacts.drawer.confirmedOn', { date: fullDate(contact.consent.confirmedAt) }) }}</span><span v-if="contact.consent.formUrl">{{ $t('contacts.drawer.fromForm', { url: contact.consent.formUrl }) }}</span><span v-if="contact.consent.ip"> · {{ contact.consent.ip }}</span>
          </p>
          <p v-if="contact.unsubscribedTopics.length" class="text-xs text-muted">{{ $t('contacts.drawer.optedOutOf', { topics: contact.unsubscribedTopics.join(', ') }) }}</p>
          <p v-if="!contact.feedbackEmails" class="text-xs text-muted">{{ $t('contacts.drawer.feedbackOff') }}</p>
        </section>

        <section class="space-y-3">
          <UFormField :label="$t('common.name')"><UInput v-model="name" class="w-full" /></UFormField>
          <UFormField :label="$t('contacts.drawer.language')" :hint="$t('contacts.drawer.languageHint')"><OptionalSelect v-model="language" :items="languageItems" :none-label="$t('contacts.drawer.languageNone')" class="w-full" /></UFormField>
          <UFormField :label="$t('contacts.form.tags')"><UInputTags v-model="tags" :placeholder="$t('contacts.drawer.addTag')" class="w-full" /></UFormField>
          <UFormField :label="$t('contacts.drawer.attributes')" :hint="$t('contacts.drawer.attributesHint')">
            <div class="space-y-1.5">
              <div v-for="(attr, i) in attributes" :key="i" class="flex items-center gap-1.5">
                <UInput v-model="attr.key" :placeholder="$t('contacts.drawer.key')" size="sm" class="w-36 font-mono" />
                <UInput v-model="attr.value" :placeholder="$t('contacts.drawer.value')" size="sm" class="min-w-0 flex-1" />
                <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('contacts.drawer.removeAttribute')" @click="attributes.splice(i, 1)" />
              </div>
              <UButton icon="i-lucide-plus" :label="$t('contacts.drawer.attribute')" size="xs" color="neutral" variant="ghost" @click="attributes.push({ key: '', value: '' })" />
            </div>
          </UFormField>
          <div class="flex justify-end">
            <UButton :label="$t('contacts.save')" size="sm" :loading="saving" :disabled="!dirty" @click="saveProfile" />
          </div>
        </section>

        <dl class="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 border-t border-default pt-4">
          <dt class="text-muted">{{ $t('contacts.form.email') }}</dt><dd class="min-w-0 break-words">{{ contact.email || contact.pendingEmail || '—' }}<UBadge v-if="!contact.email && contact.pendingEmail" :label="$t('contacts.drawer.unverified')" color="warning" variant="subtle" size="sm" class="ms-2" :title="$t('contacts.drawer.unverifiedHint')" /></dd>
          <dt class="text-muted">{{ $t('contacts.form.userId') }}</dt><dd class="min-w-0 break-words font-mono text-xs">{{ contact.externalId || '—' }}</dd>
          <template v-if="contact.username"><dt class="text-muted">{{ $t('contacts.drawer.handle') }}</dt><dd>@{{ contact.username }}</dd></template>
          <dt class="text-muted">{{ $t('contacts.added') }}</dt><dd>{{ fullDate(contact.createdAt) }}</dd>
          <template v-if="contact.origin">
            <dt class="text-muted">{{ $t('contacts.drawer.addedVia') }}</dt>
            <dd class="flex min-w-0 items-center gap-1.5"><UIcon :name="ORIGIN_ICONS[contact.origin.type]" class="size-3.5 shrink-0 text-muted" />{{ originText(contact.origin, originKind, names) }}</dd>
          </template>
          <template v-if="contact.leadForms.length">
            <dt class="text-muted">{{ $t('contacts.drawer.leadForms') }}</dt>
            <dd class="flex flex-wrap gap-1"><UBadge v-for="f in contact.leadForms" :key="f" :label="names[f] || $t('contacts.drawer.deletedForm')" color="neutral" variant="soft" size="sm" :to="names[f] ? `/projects/${project.id}/forms/${f}` : undefined" /></dd>
          </template>
          <dt class="text-muted">{{ $t('contacts.lastSeen') }}</dt><dd>{{ fullDate(contact.lastSeenAt) }}</dd>
          <template v-if="contact.sources.length"><dt class="text-muted">{{ $t('contacts.drawer.syncedFrom') }}</dt><dd>{{ $t('contacts.drawer.sourceCount', contact.sources.length) }}</dd></template>
        </dl>

        <LeadFileList v-if="contact.leadForms.length" :key="contact.id" :project-id="project.id" :contact="contact.id">
          <template #title><h3 class="text-xs font-semibold text-muted">{{ $t('contacts.drawer.files') }}</h3></template>
        </LeadFileList>

        <section v-if="billing" class="space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="text-xs font-semibold text-muted">{{ $t('contacts.drawer.billing') }}</h3>
            <span v-if="attr(STRIPE_ATTR.revenue)" class="text-xs text-muted">{{ $t('contacts.drawer.paidInTotal', { amount: formatMoney(Number(attr(STRIPE_ATTR.revenue)), billing.currency) }) }}</span>
            <UButton v-if="stripeUrl" :to="stripeUrl" target="_blank" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-up-right" label="Stripe" class="ml-auto" />
          </div>
          <p v-if="billing.customer" class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
            <span>{{ $t('contacts.drawer.customerSince', { date: day(billing.customer.createdAt) }) }}</span>
            <span v-if="billing.customer.country">· {{ country(billing.customer.country) }}</span>
            <span v-if="billing.customer.balance">· {{ $t(billing.customer.balance < 0 ? 'contacts.drawer.credit' : 'contacts.drawer.owes', { amount: money(Math.abs(billing.customer.balance), billing.customer.currency || billing.currency) }) }}</span>
            <UBadge v-if="billing.customer.delinquent" :label="$t('contacts.drawer.delinquent')" color="warning" variant="subtle" size="sm" />
          </p>
          <p v-if="!billing.subscriptions.length && !billing.payments.length" class="text-xs text-dimmed">{{ $t('contacts.drawer.noStripe') }}</p>
          <ul v-if="billing.subscriptions.length" class="divide-y divide-default rounded-lg border border-default" :aria-label="$t('contacts.drawer.subscriptions')">
            <li v-for="s in billing.subscriptions" :key="s.id" class="flex items-center gap-2 px-3 py-2">
              <span class="min-w-0 flex-1 truncate">{{ s.plan }}<span class="text-muted"> · {{ every(s) }}</span></span>
              <UBadge :label="s.cancelAtPeriodEnd && s.status === 'active' ? $t('contacts.drawer.endsOn', { date: logTime(s.currentPeriodEnd) }) : statusText('contacts.stripeStatus', s.status)" :color="SUB_COLOR[s.status] || 'neutral'" variant="subtle" size="sm" />
              <span class="w-14 text-right text-xs text-muted" :title="s.canceledAt ? $t('contacts.drawer.canceled') : $t('contacts.drawer.started')">{{ logTime(s.canceledAt || s.startedAt) }}</span>
            </li>
          </ul>
          <ul v-if="billing.payments.length" class="divide-y divide-default rounded-lg border border-default" :aria-label="$t('contacts.drawer.payments')">
            <li v-for="p in billing.payments" :key="p.id" class="flex items-center gap-2 px-3 py-2">
              <span class="min-w-0 flex-1 truncate">{{ p.description || $t('contacts.drawer.payment') }}</span>
              <UBadge v-if="p.status !== 'succeeded'" :label="statusText('contacts.stripeStatus', p.status)" color="error" variant="subtle" size="sm" />
              <UBadge v-else-if="p.refunded" :label="p.refunded >= p.amount ? $t('contacts.drawer.refunded') : $t('contacts.drawer.partRefunded')" color="neutral" variant="subtle" size="sm" />
              <a v-if="p.receiptUrl" :href="p.receiptUrl" target="_blank" rel="noopener" class="tabular-nums hover:underline">{{ money(p.amount, p.currency) }}</a>
              <span v-else class="tabular-nums">{{ money(p.amount, p.currency) }}</span>
              <span class="w-14 text-right text-xs text-muted">{{ logTime(p.paidAt) }}</span>
            </li>
          </ul>
        </section>

        <section class="space-y-2">
          <h3 class="text-xs font-semibold text-muted">{{ $t('contacts.drawer.activity') }}</h3>
          <div v-if="activityState === 'loading'" class="space-y-1.5"><USkeleton v-for="i in 3" :key="i" class="h-9" /></div>
          <p v-else-if="activityState === 'error' && !activity.length" class="text-xs text-error">{{ $t('contacts.drawer.activityError') }}</p>
          <p v-else-if="!activity.length" class="text-xs text-dimmed">{{ $t('contacts.drawer.activityNone') }}</p>
          <ul v-else class="divide-y divide-default rounded-lg border border-default" :aria-label="$t('contacts.drawer.activity')">
            <li v-for="item in activity" :key="item.id">
              <component :is="linkOf(item) ? NuxtLink : 'div'" :to="linkOf(item) || undefined" class="flex items-center gap-2.5 px-3 py-2" :class="linkOf(item) && 'hover:bg-elevated'">
                <UIcon :name="ACTIVITY_ICONS[item.type]" class="size-3.5 shrink-0 text-muted" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{{ item.title }}</span>
                  <span v-if="item.detail" class="block truncate text-xs text-muted">{{ item.detail }}</span>
                </span>
                <time :datetime="item.at" :title="fullDate(item.at)" class="shrink-0 text-xs text-muted">{{ relativeTime(item.at, undefined, uiLocale) }}</time>
              </component>
            </li>
          </ul>
          <div v-if="nextBefore" class="flex justify-center">
            <UButton :label="$t('contacts.drawer.showOlder')" size="xs" color="neutral" variant="ghost" :loading="activityState === 'more'" @click="loadActivity(true)" />
          </div>
        </section>

        <div class="flex flex-wrap gap-2 border-t border-default pt-4">
          <UButton icon="i-lucide-list-plus" :label="$t('contacts.drawer.addToSequence')" size="sm" color="neutral" variant="outline" @click="sequenceOpen = true" />
          <UButton icon="i-lucide-trash-2" :label="$t('contacts.drawer.erase')" size="sm" color="error" variant="outline" @click="erase" />
        </div>
      </div>
    </template>
  </USlideover>
  <AddToSequenceModal v-if="contact" v-model:open="sequenceOpen" :project="project" :contact-id="contact.id" />
</template>
