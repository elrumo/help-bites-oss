<template>
  <div class="grid min-h-full bg-default md:grid-cols-2">
    <div class="flex items-center justify-center px-6 py-16">
      <form class="w-full max-w-[22rem]" @submit.prevent="submit">
        <span class="mb-10 grid size-8 place-items-center rounded-lg bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-[18px]" /></span>

        <template v-if="resetToken">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ $t('login.resetTitle') }}</h1>
          <p class="mb-8 mt-1 text-[15px] text-muted">{{ $t('login.resetDescription') }}</p>
          <UFormField :label="$t('login.newPassword')" :hint="$t('login.passwordHint')" class="mb-4" :ui="labelUi"><UInput v-model="password" type="password" autocomplete="new-password" required minlength="8" size="lg" class="w-full" :ui="fieldUi" autofocus /></UFormField>
          <UCheckbox v-model="revokeApiKeys" :label="$t('login.revokeKeys')" :description="$t('login.revokeKeysDescription')" class="mb-6" />
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex justify-end"><UButton type="submit" size="lg" :loading="loading">{{ $t('login.savePassword') }}</UButton></div>
        </template>

        <div v-else-if="needsSetup === null" class="space-y-3"><USkeleton class="h-7 w-40" /><USkeleton class="h-11" /><USkeleton class="h-11" /></div>

        <template v-else-if="needsSetup">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ $t('login.setupTitle') }}</h1>
          <p class="mb-8 mt-1 text-[15px] text-muted">{{ $t('login.setupDescription') }}</p>
          <UFormField :label="$t('common.name')" class="mb-4" :ui="labelUi"><UInput v-model="name" autocomplete="name" size="lg" class="w-full" :ui="fieldUi" autofocus /></UFormField>
          <UFormField :label="$t('login.email')" :hint="$t('login.emailHint')" class="mb-4" :ui="labelUi"><UInput v-model="email" type="email" autocomplete="email" size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <UFormField :label="$t('login.username')" class="mb-4" :ui="labelUi"><UInput v-model="username" autocomplete="username" required size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <UFormField :label="$t('login.password')" :hint="$t('login.passwordHint')" :class="needsToken ? 'mb-4' : 'mb-6'" :ui="labelUi"><UInput v-model="password" type="password" autocomplete="new-password" required minlength="8" size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <UFormField v-if="needsToken" :label="$t('login.setupToken')" :hint="$t('login.setupTokenHint')" class="mb-6" :ui="labelUi"><UInput v-model="setupToken" type="password" autocomplete="off" required size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex justify-end"><UButton type="submit" size="lg" :loading="loading">{{ $t('login.createAccount') }}</UButton></div>
        </template>

        <template v-else-if="mode === 'forgot'">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ $t('login.forgotTitle') }}</h1>
          <p class="mb-8 mt-1 text-[15px] text-muted">{{ $t('login.forgotDescription') }}</p>
          <UFormField :label="$t('login.email')" class="mb-6" :ui="labelUi"><UInput v-model="email" type="email" autocomplete="email" required size="lg" class="w-full" :ui="fieldUi" autofocus /></UFormField>
          <p v-if="notice" class="mb-4 text-[13px] text-success">{{ notice }}</p>
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex items-center justify-end gap-2">
            <UButton color="neutral" variant="ghost" size="lg" @click="toSignin">{{ $t('login.backToSignIn') }}</UButton>
            <UButton type="submit" size="lg" :loading="loading">{{ $t('login.sendResetLink') }}</UButton>
          </div>
        </template>

        <template v-else>
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">{{ $t('login.signInTitle') }}</h1>
          <p class="mb-8 mt-1 text-[15px] text-muted">{{ $t('login.signInDescription') }}</p>
          <p v-if="notice" class="mb-4 text-[13px] text-success">{{ notice }}</p>
          <UFormField :label="$t('login.emailOrUsername')" class="mb-4" :ui="labelUi"><UInput v-model="username" autocomplete="username" required size="lg" class="w-full" :ui="fieldUi" autofocus /></UFormField>
          <UFormField :label="$t('login.password')" class="mb-6" :ui="labelUi"><UInput v-model="password" type="password" autocomplete="current-password" required size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex items-center justify-end gap-2">
            <UButton color="neutral" variant="ghost" size="lg" @click="toForgot">{{ $t('login.forgotPassword') }}</UButton>
            <UButton type="submit" size="lg" :loading="loading">{{ $t('login.signIn') }}</UButton>
          </div>
          <p v-if="meta.signup === 'open'" class="mt-8 text-[13px] text-muted">
            {{ $t('login.newTo') }} <NuxtLink to="/signup" class="font-medium text-default transition-colors hover:text-highlighted">{{ $t('login.signUp') }}</NuxtLink>
          </p>
        </template>

        <p class="mt-10 text-xs text-dimmed">
          <a :href="meta.sourceCodeUrl" target="_blank" rel="noopener" class="transition-colors hover:text-muted">{{ $t('common.sourceCode') }}</a>
        </p>
      </form>
    </div>

    <!-- Linear's onboarding art: the product's own sidebar, huge, tilted away and out of focus. -->
    <div class="relative hidden overflow-hidden border-l border-default bg-muted md:block" aria-hidden="true">
      <div class="absolute inset-0 [perspective:1200px]">
        <div class="absolute left-[14%] top-[16%] origin-left space-y-9 text-[54px] font-semibold tracking-tight text-highlighted opacity-[0.16] blur-[1.2px] [transform:rotateY(-26deg)_rotateX(10deg)_rotateZ(5deg)] dark:opacity-[0.2]">
          <p class="flex items-center gap-5"><span class="grid size-14 place-items-center rounded-2xl bg-primary-500 text-white"><UIcon name="i-lucide-message-circle-more" class="size-8" /></span>HelpBites<UIcon name="i-lucide-chevron-down" class="size-8" /></p>
          <p v-for="item in art" :key="item.label" class="flex items-center gap-6 whitespace-nowrap"><UIcon :name="item.icon" class="size-12" />{{ item.label }}</p>
        </div>
      </div>
      <div class="absolute inset-0 bg-gradient-to-r from-[var(--ui-bg-muted)] via-transparent to-[var(--ui-bg-muted)]" />
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const { t } = useI18n()
const { login, token, agent } = useAgent()
const meta = useMeta()
const route = useRoute()
const needsSetup = ref<boolean | null>(null)
const needsToken = ref(false)
const setupToken = ref('')
const revokeApiKeys = ref(true)
const mode = ref<'signin' | 'forgot'>('signin')
const name = ref('')
const email = ref('')
const username = ref('')
const password = ref('')
const error = ref('')
const notice = ref('')
const loading = ref(false)

// Linear's onboarding fields: taller, quieter labels.
const fieldUi = { base: 'h-11' }
const labelUi = { label: 'font-normal text-muted' }
const art = computed(() => [
  { label: t('login.art.inbox'), icon: 'i-lucide-inbox' },
  { label: t('login.art.emailTemplates'), icon: 'i-lucide-mail' },
  { label: t('login.art.knowledge'), icon: 'i-lucide-book-open' },
  { label: t('login.art.assistants'), icon: 'i-lucide-sparkles' },
  { label: t('login.art.feedback'), icon: 'i-lucide-lightbulb' }
])

const resetToken = computed(() => typeof route.query.reset === 'string' ? route.query.reset : '')

if (token.value && !resetToken.value) await navigateTo('/inbox', { replace: true })

onMounted(async () => {
  try {
    const setup = await $fetch<{ needsSetup: boolean, needsToken?: boolean }>('/v1/admin/setup')
    needsSetup.value = setup.needsSetup
    needsToken.value = !!setup.needsToken
  } catch {
    needsSetup.value = false
  }
})

function toForgot() {
  mode.value = 'forgot'
  error.value = ''
  notice.value = ''
}

function toSignin() {
  mode.value = 'signin'
  error.value = ''
  notice.value = ''
}

async function submit() {
  loading.value = true
  error.value = ''
  try {
    if (resetToken.value) {
      const result = await $fetch<{ revokedApiKeys?: number }>('/v1/admin/reset-password', { method: 'POST', body: { token: resetToken.value, password: password.value, revokeApiKeys: revokeApiKeys.value } })
      password.value = ''
      const revoked = result.revokedApiKeys || 0
      notice.value = revoked ? t('login.passwordUpdatedRevoked', { count: revoked }) : t('login.passwordUpdated')
      await navigateTo('/login', { replace: true })
    } else if (mode.value === 'forgot') {
      await $fetch('/v1/admin/forgot-password', { method: 'POST', body: { email: email.value.trim() } })
      notice.value = t('login.resetSent')
    } else if (needsSetup.value) {
      const result = await $fetch<{ sessionToken: string, agent: any }>('/v1/admin/setup', { method: 'POST', body: { name: name.value, email: email.value, username: username.value.trim(), password: password.value, ...(needsToken.value ? { setupToken: setupToken.value } : {}) } })
      token.value = result.sessionToken
      agent.value = result.agent
      await navigateTo(typeof route.query.next === 'string' ? route.query.next : '/inbox', { replace: true })
    } else {
      await login(username.value.trim(), password.value)
      await navigateTo(typeof route.query.next === 'string' ? route.query.next : '/inbox', { replace: true })
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || (needsSetup.value ? t('login.createAccountError') : t('login.genericError'))
  } finally {
    loading.value = false
  }
}
</script>
