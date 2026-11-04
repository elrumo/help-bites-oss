<template>
  <div class="flex-1 min-h-0 flex flex-col">
    <PageHeader :project-id="id" :title="$t('sections.changelog')">
      <template #title>
        <span v-if="!loading && !error" class="ml-1 hidden text-xs font-normal tabular-nums text-muted sm:inline">{{ $t('changelog.publicCount', publicCount) }}, {{ $t('changelog.draftCount', draftCount) }}</span>
      </template>
      <template #actions>
        <UButton icon="i-lucide-sparkles" :label="$t('changelog.publicChangelog')" color="neutral" variant="ghost" size="sm" @click="copyChangelogUrl" />
        <UButton v-if="changelogReady" icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" square :to="changelogUrl" target="_blank" :aria-label="$t('changelog.openPublic')" />
        <UButton icon="i-lucide-git-commit-horizontal" :label="$t('changelog.fromCommits')" color="neutral" variant="ghost" size="sm" @click="openGenerate" />
        <UButton icon="i-lucide-palette" :label="$t('style.title')" color="neutral" variant="ghost" size="sm" @click="showStyle = true" />
        <UButton icon="i-lucide-settings-2" :label="$t('nav.settings')" color="neutral" variant="ghost" size="sm" @click="showSettings = true" />
        <UButton icon="i-lucide-package-plus" :label="$t('changelog.newRelease')" color="neutral" variant="soft" size="sm" @click="openNewRelease" />
        <UButton icon="i-lucide-plus" :label="$t('changelog.newEntry')" size="sm" @click="openNewEntry" />
      </template>
    </PageHeader>

    <div v-if="error" class="p-8 text-sm text-error">{{ error }}</div>
    <div v-else-if="loading" class="space-y-2 p-4"><USkeleton v-for="i in 4" :key="i" class="h-16" /></div>

    <div v-else class="flex-1 min-h-0 overflow-y-auto">
      <div class="mx-auto max-w-4xl space-y-8 px-4 py-4 md:px-6">
        <p v-if="project && !changelogReady" class="rounded-lg border border-default bg-elevated px-3 py-2 text-[13px] text-muted">
          {{ $t('changelog.offBefore') }} <button type="button" class="font-medium text-default underline underline-offset-2" @click="showSettings = true">{{ $t('changelog.publicChangelog') }}</button> {{ $t('changelog.offAfter') }}
        </p>

        <EmptyState v-if="!entries.length && !releases.length" icon="i-lucide-sparkles" :title="$t('changelog.nothingYet')" :description="$t('changelog.emptyDescription')">
          <UButton icon="i-lucide-plus" label="New entry" @click="openNewEntry" />
        </EmptyState>

        <p v-if="aiPending" class="flex items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-2 text-[13px] text-muted">
          <UIcon name="i-lucide-sparkles" class="size-4 shrink-0 text-primary" />
          <span><span class="font-medium text-default">{{ $t('changelog.aiWaiting', aiPending) }}</span> {{ $t('changelog.nothingPublic') }}</span>
        </p>

        <div v-if="selected.size" class="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-default bg-default px-3 py-2 text-[13px] shadow-sm">
          <span class="tabular-nums text-muted">{{ $t('changelog.selected', { count: selected.size }) }}</span>
          <UButton :label="$t('changelog.approvePublish')" icon="i-lucide-check" size="xs" color="primary" variant="soft" :disabled="!selectedDrafts.length" :loading="bulk === 'approve'" @click="approveSelected" />
          <UButton :label="confirmMerge ? $t('changelog.confirmMerge') : $t('changelog.mergeOne')" icon="i-lucide-merge" size="xs" :color="confirmMerge ? 'warning' : 'neutral'" variant="soft" :disabled="selected.size < 2 || selected.size > 10" :loading="bulk === 'merge'" @click="mergeSelected" />
          <UButton :label="$t('changelog.aiMerge')" icon="i-lucide-sparkles" size="xs" color="primary" variant="soft" :disabled="selected.size < 2" :loading="mergeAi.loading" @click="suggestMerges" />
          <UDropdownMenu :items="moveItems">
            <UButton :label="$t('changelog.moveTo')" icon="i-lucide-package" trailing-icon="i-lucide-chevron-down" size="xs" color="neutral" variant="soft" :loading="bulk === 'move'" />
          </UDropdownMenu>
          <UButton :label="$t('changelog.clear')" size="xs" color="neutral" variant="ghost" class="ml-auto" @click="clearSelection" />
          <p v-if="bulkError" class="w-full text-sm text-error">{{ bulkError }}</p>
        </div>

        <section v-for="group in groups" :key="group.key" class="rounded-xl transition-shadow" :class="dropKey === group.key ? 'ring-2 ring-primary/60 bg-primary/5' : ''" @dragover="dragOver(group, $event)" @drop.prevent="dropOn(group)">
          <UCollapsible :open="!collapsed.has(group.key)" @update:open="toggleGroup(group.key)">
            <header class="group/release flex cursor-pointer flex-wrap items-center gap-2">
              <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted transition-transform" :class="collapsed.has(group.key) ? '-rotate-90' : ''" aria-hidden="true" />
              <template v-if="group.release">
                <UCheckbox v-if="group.entries.length" :model-value="releaseState(group.entries)" class="transition-opacity" :class="releaseState(group.entries) === false ? 'opacity-0 group-hover/release:opacity-100 focus-within:opacity-100' : ''" :aria-label="$t('changelog.selectRelease', { version: group.release.version })" @click.stop @update:model-value="toggleRelease(group.entries)" />
                <h2 class="text-sm font-semibold">{{ group.release.version }}<span v-if="group.release.title" class="font-normal text-muted"> · {{ group.release.title }}</span></h2>
                <span class="rounded-full px-1.5 text-[11px]" :class="group.release.status === 'published' ? 'bg-success/10 text-success' : 'bg-elevated text-toned'">{{ group.release.status === 'published' ? $t('changelog.published') : $t('changelog.draft') }}</span>
                <time v-if="group.release.publishedAt" class="text-xs text-muted" :datetime="group.release.publishedAt">{{ shortDate(group.release.publishedAt) }}</time>
                <span class="text-xs tabular-nums text-muted">{{ $t('changelog.entryCount', group.entries.length) }}</span>
                <span class="ml-auto flex items-center gap-1" @click.stop>
                  <UButton v-if="group.release.status === 'draft'" :label="$t('changelog.publishRelease')" icon="i-lucide-rocket" size="xs" color="primary" variant="soft" :loading="publishing === group.release.id" @click="publishRelease(group.release)" />
                  <UButton icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" square :aria-label="$t('changelog.editRelease', { version: group.release.version })" @click="openRelease(group.release)" />
                </span>
              </template>
              <template v-else>
                <h2 class="text-sm font-semibold">{{ $t('changelog.noRelease') }}</h2>
                <span class="text-xs tabular-nums text-muted">{{ $t('changelog.entryCount', group.entries.length) }}</span>
              </template>
            </header>
            <template #content>
              <ul class="mt-2 divide-y divide-default rounded-lg border border-default">
                <li v-for="entry in group.entries" :key="entry.id" draggable="true" :title="$t('changelog.dragToMove')" class="flex items-center transition-colors hover:bg-elevated cursor-grab active:cursor-grabbing" :class="moving.includes(entry.id) || dragIds.includes(entry.id) ? 'opacity-50' : ''" @dragstart="startDrag(entry, $event)" @dragend="endDrag">
                  <UCheckbox :model-value="selected.has(entry.id)" class="pl-3" :aria-label="$t('changelog.selectEntry', { title: entry.title })" @click.capture="shiftHeld = $event.shiftKey" @update:model-value="toggleSelected(entry.id)" />
                  <button type="button" class="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[13px]" @click="openEntry(entry.id)">
                    <span class="w-16 shrink-0 rounded-full px-1.5 text-center text-[11px] font-semibold" :class="CHANGELOG_TAG_CLASS[entry.tag]">{{ $t(TAG_KEYS[entry.tag]) }}</span>
                    <span v-if="entry.number" class="shrink-0 tabular-nums text-muted">#{{ entry.number }}</span>
                    <span class="min-w-0 flex-1 truncate">{{ entry.title }}</span>
                    <time class="shrink-0 text-xs tabular-nums text-muted" :datetime="entryDate(entry)" :title="exactDate(entryDate(entry))">{{ shortDate(entryDate(entry)) }}</time>
                    <span v-if="entry.sources.length" class="inline-flex shrink-0 items-center gap-1 text-xs text-muted" :title="$t('changelog.linkedDone', { done: entry.sources.filter(s => s.done).length, total: entry.sources.length })"><UIcon name="i-lucide-link" class="size-3" />{{ entry.sources.filter(s => s.done).length }}/{{ entry.sources.length }}</span>
                    <span v-if="entry.aiGenerated" class="shrink-0 rounded-full bg-primary/10 px-1.5 text-[11px] text-primary" :title="$t('changelog.aiTitle')">AI</span>
                    <span class="shrink-0 rounded-full px-1.5 text-[11px]" :class="STATE_CLASS[stateOf(entry).key]">{{ stateOf(entry).label }}</span>
                  </button>
                </li>
                <li v-if="!group.entries.length" class="px-3 py-2.5 text-xs text-muted">{{ $t('changelog.noEntries') }}</li>
              </ul>
            </template>
          </UCollapsible>
        </section>
      </div>
    </div>

    <!-- Entry editor -->
    <USlideover v-model:open="entryOpen" :title="current ? (current.number ? $t('changelog.entryNumber', { number: current.number }) : $t('changelog.entry')) : $t('changelog.newEntry')" :description="current ? $t('changelog.created', { time: `${exactDate(current.createdAt)} (${timeAgo(current.createdAt)})` }) : $t('changelog.draftUntilPublish')" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div class="space-y-6" @keydown.meta.enter.prevent="submitShortcut" @keydown.ctrl.enter.prevent="submitShortcut">
          <p v-if="!current && restored" class="flex items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-2 text-xs text-muted">
            <UIcon name="i-lucide-history" class="size-3.5 shrink-0" />
            <span class="min-w-0 flex-1">{{ $t('changelog.draftRestored') }}</span>
            <UButton :label="$t('changelog.discardDraft')" size="xs" color="neutral" variant="ghost" @click="discardDraft" />
          </p>
          <div class="space-y-2">
            <UInput v-model="draft.title" :placeholder="$t('changelog.whatChanged')" size="xl" class="w-full" :ui="titleField" :maxlength="200" :aria-label="$t('changelog.title')" @blur="saveText('title')" @keydown.enter.prevent="saveText('title')" />
            <UTextarea v-model="draft.body" :placeholder="$t('changelog.bodyPlaceholder')" :rows="4" autoresize :maxrows="18" class="w-full" :aria-label="$t('changelog.text')" @blur="saveText('body')" />
          </div>

          <section class="space-y-2">
            <h3 class="text-sm font-semibold">{{ $t('changelog.images') }}</h3>
            <AttachmentsField v-if="current" v-model="draft.images" images-only :project-id="id" :add-label="$t('changelog.addImage')" @update:model-value="patch({ images: $event })" />
            <p v-else class="text-xs text-muted">{{ $t('changelog.imagesAfterCreate') }}</p>
            <p class="text-xs text-muted">{{ $t('changelog.imagesHint') }}</p>
          </section>

          <section class="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <UInput variant="subtle" v-model="draft.summary" :placeholder="$t('changelog.summaryPlaceholder')" size="sm" class="w-full sm:col-span-2" :maxlength="300" :aria-label="$t('changelog.summary')" @blur="saveField('summary')" />
            <UInput v-if="current" variant="subtle" v-model="draft.slug" :placeholder="$t('changelog.slug')" size="sm" class="w-full" :maxlength="120" :aria-label="$t('changelog.slug')" :ui="{ base: 'font-mono text-xs' }" @blur="saveField('slug')" />
            <UInput variant="subtle" v-model="draft.area" :placeholder="project?.changelog.areas?.length ? $t('changelog.areaList', { areas: project.changelog.areas.join(', ') }) : $t('changelog.areaOptional')" size="sm" class="w-full" :maxlength="40" :aria-label="$t('changelog.area')" @blur="saveField('area')" />
          </section>

          <section class="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <USelect v-model="draft.tag" :items="tagItems" size="sm" class="w-full" :ui="propertyField" :aria-label="$t('changelog.type')" @update:model-value="patch({ tag: draft.tag })">
              <template #leading><UIcon name="i-lucide-tag" class="size-3.5 text-dimmed" /></template>
            </USelect>
            <USelect v-model="draft.releaseId" :items="releaseItems" size="sm" class="w-full" :ui="propertyField" :aria-label="$t('changelog.release')" @update:model-value="patch({ releaseId: draft.releaseId === NO_RELEASE ? null : draft.releaseId })">
              <template #leading><UIcon name="i-lucide-package" class="size-3.5 text-dimmed" /></template>
            </USelect>
            <USelect v-model="draft.status" :items="statusItems" size="sm" class="w-full" :ui="propertyField" :aria-label="$t('changelog.status')" @update:model-value="patch({ status: draft.status })">
              <template #leading><span class="size-2.5 rounded-full" :class="draft.status === 'published' ? 'bg-emerald-500' : 'bg-stone-400'" /></template>
            </USelect>
            <label class="group" :class="[propertyBox, current ? '' : 'pointer-events-none opacity-50']">
              <UIcon name="i-lucide-calendar" class="absolute left-2.5 size-3.5 text-dimmed" />
              <input v-model="draft.date" type="date" :title="current && !current.publishedAt ? $t('changelog.dateFallback', { date: exactDate(current.createdAt) }) : undefined" class="w-full bg-transparent outline-none [color-scheme:light] dark:[color-scheme:dark]" :class="draft.date ? '' : 'text-dimmed'" :aria-label="$t('changelog.date')" :disabled="!current" @change="patch({ publishedAt: draft.date ? `${draft.date}T12:00:00.000Z` : null })">
            </label>
          </section>

          <p v-if="current?.aiGenerated" class="flex items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-2 text-xs text-muted">
            <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0 text-primary" />
            {{ $t('changelog.aiWrittenFrom', current.commitShas.length) }}
          </p>

          <section v-if="current && current.status === 'draft' && current.reviewStatus" class="space-y-2 rounded-lg border border-default bg-elevated px-3 py-2">
            <p class="text-xs text-muted">
              <span class="font-medium text-default">{{ current.reviewStatus === 'rejected' ? $t('changelog.sentBack') : $t('changelog.waitingReview') }}</span>
              <template v-if="current.reviewedBy"> · {{ current.reviewedBy }}<template v-if="current.reviewNotes">: {{ current.reviewNotes }}</template></template>
            </p>
            <div class="flex items-center gap-2">
              <UInput variant="subtle" v-model="reviewNotes" :placeholder="$t('changelog.notesOptional')" size="sm" class="min-w-0 flex-1" :maxlength="2000" :aria-label="$t('changelog.reviewNotes')" />
              <UButton :label="$t('changelog.reject')" size="sm" color="neutral" variant="soft" :loading="reviewing === 'reject'" @click="review('reject')" />
              <UButton :label="$t('changelog.approvePublish')" size="sm" color="primary" :loading="reviewing === 'approve'" @click="review('approve')" />
            </div>
          </section>

          <p v-if="current && stateOf(current).key === 'waiting'" class="rounded-lg border border-default bg-elevated px-3 py-2 text-xs text-muted">{{ $t('changelog.notPublicYet') }}</p>

          <template v-if="current">
            <section class="space-y-2">
              <h3 class="flex items-center gap-2 text-sm font-semibold">{{ $t('changelog.madeFrom') }} <span class="font-normal text-muted">{{ current.sources.length }}</span></h3>
              <ul v-if="current.sources.length" class="divide-y divide-default rounded-lg border border-default">
                <li v-for="source in current.sources" :key="`${source.kind}:${source.id}`" class="group flex items-center gap-2 px-2.5 py-2 text-[13px]">
                  <UIcon :name="SOURCE_ICON[source.kind]" class="size-3.5 shrink-0 text-muted" :aria-label="SOURCE_LABEL[source.kind]" />
                  <NuxtLink v-if="sourceLink(source)" :to="sourceLink(source)!" class="min-w-0 flex-1 truncate hover:underline"><span v-if="source.number" class="mr-1 tabular-nums text-muted">#{{ source.number }}</span>{{ source.label || SOURCE_LABEL[source.kind] }}</NuxtLink>
                  <span v-else class="min-w-0 flex-1 truncate"><span v-if="source.number" class="mr-1 tabular-nums text-muted">#{{ source.number }}</span>{{ source.label || SOURCE_LABEL[source.kind] }}</span>
                  <span class="shrink-0 rounded-full px-1.5 text-[11px]" :class="source.done ? 'bg-success/10 text-success' : 'bg-elevated text-toned'">{{ source.done ? $t('changelog.done') : source.status || $t('changelog.open') }}</span>
                  <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :aria-label="$t('changelog.unlinkSource', { label: source.label })" @click="setLink(source.kind, source.id, false)" />
                </li>
              </ul>
              <form class="flex gap-2" @submit.prevent="addSource">
                <USelect v-model="sourceKind" :items="sourceKindItems" size="sm" class="w-36" :aria-label="$t('changelog.kind')" />
                <UInput variant="subtle" v-model="sourceRef" size="sm" class="w-32" placeholder="#12" :aria-label="$t('changelog.number')" />
                <UButton type="submit" :label="$t('changelog.link')" size="sm" color="neutral" variant="soft" :disabled="!sourceRef.trim()" :loading="linking" />
              </form>
              <p class="text-xs text-muted">{{ $t('changelog.linkHint') }}</p>
            </section>

            <!-- Only once it is public, and only when it answers somebody's conversation. Never sent on its own. -->
            <section v-if="linkedConversations?.count && stateOf(current).key === 'public'" class="flex flex-wrap items-center gap-3 rounded-lg border border-default bg-elevated px-3 py-2.5">
              <UIcon name="i-lucide-messages-square" class="size-4 shrink-0 text-primary" />
              <p class="min-w-0 flex-1 text-[13px] text-muted">{{ $t('changelog.reply.hint', linkedConversations.count) }}</p>
              <UButton icon="i-lucide-send" size="sm" color="primary" variant="soft" :label="$t('changelog.reply.button', linkedConversations.count)" @click="replyOpen = true" />
            </section>
          </template>

          <p v-if="entryError" class="text-sm text-error">{{ entryError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UButton v-if="current" :label="confirmDelete ? $t('changelog.clickAgainDelete') : $t('changelog.delete')" icon="i-lucide-trash-2" :color="confirmDelete ? 'error' : 'neutral'" :variant="confirmDelete ? 'solid' : 'ghost'" @click="deleteEntry" />
          <SaveStatus v-if="current" class="ml-auto" :saving="savingEntry" :saved="savedEntry" :idle="$t('changelog.changesSave')" />
          <template v-else>
            <UButton class="ml-auto" :label="$t('common.cancel')" color="neutral" variant="ghost" @click="entryOpen = false" />
            <UButton :label="$t('changelog.createDraft')" color="primary" :loading="savingEntry" :disabled="!draft.title.trim()" @click="createEntry">
              <template #trailing><span class="hidden items-center gap-0.5 sm:inline-flex" aria-hidden="true"><UKbd value="meta" size="sm" class="bg-white/20 text-white ring-0" /><UKbd value="enter" size="sm" class="bg-white/20 text-white ring-0" /></span></template>
            </UButton>
          </template>
        </div>
      </template>
    </USlideover>

    <ChangelogReplyDialog v-if="current && linkedConversations" v-model:open="replyOpen" :project-id="id" :entry-id="current.id" :linked="linkedConversations" @sent="loadLinkedConversations" />

    <!-- Settings -->
    <USlideover v-model:open="showSettings" :title="$t('changelog.settingsTitle')" :description="$t('changelog.settingsDescription')" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-4">
          <USwitch :model-value="project?.changelog.autoDraft || false" :label="$t('changelog.autoDraft')" :description="$t('changelog.autoDraftDescription')" @update:model-value="saveSettings({ autoDraft: $event })" />
          <USwitch :model-value="project?.changelog.commitAi.onPush || false" :label="$t('changelog.commitAi')" :description="$t('changelog.commitAiDescription')" @update:model-value="saveSettings({ commitAi: { onPush: $event } })" />
          <USwitch v-if="project?.changelog.commitAi.onPush" :model-value="project?.changelog.commitAi.autoPublish || false" :label="$t('changelog.autoPublish')" :description="$t('changelog.autoPublishDescription')" @update:model-value="saveSettings({ commitAi: { autoPublish: $event } })" />
          <USwitch :model-value="project?.changelog.comments || false" :label="$t('changelog.comments')" :description="$t('changelog.commentsDescription')" @update:model-value="saveSettings({ comments: $event })" />
          <USwitch :model-value="project?.changelog.notify || false" :label="$t('changelog.emailSubscribers')" :description="$t('changelog.emailSubscribersDescription')" @update:model-value="saveSettings({ notify: $event })" />
          <USwitch :model-value="project?.changelog.enabled || false" :label="$t('changelog.publicChangelog')" :description="$t('changelog.publicChangelogDescription')" @update:model-value="saveSettings({ enabled: $event })" />
          <div class="space-y-2">
            <p class="text-sm font-medium">{{ $t('changelog.imageWidth') }}</p>
            <p class="text-xs text-muted">{{ $t('changelog.imageWidthDescription') }}</p>
            <URadioGroup :model-value="project?.changelog.imageWidth || 'full'" :items="imageWidthItems" orientation="horizontal" @update:model-value="saveSettings({ imageWidth: $event })" />
          </div>
          <p class="text-xs text-muted">{{ savingSettings ? $t('changelog.saving') : settingsSaved ? $t('common.saved') : $t('changelog.savesAsChange') }}</p>
          <p v-if="settingsError" class="text-sm text-error">{{ settingsError }}</p>
          <p class="text-xs text-muted">{{ $t('changelog.followsFeedback') }} <NuxtLink :to="`/projects/${id}/feedback`" class="underline underline-offset-2">{{ $t('changelog.changelogOption') }}</NuxtLink>{{ $t('changelog.followsFeedbackEnd') }}</p>
        </div>
      </template>
    </USlideover>

    <!-- Style -->
    <USlideover v-model:open="showStyle" :title="$t('changelog.styleTitle')" :description="$t('changelog.styleDescription')" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <StyleChoicePanel v-if="project" :project="project" target="changelog" />
      </template>
    </USlideover>

    <!-- Write from commits -->
    <USlideover v-model:open="generateOpen" :title="$t('changelog.writeFromCommits')" :description="$t('changelog.writeFromCommitsDescription')" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-4">
          <p v-if="repos && !repos.length" class="rounded-lg border border-default bg-elevated px-3 py-2 text-[13px] text-muted">
            {{ $t('changelog.noRepos') }} <NuxtLink :to="`/projects/${id}/settings`" @click.prevent="openProjectSettings(id)" class="font-medium text-default underline underline-offset-2">{{ $t('nav.settings') }}</NuxtLink>{{ $t('changelog.noReposAfter') }}
          </p>
          <UFormField :label="$t('changelog.commitsToRead')">
            <USelect v-model="range" :items="rangeItems" class="w-full" />
          </UFormField>
          <div v-if="range === 'recent'" class="flex gap-2">
            <UInput v-model.number="rangeCount" type="number" :min="1" :max="999" class="w-24" :aria-label="$t('changelog.howMany')" />
            <USelect v-model="rangeUnit" :items="unitItems" class="w-36" :aria-label="$t('changelog.unit')" />
          </div>
          <p class="text-xs text-muted">{{ $t('changelog.readsNewest') }}</p>
          <div v-if="run" class="rounded-lg border border-default px-3 py-2 text-[13px]">
            <template v-if="run.state === 'running'"><UIcon name="i-lucide-loader-circle" class="mr-1 inline size-3.5 animate-spin" />{{ $t('changelog.writingDrafts') }}</template>
            <template v-else-if="run.state === 'done'">{{ $t('changelog.lastRun') }} {{ $t('changelog.draftsCreated', run.created) }}, {{ $t('changelog.commitsCovered', run.skipped) }}<template v-if="run.truncated">{{ $t('changelog.olderNotRead') }}</template>{{ $t('changelog.sentenceEnd') }}</template>
            <template v-else><span class="text-error">{{ $t('changelog.lastRunFailed') }} {{ run.error }}</span></template>
          </div>
          <p v-if="generateError" class="text-sm text-error">{{ generateError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UButton class="ml-auto" :label="$t('changelog.close')" color="neutral" variant="ghost" @click="generateOpen = false" />
          <UButton :label="$t('changelog.generateDrafts')" icon="i-lucide-sparkles" color="primary" :loading="generating || run?.state === 'running'" :disabled="repos !== null && !repos.length" @click="generate" />
        </div>
      </template>
    </USlideover>

    <!-- AI merge suggestions -->
    <UModal v-model:open="mergeAi.open" :title="$t('changelog.aiMergeTitle')" :description="$t('changelog.aiMergeDescription')" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div v-if="mergeAi.loading" class="flex items-center gap-2 py-8 text-sm text-muted"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />{{ $t('changelog.aiMergeReading', { count: selected.size }) }}</div>
        <p v-else-if="mergeAi.error" class="text-sm text-error">{{ mergeAi.error }}</p>
        <p v-else-if="!mergeAi.merges.length" class="py-6 text-center text-sm text-muted">{{ $t('changelog.aiMergeNone') }}</p>
        <ul v-else class="space-y-3">
          <li v-for="(m, i) in mergeAi.merges" :key="i" class="rounded-lg border border-default p-3" :class="mergeAi.chosen.has(i) ? '' : 'opacity-60'">
            <label class="flex cursor-pointer items-start gap-2.5">
              <UCheckbox :model-value="mergeAi.chosen.has(i)" class="mt-0.5" @update:model-value="toggleMergeChoice(i)" />
              <span class="min-w-0 flex-1 space-y-2">
                <span v-if="m.reason" class="block text-xs text-muted">{{ m.reason }}</span>
                <span class="block space-y-1 rounded-md bg-elevated px-2.5 py-2">
                  <span v-for="src in mergeSources(m)" :key="src.id" class="flex items-center gap-2 text-[13px] text-muted">
                    <span class="w-16 shrink-0 rounded-full px-1.5 text-center text-[11px] font-semibold" :class="CHANGELOG_TAG_CLASS[src.tag]">{{ $t(TAG_KEYS[src.tag]) }}</span>
                    <span v-if="src.number" class="shrink-0 tabular-nums">#{{ src.number }}</span>
                    <span class="min-w-0 flex-1 truncate">{{ src.title }}</span>
                    <span v-if="src.status === 'published'" class="shrink-0 rounded-full bg-success/10 px-1.5 text-[11px] text-success">{{ $t('changelog.published') }}</span>
                  </span>
                </span>
                <span class="flex items-center gap-1.5 text-xs font-medium text-primary"><UIcon name="i-lucide-arrow-down" class="size-3.5" />{{ $t('changelog.aiMergeInto') }}</span>
                <span class="block space-y-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2">
                  <span class="flex items-center gap-2">
                    <span class="w-16 shrink-0 rounded-full px-1.5 text-center text-[11px] font-semibold" :class="CHANGELOG_TAG_CLASS[m.tag]">{{ $t(TAG_KEYS[m.tag]) }}</span>
                    <span class="min-w-0 flex-1 text-sm font-medium">{{ m.title }}</span>
                  </span>
                  <span v-if="m.body" class="block whitespace-pre-wrap text-[13px] text-toned">{{ m.body }}</span>
                </span>
              </span>
            </label>
          </li>
        </ul>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-2">
          <span v-if="mergeAi.merges.some(m => mergeSources(m).some(e => e.status === 'published'))" class="text-xs text-muted">{{ $t('changelog.aiMergePublishedNote') }}</span>
          <UButton class="ml-auto" :label="$t('common.cancel')" color="neutral" variant="ghost" @click="mergeAi.open = false" />
          <UButton v-if="mergeAi.merges.length" :label="$t('changelog.aiMergeApply', mergeAi.chosen.size)" icon="i-lucide-merge" color="primary" :loading="mergeAi.applying" :disabled="!mergeAi.chosen.size" @click="applyMerges" />
        </div>
      </template>
    </UModal>

    <!-- Release editor -->
    <USlideover v-model:open="releaseOpen" :title="releaseDraft.id ? $t('changelog.releaseTitle', { version: releaseDraft.version }) : $t('changelog.newRelease')" :description="$t('changelog.releaseDescription')" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <form class="space-y-4" @submit.prevent="saveRelease">
          <UFormField :label="$t('changelog.version')" required :hint="$t('changelog.versionHint')">
            <UInput variant="subtle" v-model="releaseDraft.version" class="w-full" :maxlength="60" placeholder="2.4" />
          </UFormField>
          <UFormField :label="$t('changelog.title')" :hint="$t('changelog.optionalHeadline')">
            <UInput variant="subtle" v-model="releaseDraft.title" class="w-full" :maxlength="200" :placeholder="$t('changelog.releasePlaceholder')" />
          </UFormField>
          <UFormField :label="$t('changelog.summary')" :hint="$t('changelog.summaryHint')">
            <UTextarea variant="subtle" v-model="releaseDraft.summary" :rows="3" autoresize :maxrows="12" class="w-full" :maxlength="2000" />
          </UFormField>
          <UButton v-if="releaseDraft.id" :label="$t('changelog.releaseWriteAi')" icon="i-lucide-sparkles" color="primary" variant="soft" size="sm" :loading="writingRelease" @click="writeRelease" />
          <p v-if="releaseError" class="text-sm text-error">{{ releaseError }}</p>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UButton v-if="releaseDraft.id" :label="confirmDeleteRelease ? $t('changelog.clickAgainDelete') : $t('changelog.delete')" icon="i-lucide-trash-2" :color="confirmDeleteRelease ? 'error' : 'neutral'" :variant="confirmDeleteRelease ? 'solid' : 'ghost'" @click="deleteRelease" />
          <UButton class="ml-auto" :label="$t('common.cancel')" color="neutral" variant="ghost" @click="releaseOpen = false" />
          <UButton :label="releaseDraft.id ? $t('changelog.save') : $t('changelog.createRelease')" color="primary" :loading="savingRelease" :disabled="!releaseDraft.version.trim()" @click="saveRelease" />
        </div>
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
const { openProjectSettings } = useProjectSettings()
import { CHANGELOG_IMAGE_WIDTHS, CHANGELOG_TAGS, CHANGELOG_TAG_LABELS, isEntryPublic, type ChangelogEntry, type ChangelogImageWidth, type ChangelogLinkKind, type ChangelogRelease, type ChangelogSource, type ChangelogStatus, type ChangelogTag } from '#shared/changelog'
import type { ChangelogLinkedConversations } from '#shared/changelogReply'
import type { ItemAttachment } from '#shared/itemAttachments'
import type { AdminProject } from '~~/server/utils/projects'

// A project's changelog: entries (what shipped, in your own words) grouped into
// releases, each linked to the posts, board items, tickets and errors it came
// from. Operators only. Existing entries save field by field, the way the board's
// items do; nothing is public until the entry (and its release) is published.

definePageMeta({ middleware: 'agent' })

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)
const { api, projects, loadProjects } = useAgent()
const toast = useToast()
const { t } = useI18n()
const appUrl = useAppUrl()

const project = computed<AdminProject | null>(() => projects.value.find(p => p.id === id) || null)
const entries = ref<ChangelogEntry[]>([])
const releases = ref<ChangelogRelease[]>([])
const loading = ref(true)
const error = ref('')

const NO_RELEASE = '__none__'
const SOURCE_LABEL = computed<Record<ChangelogLinkKind, string>>(() => ({ feedback: t('changelog.feedbackPost'), board: t('changelog.boardItem'), conversation: t('changelog.conversation') }))
const TAG_KEYS: Record<ChangelogTag, string> = { new: 'changelog.tagNew', improved: 'changelog.tagImproved', fix: 'changelog.tagFixed', removed: 'changelog.tagRemoved', breaking: 'changelog.tagBreaking' }
const SOURCE_ICON: Record<ChangelogLinkKind, string> = { feedback: 'i-lucide-lightbulb', board: 'i-lucide-square-kanban', conversation: 'i-lucide-message-square' }
const STATE_CLASS = { public: 'bg-success/10 text-success', waiting: 'bg-warning/10 text-warning', draft: 'bg-elevated text-toned' }
const tagItems = computed(() => CHANGELOG_TAGS.map(value => ({ label: t(TAG_KEYS[value]), value })))
const statusItems = computed(() => [{ label: t('changelog.draft'), value: 'draft' }, { label: t('changelog.published'), value: 'published' }])
const imageWidthItems = computed(() => CHANGELOG_IMAGE_WIDTHS.map(value => ({ label: t(`changelog.imageWidth_${value}`), value })))
const sourceKindItems = computed(() => [{ label: t('changelog.feedbackPost'), value: 'feedback' }, { label: t('changelog.boardItem'), value: 'board' }])

const releaseOf = (releaseId: string) => releases.value.find(r => r.id === releaseId) || null
/** Highest version first (0.8.1 above 0.8.0, 0.8.10 above 0.8.9), the newer date breaking a tie. */
const orderedReleases = computed(() => [...releases.value].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }) || String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt))))
const releaseLabel = (r: ChangelogRelease) => `${r.version}${r.title ? ` · ${r.title}` : ''}${r.status === 'draft' ? ` ${t('changelog.draftSuffix')}` : ''}`
const releaseItems = computed(() => [{ label: t('changelog.noRelease'), value: NO_RELEASE }, ...orderedReleases.value.map(r => ({ label: releaseLabel(r), value: r.id }))])

/** The date an entry carries: when it went (or is set to go) public, else when it was written. */
const entryDate = (entry: ChangelogEntry) => entry.publishedAt || entry.createdAt
const exactDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Where an entry stands: public, a published entry still waiting on its draft release, or a draft. */
function stateOf(entry: ChangelogEntry): { key: 'public' | 'waiting' | 'draft', label: string } {
  if (entry.status !== 'published') return { key: 'draft', label: t('changelog.draft') }
  return isEntryPublic(entry, entry.releaseId ? releaseOf(entry.releaseId) : null) ? { key: 'public', label: t('changelog.public') } : { key: 'waiting', label: t('changelog.waitingRelease') }
}

const aiPending = computed(() => entries.value.filter(e => e.aiGenerated && e.status === 'draft').length)
const publicCount = computed(() => entries.value.filter(e => stateOf(e).key === 'public').length)
const draftCount = computed(() => entries.value.filter(e => stateOf(e).key !== 'public').length)

/** Release-less entries first (where new drafts land), then the releases, highest version first. */
const groups = computed(() => {
  const loose = entries.value.filter(e => !e.releaseId || !releaseOf(e.releaseId))
  const out: { key: string, release: ChangelogRelease | null, entries: ChangelogEntry[] }[] = []
  // While an entry is dragged, "No release" is always there to drop it on, even when empty.
  if (loose.length || dragIds.value.length) out.push({ key: 'none', release: null, entries: loose })
  for (const release of orderedReleases.value) out.push({ key: release.id, release, entries: entries.value.filter(e => e.releaseId === release.id) })
  return out
})

// ---- the public link ----
const changelogUrl = computed(() => (project.value ? `${appUrl.value}/changelog/${project.value.publicKey}` : ''))
const changelogReady = computed(() => Boolean(project.value?.changelog.enabled))

async function copyChangelogUrl() {
  if (!changelogReady.value) {
    toast.add({ title: t('changelog.turnOnFirst'), description: t('changelog.turnOnFirstDescription'), icon: 'i-lucide-info', color: 'warning' })
    return
  }
  try {
    await navigator.clipboard.writeText(changelogUrl.value)
    toast.add({ title: t('changelog.linkCopied'), description: changelogUrl.value, icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {
    toast.add({ title: t('changelog.yourPublic'), description: changelogUrl.value, icon: 'i-lucide-sparkles' })
  }
}

// ---- load ----
async function loadAll() {
  const [entryResult, releaseResult] = await Promise.all([
    api<{ entries: ChangelogEntry[] }>('/admin/changelog/entries', { query: { project: id } }),
    api<{ releases: ChangelogRelease[] }>('/admin/changelog/releases', { query: { project: id } })
  ])
  entries.value = entryResult.entries
  releases.value = releaseResult.releases
}

/** No live sync between operators yet: coming back to the tab refetches. */
function onFocus() {
  if (!savingEntry.value && !loading.value) loadAll().catch(() => {})
}

onMounted(async () => {
  window.addEventListener('focus', onFocus)
  try {
    if (!project.value) await loadProjects()
    if (!project.value) throw new Error('Project not found')
    await loadAll()
  } catch (e: any) {
    error.value = e?.message || t('changelog.loadError')
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => window.removeEventListener('focus', onFocus))

// ---- the entry editor ----
const entryOpen = ref(false)
const editingId = ref('')
const current = computed(() => entries.value.find(e => e.id === editingId.value) || null)
const draft = reactive({ title: '', summary: '', slug: '', area: '', body: '', images: [] as ItemAttachment[], tag: 'improved' as ChangelogTag, releaseId: NO_RELEASE, status: 'draft' as ChangelogStatus, date: '' })
const reviewNotes = ref('')
const reviewing = ref<'' | 'approve' | 'reject'>('')
const entryError = ref('')
const savingEntry = ref(false)
/** The last change to the open entry has landed; the footer says so until the next one starts. */
const savedEntry = ref(false)
const confirmDelete = ref(false)
const sourceKind = ref<'feedback' | 'board'>('feedback')
const sourceRef = ref('')
const linking = ref(false)

function fill(entry: ChangelogEntry | null) {
  Object.assign(draft, {
    title: entry?.title || '',
    summary: entry?.summary || '',
    slug: entry?.slug || '',
    area: entry?.area || '',
    body: entry?.body || '',
    images: [...(entry?.images || [])],
    tag: entry?.tag || 'improved',
    releaseId: entry?.releaseId || NO_RELEASE,
    status: entry?.status === 'published' ? 'published' : 'draft',
    date: entry?.publishedAt ? entry.publishedAt.slice(0, 10) : ''
  })
  entryError.value = ''
  confirmDelete.value = false
  sourceRef.value = ''
  savedEntry.value = false
  restored.value = false
}

// ---- the new entry's unsaved draft ----
// Kept in this browser while the panel is a new entry, and brought back the next time it opens.
type DraftSnapshot = Pick<typeof draft, 'title' | 'summary' | 'area' | 'body' | 'tag' | 'releaseId' | 'status'>
const saved = useSavedDraft<Partial<DraftSnapshot>>(() => `hb-draft:changelog:${id}`)
const restored = ref(false)

const hasDraftContent = () => Boolean(draft.title.trim() || draft.summary.trim() || draft.area.trim() || draft.body.trim())

watch(draft, () => {
  if (!entryOpen.value || current.value) return
  saved.schedule(() => (hasDraftContent() ? { title: draft.title, summary: draft.summary, area: draft.area, body: draft.body, tag: draft.tag, releaseId: draft.releaseId, status: draft.status } : null))
}, { deep: true })

function restoreDraft(snapshot: Partial<DraftSnapshot>) {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  Object.assign(draft, {
    title: text(snapshot.title),
    summary: text(snapshot.summary),
    area: text(snapshot.area),
    body: text(snapshot.body),
    tag: CHANGELOG_TAGS.find(tag => tag === snapshot.tag) || 'improved',
    releaseId: snapshot.releaseId && releaseOf(snapshot.releaseId) ? snapshot.releaseId : NO_RELEASE,
    status: snapshot.status === 'published' ? 'published' : 'draft'
  })
}

function discardDraft() {
  saved.clear()
  fill(null)
  restored.value = false
}

function replaceEntry(entry: ChangelogEntry) {
  entries.value = entries.value.some(e => e.id === entry.id) ? entries.value.map(e => (e.id === entry.id ? entry : e)) : [entry, ...entries.value]
  if (editingId.value === entry.id) fill(entry)
}

function openEntry(entryId: string) {
  void router.replace({ query: { ...route.query, entry: entryId } })
}

function openNewEntry() {
  editingId.value = ''
  const snapshot = saved.read()
  fill(null)
  restored.value = false
  if (snapshot) {
    restoreDraft(snapshot)
    restored.value = hasDraftContent()
  }
  entryOpen.value = true
}

// `?entry=<id>` is the editor's address: the inbox and the feedback board link to it.
watch(() => [route.query.entry, loading.value, entries.value.length] as const, ([wanted]) => {
  const entryId = typeof wanted === 'string' ? wanted : ''
  if (!entryId) {
    if (editingId.value && entryOpen.value) entryOpen.value = false
    return
  }
  if (loading.value || (editingId.value === entryId && entryOpen.value)) return
  const entry = entries.value.find(e => e.id === entryId)
  if (!entry) return
  editingId.value = entryId
  fill(entry)
  entryOpen.value = true
}, { immediate: true })

// The conversations a public entry answers, for "Reply to N linked conversations". Looked up when the editor
// opens on a public entry and again when its links or state change; the reply itself is always the person's click.
const linkedConversations = ref<ChangelogLinkedConversations | null>(null)
const replyOpen = ref(false)

async function loadLinkedConversations() {
  const entry = current.value
  if (!entry || stateOf(entry).key !== 'public') { linkedConversations.value = null; return }
  try {
    const found = await api<ChangelogLinkedConversations>(`/admin/changelog/entries/${entry.id}/linked-conversations`, { query: { project: id } })
    if (current.value?.id === entry.id) linkedConversations.value = found
  } catch {
    // The editor works without it; the section just does not show.
    linkedConversations.value = null
  }
}

watch(() => [current.value?.id, current.value && stateOf(current.value).key, current.value?.sources.length] as const, () => { void loadLinkedConversations() }, { immediate: true })

watch(entryOpen, (open) => {
  if (open) return
  // A field still being edited saves with the panel closing, not only on blur.
  flushText()
  editingId.value = ''
  linkedConversations.value = null
  replyOpen.value = false
  if (route.query.entry) void router.replace({ query: { ...route.query, entry: undefined } })
})

// ---- moving entries to another release: drag them onto a release (or "No release"), or use "Move to" ----
// Dragging a selected entry takes the whole selection along; dragging an unselected one moves just that one.
const dragIds = ref<string[]>([])
const dropKey = ref('')
const moving = ref<string[]>([])
type ChangelogGroup = (typeof groups.value)[number]

const groupKeyOf = (entry: ChangelogEntry) => (entry.releaseId && releaseOf(entry.releaseId) ? entry.releaseId : 'none')

function startDrag(entry: ChangelogEntry, event: DragEvent) {
  dragIds.value = selected.value.has(entry.id) ? [...selected.value] : [entry.id]
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', dragIds.value.join(','))
  }
}

function endDrag() {
  dragIds.value = []
  dropKey.value = ''
}

/** The dragged entries that are not already in this group. */
const movable = (key: string) => entries.value.filter(e => dragIds.value.includes(e.id) && groupKeyOf(e) !== key)

/** Allowed only when something would change; the drop is taken (and the group lit) only then. */
function dragOver(group: ChangelogGroup, event: DragEvent) {
  if (!movable(group.key).length) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropKey.value = group.key
}

async function dropOn(group: ChangelogGroup) {
  const list = movable(group.key)
  endDrag()
  await moveEntries(list, group.release?.id ?? null)
}

/** One request per entry; stops at the first failure and leaves the selection so it can be retried. */
async function moveEntries(list: ChangelogEntry[], releaseId: string | null) {
  if (!list.length) return
  moving.value = list.map(e => e.id)
  try {
    for (const entry of list) replaceEntry((await api<{ entry: ChangelogEntry }>(`/admin/changelog/entries/${entry.id}`, { method: 'PATCH', body: { releaseId } })).entry)
    clearSelection()
  } catch (e: any) {
    toast.add({ title: e?.message || t('changelog.moveError'), icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    moving.value = []
  }
}

async function patch(body: Record<string, unknown>) {
  if (!current.value) return
  savingEntry.value = true
  savedEntry.value = false
  entryError.value = ''
  try {
    replaceEntry((await api<{ entry: ChangelogEntry }>(`/admin/changelog/entries/${current.value.id}`, { method: 'PATCH', body })).entry)
    savedEntry.value = true
  } catch (e: any) {
    entryError.value = e?.message || t('changelog.saveError')
    fill(current.value)
  } finally {
    savingEntry.value = false
  }
}

/** Summary, slug and area: saved when the field is left, only when it changed. */
function saveField(key: 'summary' | 'slug' | 'area') {
  if (!current.value) return
  const value = draft[key].trim()
  if (key === 'slug' && !value) { draft.slug = current.value.slug; return }
  if (value !== current.value[key]) void patch({ [key]: value })
}

async function review(action: 'approve' | 'reject') {
  if (!current.value) return
  reviewing.value = action
  entryError.value = ''
  try {
    replaceEntry((await api<{ entry: ChangelogEntry }>(`/admin/changelog/entries/${current.value.id}/review`, { method: 'POST', body: { action, notes: reviewNotes.value } })).entry)
    reviewNotes.value = ''
  } catch (e: any) {
    entryError.value = e?.message || t('changelog.reviewError')
  } finally {
    reviewing.value = ''
  }
}

function saveText(key: 'title' | 'body') {
  if (!current.value) return
  const value = draft[key].trim()
  if (key === 'title' && !value) { draft.title = current.value.title; return }
  if (value !== current.value[key]) void patch({ [key]: value })
}

/** Saves every text field that changed in one request. */
function flushText() {
  const entry = current.value
  if (!entry) return
  const body: Record<string, unknown> = {}
  for (const key of ['title', 'body', 'summary', 'slug', 'area'] as const) {
    const value = draft[key].trim()
    if ((key === 'title' || key === 'slug') && !value) continue
    if (value !== entry[key]) body[key] = value
  }
  if (Object.keys(body).length) void patch(body)
}

/** Cmd or Ctrl and Enter: creates the new entry, or saves what is being typed in an existing one. */
function submitShortcut() {
  if (current.value) flushText()
  else void createEntry()
}

async function createEntry() {
  if (savingEntry.value || !draft.title.trim()) return
  savingEntry.value = true
  entryError.value = ''
  try {
    const { entry } = await api<{ entry: ChangelogEntry }>('/admin/changelog/entries', {
      method: 'POST',
      query: { project: id },
      body: { title: draft.title, summary: draft.summary, area: draft.area, body: draft.body, tag: draft.tag, status: draft.status, releaseId: draft.releaseId === NO_RELEASE ? null : draft.releaseId }
    })
    replaceEntry(entry)
    saved.clear()
    restored.value = false
    editingId.value = entry.id
    void router.replace({ query: { ...route.query, entry: entry.id } })
  } catch (e: any) {
    entryError.value = e?.message || t('changelog.createError')
  } finally {
    savingEntry.value = false
  }
}

async function deleteEntry() {
  if (!current.value) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    setTimeout(() => { confirmDelete.value = false }, 3500)
    return
  }
  const entryId = current.value.id
  try {
    await api(`/admin/changelog/entries/${entryId}`, { method: 'DELETE' })
    entries.value = entries.value.filter(e => e.id !== entryId)
    entryOpen.value = false
  } catch (e: any) {
    entryError.value = e?.message || t('changelog.deleteError')
  }
}

function sourceLink(source: ChangelogSource): string | null {
  if (source.kind === 'board') return `/projects/${id}/board?item=${source.id}`
  if (source.kind === 'conversation') return `/inbox?c=${source.id}`
  return null
}

async function setLink(kind: ChangelogLinkKind, targetId: string, linked: boolean) {
  if (!current.value) return false
  linking.value = true
  entryError.value = ''
  try {
    replaceEntry((await api<{ entry: ChangelogEntry }>(`/admin/changelog/entries/${current.value.id}/links`, { method: 'POST', body: { kind, id: targetId, linked } })).entry)
    return true
  } catch (e: any) {
    entryError.value = e?.message || t('changelog.linkError')
    return false
  } finally {
    linking.value = false
  }
}

async function addSource() {
  const value = sourceRef.value.trim()
  if (value && await setLink(sourceKind.value, value, true)) sourceRef.value = ''
}

// ---- collapsing a release ----
const collapsed = ref(new Set<string>())

function toggleGroup(key: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) next.add(key)
  collapsed.value = next
}

// ---- selecting: approve, merge or move several at once ----
const selected = ref(new Set<string>())
const bulk = ref<'' | 'approve' | 'merge' | 'move'>('')
const bulkError = ref('')
const confirmMerge = ref(false)
const selectedEntries = computed(() => entries.value.filter(e => selected.value.has(e.id)))
const selectedDrafts = computed(() => selectedEntries.value.filter(e => e.status === 'draft'))

// Shift-click selects everything between the last clicked entry and this one, in the order shown.
const shiftHeld = ref(false)
let anchorId = ''

function toggleSelected(entryId: string) {
  const next = new Set(selected.value)
  const add = !next.has(entryId)
  const shown = groups.value.filter(g => !collapsed.value.has(g.key)).flatMap(g => g.entries.map(e => e.id))
  const from = shown.indexOf(anchorId)
  const to = shown.indexOf(entryId)
  const span = shiftHeld.value && from >= 0 ? shown.slice(Math.min(from, to), Math.max(from, to) + 1) : [entryId]
  for (const id of span) add ? next.add(id) : next.delete(id)
  anchorId = entryId
  selected.value = next
  confirmMerge.value = false
}

/** true when every entry of a release is selected, 'indeterminate' when some are. */
function releaseState(list: ChangelogEntry[]) {
  const n = list.filter(e => selected.value.has(e.id)).length
  return n === 0 ? false : n === list.length ? true : 'indeterminate' as const
}

function toggleRelease(list: ChangelogEntry[]) {
  const next = new Set(selected.value)
  const all = releaseState(list) === true
  for (const e of list) all ? next.delete(e.id) : next.add(e.id)
  selected.value = next
  confirmMerge.value = false
}

function clearSelection() {
  selected.value = new Set()
  bulkError.value = ''
  confirmMerge.value = false
}

/** The "Move to" menu: no release, then each release, highest version first. */
const moveItems = computed(() => [
  [{ label: t('changelog.noRelease'), icon: 'i-lucide-package-x', onSelect: () => moveSelected(null) }],
  orderedReleases.value.map(r => ({ label: releaseLabel(r), icon: 'i-lucide-package', onSelect: () => moveSelected(r.id) }))
])

async function moveSelected(releaseId: string | null) {
  bulk.value = 'move'
  await moveEntries(selectedEntries.value.filter(e => groupKeyOf(e) !== (releaseId ?? 'none')), releaseId)
  bulk.value = ''
}

async function approveSelected() {
  bulk.value = 'approve'
  bulkError.value = ''
  try {
    for (const entry of selectedDrafts.value) await api(`/admin/changelog/entries/${entry.id}/review`, { method: 'POST', body: { action: 'approve' } })
    toast.add({ title: t('changelog.publishedCount', selectedDrafts.value.length), icon: 'i-lucide-check', color: 'success' })
    clearSelection()
  } catch (e: any) {
    bulkError.value = e?.message || t('changelog.approveError')
  } finally {
    bulk.value = ''
    await loadAll().catch(() => {})
  }
}

/** One new draft from the selection (the editor opens on it); the originals are archived, and their commits and links move over. */
async function mergeSelected() {
  const picked = selectedEntries.value
  if (picked.some(e => e.status === 'published') && !confirmMerge.value) {
    confirmMerge.value = true
    setTimeout(() => { confirmMerge.value = false }, 3500)
    return
  }
  bulk.value = 'merge'
  bulkError.value = ''
  try {
    const { entry } = await api<{ entry: ChangelogEntry }>('/admin/changelog/entries/merge', {
      method: 'POST',
      query: { project: id },
      body: { refs: picked.map(e => e.id), entry: { title: picked[0]!.title, body: picked.map(e => e.body).filter(Boolean).join('\n\n'), tag: picked[0]!.tag, status: 'draft' } }
    })
    clearSelection()
    await loadAll()
    openEntry(entry.id)
  } catch (e: any) {
    bulkError.value = e?.message || t('changelog.mergeError')
  } finally {
    bulk.value = ''
  }
}

// ---- AI: which of the selected entries to merge ----
type MergeSuggestion = { refs: string[], title: string, body: string, tag: ChangelogTag, reason: string }
const mergeAi = reactive({ open: false, loading: false, applying: false, error: '', merges: [] as MergeSuggestion[], chosen: new Set<number>() })

const mergeSources = (m: MergeSuggestion) => m.refs.map(ref => entries.value.find(e => e.id === ref)).filter((e): e is ChangelogEntry => !!e)

function toggleMergeChoice(i: number) {
  const next = new Set(mergeAi.chosen)
  if (!next.delete(i)) next.add(i)
  mergeAi.chosen = next
}

/** The AI reads the selection and may propose merges (or none); nothing changes until Merge is pressed in the modal. */
async function suggestMerges() {
  Object.assign(mergeAi, { open: true, loading: true, error: '', merges: [], chosen: new Set<number>() })
  try {
    const { merges } = await api<{ merges: MergeSuggestion[] }>('/admin/changelog/entries/suggest-merges', { method: 'POST', query: { project: id }, body: { refs: [...selected.value] } })
    Object.assign(mergeAi, { merges, chosen: new Set(merges.map((_, i) => i)) })
  } catch (e: any) {
    mergeAi.error = e?.message || t('changelog.aiMergeError')
  } finally {
    mergeAi.loading = false
  }
}

/** Each chosen suggestion becomes one draft; the originals are archived, as with Merge into one draft. */
async function applyMerges() {
  mergeAi.applying = true
  mergeAi.error = ''
  let done = 0
  try {
    for (const [i, m] of mergeAi.merges.entries()) {
      if (!mergeAi.chosen.has(i)) continue
      await api('/admin/changelog/entries/merge', { method: 'POST', query: { project: id }, body: { refs: m.refs, entry: { title: m.title, body: m.body, tag: m.tag, status: 'draft' } } })
      done++
    }
    mergeAi.open = false
    clearSelection()
    toast.add({ title: t('changelog.aiMerged', done), icon: 'i-lucide-merge', color: 'success' })
  } catch (e: any) {
    mergeAi.error = e?.message || t('changelog.mergeError')
  } finally {
    mergeAi.applying = false
    await loadAll().catch(() => {})
  }
}

// ---- writing entries from commits ----
type Run = { state: 'running' | 'done' | 'failed', created: number, skipped: number, truncated?: boolean, error?: string }
const generateOpen = ref(false)
const generating = ref(false)
const generateError = ref('')
const run = ref<Run | null>(null)
const repos = ref<{ id: number }[] | null>(null)
const range = ref<'all' | 'recent'>('recent')
const rangeCount = ref(2)
const rangeUnit = ref(7)
const rangeItems = [{ label: 'All commits', value: 'all' }, { label: 'Only recent commits', value: 'recent' }]
const unitItems = [{ label: 'days', value: 1 }, { label: 'weeks', value: 7 }, { label: 'months', value: 30 }]
let poll: ReturnType<typeof setInterval> | undefined

async function loadRun() {
  run.value = (await api<{ run: Run | null }>('/admin/changelog/generate', { query: { project: id } })).run
}

function watchRun() {
  clearInterval(poll)
  poll = setInterval(async () => {
    const before = run.value?.state
    await loadRun().catch(() => {})
    if (run.value?.state === 'running') return
    clearInterval(poll)
    if (before === 'running') await loadAll().catch(() => {})
  }, 3000)
}

async function openGenerate() {
  generateError.value = ''
  generateOpen.value = true
  try {
    const [, mine] = await Promise.all([loadRun(), api<{ repos: { id: number }[] }>(`/admin/projects/${id}/repos`)])
    repos.value = mine.repos
    if (run.value?.state === 'running') watchRun()
  } catch (e: any) {
    generateError.value = e?.message || t('changelog.loadRunError')
  }
}

async function generate() {
  generating.value = true
  generateError.value = ''
  try {
    const days = range.value === 'all' ? null : Math.max(1, Math.floor(Number(rangeCount.value) || 1)) * rangeUnit.value
    await api('/admin/changelog/generate', { method: 'POST', query: { project: id }, body: { days } })
    await loadRun()
    watchRun()
  } catch (e: any) {
    generateError.value = e?.message || t('changelog.startError')
  } finally {
    generating.value = false
  }
}

onBeforeUnmount(() => clearInterval(poll))

// ---- settings ----
const showSettings = ref(false)
const savingSettings = ref(false)
const settingsSaved = ref(false)
const settingsError = ref('')

async function saveSettings(next: { autoDraft?: boolean, enabled?: boolean, comments?: boolean, notify?: boolean, imageWidth?: ChangelogImageWidth, commitAi?: { onPush?: boolean, autoPublish?: boolean } }) {
  savingSettings.value = true
  settingsSaved.value = false
  settingsError.value = ''
  try {
    const { project: saved } = await api<{ project: AdminProject }>(`/admin/projects/${id}`, { method: 'PATCH', body: { changelog: next } })
    projects.value = projects.value.map(p => (p.id === saved.id ? saved : p))
    settingsSaved.value = true
  } catch (e: any) {
    settingsError.value = e?.message || t('changelog.saveError')
  } finally {
    savingSettings.value = false
  }
}

// ---- style ----
const showStyle = ref(false)

// ---- releases ----
const releaseOpen = ref(false)
const releaseDraft = reactive({ id: '', version: '', title: '', summary: '' })
const releaseError = ref('')
const savingRelease = ref(false)
const confirmDeleteRelease = ref(false)
const writingRelease = ref(false)
const publishing = ref('')

function openNewRelease() {
  Object.assign(releaseDraft, { id: '', version: '', title: '', summary: '' })
  releaseError.value = ''
  confirmDeleteRelease.value = false
  releaseOpen.value = true
}

function openRelease(release: ChangelogRelease) {
  Object.assign(releaseDraft, { id: release.id, version: release.version, title: release.title, summary: release.summary })
  releaseError.value = ''
  confirmDeleteRelease.value = false
  releaseOpen.value = true
}

async function saveRelease() {
  if (!releaseDraft.version.trim()) return
  savingRelease.value = true
  releaseError.value = ''
  const body = { version: releaseDraft.version, title: releaseDraft.title, summary: releaseDraft.summary }
  try {
    const { release } = releaseDraft.id
      ? await api<{ release: ChangelogRelease }>(`/admin/changelog/releases/${releaseDraft.id}`, { method: 'PATCH', body })
      : await api<{ release: ChangelogRelease }>('/admin/changelog/releases', { method: 'POST', query: { project: id }, body })
    releases.value = releases.value.some(r => r.id === release.id) ? releases.value.map(r => (r.id === release.id ? release : r)) : [release, ...releases.value]
    releaseOpen.value = false
  } catch (e: any) {
    releaseError.value = e?.message || t('changelog.releaseSaveError')
  } finally {
    savingRelease.value = false
  }
}

/** The AI reads the release's entries and fills the form; nothing is saved until Save. */
async function writeRelease() {
  writingRelease.value = true
  releaseError.value = ''
  try {
    const copy = await api<{ title: string, summary: string }>(`/admin/changelog/releases/${releaseDraft.id}/suggest`, { method: 'POST' })
    if (copy.title) releaseDraft.title = copy.title
    if (copy.summary) releaseDraft.summary = copy.summary
  } catch (e: any) {
    releaseError.value = e?.message || t('changelog.releaseWriteAiError')
  } finally {
    writingRelease.value = false
  }
}

async function publishRelease(release: ChangelogRelease) {
  publishing.value = release.id
  try {
    await api(`/admin/changelog/releases/${release.id}/publish`, { method: 'POST' })
    // Its draft entries went out with it: refetch rather than patch each.
    await loadAll()
    toast.add({ title: t('changelog.releasePublished', { version: release.version }), icon: 'i-lucide-rocket', color: 'success' })
  } catch (e: any) {
    toast.add({ title: t('changelog.publishReleaseError'), description: e?.message, color: 'error' })
  } finally {
    publishing.value = ''
  }
}

async function deleteRelease() {
  if (!releaseDraft.id) return
  if (!confirmDeleteRelease.value) {
    confirmDeleteRelease.value = true
    setTimeout(() => { confirmDeleteRelease.value = false }, 3500)
    return
  }
  try {
    await api(`/admin/changelog/releases/${releaseDraft.id}`, { method: 'DELETE' })
    releaseOpen.value = false
    // Its entries stay, as entries of no release.
    await loadAll()
  } catch (e: any) {
    releaseError.value = e?.message || t('changelog.releaseDeleteError')
  }
}
</script>
