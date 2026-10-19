<template>
  <div class="min-h-screen bg-default text-[15px] leading-relaxed text-default">
    <!-- ------------------------------------------------------------ header -->
    <header class="sticky top-0 z-30 border-b border-default/70 bg-default/80 backdrop-blur-xl">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5 md:px-8">
        <NuxtLink to="/" class="flex items-center gap-2 text-[14px] font-semibold text-highlighted">
          <span class="grid size-6 place-items-center rounded-md bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-3.5" /></span>
          HelpBites
        </NuxtLink>
        <nav class="hidden items-center gap-5 text-[13px] sm:flex" aria-label="Sections">
          <a href="#connect" class="text-muted transition-colors hover:text-highlighted">Connect</a>
          <a href="#features" class="text-muted transition-colors hover:text-highlighted">Features</a>
          <NuxtLink to="/docs" class="text-muted transition-colors hover:text-highlighted">Docs</NuxtLink>
          <a :href="repo" target="_blank" rel="noopener" class="text-muted transition-colors hover:text-highlighted">Source</a>
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <UButton to="/login" label="Sign in" color="neutral" variant="ghost" size="sm" />
          <UButton to="/demo" label="Try the demo" size="sm" />
        </div>
      </div>
    </header>

    <!-- -------------------------------------------------------------- hero -->
    <section class="mx-auto max-w-6xl px-5 pb-14 pt-16 md:px-8 md:pt-24">
      <h1 class="hero-title max-w-[15ch] text-[clamp(2.5rem,6.4vw,4.6rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
        One support inbox for every app you run.
      </h1>
      <p class="mt-6 max-w-[56ch] text-[17px] leading-relaxed text-muted">
        HelpBites puts a chat window inside your product, where your users already are. They write
        from the page they're stuck on, and you answer everything — every app, every user — from one panel.
      </p>
      <div class="mt-9 flex flex-wrap items-center gap-2.5">
        <UButton to="/demo" size="lg" trailing-icon="i-lucide-arrow-right">Try the demo</UButton>
        <UButton to="/docs/self-host" variant="outline" color="neutral" size="lg">Self-host it</UButton>
        <UButton to="#connect" variant="ghost" color="neutral" size="lg">See how it connects</UButton>
      </div>
      <p class="mt-4 text-[13px] text-dimmed">
        The demo is the real inbox with sample data: no sign-up, nothing saved. Runs on your own machines with
        <code class="inline-code">docker compose up -d</code>.
      </p>
    </section>

    <!-- The product, both sides of one conversation: your inbox, and the chat your user sees. -->
    <section class="relative mx-auto max-w-6xl px-5 pb-28 md:px-8 lg:pb-44" aria-label="The inbox and the chat, side by side">
      <div class="hero-glow pointer-events-none absolute inset-x-0 -top-16 h-[520px]" aria-hidden="true" />
      <div class="relative rounded-2xl border border-default bg-muted p-1.5 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.25)] dark:shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]">
        <div class="grid h-[440px] grid-cols-1 overflow-hidden rounded-xl md:grid-cols-[190px_270px_minmax(0,1fr)]">
          <!-- sidebar -->
          <aside class="hidden flex-col gap-4 bg-muted px-2.5 py-3 text-[12.5px] md:flex" aria-hidden="true">
            <p class="flex items-center gap-2 px-1.5 font-semibold text-highlighted"><span class="grid size-4.5 place-items-center rounded-[4px] bg-primary-500 text-white"><UIcon name="i-lucide-message-circle-more" class="size-3" /></span>HelpBites</p>
            <div class="space-y-px">
              <p class="flex items-center gap-2 rounded-md bg-black/[0.06] px-1.5 py-1 text-highlighted dark:bg-white/[0.07]"><UIcon name="i-lucide-inbox" class="size-3.5 text-muted" />Inbox<span class="ml-auto text-[11px] text-muted">3</span></p>
              <p class="flex items-center gap-2 px-1.5 py-1"><UIcon name="i-lucide-mail" class="size-3.5 text-muted" />Email templates</p>
            </div>
            <div class="space-y-px">
              <p class="px-1.5 pb-0.5 text-[11px] font-medium text-muted">Projects</p>
              <p v-for="app in apps" :key="app.name" class="flex items-center gap-2 px-1.5 py-1">
                <span class="grid size-4 place-items-center rounded-[4px] text-[9px] font-semibold text-white" :style="{ background: app.color }">{{ app.name[0] }}</span>{{ app.name }}
              </p>
            </div>
          </aside>

          <!-- list -->
          <div class="hidden flex-col border-x border-default bg-default md:flex" aria-hidden="true">
            <p class="flex h-10 shrink-0 items-center border-b border-default px-3 text-[12.5px] font-medium text-highlighted">Inbox</p>
            <div class="flex gap-1 px-2.5 py-2">
              <span v-for="(view, i) in ['All', 'Mine', 'Unread']" :key="view" class="rounded-full border px-2 py-0.5 text-[11px] font-medium" :class="i === 0 ? 'border-accented bg-elevated text-highlighted' : 'border-default text-muted'">{{ view }}</span>
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
              <span class="ml-1 hidden truncate text-muted sm:inline">Export stuck</span>
            </p>
            <div class="flex min-h-0 flex-1 flex-col justify-end gap-0.5 px-4 py-3 text-[13px]">
              <div class="mb-2 max-w-[70%] self-start rounded-lg border border-default px-2.5 py-1.5 text-[11.5px] leading-snug">
                <span class="block font-medium text-highlighted">Exports</span>
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
                Reply to Maya…<span class="ml-auto grid size-5 place-items-center rounded-full bg-primary-500/40 text-white"><UIcon name="i-lucide-arrow-up" class="size-3" /></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- The chat as Maya sees it, in Acme's app. -->
      <div class="absolute bottom-8 left-3 hidden w-[290px] overflow-hidden rounded-xl border border-default bg-default shadow-[0_20px_60px_-12px_rgb(0_0_0/0.35)] lg:-left-4 lg:block" aria-hidden="true">
        <p class="flex h-10 items-center gap-2 border-b border-default px-3 text-[12.5px] font-semibold text-highlighted">
          <span class="grid size-5 place-items-center rounded-[5px] text-[10px] text-white" :style="{ background: apps[0]!.color }">A</span>Acme support
          <UIcon name="i-lucide-x" class="ml-auto size-3.5 text-muted" />
        </p>
        <div class="flex min-h-[240px] flex-col justify-end gap-0.5 px-3 py-3 text-[12.5px]">
          <template v-for="(m, i) in script.slice(0, shown)" :key="i">
            <div class="flex" :class="[m.from === 'user' ? 'justify-end' : 'justify-start', script[i + 1]?.from === m.from ? '' : 'mb-2']">
              <div class="max-w-[82%] rounded-2xl px-3 py-1.5 leading-5 animate-bubble-in" :class="m.from === 'user' ? 'accent-acme text-white' : 'bubble-them'">{{ m.body }}</div>
            </div>
          </template>
          <div v-if="typingFrom === 'agent'" class="flex justify-start"><div class="typing bubble-them"><span v-for="d in 3" :key="d" class="animate-dot" :style="{ animationDelay: `${(d - 1) * 0.16}s` }" /></div></div>
          <p v-if="shown === script.length" class="text-right text-[10.5px] text-muted">Read</p>
        </div>
        <div class="border-t border-default px-3 py-2.5">
          <div class="rounded-lg border border-default px-2.5 py-1.5 text-[12px] text-dimmed">Message</div>
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
      <div class="mx-auto grid max-w-6xl gap-12 px-5 py-24 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:px-8">
        <div>
          <h2 class="text-[clamp(1.75rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-highlighted">Connecting it is a ten-minute job.</h2>
          <p class="mt-4 max-w-[44ch] text-muted">
            Three steps. Your users never make an account, because they already have one with you —
            your server vouches for them with a token that lasts an hour.
          </p>
        </div>

        <ol class="space-y-10">
          <li>
            <h3 class="flex items-center gap-2.5 text-[15px] font-semibold text-highlighted"><span class="step">1</span>Create a project</h3>
            <p class="mt-2 text-[14px] text-muted">
              One project per app. You get a public key <code class="inline-code">pk_…</code> that's safe in a
              browser and a secret <code class="inline-code">sk_…</code> that never leaves your server. Set the name
              replies are signed with, the origins allowed to host the chat, and who gets emailed when someone writes.
            </p>
          </li>
          <li>
            <h3 class="flex items-center gap-2.5 text-[15px] font-semibold text-highlighted"><span class="step">2</span>Sign a token for the user who's signed in</h3>
            <p class="mb-3 mt-2 text-[14px] text-muted">One authenticated route on your server. Any JWT library works; here it is with none at all.</p>
            <CodeBlock :code="mintSnippet" lang="js" />
          </li>
          <li>
            <h3 class="flex items-center gap-2.5 text-[15px] font-semibold text-highlighted"><span class="step">3</span>Drop the chat on the page</h3>
            <p class="mb-3 mt-2 text-[14px] text-muted">A script tag and the function that fetches that token. That's the install.</p>
            <CodeBlock :code="widgetSnippet" lang="html" />
            <p class="mt-3 text-[13px] text-muted">
              Only the origins you listed can host it — anywhere else sees an error and never gets a token. Add
              <code class="inline-code">data-mode="inline"</code> with a target element and the same chat becomes a
              page of your app instead of a floating bubble.
            </p>
          </li>
        </ol>
      </div>
    </section>

    <!-- ---------------------------------------------------------- features -->
    <section id="features" class="mx-auto grid max-w-6xl scroll-mt-14 gap-14 px-5 py-24 md:grid-cols-2 md:gap-16 md:px-8">
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
          A person reads it, and a person answers.
        </p>
        <p class="mt-6 max-w-[58ch] text-muted">
          AI is off until you switch it on for an assistant, and when it is on it answers only from the
          knowledge you gave it. No bot in the way by default, no “did that answer your question?”, no
          deflection funnel measured in tickets avoided. For most products, a chat window with a human on
          the other end is the entire feature.
        </p>
      </div>
    </section>

    <!-- --------------------------------------------------------- run it -->
    <section class="mx-auto grid max-w-6xl items-start gap-12 px-5 py-24 md:grid-cols-2 md:gap-16 md:px-8">
      <div>
        <h2 class="text-[clamp(1.75rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-highlighted">It's yours to run.</h2>
        <p class="mt-4 max-w-[52ch] text-muted">
          One <code class="inline-code">docker compose up -d</code> brings up the app, Mongo, Parse and Redis.
          Attachments go to any S3-compatible bucket you point it at. Your users' conversations stay on
          infrastructure you control. Nothing phones home; the only outside services are the ones you connect,
          such as Mailgun or an LLM.
        </p>
        <p class="mt-4 max-w-[52ch] text-muted">
          The widget is a convenience, not the product. Everything it does is on the API, and the API is
          documented down to the response shapes — build your own chat UI on it if you'd rather.
        </p>
        <div class="mt-8 flex flex-wrap gap-2.5">
          <UButton to="/docs/self-host">Self-host it</UButton>
          <UButton to="/_docs/scalar" target="_blank" variant="outline" color="neutral" trailing-icon="i-lucide-arrow-up-right">API reference</UButton>
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

    <!-- ------------------------------------------------------------ footer -->
    <footer class="border-t border-default">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 text-[13px] md:px-8">
        <p class="mr-auto flex items-center gap-2 font-semibold text-highlighted">
          <span class="grid size-5 place-items-center rounded-[5px] bg-primary-500 text-white" aria-hidden="true"><UIcon name="i-lucide-message-circle-more" class="size-3" /></span>
          HelpBites
        </p>
        <a :href="repo" target="_blank" rel="noopener" class="text-muted transition-colors hover:text-highlighted">Source</a>
        <NuxtLink to="/docs" class="text-muted transition-colors hover:text-highlighted">Docs</NuxtLink>
        <a href="/_docs/scalar" target="_blank" class="text-muted transition-colors hover:text-highlighted">API reference</a>
        <NuxtLink to="/demo" class="text-muted transition-colors hover:text-highlighted">Demo</NuxtLink>
        <NuxtLink to="/login" class="text-muted transition-colors hover:text-highlighted">Sign in</NuxtLink>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const repo = 'https://github.com/elrumo/help-bites-oss'
const appUrl = useAppUrl()

// Signed-in operators have no business on the marketing page. The cookie is a
// client fact and this route is prerendered, so the bounce happens on mount.
const { token } = useAgent()
onMounted(() => {
  if (token.value) navigateTo('/inbox', { replace: true })
})

useSeoMeta({
  title: 'HelpBites — one support inbox for every app you run',
  description: 'A chat window inside your product and one inbox behind it. Your users are already signed in, the install is a script tag, and a real person answers. AI is opt-in. Self-hosted.',
  ogTitle: 'HelpBites — one support inbox for every app you run',
  ogDescription: 'A chat window inside your product and one inbox behind it. Self-hosted, documented API, answered by a human.',
  ogType: 'website'
})

/* -------------------------------------------------- hero transcript, played once */

const script = [
  { from: 'user', body: 'Hey — my export has been stuck on “preparing” for about ten minutes.' },
  { from: 'agent', body: 'Found it — the job hit a timeout. I’ve requeued it just now.' },
  { from: 'agent', body: 'The email should land in a couple of minutes.' },
  { from: 'user', body: 'amazing, thank you' }
]

const shown = ref(0)
const typing = ref(false)
const typingFrom = computed(() => (typing.value ? script[shown.value]?.from : undefined))

let timer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  // main.css flattens every animation under reduced motion, so a timed reveal
  // would just leave the panel blank. Show the whole thing at once instead.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    shown.value = script.length
    return
  }

  const step = () => {
    if (shown.value >= script.length) return
    const previous = script[shown.value - 1]
    const next = script[shown.value]!
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
const inbox = [
  { name: 'Maya Chen', preview: 'Export stuck on “preparing”', time: 'now', unread: true, color: '#d9622b' },
  { name: 'Leo Park', preview: 'Can I move my plan to annual?', time: '4m', unread: true, color: '#5e6ad2' },
  { name: 'Sara Ruiz', preview: 'You: Fixed in 2.4 — thanks!', time: '1h', unread: false, color: '#0e9384' },
  { name: 'Tom Ade', preview: 'Invite link expired', time: '3h', unread: false, color: '#d9622b' },
  { name: 'Ines Wu', preview: 'Dark mode on the receipts page', time: '1d', unread: false, color: '#5e6ad2' }
]

const pitch = [
  {
    icon: 'i-lucide-layers',
    title: 'Every app, one list',
    body: 'Each app you run is a project, and every project writes into the same inbox — colour-coded, filterable, one unread count. You are not signing in and out of four helpdesks.'
  },
  {
    icon: 'i-lucide-key-round',
    title: 'No support email, no ticket numbers',
    body: 'Your users are already signed in to your app. Your server signs a short token and they are identified — no new account to make, no “please include your order ID”.'
  },
  {
    icon: 'i-lucide-scan-eye',
    title: 'You can see what they were looking at',
    body: 'The chat attaches the page, record or item they were on when they wrote. It is sitting on the conversation before you have asked a single question.'
  }
]

const features = [
  {
    title: 'In your app',
    hint: 'One script tag, no dependencies, about 10 KB.',
    items: [
      { term: 'A bubble, or a page of your app', desc: 'Give it a container and data-mode="inline" and the same chat becomes a page in your layout.' },
      { term: 'Knows what they were looking at', desc: 'Attach the page, record or link they are on, and update it as they move around your app.' },
      { term: 'Images, reactions, read receipts', desc: 'Paste or pick PNG, JPEG, GIF or WebP. Reply, unsend and react, and see when the team has read it.' },
      { term: 'Your colours', desc: 'Set an accent colour per project and the chat takes it on.' },
      { term: 'Or none of it', desc: 'Every endpoint is public and documented. Build your own chat UI on /v1/* instead.' }
    ]
  },
  {
    title: 'In your inbox',
    hint: 'One panel, however many apps and teammates.',
    items: [
      { term: 'Every app, one live list', desc: 'Colour-coded projects, one unread count, and messages that arrive as they happen. Filter by assignee, status or unread.' },
      { term: 'Notes, context and errors', desc: 'Internal notes your customer never sees. Their recent errors and linked feedback sit beside the conversation.' },
      { term: 'Email when you are away', desc: 'Notify whoever you list per project. Replies go to users by email too, linking straight back to the thread.' },
      { term: 'Write first', desc: 'Start a conversation with a user, after a failed payment or before a migration.' },
      { term: 'iPhone, iPad and Mac', desc: 'A native app for the inbox, replies and most of the panel, with push notifications once your server has APNs set up.' }
    ]
  },
  {
    title: 'Feedback, roadmap and changelog',
    hint: 'Users tell you what to build. You tell them what shipped.',
    items: [
      { term: 'A public board', desc: 'Users post ideas and bugs, vote, comment and react. You set the types, tags and statuses, and merge duplicates.' },
      { term: 'A roadmap from your own board', desc: 'Plan internal work on a kanban, link it to posts and conversations, and publish only the items you pick.' },
      { term: 'A changelog from what shipped', desc: 'Entries grouped into releases, drafted from finished work and reviewed before they go public. Includes RSS and digest emails.' },
      { term: 'Followers get the news', desc: 'Email when a followed post changes status, gets a public reply, or mentions them. Anyone can mute or unfollow.' }
    ]
  },
  {
    title: 'Knowledge and AI assistants',
    hint: 'Off until you turn it on. Grounded in your docs when it is on.',
    items: [
      { term: 'Upload your FAQ', desc: 'A Markdown or text file becomes a searchable knowledge base. Duplicates are flagged, and re-imports never overwrite your edits.' },
      { term: 'Assistants answer from it', desc: 'Each one has its own instructions, your own LLM endpoint, and routing rules that send a conversation to AI or to a person.' },
      { term: 'You choose what it sees', desc: 'Assign knowledge per assistant, by area or by single FAQ, with exclusions. Test retrieval before it answers anyone.' },
      { term: 'Hybrid search', desc: 'Keyword and vector search over the knowledge base. It runs keyword-only if you skip embeddings.' }
    ]
  },
  {
    title: 'Email and marketing',
    hint: 'Design once, brand per project, send from your server, see every delivery.',
    items: [
      { term: 'A block email designer', desc: 'Sections, buttons, columns and reusable components, rendered for Gmail, Apple Mail and Outlook. An AI designer turns pasted HTML into blocks.' },
      { term: 'A send API', desc: 'POST a template, your own HTML or a block document, with per-recipient variables, attachments, scheduling and idempotency keys.' },
      { term: 'A log of every delivery', desc: 'One entry per recipient, kept current by Mailgun. Bounces, complaints and unsubscribes are suppressed automatically.' },
      { term: 'Contacts, segments and campaigns', desc: 'Sync people from Postgres, Parse or Firestore, segment them, then run broadcasts and drip sequences with double opt-in.' }
    ]
  },
  {
    title: 'Your team and your tools',
    hint: 'Roles, error tracking and flags that sit next to support.',
    items: [
      { term: 'Error tracking', desc: 'Connect GlitchTip or Bugsink. New errors open conversations, and resolving either side resolves the other.' },
      { term: 'Feature flags', desc: 'Switch features on, off or for admins only, from the panel, without a deploy.' },
      { term: 'Your own ticket types', desc: 'Support is built in. Add types with their own statuses, fields and actions, and actions call back to your app over a signed webhook.' },
      { term: 'Roles for your team', desc: 'Agents answer, admins run projects and the team, owners handle billing. Invite people by email.' }
    ]
  }
]

const endpoints = [
  { method: 'GET', path: '/v1/conversations', desc: 'List' },
  { method: 'POST', path: '/v1/conversations', desc: 'Start one' },
  { method: 'GET', path: '/v1/conversations/:id/messages', desc: 'Transcript' },
  { method: 'POST', path: '/v1/conversations/:id/messages', desc: 'Send' },
  { method: 'DELETE', path: '/v1/messages/:id', desc: 'Unsend' },
  { method: 'POST', path: '/v1/attachments', desc: 'Multipart file' },
  { method: 'GET', path: '/v1/events', desc: 'Server-sent events' }
]

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
.inline-code { @apply whitespace-nowrap rounded border border-default bg-elevated px-1 py-px font-mono text-[0.85em]; }
.step { @apply inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-default bg-elevated text-[11px] font-semibold tabular-nums text-toned; }
</style>
