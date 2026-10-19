<script setup lang="ts">
/**
 * A project's newsletter settings: the topics people can pick, the postal
 * address every campaign must carry, double opt-in for the sign-up form, its
 * own sender, and the event webhook that tells your app about unsubscribes.
 */
import type { MarketingConfig, MarketingTopic } from '#shared/marketing'
import type { AdminProject } from '~~/server/utils/projects'
import CampaignsTabs from '~/components/campaigns/CampaignsTabs.vue'

const props = defineProps<{ project: AdminProject }>()

const { api, projects } = useAgent()
const toast = useToast()
const appUrl = useAppUrl()

const form = reactive<MarketingConfig>(JSON.parse(JSON.stringify(props.project.marketing)))
const webhookUrl = ref(props.project.eventWebhookUrl)
const webhookSecret = ref('')
const saving = ref(false)

function addTopic() {
  form.topics.push({ key: '', name: '', description: '' })
}
const keyFor = (t: MarketingTopic) => { if (!t.key && t.name) t.key = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) }

async function save() {
  saving.value = true
  try {
    const { project } = await api<{ project: AdminProject }>(`/admin/projects/${props.project.id}`, { method: 'PATCH', body: { marketing: form, eventWebhookUrl: webhookUrl.value, ...(webhookSecret.value ? { eventWebhookSecret: webhookSecret.value } : {}) } })
    const i = projects.value.findIndex(p => p.id === project.id)
    if (i >= 0) projects.value[i] = project
    webhookSecret.value = ''
    toast.add({ title: 'Saved', color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.message || 'Could not save', color: 'error' })
  } finally {
    saving.value = false
  }
}

const signupUrl = computed(() => `${appUrl.value}/s/${props.project.publicKey}`)
const snippet = computed(() => `<form action="${appUrl.value}/v1/subscribe" method="post">
  <input type="hidden" name="pk" value="${props.project.publicKey}">
  <input type="email" name="email" required placeholder="you@example.com">
  <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-10000px">
  <button type="submit">Subscribe</button>
</form>`)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :project-id="project.id" title="Campaigns">
      <template #title><CampaignsTabs current="settings" /></template>
      <template #actions><UButton label="Save" size="sm" :loading="saving" @click="save" /></template>
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <form class="mx-auto max-w-2xl space-y-8 px-6 py-6 text-[13px]" @submit.prevent="save">
        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-highlighted">Required in every campaign</h2>
          <UFormField label="Postal address" hint="Shown as {{project.address}}; the law requires it in marketing email">
            <UInput v-model="form.postalAddress" placeholder="Acme Inc, 1 Main Street, Lisbon, Portugal" class="w-full" />
          </UFormField>
        </section>

        <section class="space-y-3">
          <div class="flex items-center gap-2">
            <h2 class="flex-1 text-sm font-semibold text-highlighted">Topics</h2>
            <UButton icon="i-lucide-plus" label="Topic" size="xs" color="neutral" variant="ghost" @click="addTopic" />
          </div>
          <p class="text-muted">Newsletters people can opt out of one by one on their preferences page. A campaign can go to one topic's readers.</p>
          <p v-if="!form.topics.length" class="text-xs text-dimmed">No topics: one list for everything.</p>
          <div v-for="(t, i) in form.topics" :key="i" class="grid grid-cols-[1fr_8rem_auto] gap-1.5">
            <UInput v-model="t.name" placeholder="Product updates" size="sm" @blur="keyFor(t)" />
            <UInput v-model="t.key" placeholder="key" size="sm" class="font-mono" />
            <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square aria-label="Remove topic" @click="form.topics.splice(i, 1)" />
            <UInput v-model="t.description" placeholder="What it is, in a line" size="sm" class="col-span-2" />
          </div>
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-highlighted">Sign-up form</h2>
          <USwitch v-model="form.doubleOptIn" label="Double opt-in" description="New sign-ups confirm by email before they get anything. Strongly recommended." />
          <UFormField label="After signing up, go to" hint="Optional; otherwise a HelpBites thank-you page">
            <UInput v-model="form.confirmRedirectUrl" placeholder="https://example.com/thanks" class="w-full" />
          </UFormField>
          <UFormField label="Hosted sign-up page"><UInput :model-value="signupUrl" readonly class="w-full font-mono text-xs" /></UFormField>
          <UFormField label="Or a form on your site"><UTextarea :model-value="snippet" readonly :rows="6" class="w-full font-mono text-xs" /></UFormField>
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-highlighted">Sender</h2>
          <p class="text-muted">Optional. A separate domain keeps newsletter reputation apart from support and account email. It must be a sending domain of the same Mailgun account.</p>
          <div class="grid gap-3 sm:grid-cols-3">
            <UFormField label="From name"><UInput v-model="form.fromName" :placeholder="project.fromName || project.name" class="w-full" /></UFormField>
            <UFormField label="From address"><UInput v-model="form.fromEmail" placeholder="news@news.example.com" class="w-full" /></UFormField>
            <UFormField label="Mailgun domain"><UInput v-model="form.mailDomain" placeholder="news.example.com" class="w-full" /></UFormField>
          </div>
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-highlighted">Event webhook</h2>
          <p class="text-muted">HelpBites never writes to your database. It tells your app instead: <code class="font-mono">contact.subscription_changed</code> and <code class="font-mono">email.suppressed</code>, signed like the action webhook (<code class="font-mono">x-helpbites-signature</code>), retried for a day.</p>
          <UFormField label="URL"><UInput v-model="webhookUrl" placeholder="https://api.example.com/hooks/helpbites" class="w-full" /></UFormField>
          <UFormField label="Signing secret" :hint="project.hasEventWebhookSecret ? 'Set; type a new one to replace it' : '16+ characters'"><UInput v-model="webhookSecret" type="password" autocomplete="off" class="w-full" /></UFormField>
        </section>
      </form>
    </div>
  </div>
</template>
