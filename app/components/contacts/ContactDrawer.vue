<script setup lang="ts">
/**
 * One person, everything HelpBites knows: who they are (and in which of your
 * systems), their attributes and tags, marketing consent and the proof of it,
 * and what happened between you — conversations and every email they got.
 */
import type { Contact, ContactAttributeValue, ContactSubscription } from '#shared/contacts'
import type { Conversation } from '#shared/support'
import { STRIPE_ATTR, formatMoney, fromMinor, type StripePaymentDto, type StripeSubscriptionDto } from '#shared/stripe'
import type { EmailLogEntry } from '~~/server/utils/emailLogs'
import type { AdminProject } from '~~/server/utils/projects'
import { SUBSCRIPTION_STATUS } from '~/utils/contactStatus'
import { EMAIL_STATUS, logTime } from '~/utils/emailStatus'

const props = defineProps<{ project: AdminProject }>()
const id = defineModel<string>('id', { default: '' })
const emit = defineEmits<{ changed: [contact: Contact | null, id: string] }>()

const { api } = useAgent()
const toast = useToast()

const open = computed({ get: () => Boolean(id.value), set: (v) => { if (!v) id.value = '' } })
const contact = ref<Contact | null>(null)
const conversations = ref<Conversation[]>([])
const emails = ref<EmailLogEntry[]>([])
// Stripe: null until it says it is connected (a 403 for roles that may not see money also leaves it null).
const billing = ref<{ currency: string, subscriptions: StripeSubscriptionDto[], payments: StripePaymentDto[] } | null>(null)
const saving = ref(false)

const name = ref('')
const tags = ref<string[]>([])
const attributes = ref<{ key: string, value: string }[]>([])

async function load() {
  const current = id.value
  contact.value = null
  conversations.value = []
  emails.value = []
  billing.value = null
  if (!current) return
  try {
    const { contact: c } = await api<{ contact: Contact }>(`/contacts/${current}`, { query: { project: props.project.id } })
    if (id.value !== current) return
    contact.value = c
    name.value = c.name
    tags.value = [...c.tags]
    attributes.value = Object.entries(c.attributes).map(([key, value]) => ({ key, value: String(value) }))
    api<{ conversations: Conversation[] }>('/admin/conversations', { query: { project: props.project.id, endUser: c.id, archived: 'any', limit: 20 } }).then(r => { conversations.value = r.conversations }).catch(() => {})
    api<NonNullable<typeof billing.value>>('/admin/stripe/contact', { query: { project: props.project.id, contact: c.id } }).then((r) => { if (id.value === current && r.currency) billing.value = r }).catch(() => {})
    if (c.email) api<{ logs: EmailLogEntry[] }>('/admin/email-logs', { query: { project: props.project.id, to: c.email, limit: 20 } }).then(r => { emails.value = r.logs.filter(l => l.to === c.email) }).catch(() => {})
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not load the contact', color: 'error' })
    id.value = ''
  }
}
watch(id, load, { immediate: true })

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
    toast.add({ title: e?.message || 'Could not save', color: 'error' })
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
  save({ name: name.value, tags: tags.value, attributes: next })
}

async function setSubscription(value: ContactSubscription) {
  if (!contact.value) return
  if (contact.value.subscription === 'unsubscribed' && value === 'subscribed') {
    if (!window.confirm('They unsubscribed. Only subscribe them again if they asked you to.')) return
    return save({ subscription: value, resubscribe: true })
  }
  return save({ subscription: value })
}

async function erase() {
  if (!contact.value) return
  if (!window.confirm(`Erase ${contact.value.email || contact.value.externalId}? Their conversations, feedback and email history go too. This can't be undone.`)) return
  try {
    await api(`/contacts/${contact.value.id}`, { method: 'DELETE', query: { project: props.project.id } })
    emit('changed', null, contact.value.id)
    id.value = ''
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not erase them', color: 'error' })
  }
}

const subscriptionItems = computed(() => (Object.keys(SUBSCRIPTION_STATUS) as ContactSubscription[])
  .filter(s => s !== 'pending' || contact.value?.subscription === 'pending')
  .map(value => ({ label: SUBSCRIPTION_STATUS[value].label, value, icon: SUBSCRIPTION_STATUS[value].icon })))
const money = (minor: number, currency: string) => formatMoney(fromMinor(minor, currency), currency)
const attr = (key: string) => contact.value?.attributes[key]
const INTERVALS: Record<string, string> = { day: 'day', week: 'week', month: 'mo', year: 'yr' }
const every = (s: StripeSubscriptionDto) => `${money(s.amount, s.currency)}/${s.intervalCount > 1 ? `${s.intervalCount} ` : ''}${INTERVALS[s.interval] || s.interval}`
const SUB_COLOR: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = { active: 'success', trialing: 'info', past_due: 'warning', unpaid: 'error', canceled: 'neutral' }
const stripeUrl = computed(() => (attr(STRIPE_ATTR.customer) ? `https://dashboard.stripe.com/customers/${attr(STRIPE_ATTR.customer)}` : ''))
const fullDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')
const dirty = computed(() => contact.value && (name.value !== contact.value.name || JSON.stringify(tags.value) !== JSON.stringify(contact.value.tags) || JSON.stringify(attributes.value) !== JSON.stringify(Object.entries(contact.value.attributes).map(([key, value]) => ({ key, value: String(value) })))))
</script>

<template>
  <USlideover v-model:open="open" :title="contact?.name || contact?.email || 'Contact'" :description="contact ? [contact.name ? contact.email : '', contact.externalId && `id ${contact.externalId}`].filter(Boolean).join(' · ') : ''" :ui="{ content: 'max-w-xl' }">
    <template #body>
      <div v-if="!contact" class="space-y-2"><USkeleton v-for="i in 6" :key="i" class="h-8" /></div>
      <div v-else class="space-y-6 text-[13px]">
        <section class="space-y-3">
          <div class="flex items-center gap-2">
            <USelect :model-value="contact.subscription" :items="subscriptionItems" value-key="value" size="sm" class="w-44" aria-label="Marketing email" :disabled="saving" @update:model-value="setSubscription($event as ContactSubscription)" />
            <span class="text-xs text-muted">{{ SUBSCRIPTION_STATUS[contact.subscription].hint }}</span>
          </div>
          <p v-if="contact.consent" class="text-xs text-muted">
            Opted in via <span class="font-medium text-default">{{ contact.consent.source }}</span> on {{ fullDate(contact.consent.at) }}<span v-if="contact.consent.confirmedAt">, confirmed {{ fullDate(contact.consent.confirmedAt) }}</span><span v-if="contact.consent.formUrl"> from {{ contact.consent.formUrl }}</span><span v-if="contact.consent.ip"> · {{ contact.consent.ip }}</span>
          </p>
          <p v-if="contact.unsubscribedTopics.length" class="text-xs text-muted">Opted out of {{ contact.unsubscribedTopics.join(', ') }}</p>
          <p v-if="!contact.feedbackEmails" class="text-xs text-muted">Turned off feedback emails.</p>
        </section>

        <section class="space-y-3">
          <UFormField label="Name"><UInput v-model="name" class="w-full" /></UFormField>
          <UFormField label="Tags"><UInputTags v-model="tags" placeholder="Add a tag" class="w-full" /></UFormField>
          <UFormField label="Attributes" hint="Synced columns and your own values">
            <div class="space-y-1.5">
              <div v-for="(attr, i) in attributes" :key="i" class="flex items-center gap-1.5">
                <UInput v-model="attr.key" placeholder="key" size="sm" class="w-36 font-mono" />
                <UInput v-model="attr.value" placeholder="value" size="sm" class="min-w-0 flex-1" />
                <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square aria-label="Remove attribute" @click="attributes.splice(i, 1)" />
              </div>
              <UButton icon="i-lucide-plus" label="Attribute" size="xs" color="neutral" variant="ghost" @click="attributes.push({ key: '', value: '' })" />
            </div>
          </UFormField>
          <div class="flex justify-end">
            <UButton label="Save" size="sm" :loading="saving" :disabled="!dirty" @click="saveProfile" />
          </div>
        </section>

        <dl class="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 border-t border-default pt-4">
          <dt class="text-muted">Email</dt><dd class="min-w-0 break-words">{{ contact.email || '—' }}</dd>
          <dt class="text-muted">User id</dt><dd class="min-w-0 break-words font-mono text-xs">{{ contact.externalId || '—' }}</dd>
          <template v-if="contact.username"><dt class="text-muted">Handle</dt><dd>@{{ contact.username }}</dd></template>
          <dt class="text-muted">Added</dt><dd>{{ fullDate(contact.createdAt) }}</dd>
          <dt class="text-muted">Last seen</dt><dd>{{ fullDate(contact.lastSeenAt) }}</dd>
          <template v-if="contact.sources.length"><dt class="text-muted">Synced from</dt><dd>{{ contact.sources.length }} source{{ contact.sources.length === 1 ? '' : 's' }}</dd></template>
        </dl>

        <section v-if="billing" class="space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="text-xs font-semibold text-muted">Billing</h3>
            <span v-if="attr(STRIPE_ATTR.revenue)" class="text-xs text-muted">{{ formatMoney(Number(attr(STRIPE_ATTR.revenue)), billing.currency) }} paid in total</span>
            <UButton v-if="stripeUrl" :to="stripeUrl" target="_blank" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-up-right" label="Stripe" class="ml-auto" />
          </div>
          <p v-if="!billing.subscriptions.length && !billing.payments.length" class="text-xs text-dimmed">No subscriptions or payments from Stripe.</p>
          <ul v-if="billing.subscriptions.length" class="divide-y divide-default rounded-lg border border-default" aria-label="Subscriptions">
            <li v-for="s in billing.subscriptions" :key="s.id" class="flex items-center gap-2 px-3 py-2">
              <span class="min-w-0 flex-1 truncate">{{ s.plan }}<span class="text-muted"> · {{ every(s) }}</span></span>
              <UBadge :label="s.cancelAtPeriodEnd && s.status === 'active' ? 'Ends ' + logTime(s.currentPeriodEnd) : s.status.replace('_', ' ')" :color="SUB_COLOR[s.status] || 'neutral'" variant="subtle" size="sm" />
              <span class="w-14 text-right text-xs text-muted" :title="s.canceledAt ? 'Canceled' : 'Started'">{{ logTime(s.canceledAt || s.startedAt) }}</span>
            </li>
          </ul>
          <ul v-if="billing.payments.length" class="divide-y divide-default rounded-lg border border-default" aria-label="Payments">
            <li v-for="p in billing.payments" :key="p.id" class="flex items-center gap-2 px-3 py-2">
              <span class="min-w-0 flex-1 truncate">{{ p.description || 'Payment' }}</span>
              <UBadge v-if="p.status !== 'succeeded'" :label="p.status" color="error" variant="subtle" size="sm" />
              <UBadge v-else-if="p.refunded" :label="p.refunded >= p.amount ? 'Refunded' : 'Part refunded'" color="neutral" variant="subtle" size="sm" />
              <a v-if="p.receiptUrl" :href="p.receiptUrl" target="_blank" rel="noopener" class="tabular-nums hover:underline">{{ money(p.amount, p.currency) }}</a>
              <span v-else class="tabular-nums">{{ money(p.amount, p.currency) }}</span>
              <span class="w-14 text-right text-xs text-muted">{{ logTime(p.paidAt) }}</span>
            </li>
          </ul>
        </section>

        <section class="space-y-2">
          <h3 class="text-xs font-semibold text-muted">Conversations</h3>
          <p v-if="!conversations.length" class="text-xs text-dimmed">None yet.</p>
          <ul v-else class="divide-y divide-default rounded-lg border border-default">
            <li v-for="c in conversations" :key="c.id">
              <NuxtLink :to="`/inbox?project=${project.id}&c=${c.id}`" class="flex items-center gap-2 px-3 py-2 hover:bg-elevated">
                <span class="min-w-0 flex-1 truncate">{{ c.subject || c.lastMessagePreview || 'Conversation' }}</span>
                <UBadge :label="c.status" color="neutral" variant="soft" size="sm" />
                <span class="w-14 text-right text-xs text-muted">{{ logTime(c.lastMessageAt) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <section class="space-y-2">
          <h3 class="text-xs font-semibold text-muted">Email</h3>
          <p v-if="!emails.length" class="text-xs text-dimmed">Nothing sent yet.</p>
          <ul v-else class="divide-y divide-default rounded-lg border border-default">
            <li v-for="e in emails" :key="e.id" class="flex items-center gap-2 px-3 py-2">
              <UIcon :name="EMAIL_STATUS[e.status].icon" class="size-3.5 shrink-0 text-muted" :aria-label="EMAIL_STATUS[e.status].label" />
              <span class="min-w-0 flex-1 truncate">{{ e.subject }}</span>
              <span class="text-xs text-muted">{{ EMAIL_STATUS[e.status].label }}</span>
              <span class="w-14 text-right text-xs text-muted">{{ logTime(e.createdAt) }}</span>
            </li>
          </ul>
        </section>

        <div class="flex flex-wrap gap-2 border-t border-default pt-4">
          <UButton icon="i-lucide-trash-2" label="Erase this person" size="sm" color="error" variant="outline" @click="erase" />
        </div>
      </div>
    </template>
  </USlideover>
</template>
