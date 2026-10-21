<script setup lang="ts">
/**
 * A project's email settings, in one place: the sender every message goes out
 * from (with an optional second one for campaigns and sequences), and the
 * newsletter's own settings: the postal address every campaign must carry, the
 * topics people can pick, double opt-in for the sign-up form, and the event
 * webhook that tells your app about unsubscribes.
 */
import type { MarketingConfig, MarketingTopic } from '#shared/marketing'
import type { AdminProject } from '~~/server/utils/projects'
import EmailSetupStrip from '~/components/email/EmailSetupStrip.vue'
import EmailTabs from '~/components/email/EmailTabs.vue'

const props = defineProps<{ project: AdminProject }>()

const { api, projects } = useAgent()
const toast = useToast()
const appUrl = useAppUrl()
const { t } = useI18n()

const form = reactive<MarketingConfig>(JSON.parse(JSON.stringify(props.project.marketing)))
// The sender: the project's own, which every message uses unless campaigns have one of their own.
const sender = reactive({ fromName: props.project.fromName, fromEmail: props.project.fromEmail, mailDomain: props.project.mailDomain, replyTo: props.project.replyTo, emailLogContent: props.project.emailLogContent })
const serverDefault = ref<{ fromEmail: string, domain: string } | null>(null)
onMounted(() => { api<{ fromEmail: string, domain: string }>('/admin/email-settings').then((s) => { serverDefault.value = s }).catch(() => {}) })
const separate = ref(Boolean(form.fromEmail || form.mailDomain || form.fromName))
const webhookUrl = ref(props.project.eventWebhookUrl)
const webhookSecret = ref('')
const saving = ref(false)
// The strip judges the saved sender, so it reads again after a save.
const stripKey = ref(0)

function addTopic() {
  form.topics.push({ key: '', name: '', description: '' })
}
const keyFor = (t: MarketingTopic) => { if (!t.key && t.name) t.key = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) }

async function save() {
  saving.value = true
  try {
    // Turning the second sender off blanks it, so campaigns fall back to the one above.
    const marketing = separate.value ? form : { ...form, fromName: '', fromEmail: '', mailDomain: '' }
    const { project } = await api<{ project: AdminProject }>(`/admin/projects/${props.project.id}`, { method: 'PATCH', body: { ...sender, marketing, eventWebhookUrl: webhookUrl.value, ...(webhookSecret.value ? { eventWebhookSecret: webhookSecret.value } : {}) } })
    const i = projects.value.findIndex(p => p.id === project.id)
    if (i >= 0) projects.value[i] = project
    webhookSecret.value = ''
    stripKey.value++
    toast.add({ title: t('common.saved'), color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.message || t('campaigns.settings.saveError'), color: 'error' })
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
    <PageHeader :project-id="project.id" :title="$t('nav.email')">
      <template #title><EmailTabs current="settings" /></template>
      <template #actions><UButton :label="$t('campaigns.save')" size="sm" :loading="saving" @click="save" /></template>
    </PageHeader>
    <EmailSetupStrip :key="stripKey" :project-id="project.id" scope="bulk" />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <form class="mx-auto max-w-2xl space-y-8 px-6 py-6 text-[13px]" @submit.prevent="save">
        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-highlighted">{{ $t('emailSettings.sender') }}</h2>
          <p class="text-muted">{{ $t('emailSettings.senderIntro') }}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="$t('emailSettings.fromName')" :hint="$t('emailSettings.fromNameHint')"><UInput v-model="sender.fromName" :placeholder="project.name" class="w-full" /></UFormField>
            <UFormField :label="$t('emailSettings.replyTo')"><UInput v-model="sender.replyTo" type="email" :placeholder="$t('emailSettings.replyToPlaceholder')" class="w-full" /></UFormField>
            <UFormField :label="$t('emailSettings.fromAddress')"><UInput v-model="sender.fromEmail" type="email" :placeholder="serverDefault?.fromEmail || 'hello@mail.example.com'" class="w-full" /></UFormField>
            <UFormField :label="$t('emailSettings.sendingDomain')"><UInput v-model="sender.mailDomain" :placeholder="serverDefault?.domain || 'mail.example.com'" class="w-full font-mono text-xs" /></UFormField>
          </div>
          <p class="text-xs text-muted">{{ $t('emailSettings.defaultsNote') }}</p>
          <USwitch v-model="separate" :label="$t('emailSettings.separate')" :description="$t('emailSettings.separateDescription')" />
          <div v-if="separate" class="grid gap-3 sm:grid-cols-3">
            <UFormField :label="$t('campaigns.settings.fromName')"><UInput v-model="form.fromName" :placeholder="sender.fromName || project.name" class="w-full" /></UFormField>
            <UFormField :label="$t('campaigns.settings.fromAddress')"><UInput v-model="form.fromEmail" placeholder="news@news.example.com" class="w-full" /></UFormField>
            <UFormField :label="$t('campaigns.settings.mailDomain')"><UInput v-model="form.mailDomain" placeholder="news.example.com" class="w-full" /></UFormField>
          </div>
          <UCheckbox v-model="sender.emailLogContent" :label="$t('emailSettings.keepLog')" :description="$t('emailSettings.keepLogDescription')" />
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-highlighted">{{ $t('campaigns.settings.required') }}</h2>
          <UFormField :label="$t('campaigns.settings.postalAddress')" :hint="$t('campaigns.settings.postalAddressHint')">
            <UInput v-model="form.postalAddress" placeholder="Acme Inc, 1 Main Street, Lisbon, Portugal" class="w-full" />
          </UFormField>
          <p class="text-xs text-muted">
            <i18n-t keypath="campaigns.settings.postalAddressCompany" tag="span">
              <template #company><NuxtLink :to="`/projects/${project.id}/settings#company`" class="font-medium text-default underline-offset-2 hover:underline">{{ $t('campaigns.settings.postalAddressCompanyLink') }}</NuxtLink></template>
            </i18n-t>
          </p>
        </section>

        <section class="space-y-3">
          <div class="flex items-center gap-2">
            <h2 class="flex-1 text-sm font-semibold text-highlighted">{{ $t('campaigns.settings.topics') }}</h2>
            <UButton icon="i-lucide-plus" :label="$t('campaigns.settings.topic')" size="xs" color="neutral" variant="ghost" @click="addTopic" />
          </div>
          <p class="text-muted">{{ $t('campaigns.settings.topicsIntro') }}</p>
          <p v-if="!form.topics.length" class="text-xs text-dimmed">{{ $t('campaigns.settings.noTopics') }}</p>
          <div v-for="(t, i) in form.topics" :key="i" class="grid grid-cols-[1fr_8rem_auto] gap-1.5">
            <UInput v-model="t.name" :placeholder="$t('campaigns.settings.topicNamePlaceholder')" size="sm" @blur="keyFor(t)" />
            <UInput v-model="t.key" :placeholder="$t('campaigns.settings.topicKeyPlaceholder')" size="sm" class="font-mono" />
            <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('campaigns.settings.removeTopic')" @click="form.topics.splice(i, 1)" />
            <UInput v-model="t.description" :placeholder="$t('campaigns.settings.topicDescriptionPlaceholder')" size="sm" class="col-span-2" />
          </div>
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-highlighted">{{ $t('campaigns.settings.signupForm') }}</h2>
          <USwitch v-model="form.doubleOptIn" :label="$t('campaigns.settings.doubleOptIn')" :description="$t('campaigns.settings.doubleOptInDescription')" />
          <UFormField :label="$t('campaigns.settings.redirect')" :hint="$t('campaigns.settings.redirectHint')">
            <UInput v-model="form.confirmRedirectUrl" placeholder="https://example.com/thanks" class="w-full" />
          </UFormField>
          <UFormField :label="$t('campaigns.settings.hostedPage')"><UInput :model-value="signupUrl" readonly class="w-full font-mono text-xs" /></UFormField>
          <UFormField :label="$t('campaigns.settings.siteForm')"><UTextarea :model-value="snippet" readonly :rows="6" class="w-full font-mono text-xs" /></UFormField>
        </section>

        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-highlighted">{{ $t('campaigns.settings.webhook') }}</h2>
          <p class="text-muted">{{ $t('campaigns.settings.webhookIntro') }} <code class="font-mono">contact.subscription_changed</code> {{ $t('campaigns.settings.and') }} <code class="font-mono">email.suppressed</code>{{ $t('campaigns.settings.signedLike') }} (<code class="font-mono">x-helpbites-signature</code>){{ $t('campaigns.settings.retried') }}</p>
          <PlanLock feature="eventWebhooks" inline />
          <UFormField label="URL"><UInput v-model="webhookUrl" placeholder="https://api.example.com/hooks/helpbites" class="w-full" /></UFormField>
          <UFormField :label="$t('campaigns.settings.signingSecret')" :hint="project.hasEventWebhookSecret ? $t('campaigns.settings.secretSet') : $t('campaigns.settings.secretLength')"><UInput v-model="webhookSecret" type="password" autocomplete="off" class="w-full" /></UFormField>
        </section>
      </form>
    </div>
  </div>
</template>
