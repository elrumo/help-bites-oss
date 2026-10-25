<template>
  <div class="flex-1 min-h-0 flex flex-col">
    <PageHeader :project-id="id" :title="$t('sections.board')">
      <template #title>
        <span v-if="board?.enabled" class="ml-1 hidden text-xs font-normal tabular-nums text-muted sm:inline">{{ $t('board.itemCount', items.length) }}, {{ $t('board.onRoadmap', { count: publicCount }) }}</span>
        <span v-else-if="board" class="ml-1 text-xs font-normal text-warning">{{ $t('board.boardOff') }}</span>
      </template>
      <template v-if="board && (board.enabled || showSettings)" #actions>
        <UButton icon="i-lucide-map" :label="$t('board.publicRoadmap')" color="neutral" variant="ghost" size="sm" @click="copyRoadmapUrl" />
        <UButton v-if="roadmapReady" icon="i-lucide-external-link" color="neutral" variant="ghost" size="sm" square :to="roadmapUrl" target="_blank" :aria-label="$t('board.openRoadmap')" />
        <UButton icon="i-lucide-settings-2" :label="$t('nav.settings')" color="neutral" variant="ghost" size="sm" @click="showSettings = true" />
        <UButton icon="i-lucide-sparkles" :label="$t('aiCards.button')" color="neutral" variant="soft" size="sm" @click="showAi = true" />
        <UButton icon="i-lucide-plus" :label="$t('board.newItem')" size="sm" @click="openNew" />
      </template>
    </PageHeader>

    <!-- Not set up yet -->
    <div v-if="board && !board.enabled && !showSettings" class="flex-1 overflow-y-auto">
      <EmptyState icon="i-lucide-square-kanban" :title="$t('board.boardFor', { name: project?.name || $t('board.thisProject') })" :description="$t('board.setupDescription')">
        <UButton :label="$t('board.customizeFirst')" color="neutral" variant="outline" @click="showSettings = true" />
        <UButton :label="$t('board.turnOn')" :loading="savingBoard" @click="saveBoard({ enabled: true })" />
      </EmptyState>
      <p v-if="boardError" class="text-center text-[13px] text-error">{{ boardError }}</p>
    </div>

    <template v-else-if="board">
      <!-- Toolbar: filters on the left, search on the right -->
      <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-default px-4 py-2.5">
        <button type="button" class="chip h-6 px-2.5 text-xs" :class="roadmapOnly ? 'chip-active' : 'border-transparent text-dimmed'" :aria-pressed="roadmapOnly" @click="roadmapOnly = !roadmapOnly">
          <UIcon name="i-lucide-globe" class="size-3" />{{ $t('board.roadmapChip') }}<span class="tabular-nums opacity-70">{{ publicCount }}</span>
        </button>
        <USelectMenu v-if="board.labels.length" v-model="labelFilter" :items="labelItems" value-key="value" multiple size="sm" class="w-40" :placeholder="$t('board.labels')" :aria-label="$t('board.labels')" />
        <USelect v-model="assigneeFilter" :items="assigneeFilterItems" size="sm" class="w-36" :aria-label="$t('board.assignee')" />
        <USelect v-model="priorityFilter" :items="priorityFilterItems" size="sm" class="w-32" :aria-label="$t('board.priority')" />
        <UButton v-if="filtering" :label="$t('board.clear')" size="xs" color="neutral" variant="link" @click="clearFilters" />
        <div class="ml-auto">
          <UInput v-model="search" icon="i-lucide-search" :placeholder="$t('board.searchPlaceholder')" size="sm" class="w-44 sm:w-56" :aria-label="$t('board.searchItems')" />
        </div>
      </div>
      <div v-if="actionError" class="flex items-center gap-2 border-b border-default bg-error/10 px-4 py-1.5 text-[13px] text-error">
        <span class="min-w-0 flex-1">{{ actionError }}</span>
        <UButton icon="i-lucide-x" size="xs" color="error" variant="ghost" square :aria-label="$t('board.dismiss')" @click="actionError = ''" />
      </div>

      <div v-if="loading" class="flex gap-3 p-4"><USkeleton v-for="i in 4" :key="i" class="h-64 w-72 shrink-0 rounded-xl" /></div>
      <p v-else-if="error" class="p-8 text-[13px] text-error">{{ error }}</p>

      <!-- Kanban: drag a card across columns to change its status, within one to reorder -->
      <div v-else class="flex-1 min-h-0 overflow-x-auto">
        <div class="flex h-full gap-3 p-4 md:px-6">
          <section
            v-for="status in board.statuses"
            :key="status.key"
            class="flex w-72 shrink-0 flex-col rounded-xl bg-elevated/60 transition-shadow"
            :class="[(dragging || draggingColumn) && dragOver === status.key ? 'ring-2 ring-primary/60' : '', draggingColumn === status.key ? 'opacity-50' : '']"
            @dragover.prevent="enterColumn(status.key)"
            @drop.prevent="dropOn(status.key)"
          >
            <!-- Admins drag the header to move the column -->
            <header class="flex items-center justify-between px-3 pt-3 pb-2" :class="canManage ? 'cursor-grab' : ''" :draggable="canManage" :title="canManage ? $t('board.dragColumn') : undefined" @dragstart="startColumnDrag($event, status.key)" @dragend="endDrag">
              <div class="flex min-w-0 items-center gap-1.5">
                <UIcon v-if="canManage" name="i-lucide-grip-vertical" class="size-3.5 shrink-0 text-dimmed" />
                <FeedbackStatusBadge :status="status" />
              </div>
              <span class="text-xs tabular-nums text-muted">{{ (visibleByColumn[status.key] || []).length }}</span>
            </header>
            <div class="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-2">
              <div v-for="(item, index) in visibleByColumn[status.key] || []" :key="item.id" class="relative">
                <div v-if="dragging && dragOver === status.key && dropBefore === item.id" class="pointer-events-none absolute inset-x-1 -top-[5px] h-0.5 rounded-full bg-primary" aria-hidden="true" />
                <button
                  type="button"
                  draggable="true"
                  class="w-full cursor-grab rounded-lg border border-default bg-default p-3 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,opacity] hover:border-accented active:cursor-grabbing"
                  :class="dragging === item.id ? 'opacity-40' : ''"
                  @dragstart="startDrag($event, item)"
                  @dragend="endDrag"
                  @dragover.prevent.stop="overCard($event, status.key, index)"
                  @click="openItem(item.id)"
                >
                  <span class="flex items-center gap-1.5 text-[11px] text-muted">
                    <span v-if="item.number" class="tabular-nums">#{{ item.number }}</span>
                    <PriorityIcon v-if="item.priority" :priority="item.priority" />
                    <span class="ml-auto flex items-center gap-1.5">
                      <UIcon v-if="item.public" name="i-lucide-globe" class="size-3.5 text-primary" :aria-label="$t('board.publicRoadmapLabel')" />
                      <span v-if="assigneeOf(item)" class="grid size-5 place-items-center rounded-full bg-accented text-[9px] font-semibold text-toned" :title="assigneeOf(item)!.name || assigneeOf(item)!.username">{{ initialsOf(assigneeOf(item)!.name || assigneeOf(item)!.username) }}</span>
                    </span>
                  </span>
                  <span class="mt-1 block text-[13px] font-medium leading-snug line-clamp-3">{{ item.title }}</span>
                  <span v-if="item.labels.length" class="mt-2 flex flex-wrap gap-1">
                    <span v-for="label in item.labels" :key="label" class="inline-flex items-center gap-1 rounded-full border border-default px-1.5 py-px text-[10px] text-toned">
                      <span class="size-1.5 rounded-full" :class="toneDot(labelOf(label)?.color)" />{{ labelOf(label)?.label || label }}
                    </span>
                  </span>
                  <span v-if="item.posts.length || item.conversations.length || item.targetDate" class="mt-2 flex items-center gap-2.5 text-[11px] text-muted">
                    <span v-if="item.posts.length" class="inline-flex items-center gap-0.5 font-semibold tabular-nums" :title="$t('board.votesTitle')"><UIcon name="i-lucide-chevron-up" class="size-3" />{{ item.voteCount }}</span>
                    <span v-if="item.posts.length" class="inline-flex items-center gap-0.5 tabular-nums" :title="$t('board.linkedPosts')"><UIcon name="i-lucide-lightbulb" class="size-3" />{{ item.posts.length }}</span>
                    <span v-if="item.conversations.length" class="inline-flex items-center gap-0.5 tabular-nums" :title="$t('board.linkedConversations')"><UIcon name="i-lucide-message-square" class="size-3" />{{ item.conversations.length }}</span>
                    <span v-if="item.targetDate" class="ml-auto inline-flex items-center gap-0.5" :title="$t('board.targetDate')"><UIcon name="i-lucide-calendar" class="size-3" />{{ dayLabel(item.targetDate) }}</span>
                  </span>
                </button>
              </div>
              <!-- The rest of the column: dropping here appends -->
              <div class="relative min-h-10 flex-1" @dragover.prevent.stop="dragOver = status.key; dropBefore = ''">
                <div v-if="dragging && dragOver === status.key && dropBefore === ''" class="pointer-events-none absolute inset-x-1 -top-[5px] h-0.5 rounded-full bg-primary" aria-hidden="true" />
                <p v-if="!(visibleByColumn[status.key] || []).length && !dragging" class="px-1 py-3 text-center text-xs text-dimmed">{{ filtering ? $t('board.nothingMatches') : $t('board.noItems') }}</p>
              </div>
            </div>
          </section>
          <button v-if="listsConfig" type="button" class="flex h-16 w-72 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-default text-[13px] text-muted transition-colors hover:text-default" @click="openAddColumn">
            <UIcon name="i-lucide-plus" class="size-4" />{{ $t('board.addColumn') }}
          </button>
        </div>
      </div>
    </template>

    <div v-else-if="error" class="p-8 text-sm text-error">{{ error }}</div>
    <div v-else class="p-8 text-sm text-muted">{{ $t('board.loading') }}</div>

    <!-- New column: a status, saved with the board's statuses -->
    <UModal v-model:open="columnOpen" :title="$t('board.newColumn')" :description="$t('board.newColumnHelp')">
      <template #body>
        <form class="space-y-4" @submit.prevent="addColumn">
          <UFormField :label="$t('board.columnName')">
            <UInput v-model="columnDraft.label" :placeholder="$t('board.columnNamePlaceholder')" :maxlength="60" autofocus class="w-full" />
          </UFormField>
          <UFormField :label="$t('feedback.category')" :help="$t('board.columnCategoryHelp')">
            <USelect v-model="columnDraft.category" :items="categoryItems" class="w-full" />
          </UFormField>
          <p v-if="columnError" class="text-[13px] text-error">{{ columnError }}</p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton :label="$t('common.cancel')" color="neutral" variant="ghost" @click="columnOpen = false" />
            <UButton type="submit" :label="$t('board.addColumn')" :loading="savingLists" :disabled="!columnKey" />
          </div>
        </form>
      </template>
    </UModal>

    <!-- Item editor -->
    <USlideover v-model:open="editorOpen" :title="current ? (current.number ? $t('board.itemNumber', { number: current.number }) : $t('board.item')) : $t('board.newItem')" :description="current ? $t('board.created', { time: timeAgo(current.createdAt) }) : $t('board.privateUntilRoadmap')" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <div v-if="board" class="space-y-6">
          <div class="space-y-2">
            <UInput v-model="draft.title" :placeholder="$t('board.title')" variant="none" size="xl" class="w-full" :ui="{ base: 'px-0 text-lg font-semibold' }" :maxlength="200" :aria-label="$t('board.title')" @blur="saveText('title')" @keydown.enter.prevent="saveText('title')" />
            <UTextarea v-model="draft.description" :placeholder="$t('board.descriptionPlaceholder')" variant="none" :rows="3" autoresize :maxrows="18" class="w-full" :ui="{ base: 'px-0' }" :aria-label="$t('board.description')" @blur="saveText('description')" />
          </div>

          <!-- Linear's property rows: quiet until hovered -->
          <section class="grid gap-x-4 sm:grid-cols-2">
            <USelect v-model="draft.status" :items="statusItems" variant="ghost" size="sm" class="w-full" :ui="property" :aria-label="$t('board.status')" @update:model-value="patch({ status: draft.status })">
              <template #leading><span class="size-2.5 rounded-full" :class="toneDot(statusOf(draft.status)?.color)" /></template>
            </USelect>
            <USelect v-model="draft.priority" :items="priorityItems" variant="ghost" size="sm" class="w-full" :ui="property" :aria-label="$t('board.priority')" @update:model-value="patch({ priority: draft.priority === 'none' ? '' : draft.priority })">
              <template #leading><PriorityIcon v-if="draft.priority !== 'none'" :priority="draft.priority as ConversationPriority" /><UIcon v-else name="i-lucide-minus" class="size-3.5 text-dimmed" /></template>
            </USelect>
            <USelect v-model="draft.assigneeId" :items="assigneeItems" variant="ghost" size="sm" class="w-full" :ui="property" :aria-label="$t('board.assignee')" @update:model-value="patch({ assigneeId: draft.assigneeId === 'unassigned' ? '' : draft.assigneeId })">
              <template #leading>
                <span v-if="draftAssignee" class="grid size-4 place-items-center rounded-full bg-accented text-[8px] font-semibold text-toned">{{ initialsOf(draftAssignee.name || draftAssignee.username) }}</span>
                <UIcon v-else name="i-lucide-circle-user-round" class="size-4 text-dimmed" />
              </template>
            </USelect>
            <label class="group relative flex h-8 items-center rounded-md ps-8 pe-2 text-[13px] text-default hover:bg-elevated">
              <UIcon name="i-lucide-calendar" class="absolute left-2.5 size-3.5 text-dimmed" />
              <input v-model="draft.targetDate" type="date" class="w-full bg-transparent outline-none [color-scheme:light] dark:[color-scheme:dark]" :class="draft.targetDate ? '' : 'text-dimmed'" :aria-label="$t('board.targetDate')" @change="patch({ targetDate: draft.targetDate || null })">
            </label>
            <USelectMenu v-if="board.labels.length" v-model="draft.labels" :items="labelItems" value-key="value" multiple variant="ghost" size="sm" class="w-full sm:col-span-2" :ui="property" :placeholder="$t('board.addLabels')" :aria-label="$t('board.labels')" @update:model-value="patch({ labels: draft.labels })">
              <template #leading><UIcon name="i-lucide-tag" class="size-3.5 text-dimmed" /></template>
            </USelectMenu>
          </section>

          <section class="space-y-3 rounded-xl border border-default p-3">
            <USwitch v-model="draft.public" :label="$t('board.onPublicRoadmap')" :description="$t('board.onPublicRoadmapDescription')" @update:model-value="patch({ public: draft.public })" />
            <template v-if="draft.public">
              <UFormField :label="$t('board.publicDescription')" :hint="$t('board.publicDescriptionHint')">
                <UTextarea v-model="draft.publicDescription" :rows="2" autoresize :maxrows="10" class="w-full" :placeholder="$t('board.publicDescriptionPlaceholder')" @blur="saveText('publicDescription')" />
              </UFormField>
              <p v-if="!roadmapReady" class="text-xs text-warning">{{ $t('board.roadmapNeedsFeedback') }}</p>
              <p v-else-if="!roadmapStatus" class="text-xs text-muted">{{ $t('board.notOnRoadmap', { status: statusOf(draft.status)?.label || $t('board.thisStatus') }) }}</p>
            </template>
          </section>

          <section class="space-y-2">
            <h3 class="text-sm font-semibold">{{ $t('attachments.title') }}</h3>
            <AttachmentsField v-model="draft.attachments" :project-id="id" @update:model-value="current && patch({ attachments: draft.attachments })" />
          </section>

          <!-- A new item can already take feedback: it is linked once the item exists -->
          <section v-if="!current" class="space-y-2">
            <h3 class="text-sm font-semibold">{{ $t('board.feedback') }} <span class="font-normal text-muted">{{ draft.posts.length }}</span></h3>
            <ul v-if="draft.posts.length" class="divide-y divide-default rounded-lg border border-default">
              <li v-for="post in draft.posts" :key="post.id" class="group flex items-center gap-2.5 px-2.5 py-2 text-[13px]">
                <span class="inline-flex w-8 shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums text-muted"><UIcon name="i-lucide-chevron-up" class="size-3" />{{ post.voteCount }}</span>
                <span class="min-w-0 flex-1 truncate"><span v-if="post.number" class="mr-1 tabular-nums text-muted">#{{ post.number }}</span>{{ post.title }}</span>
                <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('board.unlinkPost', { number: post.number ?? '' })" @click="draft.posts = draft.posts.filter(p => p.id !== post.id)" />
              </li>
            </ul>
            <FeedbackSearchPicker :project-id="id" :exclude="draft.posts.map(p => p.id)" class="w-full" @pick="post => draft.posts.push({ id: post.id, number: post.number, title: post.title, voteCount: post.voteCount })" />
          </section>

          <template v-if="current">
            <section class="space-y-2">
              <h3 class="flex items-center gap-2 text-sm font-semibold">{{ $t('board.feedback') }} <span class="font-normal text-muted">{{ current.posts.length }}</span><span v-if="current.posts.length" class="ml-auto inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums text-muted"><UIcon name="i-lucide-chevron-up" class="size-3.5" />{{ $t('board.votes', current.voteCount) }}</span></h3>
              <ul v-if="current.posts.length" class="divide-y divide-default rounded-lg border border-default">
                <li v-for="post in current.posts" :key="post.id" class="group flex items-center gap-2.5 px-2.5 py-2 text-[13px]">
                  <span class="inline-flex w-8 shrink-0 items-center gap-0.5 text-xs font-semibold tabular-nums text-muted"><UIcon name="i-lucide-chevron-up" class="size-3" />{{ post.voteCount }}</span>
                  <span class="min-w-0 flex-1 truncate"><span v-if="post.number" class="mr-1 tabular-nums text-muted">#{{ post.number }}</span>{{ post.title }}</span>
                  <span v-if="post.hidden" class="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 text-[11px] text-warning" :title="$t('board.hiddenTitle')"><UIcon name="i-lucide-eye-off" class="size-3" />{{ $t('board.hidden') }}</span>
                  <FeedbackStatusBadge :status="feedbackStatusFor(project?.feedback, post.status)" />
                  <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :aria-label="$t('board.unlinkPost', { number: post.number ?? '' })" @click="setLink('feedback', post.id, false)" />
                </li>
              </ul>
              <FeedbackSearchPicker :project-id="id" :exclude="current.feedbackPostIds" class="w-full" @pick="post => setLink('feedback', post.id, true)" />
            </section>

            <section class="space-y-2">
              <h3 class="text-sm font-semibold">{{ $t('board.conversations') }} <span class="font-normal text-muted">{{ current.conversations.length }}</span></h3>
              <ul v-if="current.conversations.length" class="divide-y divide-default rounded-lg border border-default">
                <li v-for="conversation in current.conversations" :key="conversation.id" class="group flex items-center gap-2 px-2.5 text-[13px]">
                  <NuxtLink :to="`/inbox?c=${conversation.id}`" class="flex min-w-0 flex-1 items-center gap-2 py-2 hover:underline">
                    <UIcon name="i-lucide-message-square" class="size-3.5 shrink-0 text-muted" />
                    <span class="min-w-0 truncate">{{ conversation.subject || $t('board.conversation') }}</span>
                    <span v-if="conversation.endUserName" class="shrink-0 text-muted">· {{ conversation.endUserName }}</span>
                    <span class="ml-auto shrink-0 rounded-full bg-elevated px-1.5 text-[11px] text-toned">{{ conversation.status }}</span>
                  </NuxtLink>
                  <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :aria-label="$t('board.unlinkConversation')" @click="setLink('conversation', conversation.id, false)" />
                </li>
              </ul>
              <p v-else class="text-xs text-muted">{{ $t('board.linkFromInbox') }}</p>
            </section>

            <section v-if="current.errorRefs.length" class="space-y-2">
              <h3 class="text-sm font-semibold">{{ $t('board.filedFromErrors') }} <span class="font-normal text-muted">{{ current.errorRefs.length }}</span></h3>
              <ul class="divide-y divide-default rounded-lg border border-default">
                <li v-for="ref in current.errorRefs" :key="`${ref.provider}:${ref.issueId}`" class="flex items-center gap-2.5 px-2.5 py-2 text-[13px]">
                  <UIcon name="i-lucide-bug" class="size-3.5 shrink-0 text-muted" />
                  <span class="min-w-0 flex-1 truncate">{{ ref.title || ref.issueId }}</span>
                  <UButton v-if="ref.url" :to="ref.url" target="_blank" size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up-right" :label="$t('board.openInTracker', { provider: trackerName(ref.provider) })" />
                </li>
              </ul>
            </section>

            <GithubRefs :project-id="id" kind="board" :target-id="current.id" :heading="$t('github.linkedWork')" />

            <section class="space-y-2">
              <h3 class="text-sm font-semibold">{{ $t('sections.changelog') }}</h3>
              <ChangelogLinks :project-id="id" kind="board" :target-id="current.id" :source="{ title: current.title, publicDescription: current.publicDescription }" />
            </section>
          </template>

          <p v-if="editorError" class="text-sm text-error">{{ editorError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UButton v-if="current" :label="confirmDelete ? $t('board.clickAgainDelete') : $t('board.delete')" icon="i-lucide-trash-2" :color="confirmDelete ? 'error' : 'neutral'" :variant="confirmDelete ? 'solid' : 'ghost'" @click="deleteItem" />
          <span v-if="current" class="ml-auto text-xs text-muted">{{ savingItem ? $t('board.saving') : $t('board.changesSave') }}</span>
          <template v-else>
            <UButton class="ml-auto" :label="$t('common.cancel')" color="neutral" variant="ghost" @click="editorOpen = false" />
            <UButton :label="$t('board.createItem')" color="primary" :loading="savingItem" :disabled="!draft.title.trim()" @click="createItem" />
          </template>
        </div>
      </template>
    </USlideover>

    <!-- Board settings -->
    <AiCardsChat v-model:open="showAi" :project-id="id" kind="board" @created="loadItems" />

    <USlideover v-model:open="showSettings" :title="$t('board.settingsTitle')" :description="$t('board.settingsDescription')" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div v-if="board" class="space-y-8">
          <section class="space-y-4">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold">{{ $t('sections.board') }}</h3>
              <span class="text-xs text-muted">{{ savingBoard ? $t('board.saving') : boardSaved ? $t('common.saved') : $t('board.savesAsChange') }}</span>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <USwitch :model-value="board.enabled" :label="$t('board.boardOn')" :description="$t('board.boardOnDescription')" @update:model-value="saveBoard({ enabled: $event })" />
              <USwitch :model-value="board.syncFeedback" :label="$t('board.syncFeedback')" :description="$t('board.syncFeedbackDescription')" @update:model-value="saveBoard({ syncFeedback: $event })" />
            </div>
            <div class="grid gap-3 sm:grid-cols-3">
              <UFormField :label="$t('board.roadmapLayout')">
                <USelect :model-value="board.roadmap.layout" :items="layoutItems" class="w-full" @update:model-value="saveBoard({ roadmap: { layout: $event } })" />
              </UFormField>
              <USwitch :model-value="board.roadmap.showLabels" :label="$t('board.showLabels')" :description="$t('board.showLabelsDescription')" class="sm:pt-5" @update:model-value="saveBoard({ roadmap: { showLabels: $event } })" />
              <USwitch :model-value="board.roadmap.showDates" :label="$t('board.showDates')" :description="$t('board.showDatesDescription')" class="sm:pt-5" @update:model-value="saveBoard({ roadmap: { showDates: $event } })" />
            </div>
            <p v-if="boardError" class="text-sm text-error">{{ boardError }}</p>
          </section>
          <FeedbackBoardSettings v-if="listsConfig" board-only :config="listsConfig" :saving="savingLists" :saved="listsSaved" :error="listsError" @save="saveLists" />
        </div>
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import Fuse from 'fuse.js'
import { DEFAULT_FEEDBACK_CONFIG, FEEDBACK_STATUS_CATEGORIES, defaultFeedbackStatus, feedbackStatusCategory, normalizeFeedbackKey, type FeedbackBoardConfig, type FeedbackColor, type FeedbackStatusCategory } from '#shared/feedback'
import type { ItemAttachment } from '#shared/itemAttachments'
import { can } from '#shared/roles'
import { BOARD_ROADMAP_LAYOUTS, ROADMAP_CATEGORIES, rankBetween, type BoardConfig, type BoardItem, type BoardItemPriority, type BoardRoadmapLayout } from '#shared/board'
import type { ConversationPriority } from '#shared/support'
import type { AdminProject } from '~~/server/utils/projects'

// A project's board: Linear-style items on a kanban, linked to the feedback
// posts and conversations they answer, and the source of the public roadmap.
// Operators only; every change is a PATCH that the screen shows first and
// rolls back if the server refuses.

definePageMeta({ middleware: 'agent' })

type HumanAgent = { id: string, username: string, email: string, name: string }

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)
const { api, projects, loadProjects, context } = useAgent()
const toast = useToast()
const { t } = useI18n()
const appUrl = useAppUrl()

const project = computed<AdminProject | null>(() => projects.value.find(p => p.id === id) || null)
const board = computed<BoardConfig | null>(() => project.value?.board || null)
const items = ref<BoardItem[]>([])
const agents = ref<HumanAgent[]>([])
const loading = ref(true)
const error = ref('')
const actionError = ref('')

// ---- display helpers ----
const TONES: Record<string, string> = { neutral: 'bg-stone-400', primary: 'bg-primary-500', info: 'bg-sky-500', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-rose-500' }
const toneDot = (color?: FeedbackColor) => TONES[color || 'neutral'] || TONES.neutral
const statusOf = (key: string) => board.value?.statuses.find(s => s.key === key)
const labelOf = (key: string) => board.value?.labels.find(l => l.key === key)
const initialsOf = (name: string) => (name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
const trackerName = (provider: string) => (provider === 'bugsink' ? 'Bugsink' : provider === 'glitchtip' ? 'GlitchTip' : provider)
const assigneeOf = (item: BoardItem) => agents.value.find(agent => agent.id === item.assigneeId) || null
/** Target dates are calendar days at UTC midnight. */
const dayLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

// A property row: the value reads as plain text until you hover it.
const property = { base: 'h-8 w-full rounded-md ps-8 text-[13px] text-default', trailing: 'opacity-0 transition-opacity group-hover:opacity-100' }
const PRIORITY_KEYS: Record<ConversationPriority, string> = { low: 'board.low', normal: 'board.normal', high: 'board.high', urgent: 'board.urgent' }
const priorityItems = computed(() => [{ label: t('board.noPriority'), value: 'none' }, ...(['urgent', 'high', 'normal', 'low'] as const).map(value => ({ label: t(PRIORITY_KEYS[value]), value }))])
const LAYOUT_KEYS: Record<BoardRoadmapLayout, string> = { columns: 'board.layoutColumns', timeline: 'board.layoutTimeline', list: 'board.layoutList' }
const layoutItems = computed(() => BOARD_ROADMAP_LAYOUTS.map(value => ({ label: t(LAYOUT_KEYS[value]), value })))
const statusItems = computed(() => (board.value?.statuses || []).map(s => ({ label: s.label, value: s.key })))
const labelItems = computed(() => (board.value?.labels || []).map(l => ({ label: l.label, value: l.key })))
const assigneeItems = computed(() => [{ label: t('board.unassigned'), value: 'unassigned' }, ...agents.value.map(agent => ({ label: agent.name || agent.username, value: agent.id }))])
const assigneeFilterItems = computed(() => [{ label: t('board.anyone'), value: '__all__' }, ...assigneeItems.value])
const priorityFilterItems = computed(() => [{ label: t('board.anyPriority'), value: '__all__' }, ...priorityItems.value])

// ---- the roadmap link ----
const roadmapUrl = computed(() => (project.value ? `${appUrl.value}/roadmap/${project.value.publicKey}` : ''))
/** The roadmap is published through the feedback board's public pages and API. */
const roadmapReady = computed(() => Boolean(project.value?.feedback.enabled && project.value.feedback.roadmap && board.value?.enabled))
const publicCount = computed(() => items.value.filter(item => item.public).length)

async function copyRoadmapUrl() {
  if (!roadmapReady.value) {
    toast.add({ title: t('board.turnOnFeedbackTitle'), description: t('board.roadmapNeedsFeedback'), icon: 'i-lucide-info', color: 'warning' })
    return
  }
  try {
    await navigator.clipboard.writeText(roadmapUrl.value)
    toast.add({ title: t('board.roadmapLinkCopied'), description: roadmapUrl.value, icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {
    toast.add({ title: t('board.yourRoadmap'), description: roadmapUrl.value, icon: 'i-lucide-map' })
  }
}

// ---- filters ----
const search = ref('')
const labelFilter = ref<string[]>([])
const assigneeFilter = ref('__all__')
const priorityFilter = ref('__all__')
const roadmapOnly = ref(false)
const filtering = computed(() => Boolean(search.value.trim() || labelFilter.value.length || assigneeFilter.value !== '__all__' || priorityFilter.value !== '__all__' || roadmapOnly.value))
function clearFilters() {
  search.value = ''
  labelFilter.value = []
  assigneeFilter.value = '__all__'
  priorityFilter.value = '__all__'
  roadmapOnly.value = false
}

// ---- columns ----
const defaultStatus = computed(() => (board.value ? defaultFeedbackStatus(board.value).key : ''))
/** A status the board no longer knows sits in the default column. */
const columnOf = (item: BoardItem) => (statusOf(item.status) ? item.status : defaultStatus.value)
const sorted = computed(() => [...items.value].sort((a, b) => a.rank - b.rank || (a.number ?? 0) - (b.number ?? 0)))

function group(list: BoardItem[]): Record<string, BoardItem[]> {
  return list.reduce<Record<string, BoardItem[]>>((acc, item) => { (acc[columnOf(item)] ||= []).push(item); return acc }, {})
}
const columns = computed(() => group(sorted.value))
const visibleByColumn = computed(() => {
  let list = sorted.value.filter(item =>
    (!roadmapOnly.value || item.public)
    && (!labelFilter.value.length || item.labels.some(label => labelFilter.value.includes(label)))
    && (assigneeFilter.value === '__all__' || (assigneeFilter.value === 'unassigned' ? !item.assigneeId : item.assigneeId === assigneeFilter.value))
    && (priorityFilter.value === '__all__' || (priorityFilter.value === 'none' ? !item.priority : item.priority === priorityFilter.value)))
  const text = search.value.trim()
  const number = /^#?(\d+)$/.exec(text)
  if (number) list = list.filter(item => item.number === Number(number[1]))
  else if (text) {
    const hits = new Set(new Fuse(list, { keys: [{ name: 'title', weight: 2 }, 'description', 'publicDescription'], threshold: 0.38, ignoreLocation: true }).search(text).map(r => r.item.id))
    list = list.filter(item => hits.has(item.id))
  }
  return group(list)
})

function replaceItem(item: BoardItem) {
  const index = items.value.findIndex(i => i.id === item.id)
  if (index === -1) items.value = [...items.value, item]
  else items.value = [...items.value.slice(0, index), item, ...items.value.slice(index + 1)]
}

async function loadItems() {
  items.value = (await api<{ items: BoardItem[] }>('/admin/board-items', { query: { project: id } })).items
}

// ---- drag and drop ----
const dragging = ref('')
/** A column dragged by its header (admins only): its status key. */
const draggingColumn = ref('')
const canManage = computed(() => can(context.value?.role, 'projects.manage'))
const dragOver = ref('')
/** The card the drop lands before; '' is the end of the column. */
const dropBefore = ref('')

function startDrag(event: DragEvent, item: BoardItem) {
  dragging.value = item.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }
}

function endDrag() {
  dragging.value = ''
  draggingColumn.value = ''
  dragOver.value = ''
  dropBefore.value = ''
}

function startColumnDrag(event: DragEvent, key: string) {
  draggingColumn.value = key
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', key)
  }
}

function enterColumn(key: string) {
  if (dragOver.value === key) return
  dragOver.value = key
  dropBefore.value = ''
}

/** Over a card: its top half drops before it, its bottom half before the next one. */
function overCard(event: DragEvent, key: string, index: number) {
  const list = visibleByColumn.value[key] || []
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const after = event.clientY > rect.top + rect.height / 2
  dragOver.value = key
  dropBefore.value = after ? (list[index + 1]?.id || '') : list[index]!.id
}

/** A column dropped on another takes its place: the statuses are saved in that order, and a failed save puts the old order back. */
async function moveColumn(from: string, to: string) {
  endDrag()
  const current = project.value
  if (!current?.board || !listsConfig.value || from === to) return
  const statuses = current.board.statuses
  const next = [...statuses]
  const [moved] = next.splice(statuses.findIndex(s => s.key === from), 1)
  next.splice(statuses.findIndex(s => s.key === to), 0, moved!)
  storeProject({ ...current, board: { ...current.board, statuses: next } })
  await saveLists({ ...listsConfig.value, statuses: next })
  if (listsError.value) {
    storeProject(current)
    actionError.value = listsError.value
  }
}

async function dropOn(status: string) {
  if (draggingColumn.value) return moveColumn(draggingColumn.value, status)
  const item = items.value.find(i => i.id === dragging.value)
  const before = dropBefore.value
  endDrag()
  if (!item || !board.value) return
  // Neighbours come from the whole column, so a filtered view still lands exactly where it showed.
  const column = columns.value[status] || []
  const rest = column.filter(i => i.id !== item.id)
  // "Before the dragged card itself" means where it already is: before its next neighbour.
  const anchor = before === item.id ? column[column.findIndex(i => i.id === item.id) + 1]?.id || '' : before
  let index = anchor ? rest.findIndex(i => i.id === anchor) : rest.length
  if (index < 0) index = rest.length
  const prev = rest[index - 1]
  const next = rest[index]
  if (columnOf(item) === status) {
    const at = column.findIndex(i => i.id === item.id)
    if (column[at - 1]?.id === prev?.id && column[at + 1]?.id === next?.id) return
  }
  const rank = rankBetween(prev?.rank, next?.rank)
  const snapshot = item
  replaceItem({ ...item, status, rank, statusCategory: feedbackStatusCategory(board.value, status) })
  try {
    replaceItem((await api<{ item: BoardItem }>(`/admin/board-items/${item.id}`, { method: 'PATCH', body: { status, rank } })).item)
  } catch (e: any) {
    replaceItem(snapshot)
    actionError.value = e?.message || t('board.moveError')
  }
}

// ---- editor ----
const editorOpen = ref(false)
const editingId = ref('')
const current = computed(() => (editingId.value ? items.value.find(i => i.id === editingId.value) || null : null))
const draft = reactive({ title: '', description: '', publicDescription: '', status: '', priority: 'none' as BoardItemPriority | 'none', assigneeId: 'unassigned', labels: [] as string[], attachments: [] as ItemAttachment[], targetDate: '', public: false, posts: [] as { id: string, number: number | null, title: string, voteCount: number }[] })
const draftAssignee = computed(() => agents.value.find(agent => agent.id === draft.assigneeId) || null)
const roadmapStatus = computed(() => ROADMAP_CATEGORIES.includes(statusOf(draft.status)?.category || 'open'))
const editorError = ref('')
const savingItem = ref(false)
const confirmDelete = ref(false)
const linking = ref(false)

function fill(item: BoardItem | null) {
  Object.assign(draft, {
    title: item?.title || '',
    description: item?.description || '',
    publicDescription: item?.publicDescription || '',
    status: item?.status || defaultStatus.value,
    priority: item?.priority || 'none',
    assigneeId: item?.assigneeId || 'unassigned',
    labels: [...(item?.labels || [])],
    attachments: [...(item?.attachments || [])],
    targetDate: item?.targetDate ? item.targetDate.slice(0, 10) : '',
    public: item?.public || false,
    posts: []
  })
  editorError.value = ''
  confirmDelete.value = false
}

function openItem(itemId: string) {
  void router.replace({ query: { ...route.query, item: itemId } })
}

function openNew() {
  editingId.value = ''
  fill(null)
  editorOpen.value = true
}

// `?item=<id>` is the editor's address: cards, the inbox and feedback posts link to it.
watch(() => [route.query.item, loading.value, items.value.length] as const, ([wanted]) => {
  const itemId = typeof wanted === 'string' ? wanted : ''
  if (!itemId) {
    if (editingId.value && editorOpen.value) editorOpen.value = false
    return
  }
  if (loading.value || (editingId.value === itemId && editorOpen.value)) return
  const item = items.value.find(i => i.id === itemId)
  if (!item) return
  editingId.value = itemId
  fill(item)
  editorOpen.value = true
}, { immediate: true })

watch(editorOpen, (open) => {
  if (open) return
  editingId.value = ''
  if (route.query.item) void router.replace({ query: { ...route.query, item: undefined } })
})

/** Existing items save field by field, the way Linear's do. */
async function patch(body: Record<string, unknown>) {
  if (!current.value) return
  savingItem.value = true
  editorError.value = ''
  try {
    replaceItem((await api<{ item: BoardItem }>(`/admin/board-items/${current.value.id}`, { method: 'PATCH', body })).item)
  } catch (e: any) {
    editorError.value = e?.message || t('board.saveError')
  } finally {
    savingItem.value = false
  }
}

function saveText(key: 'title' | 'description' | 'publicDescription') {
  if (!current.value) return
  const value = draft[key].trim()
  if (key === 'title' && !value) { draft.title = current.value.title; return }
  if (value !== current.value[key]) void patch({ [key]: value })
}

async function createItem() {
  if (!draft.title.trim()) return
  savingItem.value = true
  editorError.value = ''
  try {
    const { item } = await api<{ item: BoardItem }>('/admin/board-items', {
      method: 'POST',
      query: { project: id },
      body: {
        title: draft.title,
        description: draft.description,
        publicDescription: draft.publicDescription,
        status: draft.status,
        priority: draft.priority === 'none' ? '' : draft.priority,
        assigneeId: draft.assigneeId === 'unassigned' ? '' : draft.assigneeId,
        labels: draft.labels,
        attachments: draft.attachments,
        targetDate: draft.targetDate || null,
        public: draft.public,
        feedbackPostIds: draft.posts.map(post => post.id)
      }
    })
    replaceItem(item)
    editingId.value = item.id
    void router.replace({ query: { ...route.query, item: item.id } })
  } catch (e: any) {
    editorError.value = e?.message || t('board.createError')
  } finally {
    savingItem.value = false
  }
}

async function deleteItem() {
  if (!current.value) return
  if (!confirmDelete.value) {
    confirmDelete.value = true
    setTimeout(() => { confirmDelete.value = false }, 3500)
    return
  }
  const itemId = current.value.id
  try {
    await api(`/admin/board-items/${itemId}`, { method: 'DELETE' })
    items.value = items.value.filter(i => i.id !== itemId)
    editorOpen.value = false
  } catch (e: any) {
    editorError.value = e?.message || t('board.deleteError')
  }
}

async function setLink(kind: 'feedback' | 'conversation', targetId: string, linked: boolean) {
  if (!current.value) return
  linking.value = true
  editorError.value = ''
  try {
    replaceItem((await api<{ item: BoardItem }>(`/admin/board-items/${current.value.id}/links`, { method: 'POST', body: { kind, id: targetId, linked } })).item)
    return true
  } catch (e: any) {
    editorError.value = e?.message || t('board.linkError')
    return false
  } finally {
    linking.value = false
  }
}

// ---- settings ----
const showSettings = ref(false)
const showAi = ref(false)
const savingBoard = ref(false)
const boardSaved = ref(false)
const boardError = ref('')
const savingLists = ref(false)
const listsSaved = ref(false)
const listsError = ref('')

function storeProject(next: AdminProject) {
  projects.value = projects.value.map(p => (p.id === next.id ? next : p))
}

async function saveBoard(next: Record<string, unknown>) {
  savingBoard.value = true
  boardSaved.value = false
  boardError.value = ''
  try {
    storeProject((await api<{ project: AdminProject }>(`/admin/projects/${id}`, { method: 'PATCH', body: { board: next } })).project)
    boardSaved.value = true
  } catch (e: any) {
    boardError.value = e?.message || t('board.saveError')
  } finally {
    savingBoard.value = false
  }
}

// The status and label editor is the feedback board's, with labels as its tags.
// Rebuilt only when those lists change, so a toggle above never resets a draft below.
const listsConfig = ref<FeedbackBoardConfig | null>(null)
watch(() => (board.value ? JSON.stringify([board.value.statuses, board.value.labels]) : ''), () => {
  listsConfig.value = board.value ? { ...DEFAULT_FEEDBACK_CONFIG, statuses: board.value.statuses, tags: board.value.labels } : null
}, { immediate: true })

async function saveLists(config: FeedbackBoardConfig) {
  savingLists.value = true
  listsSaved.value = false
  listsError.value = ''
  try {
    storeProject((await api<{ project: AdminProject }>(`/admin/projects/${id}`, { method: 'PATCH', body: { board: { statuses: config.statuses, labels: config.tags } } })).project)
    listsSaved.value = true
  } catch (e: any) {
    listsError.value = e?.message || t('board.saveError')
  } finally {
    savingLists.value = false
  }
}

// ---- new column ----
// A column is a status: it joins the board's statuses through the same save as the settings form.
// Open is the default category: its items stay private, where a planned, active or done one would show on the roadmap.
const columnOpen = ref(false)
const columnDraft = reactive({ label: '', category: 'open' as FeedbackStatusCategory })
const columnKey = computed(() => normalizeFeedbackKey(columnDraft.label))
const columnError = ref('')
const categoryItems = computed(() => FEEDBACK_STATUS_CATEGORIES.map(value => ({ label: t(`feedback.categories.${value}`), value })))

function openAddColumn() {
  columnDraft.label = ''
  columnDraft.category = 'open'
  columnError.value = ''
  columnOpen.value = true
}

async function addColumn() {
  if (!columnKey.value || !listsConfig.value) return
  if (board.value?.statuses.some(status => status.key === columnKey.value)) {
    columnError.value = t('board.columnExists')
    return
  }
  columnError.value = ''
  await saveLists({ ...listsConfig.value, statuses: [...listsConfig.value.statuses, { key: columnKey.value, label: columnDraft.label.trim(), category: columnDraft.category, color: 'neutral', isDefault: false, notify: false }] })
  if (listsError.value) columnError.value = listsError.value
  else columnOpen.value = false
}

// ---- load ----
// No live sync between operators yet: coming back to the tab refetches.
function onFocus() {
  if (!dragging.value && !savingItem.value && !loading.value) loadItems().catch(() => {})
}

onMounted(async () => {
  window.addEventListener('focus', onFocus)
  try {
    if (!project.value) await loadProjects()
    if (!project.value) throw new Error(t('board.projectNotFound'))
    await Promise.all([
      loadItems(),
      api<{ agents: HumanAgent[] }>('/admin/agents').then((result) => { agents.value = result.agents }).catch(() => {})
    ])
  } catch (e: any) {
    error.value = e?.message || t('board.loadError')
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => window.removeEventListener('focus', onFocus))
</script>
