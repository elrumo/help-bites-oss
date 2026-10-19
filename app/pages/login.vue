<template>
  <div class="grid min-h-full bg-default md:grid-cols-2">
    <div class="flex items-center justify-center px-6 py-16">
      <form class="w-full max-w-[22rem]" @submit.prevent="submit">
        <span class="mb-10 grid size-8 place-items-center rounded-lg bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-[18px]" /></span>

        <template v-if="resetToken">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">Set a new password</h1>
          <p class="mb-8 mt-1 text-[15px] text-muted">Choose a new password for your account.</p>
          <UFormField label="New password" hint="At least 8 characters" class="mb-6" :ui="labelUi"><UInput v-model="password" type="password" autocomplete="new-password" required minlength="8" size="lg" class="w-full" :ui="fieldUi" autofocus /></UFormField>
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex justify-end"><UButton type="submit" size="lg" :loading="loading">Save password</UButton></div>
        </template>

        <div v-else-if="needsSetup === null" class="space-y-3"><USkeleton class="h-7 w-40" /><USkeleton class="h-11" /><USkeleton class="h-11" /></div>

        <template v-else-if="needsSetup">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">Create your account</h1>
          <p class="mb-8 mt-1 text-[15px] text-muted">This is a fresh install. The first account becomes the operator; you can add teammates later.</p>
          <UFormField label="Name" class="mb-4" :ui="labelUi"><UInput v-model="name" autocomplete="name" size="lg" class="w-full" :ui="fieldUi" autofocus /></UFormField>
          <UFormField label="Email" hint="For notifications" class="mb-4" :ui="labelUi"><UInput v-model="email" type="email" autocomplete="email" size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <UFormField label="Username" class="mb-4" :ui="labelUi"><UInput v-model="username" autocomplete="username" required size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <UFormField label="Password" hint="At least 8 characters" class="mb-6" :ui="labelUi"><UInput v-model="password" type="password" autocomplete="new-password" required minlength="8" size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex justify-end"><UButton type="submit" size="lg" :loading="loading">Create account</UButton></div>
        </template>

        <template v-else-if="mode === 'forgot'">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">Reset your password</h1>
          <p class="mb-8 mt-1 text-[15px] text-muted">Enter your account email and we'll send you a reset link.</p>
          <UFormField label="Email" class="mb-6" :ui="labelUi"><UInput v-model="email" type="email" autocomplete="email" required size="lg" class="w-full" :ui="fieldUi" autofocus /></UFormField>
          <p v-if="notice" class="mb-4 text-[13px] text-success">{{ notice }}</p>
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex items-center justify-end gap-2">
            <UButton color="neutral" variant="ghost" size="lg" @click="toSignin">Back to sign in</UButton>
            <UButton type="submit" size="lg" :loading="loading">Send reset link</UButton>
          </div>
        </template>

        <template v-else>
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">Sign in to HelpBites</h1>
          <p class="mb-8 mt-1 text-[15px] text-muted">Your support inbox and every app you've connected.</p>
          <p v-if="notice" class="mb-4 text-[13px] text-success">{{ notice }}</p>
          <UFormField label="Email or username" class="mb-4" :ui="labelUi"><UInput v-model="username" autocomplete="username" required size="lg" class="w-full" :ui="fieldUi" autofocus /></UFormField>
          <UFormField label="Password" class="mb-6" :ui="labelUi"><UInput v-model="password" type="password" autocomplete="current-password" required size="lg" class="w-full" :ui="fieldUi" /></UFormField>
          <p v-if="error" class="mb-4 text-[13px] text-error">{{ error }}</p>
          <div class="flex items-center justify-end gap-2">
            <UButton color="neutral" variant="ghost" size="lg" @click="toForgot">Forgot password?</UButton>
            <UButton type="submit" size="lg" :loading="loading">Sign in</UButton>
          </div>
          <p v-if="meta.signup === 'open'" class="mt-8 text-[13px] text-muted">
            New to HelpBites? <NuxtLink to="/signup" class="font-medium text-default transition-colors hover:text-highlighted">Create an account</NuxtLink>
          </p>
        </template>

        <p class="mt-10 text-xs text-dimmed">
          <a :href="meta.sourceCodeUrl" target="_blank" rel="noopener" class="transition-colors hover:text-muted">Source code</a>
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

const { login, token, agent } = useAgent()
const meta = useMeta()
const route = useRoute()
const needsSetup = ref<boolean | null>(null)
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
const art = [
  { label: 'Inbox', icon: 'i-lucide-inbox' },
  { label: 'Email templates', icon: 'i-lucide-mail' },
  { label: 'Knowledge base', icon: 'i-lucide-book-open' },
  { label: 'Assistants', icon: 'i-lucide-sparkles' },
  { label: 'Feedback', icon: 'i-lucide-lightbulb' }
]

const resetToken = computed(() => typeof route.query.reset === 'string' ? route.query.reset : '')

if (token.value && !resetToken.value) await navigateTo('/inbox', { replace: true })

onMounted(async () => {
  try {
    needsSetup.value = (await $fetch<{ needsSetup: boolean }>('/v1/admin/setup')).needsSetup
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
      await $fetch('/v1/admin/reset-password', { method: 'POST', body: { token: resetToken.value, password: password.value } })
      password.value = ''
      notice.value = 'Password updated. Sign in with your new password.'
      await navigateTo('/login', { replace: true })
    } else if (mode.value === 'forgot') {
      await $fetch('/v1/admin/forgot-password', { method: 'POST', body: { email: email.value.trim() } })
      notice.value = 'If that email has an account, a reset link is on its way.'
    } else if (needsSetup.value) {
      const result = await $fetch<{ sessionToken: string, agent: any }>('/v1/admin/setup', { method: 'POST', body: { name: name.value, email: email.value, username: username.value.trim(), password: password.value } })
      token.value = result.sessionToken
      agent.value = result.agent
      await navigateTo(typeof route.query.next === 'string' ? route.query.next : '/inbox', { replace: true })
    } else {
      await login(username.value.trim(), password.value)
      await navigateTo(typeof route.query.next === 'string' ? route.query.next : '/inbox', { replace: true })
    }
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || (needsSetup.value ? 'Could not create the account.' : 'Something went wrong. Try again.')
  } finally {
    loading.value = false
  }
}
</script>
