<template>
  <div class="min-h-screen bg-default text-[15px] leading-relaxed text-default">
    <!-- ------------------------------------------------------------ header -->
    <header class="sticky top-0 z-30 border-b border-default/70 bg-default/80 backdrop-blur-xl">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5 md:px-8">
        <NuxtLink to="/" class="flex items-center gap-2 text-[14px] font-semibold text-highlighted">
          <span class="grid size-6 place-items-center rounded-md bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-3.5" /></span>
          HelpBites
        </NuxtLink>
        <nav class="hidden items-center gap-5 text-[13px] sm:flex" :aria-label="$t('landing.nav.sections')">
          <a href="#connect" class="text-muted transition-colors hover:text-highlighted">{{ $t('landing.nav.connect') }}</a>
          <a href="#tour" class="text-muted transition-colors hover:text-highlighted">{{ $t('landing.nav.tour') }}</a>
          <a href="#features" class="text-muted transition-colors hover:text-highlighted">{{ $t('landing.nav.features') }}</a>
          <NuxtLink to="/docs" class="text-muted transition-colors hover:text-highlighted">{{ $t('landing.nav.docs') }}</NuxtLink>
          <a :href="repo" target="_blank" rel="noopener" class="text-muted transition-colors hover:text-highlighted">{{ $t('landing.nav.source') }}</a>
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <UButton to="/login" :label="$t('login.signIn')" color="neutral" variant="ghost" size="sm" />
          <UButton to="/demo" :label="$t('landing.tryDemo')" size="sm" />
        </div>
      </div>
    </header>

    <!-- -------------------------------------------------------------- hero -->
    <section class="mx-auto max-w-6xl px-5 pb-14 pt-16 md:px-8 md:pt-24">
      <h1 class="hero-title max-w-[18ch] text-[clamp(2.5rem,6.4vw,4.6rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
        {{ $t('landing.hero.title') }}
      </h1>
      <p class="mt-6 max-w-[56ch] text-[17px] leading-relaxed text-muted">
        {{ $t('landing.hero.lead') }}
      </p>
      <div class="mt-9 flex flex-wrap items-center gap-2.5">
        <UButton to="/demo" size="lg" trailing-icon="i-lucide-arrow-right">{{ $t('landing.tryDemo') }}</UButton>
        <UButton to="/docs/self-host" variant="outline" color="neutral" size="lg">{{ $t('landing.selfHost') }}</UButton>
        <UButton to="#connect" variant="ghost" color="neutral" size="lg">{{ $t('landing.hero.seeConnect') }}</UButton>
      </div>
      <p class="mt-4 text-[13px] text-dimmed">
        {{ $t('landing.hero.noteBefore') }} <code class="inline-code">docker compose up -d</code>{{ $t('landing.hero.noteAfter') }}
      </p>
    </section>

    <!-- The product, both sides of one conversation: your inbox, and the chat your user sees. -->
    <section class="relative mx-auto max-w-6xl px-5 pb-28 md:px-8 lg:pb-44" :aria-label="$t('landing.mock.label')">
      <div class="hero-glow pointer-events-none absolute inset-x-0 -top-16 h-[520px]" aria-hidden="true" />
      <div class="relative rounded-2xl border border-default bg-muted p-1.5 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.25)] dark:shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]">
        <div class="grid h-[440px] grid-cols-1 overflow-hidden rounded-xl md:grid-cols-[190px_270px_minmax(0,1fr)]">
          <!-- sidebar -->
          <aside class="hidden flex-col gap-4 bg-muted px-2.5 py-3 text-[12.5px] md:flex" aria-hidden="true">
            <p class="flex items-center gap-2 px-1.5 font-semibold text-highlighted"><span class="grid size-4.5 place-items-center rounded-[4px] bg-primary-500 text-white"><UIcon name="i-lucide-message-circle-more" class="size-3" /></span>HelpBites</p>
            <div class="space-y-px">
              <p class="flex items-center gap-2 rounded-md bg-black/[0.06] px-1.5 py-1 text-highlighted dark:bg-white/[0.07]"><UIcon name="i-lucide-inbox" class="size-3.5 text-muted" />{{ $t('nav.inbox') }}<span class="ml-auto text-[11px] text-muted">3</span></p>
              <p class="flex items-center gap-2 px-1.5 py-1"><UIcon name="i-lucide-mail" class="size-3.5 text-muted" />{{ $t('layout.emailTemplates') }}</p>
            </div>
            <div class="space-y-px">
              <p class="px-1.5 pb-0.5 text-[11px] font-medium text-muted">{{ $t('nav.projects') }}</p>
              <p v-for="app in apps" :key="app.name" class="flex items-center gap-2 px-1.5 py-1">
                <span class="grid size-4 place-items-center rounded-[4px] text-[9px] font-semibold text-white" :style="{ background: app.color }">{{ app.name[0] }}</span>{{ app.name }}
              </p>
            </div>
          </aside>

          <!-- list -->
          <div class="hidden flex-col border-x border-default bg-default md:flex" aria-hidden="true">
            <p class="flex h-10 shrink-0 items-center border-b border-default px-3 text-[12.5px] font-medium text-highlighted">{{ $t('nav.inbox') }}</p>
            <div class="flex gap-1 px-2.5 py-2">
              <span v-for="(view, i) in mockViews" :key="view" class="rounded-full border px-2 py-0.5 text-[11px] font-medium" :class="i === 0 ? 'border-accented bg-elevated text-highlighted' : 'border-default text-muted'">{{ view }}</span>
            </div>
            <div class="space-y-px px-1.5">
              <div v-for="(row, i) in inbox" :key="row.name" class="flex items-center gap-2 rounded-lg px-1.5 py-1.5" :class="i === 0 ? 'bg-accented' : ''">
                <span class="size-1.5 shrink-0 rounded-full" :class="row.unread ? 'bg-primary-500' : ''" />
                <span class="relative grid size-6 shrink-0 place-items-center rounded-full bg-elevated text-[9px] font-semibold text-toned" :class="i === 0 ? 'bg-default' : ''">
                  {{ row.name.split(' ').map(w => w[0]).join('') }}
                  <span class="absolute -bottom-px -right-px size-2 rounded-full ring-2 ring-(--ui-bg)" :style="{ background: row.color }" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center justify-between gap-2 text-[12px]"><span class="truncate font-medium text-highlighted">{{ row.name }}</span><span class="shrink-0 text-[10.5px] text-muted">{{ row.time }}</span></span>
                  <span class="block truncate text-[11px] text-muted">{{ row.preview }}</span>
                </span>
              </div>
            </div>
          </div>

          <!-- thread: the operator's side -->
          <div class="flex min-w-0 flex-col bg-default">
            <p class="flex h-10 shrink-0 items-center gap-1.5 border-b border-default px-3.5 text-[12.5px]">
              <span class="grid size-4 place-items-center rounded-[4px] text-[9px] font-semibold text-white" :style="{ background: apps[0]!.color }">A</span>
              <span class="text-muted">Acme</span><UIcon name="i-lucide-chevron-right" class="size-3 text-dimmed" /><span class="font-medium text-highlighted">Maya Chen</span>
              <span class="ml-1 hidden truncate text-muted sm:inline">{{ $t('landing.mock.subject') }}</span>
            </p>
            <div class="flex min-h-0 flex-1 flex-col justify-end gap-0.5 px-4 py-3 text-[13px]">
              <div class="mb-2 max-w-[70%] self-start rounded-lg border border-default px-2.5 py-1.5 text-[11.5px] leading-snug">
                <span class="block font-medium text-highlighted">{{ $t('landing.mock.exports') }}</span>
                <span class="block truncate text-muted">acme.app/settings/exports</span>
              </div>
              <template v-for="(m, i) in script.slice(0, shown)" :key="i">
                <div class="flex" :class="[m.from === 'agent' ? 'justify-end' : 'justify-start', script[i + 1]?.from === m.from ? '' : 'mb-2']">
                  <div class="max-w-[78%] rounded-2xl px-3 py-1.5 leading-5 animate-bubble-in" :class="m.from === 'agent' ? 'bg-primary-500 text-white' : 'bubble-them'">{{ m.body }}</div>
                </div>
              </template>
              <div v-if="typingFrom === 'user'" class="flex justify-start"><div class="typing bubble-them"><span v-for="d in 3" :key="d" class="animate-dot" :style="{ animationDelay: `${(d - 1) * 0.16}s` }" /></div></div>
            </div>
            <div class="px-3.5 pb-3.5">
              <div class="flex items-center gap-2 rounded-xl border border-default bg-white px-3 py-2 text-[12.5px] text-dimmed dark:bg-white/[0.02]">
                {{ $t('landing.mock.reply', { name: 'Maya' }) }}<span class="ml-auto grid size-5 place-items-center rounded-full bg-primary-500/40 text-white"><UIcon name="i-lucide-arrow-up" class="size-3" /></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- The chat as Maya sees it, in Acme's app. -->
      <div class="absolute bottom-8 left-3 hidden w-[290px] overflow-hidden rounded-xl border border-default bg-default shadow-[0_20px_60px_-12px_rgb(0_0_0/0.35)] lg:-left-4 lg:block" aria-hidden="true">
        <p class="flex h-10 items-center gap-2 border-b border-default px-3 text-[12.5px] font-semibold text-highlighted">
          <span class="grid size-5 place-items-center rounded-[5px] text-[10px] text-white" :style="{ background: apps[0]!.color }">A</span>{{ $t('landing.mock.support', { name: 'Acme' }) }}
          <UIcon name="i-lucide-x" class="ml-auto size-3.5 text-muted" />
        </p>
        <div class="flex min-h-[240px] flex-col justify-end gap-0.5 px-3 py-3 text-[12.5px]">
          <template v-for="(m, i) in script.slice(0, shown)" :key="i">
            <div class="flex" :class="[m.from === 'user' ? 'justify-end' : 'justify-start', script[i + 1]?.from === m.from ? '' : 'mb-2']">
              <div class="max-w-[82%] rounded-2xl px-3 py-1.5 leading-5 animate-bubble-in" :class="m.from === 'user' ? 'accent-acme text-white' : 'bubble-them'">{{ m.body }}</div>
            </div>
          </template>
          <div v-if="typingFrom === 'agent'" class="flex justify-start"><div class="typing bubble-them"><span v-for="d in 3" :key="d" class="animate-dot" :style="{ animationDelay: `${(d - 1) * 0.16}s` }" /></div></div>
          <p v-if="shown === script.length" class="text-right text-[10.5px] text-muted">{{ $t('landing.mock.read') }}</p>
        </div>
        <div class="border-t border-default px-3 py-2.5">
          <div class="rounded-lg border border-default px-2.5 py-1.5 text-[12px] text-dimmed">{{ $t('landing.mock.message') }}</div>
        </div>
      </div>
    </section>

    <!-- --------------------------------------------------------- what it is -->
    <section class="mx-auto grid max-w-6xl gap-10 px-5 pb-24 md:grid-cols-3 md:gap-12 md:px-8">
      <div v-for="p in pitch" :key="p.title" class="border-t border-default pt-5">
        <UIcon :name="p.icon" class="size-5 text-muted" />
        <h2 class="mt-4 text-[15px] font-semibold text-highlighted">{{ p.title }}</h2>
        <p class="mt-1.5 text-[14px] leading-relaxed text-muted">{{ p.body }}</p>
      </div>
    </section>

    <!-- ----------------------------------------------------------- connect -->
    <section id="connect" class="scroll-mt-14 border-y border-default bg-muted">
      <div class="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-5 py-24 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:px-8">
        <div>
          <h2 class="text-[clamp(1.75rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-highlighted">{{ $t('landing.connect.title') }}</h2>
          <p class="mt-4 max-w-[44ch] text-muted">
            {{ $t('landing.connect.intro') }}
          </p>
        </div>

        <ol class="min-w-0 space-y-10">
          <li>
            <h3 class="flex items-center gap-2.5 text-[15px] font-semibold text-highlighted"><span class="step">1</span>{{ $t('landing.connect.step1.title') }}</h3>
            <p class="mt-2 text-[14px] text-muted">
              {{ $t('landing.connect.step1.a') }} <code class="inline-code">pk_…</code>{{ $t('landing.connect.step1.b') }} <code class="inline-code">sk_…</code>{{ $t('landing.connect.step1.c') }}
            </p>
          </li>
          <li>
            <h3 class="flex items-center gap-2.5 text-[15px] font-semibold text-highlighted"><span class="step">2</span>{{ $t('landing.connect.step2.title') }}</h3>
            <p class="mb-3 mt-2 text-[14px] text-muted">{{ $t('landing.connect.step2.body') }}</p>
            <CodeBlock :code="mintSnippet" lang="js" />
          </li>
          <li>
            <h3 class="flex items-center gap-2.5 text-[15px] font-semibold text-highlighted"><span class="step">3</span>{{ $t('landing.connect.step3.title') }}</h3>
            <p class="mb-3 mt-2 text-[14px] text-muted">{{ $t('landing.connect.step3.body') }}</p>
            <CodeBlock :code="widgetSnippet" lang="html" />
            <p class="mt-3 text-[13px] text-muted">
              {{ $t('landing.connect.step3.a') }} <code class="inline-code">data-mode="inline"</code>{{ $t('landing.connect.step3.b') }}
            </p>
          </li>
        </ol>
      </div>
    </section>

    <!-- ------------------------------------------------------------- tour -->
    <section id="tour" class="mx-auto max-w-6xl scroll-mt-14 px-5 pt-24 md:px-8">
      <p class="eyebrow">{{ $t('landing.tour.eyebrow') }}</p>
      <h2 class="mt-3 max-w-[20ch] text-[clamp(1.75rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-highlighted">{{ $t('landing.tour.title') }}</h2>
      <ul class="mt-6 flex flex-wrap gap-2" :aria-label="$t('landing.tour.jump')">
        <li v-for="s in showcase" :key="s.id"><a :href="`#${s.id}`" class="chip">{{ s.eyebrow }}</a></li>
        <li><a href="#more" class="chip">{{ $t('landing.andMore') }}</a></li>
      </ul>
    </section>

    <section v-for="(s, i) in showcase" :id="s.id" :key="s.id" class="mx-auto grid max-w-6xl scroll-mt-14 grid-cols-1 items-center gap-10 px-5 py-20 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.5fr)] md:gap-12 md:px-8">
      <div :class="i % 2 ? 'md:order-2' : ''">
        <p class="eyebrow">{{ s.eyebrow }}</p>
        <h3 class="mt-3 text-[clamp(1.5rem,3vw,2.15rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-highlighted">{{ s.title }}</h3>
        <p class="mt-4 text-muted">{{ s.body }}</p>
        <ul class="mt-5 space-y-2.5 text-[14px] text-muted">
          <li v-for="b in s.bullets" :key="b" class="flex gap-2.5"><UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-primary-500" />{{ b }}</li>
        </ul>
        <UButton v-if="s.doc" :to="s.doc" variant="link" color="neutral" class="mt-4 px-0" trailing-icon="i-lucide-arrow-right">{{ $t('landing.readDocs') }}</UButton>
      </div>
      <figure class="shot" :class="i % 2 ? 'md:order-1' : ''">
        <img :src="s.img" :alt="s.alt" :class="s.crop" width="1440" height="900" loading="lazy" class="w-full rounded-xl object-cover object-top">
      </figure>
    </section>

    <!-- ---------------------------------------------------------- and more -->
    <section id="more" class="scroll-mt-14 border-y border-default bg-muted">
      <div class="mx-auto max-w-6xl px-5 py-20 md:px-8">
        <p class="eyebrow">{{ $t('landing.andMore') }}</p>
        <h3 class="mt-3 max-w-[22ch] text-[clamp(1.5rem,3vw,2.15rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-highlighted">{{ $t('landing.more.title') }}</h3>
        <div class="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="m in more" :key="m.title">
            <UIcon :name="m.icon" class="size-5 text-muted" />
            <h4 class="mt-3 text-[14.5px] font-semibold text-highlighted">{{ m.title }}</h4>
            <p class="mt-1 text-[14px] leading-relaxed text-muted">{{ m.body }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ---------------------------------------------------------- features -->
    <section id="features" class="mx-auto max-w-6xl scroll-mt-14 px-5 pt-24 md:px-8">
      <p class="eyebrow">{{ $t('landing.features.eyebrow') }}</p>
      <h2 class="mt-3 text-[clamp(1.75rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-highlighted">{{ $t('landing.features.title') }}</h2>
    </section>
    <section class="mx-auto grid max-w-6xl gap-14 px-5 pb-24 pt-12 md:grid-cols-2 md:gap-16 md:px-8">
      <div v-for="group in features" :key="group.title">
        <h2 class="text-[clamp(1.4rem,2.6vw,1.75rem)] font-semibold tracking-[-0.025em] text-highlighted">{{ group.title }}</h2>
        <p class="mb-6 mt-1 text-[14px] text-muted">{{ group.hint }}</p>
        <dl class="divide-y divide-default border-t border-default">
          <div v-for="f in group.items" :key="f.term" class="py-4">
            <dt class="text-[14px] font-medium text-highlighted">{{ f.term }}</dt>
            <dd class="mt-0.5 text-[14px] text-muted">{{ f.desc }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- ------------------------------------------------------- the human bit -->
    <section class="border-y border-default bg-muted">
      <div class="mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-28">
        <p class="hero-title max-w-[22ch] text-[clamp(1.75rem,4vw,2.9rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
          {{ $t('landing.human.title') }}
        </p>
        <p class="mt-6 max-w-[58ch] text-muted">
          {{ $t('landing.human.body') }}
        </p>
      </div>
    </section>

    <!-- --------------------------------------------------------- run it -->
    <section class="mx-auto grid max-w-6xl items-start gap-12 px-5 py-24 md:grid-cols-2 md:gap-16 md:px-8">
      <div>
        <h2 class="text-[clamp(1.75rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-highlighted">{{ $t('landing.run.title') }}</h2>
        <p class="mt-4 max-w-[52ch] text-muted">
          {{ $t('landing.run.a') }} <code class="inline-code">docker compose up -d</code>{{ $t('landing.run.b') }}
        </p>
        <p class="mt-4 max-w-[52ch] text-muted">
          {{ $t('landing.run.p2') }}
        </p>
        <div class="mt-8 flex flex-wrap gap-2.5">
          <UButton to="/docs/self-host">{{ $t('landing.selfHost') }}</UButton>
          <UButton to="/_docs/scalar" target="_blank" variant="outline" color="neutral" trailing-icon="i-lucide-arrow-up-right">{{ $t('docs.apiReference') }}</UButton>
        </div>
      </div>

      <ul class="overflow-hidden rounded-xl border border-default text-[13px]">
        <li v-for="e in endpoints" :key="e.path" class="flex items-baseline gap-3 border-b border-default px-4 py-2.5 last:border-b-0">
          <span class="w-12 shrink-0 font-mono text-[11px] font-semibold text-muted">{{ e.method }}</span>
          <code class="font-mono text-xs text-highlighted">{{ e.path }}</code>
          <span class="ml-auto text-right text-xs text-muted">{{ e.desc }}</span>
        </li>
      </ul>
    </section>

    <!-- ---------------------------------------------------------------- cta -->
    <section class="border-t border-default bg-muted">
      <div class="mx-auto max-w-6xl px-5 py-24 text-center md:px-8">
        <h2 class="hero-title mx-auto max-w-[18ch] text-[clamp(1.9rem,4.4vw,3.2rem)] font-semibold leading-[1.05] tracking-[-0.035em]">{{ $t('landing.cta.title') }}</h2>
        <p class="mx-auto mt-4 max-w-[48ch] text-muted">{{ $t('landing.cta.body') }}</p>
        <div class="mt-8 flex flex-wrap justify-center gap-2.5">
          <UButton to="/demo" size="lg" trailing-icon="i-lucide-arrow-right">{{ $t('landing.tryDemo') }}</UButton>
          <UButton to="/docs/self-host" variant="outline" color="neutral" size="lg">{{ $t('landing.selfHost') }}</UButton>
        </div>
      </div>
    </section>

    <!-- ------------------------------------------------------------ footer -->
    <footer class="border-t border-default">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 text-[13px] md:px-8">
        <p class="mr-auto flex items-center gap-2 font-semibold text-highlighted">
          <span class="grid size-5 place-items-center rounded-[5px] bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-3" /></span>
          HelpBites
        </p>
        <a :href="repo" target="_blank" rel="noopener" class="text-muted transition-colors hover:text-highlighted">{{ $t('landing.nav.source') }}</a>
        <NuxtLink to="/docs" class="text-muted transition-colors hover:text-highlighted">{{ $t('landing.nav.docs') }}</NuxtLink>
        <a href="/_docs/scalar" target="_blank" class="text-muted transition-colors hover:text-highlighted">{{ $t('docs.apiReference') }}</a>
        <NuxtLink to="/demo" class="text-muted transition-colors hover:text-highlighted">{{ $t('landing.nav.demo') }}</NuxtLink>
        <NuxtLink to="/login" class="text-muted transition-colors hover:text-highlighted">{{ $t('login.signIn') }}</NuxtLink>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const repo = 'https://github.com/elrumo/help-bites-oss'
const appUrl = useAppUrl()
const { t } = useI18n()

// Signed-in operators have no business on the marketing page. The cookie is a
// client fact and this route is prerendered, so the bounce happens on mount.
const { token } = useAgent()
onMounted(() => {
  if (token.value) navigateTo('/overview', { replace: true })
})

useSeoMeta({
  title: () => t('landing.seo.title'),
  description: () => t('landing.seo.description'),
  ogTitle: () => t('landing.seo.ogTitle'),
  ogDescription: () => t('landing.seo.ogDescription'),
  ogType: 'website'
})

/* -------------------------------------------------- hero transcript, played once */

const script = computed(() => [
  { from: 'user', body: t('landing.chat.m1') },
  { from: 'agent', body: t('landing.chat.m2') },
  { from: 'agent', body: t('landing.chat.m3') },
  { from: 'user', body: t('landing.chat.m4') }
])

const shown = ref(0)
const typing = ref(false)
const typingFrom = computed(() => (typing.value ? script.value[shown.value]?.from : undefined))

let timer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  // main.css flattens every animation under reduced motion, so a timed reveal
  // would just leave the panel blank. Show the whole thing at once instead.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    shown.value = script.value.length
    return
  }

  const step = () => {
    if (shown.value >= script.value.length) return
    const previous = script.value[shown.value - 1]
    const next = script.value[shown.value]!
    const reveal = () => {
      typing.value = false
      shown.value++
      timer = setTimeout(step, 750)
    }
    // Only the other side pauses to type; a run of replies lands together.
    if (previous && previous.from !== next.from) {
      typing.value = true
      timer = setTimeout(reveal, 1300)
    } else {
      reveal()
    }
  }

  timer = setTimeout(step, 500)
})

onUnmounted(() => clearTimeout(timer))

/* ------------------------------------------------------------------- content */

// The product shot's sample workspace.
const apps = [{ name: 'Acme', color: '#d9622b' }, { name: 'Bolt', color: '#5e6ad2' }, { name: 'Nimbus', color: '#0e9384' }]
const mockViews = computed(() => [t('landing.mock.all'), t('landing.mock.mine'), t('landing.mock.unread')])
const inbox = computed(() => [
  { name: 'Maya Chen', preview: t('landing.mock.preview.maya'), time: 'now', unread: true, color: '#d9622b' },
  { name: 'Leo Park', preview: t('landing.mock.preview.leo'), time: '4m', unread: true, color: '#5e6ad2' },
  { name: 'Sara Ruiz', preview: t('landing.mock.preview.sara'), time: '1h', unread: false, color: '#0e9384' },
  { name: 'Tom Ade', preview: t('landing.mock.preview.tom'), time: '3h', unread: false, color: '#d9622b' },
  { name: 'Ines Wu', preview: t('landing.mock.preview.ines'), time: '1d', unread: false, color: '#5e6ad2' }
])

const showcase = computed(() => [
  {
    id: 'inbox', eyebrow: t('nav.inbox'), title: t('landing.showcase.inbox.title'),
    body: t('landing.showcase.inbox.body'),
    bullets: [t('landing.showcase.inbox.b1'), t('landing.showcase.inbox.b2'), t('landing.showcase.inbox.b3'), t('landing.showcase.inbox.b4')],
    img: '/screens/inbox.webp', alt: t('landing.showcase.inbox.alt'), crop: ''
  },
  {
    id: 'errors', eyebrow: t('landing.showcase.errors.eyebrow'), title: t('landing.showcase.errors.title'),
    body: t('landing.showcase.errors.body'),
    bullets: [t('landing.showcase.errors.b1'), t('landing.showcase.errors.b2'), t('landing.showcase.errors.b3')],
    img: '/screens/errors.webp', alt: t('landing.showcase.errors.alt'), crop: '', doc: '/docs/errors'
  },
  {
    id: 'board', eyebrow: t('landing.showcase.board.eyebrow'), title: t('landing.showcase.board.title'),
    body: t('landing.showcase.board.body'),
    bullets: [t('landing.showcase.board.b1'), t('landing.showcase.board.b2'), t('landing.showcase.board.b3'), t('landing.showcase.board.b4')],
    img: '/screens/board.webp', alt: t('landing.showcase.board.alt'), crop: 'aspect-[16/6.5]', doc: '/docs/feedback'
  },
  {
    id: 'changelog', eyebrow: t('landing.showcase.changelog.eyebrow'), title: t('landing.showcase.changelog.title'),
    body: t('landing.showcase.changelog.body'),
    bullets: [t('landing.showcase.changelog.b1'), t('landing.showcase.changelog.b2'), t('landing.showcase.changelog.b3')],
    img: '/screens/changelog.webp', alt: t('landing.showcase.changelog.alt'), crop: 'aspect-[16/6.5]', doc: '/docs/feedback'
  },
  {
    id: 'email', eyebrow: t('nav.email'), title: t('landing.showcase.email.title'),
    body: t('landing.showcase.email.body'),
    bullets: [t('landing.showcase.email.b1'), t('landing.showcase.email.b2'), t('landing.showcase.email.b3'), t('landing.showcase.email.b4')],
    img: '/screens/email-designer.webp', alt: t('landing.showcase.email.alt'), crop: ''
  },
  {
    id: 'delivery', eyebrow: t('landing.showcase.delivery.eyebrow'), title: t('landing.showcase.delivery.title'),
    body: t('landing.showcase.delivery.body'),
    bullets: [t('landing.showcase.delivery.b1'), t('landing.showcase.delivery.b2'), t('landing.showcase.delivery.b3')],
    img: '/screens/email-log.webp', alt: t('landing.showcase.delivery.alt'), crop: 'aspect-[16/9]'
  },
  {
    id: 'flags', eyebrow: t('landing.showcase.flags.eyebrow'), title: t('landing.showcase.flags.title'),
    body: t('landing.showcase.flags.body'),
    bullets: [t('landing.showcase.flags.b1'), t('landing.showcase.flags.b2')],
    img: '/screens/flags.webp', alt: t('landing.showcase.flags.alt'), crop: 'aspect-[16/5.5]', doc: '/docs/flags'
  }
])

const more = computed(() => [
  { icon: 'i-lucide-circle-dollar-sign', title: t('landing.more.stripe.title'), body: t('landing.more.stripe.body') },
  { icon: 'i-lucide-scale', title: t('landing.more.legal.title'), body: t('landing.more.legal.body') },
  { icon: 'i-lucide-bot', title: t('landing.more.ai.title'), body: t('landing.more.ai.body') },
  { icon: 'i-lucide-send', title: t('landing.more.telegram.title'), body: t('landing.more.telegram.body') },
  { icon: 'i-lucide-book-open', title: t('landing.more.kb.title'), body: t('landing.more.kb.body') },
  { icon: 'i-lucide-smartphone', title: t('landing.more.apple.title'), body: t('landing.more.apple.body') }
])

const pitch = computed(() => [
  {
    icon: 'i-lucide-layers',
    title: t('landing.pitch.apps.title'),
    body: t('landing.pitch.apps.body')
  },
  {
    icon: 'i-lucide-key-round',
    title: t('landing.pitch.noTickets.title'),
    body: t('landing.pitch.noTickets.body')
  },
  {
    icon: 'i-lucide-scan-eye',
    title: t('landing.pitch.context.title'),
    body: t('landing.pitch.context.body')
  }
])

const features = computed(() => [
  {
    title: t('landing.features.app.title'),
    hint: t('landing.features.app.hint'),
    items: [
      { term: t('landing.features.app.bubble.term'), desc: t('landing.features.app.bubble.desc') },
      { term: t('landing.features.app.context.term'), desc: t('landing.features.app.context.desc') },
      { term: t('landing.features.app.onboarding.term'), desc: t('landing.features.app.onboarding.desc') },
      { term: t('landing.features.app.media.term'), desc: t('landing.features.app.media.desc') },
      { term: t('landing.features.app.colours.term'), desc: t('landing.features.app.colours.desc') },
      { term: t('landing.features.app.none.term'), desc: t('landing.features.app.none.desc') }
    ]
  },
  {
    title: t('landing.features.inbox.title'),
    hint: t('landing.features.inbox.hint'),
    items: [
      { term: t('landing.features.inbox.live.term'), desc: t('landing.features.inbox.live.desc') },
      { term: t('landing.features.inbox.overview.term'), desc: t('landing.features.inbox.overview.desc') },
      { term: t('landing.features.inbox.notes.term'), desc: t('landing.features.inbox.notes.desc') },
      { term: t('landing.features.inbox.away.term'), desc: t('landing.features.inbox.away.desc') },
      { term: t('landing.features.inbox.first.term'), desc: t('landing.features.inbox.first.desc') },
      { term: t('landing.features.inbox.native.term'), desc: t('landing.features.inbox.native.desc') }
    ]
  },
  {
    title: t('landing.features.feedback.title'),
    hint: t('landing.features.feedback.hint'),
    items: [
      { term: t('landing.features.feedback.board.term'), desc: t('landing.features.feedback.board.desc') },
      { term: t('landing.features.feedback.roadmap.term'), desc: t('landing.features.feedback.roadmap.desc') },
      { term: t('landing.features.feedback.changelog.term'), desc: t('landing.features.feedback.changelog.desc') },
      { term: t('landing.features.feedback.followers.term'), desc: t('landing.features.feedback.followers.desc') }
    ]
  },
  {
    title: t('landing.features.knowledge.title'),
    hint: t('landing.features.knowledge.hint'),
    items: [
      { term: t('landing.features.knowledge.faq.term'), desc: t('landing.features.knowledge.faq.desc') },
      { term: t('landing.features.knowledge.assistants.term'), desc: t('landing.features.knowledge.assistants.desc') },
      { term: t('landing.features.knowledge.scope.term'), desc: t('landing.features.knowledge.scope.desc') },
      { term: t('landing.features.knowledge.hybrid.term'), desc: t('landing.features.knowledge.hybrid.desc') }
    ]
  },
  {
    title: t('landing.features.email.title'),
    hint: t('landing.features.email.hint'),
    items: [
      { term: t('landing.features.email.designer.term'), desc: t('landing.features.email.designer.desc') },
      { term: t('landing.features.email.api.term'), desc: t('landing.features.email.api.desc') },
      { term: t('landing.features.email.log.term'), desc: t('landing.features.email.log.desc') },
      { term: t('landing.features.email.contacts.term'), desc: t('landing.features.email.contacts.desc') }
    ]
  },
  {
    title: t('landing.features.team.title'),
    hint: t('landing.features.team.hint'),
    items: [
      { term: t('landing.features.team.errors.term'), desc: t('landing.features.team.errors.desc') },
      { term: t('landing.more.stripe.title'), desc: t('landing.more.stripe.body') },
      { term: t('landing.features.team.legal.term'), desc: t('landing.features.team.legal.desc') },
      { term: t('landing.features.team.brand.term'), desc: t('landing.features.team.brand.desc') },
      { term: t('landing.features.team.pages.term'), desc: t('landing.features.team.pages.desc') },
      { term: t('landing.features.team.flags.term'), desc: t('landing.features.team.flags.desc') },
      { term: t('landing.features.team.types.term'), desc: t('landing.features.team.types.desc') },
      { term: t('landing.features.team.roles.term'), desc: t('landing.features.team.roles.desc') }
    ]
  }
])

const endpoints = computed(() => [
  { method: 'GET', path: '/v1/conversations', desc: t('landing.endpoints.list') },
  { method: 'POST', path: '/v1/conversations', desc: t('landing.endpoints.start') },
  { method: 'GET', path: '/v1/conversations/:id/messages', desc: t('landing.endpoints.transcript') },
  { method: 'POST', path: '/v1/conversations/:id/messages', desc: t('landing.endpoints.send') },
  { method: 'DELETE', path: '/v1/messages/:id', desc: t('landing.endpoints.unsend') },
  { method: 'POST', path: '/v1/attachments', desc: t('landing.endpoints.multipart') },
  { method: 'GET', path: '/v1/events', desc: t('landing.endpoints.sse') }
])

const mintSnippet = `import { createHmac } from 'node:crypto'

// GET /api/support/token — only for a signed-in user of your app
export function mintSupportToken(user) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ iss: process.env.HELP_BITES_PROJECT_KEY, sub: user.id, name: user.name, email: user.email, iat: now, exp: now + 3600 })
  const sig = createHmac('sha256', process.env.HELP_BITES_SECRET).update(head + '.' + body).digest('base64url')
  return head + '.' + body + '.' + sig
}`

const widgetSnippet = computed(() => `<script src="${appUrl.value}/widget.js" data-project="pk_…" defer><\/script>
<script>
  window.HelpBites = window.HelpBites || []
  HelpBites.push(['init', {
    getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token),
    context: { type: 'page', id: location.pathname, label: document.title, url: location.href } // optional
  }])
<\/script>`)
</script>

<style scoped>
@reference "~/assets/css/main.css";
/* Linear's headline treatment: the type fades a step toward the page at its foot. */
.hero-title {
  background-image: linear-gradient(to bottom, var(--ui-text-highlighted) 50%, color-mix(in oklab, var(--ui-text-highlighted) 62%, var(--ui-bg)));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
/* One quiet light behind the product shot. */
.hero-glow { background: radial-gradient(60% 55% at 50% 30%, color-mix(in oklab, var(--ui-primary) 16%, transparent), transparent 70%); }
.typing { @apply flex items-center gap-1 rounded-2xl px-3 py-2.5; }
.typing > span { @apply size-1.5 rounded-full bg-current opacity-60; }
/* Maya's side wears Acme's accent, the way a project's widget does. */
.accent-acme { background-color: #d9622b; }
.eyebrow { @apply text-[12px] font-medium uppercase tracking-[0.08em] text-primary-500; }
.chip { @apply inline-block rounded-full border border-default px-3 py-1 text-[13px] text-muted transition-colors hover:border-accented hover:text-highlighted; }
/* The hero's framing, reused for every screenshot. */
.shot { @apply rounded-2xl border border-default bg-muted p-1.5 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.25)] dark:shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]; }
.inline-code { @apply whitespace-nowrap rounded border border-default bg-elevated px-1 py-px font-mono text-[0.85em]; }
.step { @apply inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-default bg-elevated text-[11px] font-semibold tabular-nums text-toned; }
</style>
