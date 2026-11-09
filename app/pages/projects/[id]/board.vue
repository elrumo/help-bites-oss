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
        <div class="mr-1 inline-flex rounded-lg border border-default p-0.5" role="group" :aria-label="$t('board.view')">
          <UButton v-for="option in VIEWS" :key="option.value" :icon="option.icon" :label="$t(`board.views.${option.value}`)" size="xs" :color="view === option.value ? 'primary' : 'neutral'" :variant="view === option.value ? 'soft' : 'ghost'" :aria-pressed="view === option.value" @click="view = option.value" />
        </div>
        <UDropdownMenu v-if="savedViews.length || canManage" :items="viewMenu">
          <UButton icon="i-lucide-bookmark" :label="$t('board.savedViews')" trailing-icon="i-lucide-chevron-down" size="xs" color="neutral" variant="outline" />
        </UDropdownMenu>
        <form v-if="savingView" class="flex items-center gap-1" @submit.prevent="saveView">
          <UInput v-model="viewName" :maxlength="40" size="sm" class="w-40" :placeholder="$t('board.viewName')" :aria-label="$t('board.viewName')" autofocus />
          <UButton type="submit" :label="$t('board.viewSave')" size="xs" :loading="savingViewNow" :disabled="!viewName.trim()" />
          <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square :aria-label="$t('board.viewCancel')" @click="savingView = false" />
        </form>
        <button type="button" class="chip h-6 px-2.5 text-xs" :class="roadmapOnly ? 'chip-active' : 'border-transparent text-dimmed'" :aria-pressed="roadmapOnly" @click="roadmapOnly = !roadmapOnly">
          <UIcon name="i-lucide-globe" class="size-3" />{{ $t('board.roadmapChip') }}<span class="tabular-nums opacity-70">{{ publicCount }}</span>
        </button>
        <USelectMenu v-if="board.labels.length" v-model="labelFilter" :items="labelItems" value-key="value" multiple size="sm" class="w-40" :placeholder="$t('board.labels')" :aria-label="$t('board.labels')" />
        <USelect v-model="assigneeFilter" :items="assigneeFilterItems" size="sm" class="w-36" :aria-label="$t('board.assignee')" />
        <USelect v-model="priorityFilter" :items="priorityFilterItems" size="sm" class="w-32" :aria-label="$t('board.priority')" />
        <USelect v-if="epics.length || releases.length" v-model="kindFilter" :items="kindFilterItems" size="sm" class="w-32" :aria-label="$t('board.kind')" />
        <USelect v-if="epics.length" v-model="epicFilter" :items="epicFilterItems" size="sm" class="w-40" :aria-label="$t('board.epic')" />
        <USelect v-if="releases.length" v-model="releaseFilter" :items="releaseFilterItems" size="sm" class="w-40" :aria-label="$t('board.release')" />
        <USelect v-model="order" :items="orderItems" size="sm" class="w-40" :aria-label="$t('board.order')">
          <template #leading><UIcon name="i-lucide-arrow-up-down" class="size-3.5 text-dimmed" /></template>
        </USelect>
        <USelect v-if="view === 'list'" v-model="groupBy" :items="groupByItems" size="sm" class="w-44" :aria-label="$t('board.groupBy')">
          <template #leading><UIcon name="i-lucide-rows-3" class="size-3.5 text-dimmed" /></template>
        </USelect>
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
      <div v-else-if="view === 'kanban'" class="flex-1 min-h-0 overflow-x-auto">
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
            <div class="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-1">
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
                    <UIcon v-if="item.kind !== 'task'" :name="KIND_ICONS[item.kind]" class="size-3.5 text-primary" :title="$t(`board.kinds.${item.kind}`)" />
                    <span v-if="item.number" class="tabular-nums">#{{ item.number }}</span>
                    <PriorityIcon v-if="item.priority" :priority="item.priority" />
                    <span class="ml-auto flex items-center gap-1.5">
                      <UIcon v-if="item.public" name="i-lucide-globe" class="size-3.5 text-primary" :aria-label="$t('board.publicRoadmapLabel')" />
                      <span v-if="assigneeOf(item)" class="grid size-5 place-items-center rounded-full bg-accented text-[9px] font-semibold text-toned" :title="assigneeOf(item)!.name || assigneeOf(item)!.username">{{ initialsOf(assigneeOf(item)!.name || assigneeOf(item)!.username) }}</span>
                    </span>
                  </span>
                  <span class="mt-1 block text-[13px] font-medium leading-snug line-clamp-3">{{ item.title }}</span>
                  <BoardProgress v-if="item.kind !== 'task'" :done="progressOf(item).done" :total="progressOf(item).total" :points="progressOf(item).estimateTotal" :points-done="progressOf(item).estimateDone" class="mt-2 flex" />
                  <span v-if="parentChips(item).length" class="mt-2 flex flex-wrap gap-1">
                    <span v-for="chip in parentChips(item)" :key="chip.key" class="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px text-[10px] text-primary" :title="chip.title"><UIcon :name="chip.icon" class="size-3 shrink-0" /><span class="truncate">{{ chip.label }}</span></span>
                  </span>
                  <span v-if="item.labels.length" class="mt-2 flex flex-wrap gap-1">
                    <span v-for="label in item.labels" :key="label" class="inline-flex items-center gap-1 rounded-full border border-default px-1.5 py-px text-[10px] text-toned">
                      <span class="size-1.5 rounded-full" :class="toneDot(labelOf(label)?.color)" />{{ labelOf(label)?.label || label }}
                    </span>
                  </span>
                  <span v-if="cardPills(item).length" class="mt-2 flex flex-wrap gap-1">
                    <span v-for="pill in cardPills(item)" :key="pill.key" class="inline-flex items-center gap-1 rounded-full bg-elevated px-1.5 py-px text-[10px] tabular-nums text-toned" :title="pill.title"><UIcon :name="pill.icon" class="size-3" />{{ pill.count || '' }}</span>
                  </span>
                  <span v-if="item.posts.length || item.conversations.length || item.targetDate || item.estimate != null" class="mt-2 flex items-center gap-2.5 text-[11px] text-muted">
                    <span v-if="item.estimate != null" class="inline-flex items-center gap-0.5 tabular-nums" :title="$t('board.estimate')"><UIcon name="i-lucide-gauge" class="size-3" />{{ item.estimate }}</span>
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

      <!-- List: Monday-style groups of rows; every cell edits in place, a row opens the editor -->
      <div v-else class="flex-1 min-h-0 overflow-auto">
        <div class="min-w-[67rem] space-y-5 p-4 md:px-6">
          <section v-for="g in listGroups" :key="g.key">
            <div class="flex items-center gap-2 py-1">
              <button type="button" class="flex min-w-0 items-center gap-2 text-left" :aria-expanded="!isCollapsed(g.key)" @click="toggleGroup(g.key)">
                <UIcon :name="isCollapsed(g.key) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="size-4 shrink-0 text-muted" />
                <span class="size-2.5 shrink-0 rounded-full" :class="toneDot(g.color)" />
                <span class="truncate text-sm font-semibold">{{ g.label }}</span>
                <span class="text-xs tabular-nums text-muted">{{ g.items.length }}</span>
              </button>
              <BoardProgress v-if="g.parent" :done="progressFor(g.parent.id).done" :total="progressFor(g.parent.id).total" :points="progressFor(g.parent.id).estimateTotal" :points-done="progressFor(g.parent.id).estimateDone" class="w-48" />
              <UButton v-if="g.parent && groupBy === 'epic'" icon="i-lucide-arrow-up-right" size="xs" color="neutral" variant="ghost" square :aria-label="$t('board.openItem')" @click="openItem(g.parent.id)" />
            </div>
            <div v-if="!isCollapsed(g.key)" class="overflow-hidden rounded-lg border border-default bg-default">
              <div :class="[LIST_GRID, 'border-b border-default bg-elevated/60 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted']">
                <span>{{ $t('board.colItem') }}</span><span>{{ $t('board.epic') }}</span><span>{{ $t('board.release') }}</span><span>{{ $t('board.assignee') }}</span><span>{{ $t('board.priority') }}</span><span>{{ $t('board.status') }}</span><span>{{ $t('board.targetDate') }}</span><span>{{ $t('board.estimateShort') }}</span>
              </div>
              <div v-for="item in g.items" :key="item.id" :class="[LIST_GRID, 'border-b border-default px-3 py-1 text-[13px] hover:bg-elevated/50']">
                <button type="button" class="flex min-w-0 items-center gap-2 py-1 text-left" @click="openItem(item.id)">
                  <UIcon v-if="item.kind !== 'task'" :name="KIND_ICONS[item.kind]" class="size-3.5 shrink-0 text-primary" :title="$t(`board.kinds.${item.kind}`)" />
                  <span v-if="item.number" class="shrink-0 tabular-nums text-muted">#{{ item.number }}</span>
                  <span class="min-w-0 truncate font-medium">{{ item.title }}</span>
                  <UIcon v-if="item.public" name="i-lucide-globe" class="size-3.5 shrink-0 text-primary" :aria-label="$t('board.publicRoadmapLabel')" />
                  <BoardProgress v-if="item.kind !== 'task'" :done="progressOf(item).done" :total="progressOf(item).total" :points="progressOf(item).estimateTotal" :points-done="progressOf(item).estimateDone" class="w-32 shrink-0" />
                </button>
                <select v-if="kindCanHave(item.kind, 'epic')" :value="item.epicId" :class="CELL" :aria-label="$t('board.epic')" @change="quickPatch(item, { epicId: ($event.target as HTMLSelectElement).value })">
                  <option value="">—</option>
                  <option v-for="epic in epics" :key="epic.id" :value="epic.id">{{ parentLabel(epic.id) }}</option>
                </select>
                <span v-else />
                <select v-if="kindCanHave(item.kind, 'release')" :value="item.releaseId" :class="CELL" :aria-label="$t('board.release')" @change="quickPatch(item, { releaseId: ($event.target as HTMLSelectElement).value })">
                  <option value="">—</option>
                  <option v-for="release in releases" :key="release.id" :value="release.id">{{ release.version }}</option>
                </select>
                <span v-else />
                <select :value="item.assigneeId" :class="CELL" :aria-label="$t('board.assignee')" @change="quickPatch(item, { assigneeId: ($event.target as HTMLSelectElement).value })">
                  <option value="">—</option>
                  <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name || agent.username }}</option>
                </select>
                <select :value="item.priority" :class="CELL" :aria-label="$t('board.priority')" @change="quickPatch(item, { priority: ($event.target as HTMLSelectElement).value })">
                  <option value="">—</option>
                  <option v-for="value in PRIORITIES" :key="value" :value="value">{{ $t(PRIORITY_KEYS[value]) }}</option>
                </select>
                <select :value="columnOf(item)" :class="[CELL_BASE, 'text-center font-medium text-white [&>option]:bg-default [&>option]:text-default', toneDot(statusOf(columnOf(item))?.color)]" :aria-label="$t('board.status')" @change="changeStatus(item, ($event.target as HTMLSelectElement).value)">
                  <option v-for="status in board.statuses" :key="status.key" :value="status.key">{{ status.label }}</option>
                </select>
                <input type="date" :value="item.targetDate ? item.targetDate.slice(0, 10) : ''" :class="[CELL, '[color-scheme:light] dark:[color-scheme:dark]']" :aria-label="$t('board.targetDate')" @change="quickPatch(item, { targetDate: ($event.target as HTMLInputElement).value || null })">
                <input type="number" min="0" max="1000" step="any" :value="item.estimate ?? ''" :class="[CELL, 'text-right tabular-nums']" :aria-label="$t('board.estimate')" @change="quickPatch(item, { estimate: estimateOf(($event.target as HTMLInputElement).value) })">
              </div>
              <p v-if="!g.items.length" class="px-3 py-3 text-xs text-dimmed">{{ filtering ? $t('board.nothingMatches') : $t('board.noItems') }}</p>
              <form class="flex items-center gap-2 px-3 py-1.5" @submit.prevent="quickAdd(g)">
                <UIcon name="i-lucide-plus" class="size-3.5 shrink-0 text-dimmed" />
                <input v-model="quickTitle[g.key]" type="text" maxlength="200" class="min-w-0 flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-dimmed" :placeholder="$t('board.quickAdd')" :aria-label="$t('board.quickAdd')">
              </form>
            </div>
          </section>
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
        <div v-if="board" class="space-y-4" @keydown.meta.enter.prevent="submitShortcut" @keydown.ctrl.enter.prevent="submitShortcut">
          <!-- A draft that came back from the last time this panel was open -->
          <p v-if="!current && restored" class="flex items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-2 text-xs text-muted">
            <UIcon name="i-lucide-history" class="size-3.5 shrink-0" />
            <span class="min-w-0 flex-1">{{ $t('board.draftRestored') }}</span>
            <UButton :label="$t('board.discardDraft')" size="xs" color="neutral" variant="ghost" @click="discardDraft" />
          </p>
          <!-- Planning title and description -->
          <div class="space-y-2">
            <UInput v-model="draft.title" :placeholder="$t('board.title')" size="xl" class="w-full" :ui="titleField" :maxlength="200" :aria-label="$t('board.title')" @blur="saveText('title')" @keydown.enter.prevent="saveText('title')">
              <template v-if="draft.description.trim()" #trailing>
                <UIcon v-if="writingTitle" name="i-lucide-loader-circle" class="size-4 animate-spin text-muted" :aria-label="$t('board.titleWriting')" />
                <UTooltip v-else :text="$t('board.titleWriteAi')">
                  <UButton icon="i-lucide-sparkles" color="neutral" variant="ghost" size="xs" :aria-label="$t('board.titleWriteAi')" @click="writeTitle({ manual: true })" />
                </UTooltip>
              </template>
            </UInput>
            <UTextarea v-model="draft.description" :placeholder="$t('board.descriptionPlaceholder')" :rows="3" autoresize :maxrows="18" class="w-full" :aria-label="$t('board.description')" @blur="saveText('description')" />
          </div>

          <!-- Property rows: white boxes, like every other field -->
          <section class="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <USelect v-model="draft.status" :items="statusItems" size="sm" class="w-full" :ui="propertyField" :aria-label="$t('board.status')" @update:model-value="patch({ status: draft.status })">
              <template #leading><span class="size-2.5 rounded-full" :class="toneDot(statusOf(draft.status)?.color)" /></template>
            </USelect>
            <USelect v-model="draft.priority" :items="priorityItems" size="sm" class="w-full" :ui="propertyField" :aria-label="$t('board.priority')" @update:model-value="patch({ priority: draft.priority === 'none' ? '' : draft.priority })">
              <template #leading><PriorityIcon v-if="draft.priority !== 'none'" :priority="draft.priority as ConversationPriority" /><UIcon v-else name="i-lucide-minus" class="size-3.5 text-dimmed" /></template>
            </USelect>
            <USelect v-model="draft.assigneeId" :items="assigneeItems" size="sm" class="w-full" :ui="propertyField" :aria-label="$t('board.assignee')" @update:model-value="patch({ assigneeId: draft.assigneeId === 'unassigned' ? '' : draft.assigneeId })">
              <template #leading>
                <span v-if="draftAssignee" class="grid size-4 place-items-center rounded-full bg-accented text-[8px] font-semibold text-toned">{{ initialsOf(draftAssignee.name || draftAssignee.username) }}</span>
                <UIcon v-else name="i-lucide-circle-user-round" class="size-4 text-dimmed" />
              </template>
            </USelect>
            <label class="group" :class="propertyBox">
              <UIcon name="i-lucide-calendar" class="absolute left-2.5 size-3.5 text-dimmed" />
              <input v-model="draft.targetDate" type="date" class="w-full bg-transparent outline-none [color-scheme:light] dark:[color-scheme:dark]" :class="draft.targetDate ? '' : 'text-dimmed'" :aria-label="$t('board.targetDate')" @change="patch({ targetDate: draft.targetDate || null })">
            </label>
            <label class="group" :class="propertyBox">
              <UIcon name="i-lucide-gauge" class="absolute left-2.5 size-3.5 text-dimmed" />
              <input v-model="draft.estimate" type="number" min="0" max="1000" step="any" class="w-full bg-transparent outline-none" :placeholder="$t('board.estimate')" :aria-label="$t('board.estimate')" @change="patch({ estimate: estimateOf(String(draft.estimate)) })">
            </label>
            <USelect v-model="draft.kind" :items="kindItems" size="sm" class="w-full" :ui="propertyField" :aria-label="$t('board.kind')" @update:model-value="changeKind">
              <template #leading><UIcon :name="KIND_ICONS[draft.kind]" class="size-3.5 text-dimmed" /></template>
            </USelect>
            <USelectMenu v-if="kindCanHave(draft.kind, 'epic')" v-model="draft.epicId" :items="epicItems" value-key="value" create-item="always" :search-input="{ placeholder: $t('board.createParentHint') }" size="sm" class="w-full" :ui="propertyField" :aria-label="$t('board.epic')" @create="createParent('epic', $event)" @update:model-value="setParent('epicId')">
              <template #leading><UIcon name="i-lucide-zap" class="size-3.5 text-dimmed" /></template>
              <template #create-item-label="{ item }">{{ $t('board.createEpic', { name: item }) }}</template>
            </USelectMenu>
            <USelectMenu v-if="kindCanHave(draft.kind, 'release')" v-model="draft.releaseId" :items="releaseItems" value-key="value" create-item="always" :search-input="{ placeholder: $t('board.createParentHint') }" size="sm" class="w-full" :ui="propertyField" :aria-label="$t('board.release')" @create="createParent('release', $event)" @update:model-value="setParent('releaseId')">
              <template #leading><UIcon name="i-lucide-rocket" class="size-3.5 text-dimmed" /></template>
              <template #create-item-label="{ item }">{{ $t('board.createRelease', { name: item }) }}</template>
            </USelectMenu>
            <USelectMenu v-model="draft.labels" :items="labelItems" value-key="value" multiple create-item="always" size="sm" class="w-full sm:col-span-2" :ui="propertyField" :placeholder="$t('board.addLabels')" :aria-label="$t('board.labels')" @create="createLabel" @update:model-value="patch({ labels: draft.labels })">
              <template #leading><UIcon name="i-lucide-tag" class="size-3.5 text-dimmed" /></template>
            </USelectMenu>
          </section>

          <!-- Public status -->
          <section class="space-y-3 px-3">
            <USwitch v-model="draft.public" :label="$t('board.onPublicRoadmap')" :description="$t('board.onPublicRoadmapDescription')" @update:model-value="patch({ public: draft.public })" />
            <template v-if="draft.public">
              <UFormField :label="$t('board.publicDescription')" :hint="$t('board.publicDescriptionHint')">
                <UTextarea v-model="draft.publicDescription" :rows="2" autoresize :maxrows="10" class="w-full" :placeholder="$t('board.publicDescriptionPlaceholder')" @blur="saveText('publicDescription')">
                  <template v-if="draft.description.trim()" #trailing>
                    <UIcon v-if="writingPublic" name="i-lucide-loader-circle" class="mt-1 size-4 animate-spin text-muted" :aria-label="$t('board.publicDescriptionWriting')" />
                    <UTooltip v-else :text="$t('board.publicDescriptionWriteAi')">
                      <UButton icon="i-lucide-sparkles" color="neutral" variant="ghost" size="xs" :aria-label="$t('board.publicDescriptionWriteAi')" @click="writePublicDescription" />
                    </UTooltip>
                  </template>
                </UTextarea>
              </UFormField>
              <p v-if="!roadmapReady" class="text-xs text-warning">{{ $t('board.roadmapNeedsFeedback') }}</p>
              <p v-else-if="!roadmapStatus" class="text-xs text-muted">{{ $t('board.notOnRoadmap', { status: statusOf(draft.status)?.label || $t('board.thisStatus') }) }}</p>
            </template>
          </section>

          <!-- Attachments -->
          <section class="space-y-2">
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

          <!-- Current item feedback feedback -->
          <div v-if="current" class="grid grid-cols-2 gap-4">
            <!-- Current item feedback -->
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

            <!-- An epic's or release's cards -->
            <section v-if="current.kind !== 'task'" class="col-span-2 space-y-2">
              <h3 class="flex items-center gap-2 text-sm font-semibold">{{ $t('board.cards') }} <span class="font-normal text-muted">{{ cards.length }}</span></h3>
              <BoardProgress v-if="cards.length" :done="progressOf(current).done" :total="progressOf(current).total" class="flex" />
              <ul v-if="cards.length" class="divide-y divide-default rounded-lg border border-default">
                <li v-for="card in cards" :key="card.id" class="group flex items-center gap-2.5 px-2.5 py-2 text-[13px]">
                  <UIcon v-if="card.kind !== 'task'" :name="KIND_ICONS[card.kind]" class="size-3.5 shrink-0 text-primary" />
                  <button type="button" class="min-w-0 flex-1 truncate text-left hover:underline" @click="openItem(card.id)"><span v-if="card.number" class="mr-1 tabular-nums text-muted">#{{ card.number }}</span>{{ card.title }}</button>
                  <FeedbackStatusBadge v-if="statusOf(card.status)" :status="statusOf(card.status)!" />
                  <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :aria-label="$t('board.removeCard', { number: card.number ?? '' })" @click="quickPatch(card, { [current.kind === 'epic' ? 'epicId' : 'releaseId']: '' })" />
                </li>
              </ul>
              <USelectMenu v-if="addableCards.length" :items="addableCards" value-key="value" class="w-full" :model-value="null" :placeholder="$t('board.addCard')" :aria-label="$t('board.addCard')" @update:model-value="cardId => cardId && addCard(String(cardId))" />
            </section>

            <!-- Current item related items -->
            <section class="space-y-2">
              <h3 class="text-sm font-semibold">{{ $t('board.related') }} <span class="font-normal text-muted">{{ current.related.length }}</span></h3>
              <ul v-if="current.related.length" class="divide-y divide-default rounded-lg border border-default">
                <li v-for="item in current.related" :key="item.id" class="group flex items-center gap-2.5 px-2.5 py-2 text-[13px]">
                  <span class="min-w-0 flex-1 truncate"><span v-if="item.number" class="mr-1 tabular-nums text-muted">#{{ item.number }}</span>{{ item.title }}</span>
                  <FeedbackStatusBadge v-if="statusOf(item.status)" :status="statusOf(item.status)!" />
                  <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" square class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :aria-label="$t('board.unrelate', { number: item.number ?? '' })" @click="setLink('item', item.id, false)" />
                </li>
              </ul>
              <USelectMenu v-if="relatable.length" :items="relatable" value-key="value" class="w-full" :model-value="null" :placeholder="$t('board.relateItem')" :aria-label="$t('board.relateItem')" :disabled="linking" @update:model-value="id => id && setLink('item', String(id), true)" />
            </section>

            <!-- Current item conversations -->
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

            <!-- Current item filed from errors -->
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

            <BoardItemComments :key="current.id" :project-id="id" :item-id="current.id" class="col-span-2" />

            <UCollapsible :open="historyExpanded" class="col-span-2 rounded-xl border border-default" @update:open="toggleHistory">
              <button type="button" class="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold">
                <UIcon name="i-lucide-history" class="size-4 text-muted" />
                <span>{{ $t('board.editHistory') }}</span>
                <span class="ml-auto max-w-[70%] truncate text-right text-xs font-normal text-muted" :title="current.updatedAt ? new Date(current.updatedAt).toLocaleString() : ''">
                  <template v-if="current.lastModifiedBy">{{ $t('board.historyActor', { name: current.lastModifiedBy, source: $t(`board.historySource.${current.lastModifiedSource || 'api'}`) }) }} · {{ timeAgo(current.updatedAt) }}</template>
                  <template v-else>{{ $t('board.lastModifiedUnknown', { time: timeAgo(current.updatedAt) }) }}</template>
                </span>
                <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted transition-transform" :class="historyExpanded ? 'rotate-180' : ''" />
              </button>
              <template #content>
                <div class="max-h-80 space-y-3 overflow-auto border-t border-default px-3 py-3">
                  <p v-if="historyLoading" class="text-xs text-muted">{{ $t('board.historyLoading') }}</p>
                  <p v-else-if="historyError" class="text-xs text-error">{{ $t('board.historyFailed') }}</p>
                  <p v-else-if="!itemHistory.length" class="text-xs text-muted">{{ $t('board.historyNotAvailable') }}</p>
                  <ol v-else class="space-y-4">
                    <li v-for="entry in itemHistory" :key="entry.id" class="border-l border-default pl-3">
                      <div class="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span class="font-medium text-highlighted">{{ entry.action === 'created' ? $t('board.historyCreated') : $t('board.historyUpdated') }} · {{ $t('board.historyActor', { name: entry.actorName, source: $t(`board.historySource.${entry.source}`) }) }}</span>
                        <time class="text-muted" :datetime="entry.createdAt" :title="new Date(entry.createdAt).toLocaleString()">{{ timeAgo(entry.createdAt) }}</time>
                      </div>
                      <ul v-if="entry.changes.length" class="mt-2 space-y-2 text-xs">
                        <li v-for="(change, index) in entry.changes" :key="`${entry.id}-${index}`" class="space-y-0.5">
                          <span v-if="change.field !== 'rank'" class="font-medium text-toned">{{ $t(`board.historyField.${change.field}`) }}</span>
                          <div class="whitespace-pre-wrap break-words text-muted">{{ change.field === 'rank' ? $t('board.historyPositionChanged') : `${historyValue(change.field, change.from)} → ${historyValue(change.field, change.to)}` }}</div>
                        </li>
                      </ul>
                    </li>
                  </ol>
                  <UButton v-if="historyHasMore" size="xs" color="neutral" variant="ghost" :loading="historyLoading" :label="$t('board.historyOlder')" @click="loadHistory(false)" />
                </div>
              </template>
            </UCollapsible>
          </div>

          <p v-if="editorError" class="text-sm text-error">{{ editorError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UButton v-if="current" :label="confirmDelete ? $t('board.clickAgainDelete') : $t('board.delete')" icon="i-lucide-trash-2" :color="confirmDelete ? 'error' : 'neutral'" :variant="confirmDelete ? 'solid' : 'ghost'" @click="deleteItem" />
          <SaveStatus v-if="current" class="ml-auto" :saving="savingItem" :saved="savedItem" :idle="$t('board.changesSave')" />
          <template v-else>
            <UButton class="ml-auto" :label="$t('common.cancel')" color="neutral" variant="ghost" @click="editorOpen = false" />
            <UButton :label="$t('board.createItem')" color="primary" :loading="savingItem" :disabled="!draft.title.trim() && !draft.description.trim()" @click="createItem">
              <template #trailing><span class="hidden items-center gap-0.5 sm:inline-flex" aria-hidden="true"><UKbd value="meta" size="sm" class="bg-white/20 text-white ring-0" /><UKbd value="enter" size="sm" class="bg-white/20 text-white ring-0" /></span></template>
            </UButton>
          </template>
        </div>
      </template>
    </USlideover>

    <!-- Board settings -->
    <AiCardsChat v-model:open="showAi" :project-id="id" kind="board" @created="loadItems" />

    <USlideover v-model:open="showSettings" :title="$t('board.settingsTitle')" :description="$t('board.settingsDescription')" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div v-if="board" class="space-y-8">
          <!-- The switches and the roadmap's look save as soon as they change -->
          <section class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">{{ $t('sections.board') }}</h3>
              <SaveStatus :saving="savingBoard" :saved="boardSaved" :idle="$t('board.savesAsChange')" />
            </div>
            <div class="divide-y divide-default rounded-xl border border-default bg-default">
              <div class="flex items-center justify-between gap-4 px-4 py-3">
                <div class="min-w-0"><p class="text-[13px] font-medium">{{ $t('board.boardOn') }}</p><p class="text-xs text-muted">{{ $t('board.boardOnDescription') }}</p></div>
                <USwitch :model-value="board.enabled" :aria-label="$t('board.boardOn')" @update:model-value="saveBoard({ enabled: $event })" />
              </div>
              <div class="flex items-center justify-between gap-4 px-4 py-3">
                <div class="min-w-0"><p class="text-[13px] font-medium">{{ $t('board.syncFeedback') }}</p><p class="text-xs text-muted">{{ $t('board.syncFeedbackDescription') }}</p></div>
                <USwitch :model-value="board.syncFeedback" :aria-label="$t('board.syncFeedback')" @update:model-value="saveBoard({ syncFeedback: $event })" />
              </div>
            </div>
            <p v-if="boardError" class="text-sm text-error">{{ boardError }}</p>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold">{{ $t('board.publicRoadmap') }}</h3>
            <div class="divide-y divide-default rounded-xl border border-default bg-default">
              <div class="flex items-center justify-between gap-4 px-4 py-3">
                <p class="text-[13px] font-medium">{{ $t('board.roadmapLayout') }}</p>
                <USelect :model-value="board.roadmap.layout" :items="layoutItems" size="sm" class="w-48" :aria-label="$t('board.roadmapLayout')" @update:model-value="saveBoard({ roadmap: { layout: $event } })" />
              </div>
              <div class="flex items-center justify-between gap-4 px-4 py-3">
                <div class="min-w-0"><p class="text-[13px] font-medium">{{ $t('board.showLabels') }}</p><p class="text-xs text-muted">{{ $t('board.showLabelsDescription') }}</p></div>
                <USwitch :model-value="board.roadmap.showLabels" :aria-label="$t('board.showLabels')" @update:model-value="saveBoard({ roadmap: { showLabels: $event } })" />
              </div>
              <div class="flex items-center justify-between gap-4 px-4 py-3">
                <div class="min-w-0"><p class="text-[13px] font-medium">{{ $t('board.showDates') }}</p><p class="text-xs text-muted">{{ $t('board.showDatesDescription') }}</p></div>
                <USwitch :model-value="board.roadmap.showDates" :aria-label="$t('board.showDates')" @update:model-value="saveBoard({ roadmap: { showDates: $event } })" />
              </div>
            </div>
          </section>

          <FeedbackBoardSettings v-if="listsConfig" board-only :config="listsConfig" :saving="savingLists" :saved="listsSaved" :error="listsError" @save="saveLists" />
        </div>
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import Fuse from 'fuse.js'
import { useLocalStorage, watchDebounced } from '@vueuse/core'
import { DEFAULT_FEEDBACK_CONFIG, FEEDBACK_STATUS_CATEGORIES, defaultFeedbackStatus, feedbackStatusCategory, normalizeFeedbackKey, type FeedbackBoardConfig, type FeedbackColor, type FeedbackStatusCategory } from '#shared/feedback'
import { isImageMime, isVideoMime, type ItemAttachment } from '#shared/itemAttachments'
import { can } from '#shared/roles'
import { BOARD_TITLE_DEBOUNCE_MS, fallbackBoardTitle } from '#shared/boardTitle'
import { BOARD_ITEM_KINDS, BOARD_ROADMAP_LAYOUTS, ROADMAP_CATEGORIES, kindCanHave, rankBetween, type BoardConfig, type BoardItem, type BoardItemHistory, type BoardItemKind, type BoardItemPriority, type BoardRoadmapLayout, type BoardSavedView } from '#shared/board'
import { CHANGELOG_VERSION_MAX_LENGTH, type ChangelogRelease } from '#shared/changelog'
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
// The project's changelog releases: a card's release is one of them, and a release made here is one in the changelog too.
const releaseRows = ref<ChangelogRelease[]>([])
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
/** The small facts a card shows as pills: a description, images and files. */
function cardPills(item: BoardItem) {
  const images = item.attachments.filter(file => isImageMime(file.mime)).length
  const videos = item.attachments.filter(file => isVideoMime(file.mime)).length
  const files = item.attachments.length - images - videos
  return [
    ...(item.description.trim() ? [{ key: 'description', icon: 'i-lucide-text', count: 0, title: t('board.pillDescription') }] : []),
    ...(images ? [{ key: 'images', icon: 'i-lucide-image', count: images, title: t('board.pillImages', images) }] : []),
    ...(videos ? [{ key: 'videos', icon: 'i-lucide-video', count: videos, title: t('board.pillVideos', videos) }] : []),
    ...(files ? [{ key: 'files', icon: 'i-lucide-paperclip', count: files, title: t('board.pillFiles', files) }] : []),
    ...(item.related.length ? [{ key: 'related', icon: 'i-lucide-link-2', count: item.related.length, title: t('board.pillRelated', item.related.length) }] : []),
    ...(item.errorRefs.length ? [{ key: 'error', icon: 'i-lucide-bug', count: 0, title: t('board.pillError') }] : [])
  ]
}
/** Target dates are calendar days at UTC midnight. */
const dayLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

const KIND_ICONS: Record<BoardItemKind, string> = { task: 'i-lucide-square', epic: 'i-lucide-zap' }
const RELEASE_ICON = 'i-lucide-rocket'
const kindItems = computed(() => BOARD_ITEM_KINDS.map(value => ({ label: t(`board.kinds.${value}`), value })))
const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
const PRIORITY_KEYS: Record<ConversationPriority, string> = { low: 'board.low', normal: 'board.normal', high: 'board.high', urgent: 'board.urgent' }
const priorityItems = computed(() => [{ label: t('board.noPriority'), value: 'none' }, ...(['urgent', 'high', 'normal', 'low'] as const).map(value => ({ label: t(PRIORITY_KEYS[value]), value }))])
const LAYOUT_KEYS: Record<BoardRoadmapLayout, string> = { columns: 'board.layoutColumns', timeline: 'board.layoutTimeline', list: 'board.layoutList' }
const layoutItems = computed(() => BOARD_ROADMAP_LAYOUTS.map(value => ({ label: t(LAYOUT_KEYS[value]), value })))
const statusItems = computed(() => (board.value?.statuses || []).map(s => ({ label: s.label, value: s.key })))
const labelItems = computed(() => (board.value?.labels || []).map(l => ({ label: l.label, value: l.key })))
// Other items that the open one is not related to yet.
const relatable = computed(() => items.value
  .filter(item => item.id !== current.value?.id && !current.value?.relatedItemIds.includes(item.id))
  .map(item => ({ label: `${item.number ? `#${item.number} ` : ''}${item.title}`, value: item.id })))
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
// Manual is the order the cards are dragged into; newest and oldest sort each column by when its item was made, votes by the most voted first (drag still moves items between columns).
type BoardOrder = 'manual' | 'newest' | 'oldest' | 'votes'
const ORDERS: BoardOrder[] = ['manual', 'newest', 'oldest', 'votes']
// The chosen order is remembered per project in this browser, so it survives a refresh.
const savedOrder = useLocalStorage<BoardOrder>(`hb-board-order:${id}`, 'manual')
const order = computed<BoardOrder>({
  get: () => (ORDERS.includes(savedOrder.value) ? savedOrder.value : 'manual'),
  set: (value) => { savedOrder.value = value }
})
const orderItems = computed(() => [{ label: t('board.orderManual'), value: 'manual' }, { label: t('board.orderNewest'), value: 'newest' }, { label: t('board.orderOldest'), value: 'oldest' }, { label: t('board.orderVotes'), value: 'votes' }])
const kindFilter = ref('__all__')
const epicFilter = ref('__all__')
const releaseFilter = ref('__all__')
const kindFilterItems = computed(() => [{ label: t('board.anyKind'), value: '__all__' }, ...kindItems.value])
const epicFilterItems = computed(() => [{ label: t('board.anyEpic'), value: '__all__' }, ...epics.value.map(epic => ({ label: parentLabel(epic.id), value: epic.id }))])
const releaseFilterItems = computed(() => [{ label: t('board.anyRelease'), value: '__all__' }, ...releases.value.map(release => ({ label: release.version, value: release.id }))])
const filtering = computed(() => Boolean(search.value.trim() || labelFilter.value.length || assigneeFilter.value !== '__all__' || priorityFilter.value !== '__all__' || roadmapOnly.value || kindFilter.value !== '__all__' || epicFilter.value !== '__all__' || releaseFilter.value !== '__all__'))
function clearFilters() {
  search.value = ''
  labelFilter.value = []
  assigneeFilter.value = '__all__'
  priorityFilter.value = '__all__'
  kindFilter.value = '__all__'
  epicFilter.value = '__all__'
  releaseFilter.value = '__all__'
  roadmapOnly.value = false
}

// ---- saved views ----
// A view is the layout, grouping, order and filters, named and shared by the project (`board.views`). Saving needs the admin role, like the columns.
const savedViews = computed(() => board.value?.views || [])
const savingView = ref(false)
const savingViewNow = ref(false)
const viewName = ref('')
const anyOf = (value: string) => value || '__all__'
const stored = (value: string) => (value === '__all__' ? '' : value)

function applyView(saved: BoardSavedView) {
  view.value = saved.layout
  groupBy.value = saved.group
  order.value = saved.order
  const f = saved.filters
  search.value = f.search
  labelFilter.value = f.labels.filter(label => labelOf(label))
  assigneeFilter.value = anyOf(f.assignee)
  priorityFilter.value = anyOf(f.priority)
  kindFilter.value = anyOf(f.kind)
  // An epic or release deleted since reads as "any", not as an empty board.
  epicFilter.value = epics.value.some(epic => epic.id === f.epic) ? f.epic : '__all__'
  releaseFilter.value = releases.value.some(release => release.id === f.release) ? f.release : '__all__'
  roadmapOnly.value = f.roadmapOnly
}

async function writeViews(views: BoardSavedView[]) {
  actionError.value = ''
  try {
    storeProject((await api<{ project: AdminProject }>(`/admin/projects/${id}`, { method: 'PATCH', body: { board: { views } } })).project)
    return true
  } catch (e: any) {
    actionError.value = e?.message || t('board.saveError')
    return false
  }
}

async function saveView() {
  const name = viewName.value.trim()
  if (!name || savingViewNow.value) return
  savingViewNow.value = true
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'view'
  const saved: BoardSavedView = {
    id: `${slug}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    layout: view.value,
    group: groupBy.value,
    order: order.value,
    filters: { search: search.value.trim(), labels: [...labelFilter.value], assignee: stored(assigneeFilter.value), priority: stored(priorityFilter.value), kind: stored(kindFilter.value), epic: stored(epicFilter.value), release: stored(releaseFilter.value), roadmapOnly: roadmapOnly.value }
  }
  if (await writeViews([...savedViews.value, saved])) { savingView.value = false; viewName.value = '' }
  savingViewNow.value = false
}

const viewMenu = computed(() => [
  savedViews.value.map(saved => ({ label: saved.name, icon: 'i-lucide-bookmark', onSelect: () => applyView(saved) })),
  [
    ...(canManage.value ? [{ label: t('board.saveView'), icon: 'i-lucide-bookmark-plus', onSelect: () => { viewName.value = ''; savingView.value = true } }] : []),
    ...(canManage.value && savedViews.value.length ? [{ label: t('board.deleteView'), icon: 'i-lucide-trash-2', children: savedViews.value.map(saved => ({ label: saved.name, onSelect: () => { void writeViews(savedViews.value.filter(v => v.id !== saved.id)) } })) }] : [])
  ]
].filter(group => group.length))

// ---- columns ----
const defaultStatus = computed(() => (board.value ? defaultFeedbackStatus(board.value).key : ''))
/** A status the board no longer knows sits in the default column. */
const columnOf = (item: BoardItem) => (statusOf(item.status) ? item.status : defaultStatus.value)
const sorted = computed(() => [...items.value].sort((a, b) => a.rank - b.rank || (a.number ?? 0) - (b.number ?? 0)))
// Epics are items; releases are changelog releases. Their cards and progress are read from the loaded items, so every edit moves them at once.
const epics = computed(() => sorted.value.filter(i => i.kind === 'epic'))
const releases = computed(() => releaseRows.value)
const itemById = computed(() => new Map(items.value.map(i => [i.id, i])))
type BoardProgressTotals = { total: number, done: number, estimateTotal: number, estimateDone: number }
const progressById = computed(() => {
  const progress = new Map<string, BoardProgressTotals>()
  for (const item of items.value) {
    for (const parent of new Set([item.epicId, item.releaseId])) {
      if (!parent) continue
      const entry = progress.get(parent) || { total: 0, done: 0, estimateTotal: 0, estimateDone: 0 }
      entry.total++
      entry.estimateTotal += item.estimate ?? 0
      if (item.statusCategory === 'done') { entry.done++; entry.estimateDone += item.estimate ?? 0 }
      progress.set(parent, entry)
    }
  }
  return progress
})
const progressFor = (id: string): BoardProgressTotals => progressById.value.get(id) || { total: 0, done: 0, estimateTotal: 0, estimateDone: 0 }
const progressOf = (item: BoardItem): BoardProgressTotals => progressFor(item.id)
const childrenOf = (parent: BoardItem) => items.value.filter(i => i.id !== parent.id && i.epicId === parent.id)
const releaseLabel = (id: string) => releaseRows.value.find(release => release.id === id)?.version || ''
function parentLabel(itemId: string) {
  const parent = itemById.value.get(itemId)
  return parent ? `${parent.number ? `#${parent.number} ` : ''}${parent.title}` : ''
}
/** The epic and release a card sits in, as chips. */
function parentChips(item: BoardItem) {
  return [
    ...(item.epicId && itemById.value.get(item.epicId) ? [{ key: 'epic', icon: KIND_ICONS.epic, label: itemById.value.get(item.epicId)!.title, title: `${t('board.epic')}: ${parentLabel(item.epicId)}` }] : []),
    ...(item.release ? [{ key: 'release', icon: RELEASE_ICON, label: item.release.title, title: `${t('board.release')}: ${item.release.title}` }] : [])
  ]
}
const ordered = computed(() => {
  if (order.value === 'manual') return sorted.value
  if (order.value === 'votes') return [...sorted.value].sort((a, b) => b.voteCount - a.voteCount || a.rank - b.rank || (a.number ?? 0) - (b.number ?? 0))
  const direction = order.value === 'newest' ? -1 : 1
  return [...sorted.value].sort((a, b) => direction * (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || direction * ((a.number ?? 0) - (b.number ?? 0)))
})

function group(list: BoardItem[]): Record<string, BoardItem[]> {
  return list.reduce<Record<string, BoardItem[]>>((acc, item) => { (acc[columnOf(item)] ||= []).push(item); return acc }, {})
}
const columns = computed(() => group(sorted.value))
const visible = computed(() => {
  let list = ordered.value.filter(item =>
    (!roadmapOnly.value || item.public)
    && (!labelFilter.value.length || item.labels.some(label => labelFilter.value.includes(label)))
    && (assigneeFilter.value === '__all__' || (assigneeFilter.value === 'unassigned' ? !item.assigneeId : item.assigneeId === assigneeFilter.value))
    && (priorityFilter.value === '__all__' || (priorityFilter.value === 'none' ? !item.priority : item.priority === priorityFilter.value))
    && (kindFilter.value === '__all__' || item.kind === kindFilter.value)
    && (epicFilter.value === '__all__' || item.epicId === epicFilter.value)
    && (releaseFilter.value === '__all__' || item.releaseId === releaseFilter.value))
  const text = search.value.trim()
  const number = /^#?(\d+)$/.exec(text)
  if (number) list = list.filter(item => item.number === Number(number[1]))
  else if (text) {
    const hits = new Set(new Fuse(list, { keys: [{ name: 'title', weight: 2 }, 'description', 'publicDescription'], threshold: 0.38, ignoreLocation: true }).search(text).map(r => r.item.id))
    list = list.filter(item => hits.has(item.id))
  }
  return list
})
const visibleByColumn = computed(() => group(visible.value))

function replaceItem(item: BoardItem) {
  const index = items.value.findIndex(i => i.id === item.id)
  if (index === -1) items.value = [...items.value, item]
  else items.value = [...items.value.slice(0, index), item, ...items.value.slice(index + 1)]
}

// ---- kanban or list ----
// The view and the list's grouping are remembered per project in this browser.
type BoardView = 'kanban' | 'list'
type GroupBy = 'status' | 'epic' | 'release'
const VIEWS: { value: BoardView, icon: string }[] = [{ value: 'kanban', icon: 'i-lucide-square-kanban' }, { value: 'list', icon: 'i-lucide-list' }]
const savedView = useLocalStorage<BoardView>(`hb-board-view:${id}`, 'kanban')
const view = computed<BoardView>({
  get: () => (savedView.value === 'list' ? 'list' : 'kanban'),
  set: (value) => { savedView.value = value }
})
const savedGroup = useLocalStorage<GroupBy>(`hb-board-group:${id}`, 'status')
const groupBy = computed<GroupBy>({
  get: () => (savedGroup.value === 'epic' || savedGroup.value === 'release' ? savedGroup.value : 'status'),
  set: (value) => { savedGroup.value = value }
})
const groupByItems = computed(() => (['status', 'epic', 'release'] as const).map(value => ({ label: t(`board.groupByOptions.${value}`), value })))

// Tailwind reads these class strings as written.
const LIST_GRID = 'grid grid-cols-[minmax(14rem,1fr)_9rem_9rem_8rem_7rem_9rem_7rem_4.5rem] items-center gap-2'
/** An estimate field's text as the API takes it: a number of points, null for none. */
const estimateOf = (text: string) => (text.trim() === '' ? null : Number(text))
const CELL_BASE = 'w-full min-w-0 truncate rounded-md border border-transparent px-1.5 py-1 text-[13px] outline-none hover:border-default focus:border-primary'
const CELL = `${CELL_BASE} bg-transparent`

type ListGroup = { key: string, label: string, color?: FeedbackColor, parent?: BoardItem, items: BoardItem[], /** What a row added to this group starts with. */ create: Record<string, string> }
const listGroups = computed<ListGroup[]>(() => {
  const list = visible.value
  let groups: ListGroup[]
  if (groupBy.value === 'status') {
    groups = (board.value?.statuses || []).map(status => ({ key: `status:${status.key}`, label: status.label, color: status.color, items: list.filter(item => columnOf(item) === status.key), create: { status: status.key } }))
  } else {
    const field = groupBy.value === 'epic' ? 'epicId' : 'releaseId'
    const parents = groupBy.value === 'epic'
      ? epics.value.map(epic => ({ id: epic.id, label: parentLabel(epic.id) }))
      : releases.value.map(release => ({ id: release.id, label: release.version }))
    groups = [
      ...parents.map(parent => ({ key: `${groupBy.value}:${parent.id}`, label: parent.label, color: 'primary' as FeedbackColor, parent, items: list.filter(item => item[field] === parent.id), create: { [field]: parent.id } })),
      { key: `${groupBy.value}:none`, label: t(groupBy.value === 'epic' ? 'board.noEpic' : 'board.noRelease'), color: 'neutral' as FeedbackColor, items: list.filter(item => !item[field]), create: {} }
    ]
  }
  // A filter hides the groups it empties.
  return filtering.value ? groups.filter(group => group.items.length) : groups
})
const collapsed = ref(new Set<string>())
const isCollapsed = (key: string) => collapsed.value.has(key)
function toggleGroup(key: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) next.add(key)
  collapsed.value = next
}

/** A list cell saves at once, the way a drop does: shown first, put back if the server refuses. */
async function quickPatch(item: BoardItem, body: Record<string, unknown>, shown: Record<string, unknown> = {}) {
  const snapshot = item
  replaceItem({ ...item, ...body, ...shown } as BoardItem)
  try {
    replaceItem((await api<{ item: BoardItem }>(`/admin/board-items/${item.id}`, { method: 'PATCH', body })).item)
  } catch (e: any) {
    replaceItem(snapshot)
    actionError.value = e?.message || t('board.saveError')
  }
}

function changeStatus(item: BoardItem, status: string) {
  if (!board.value) return
  // Moving statuses also moves the item's done state, which its epic and release count.
  return quickPatch(item, { status }, { statusCategory: feedbackStatusCategory(board.value, status) })
}

const quickTitle = reactive<Record<string, string>>({})
async function quickAdd(group: ListGroup) {
  const title = (quickTitle[group.key] || '').trim()
  if (!title) return
  try {
    const { item } = await api<{ item: BoardItem }>('/admin/board-items', { method: 'POST', query: { project: id }, body: { title, ...group.create } })
    replaceItem(item)
    quickTitle[group.key] = ''
  } catch (e: any) {
    actionError.value = e?.message || t('board.createError')
  }
}

async function loadItems() {
  const [list, releaseList] = await Promise.all([
    api<{ items: BoardItem[] }>('/admin/board-items', { query: { project: id } }),
    api<{ releases: ChangelogRelease[] }>('/admin/changelog/releases', { query: { project: id } })
  ])
  items.value = list.items
  releaseRows.value = releaseList.releases
}

async function loadHistory(reset = true) {
  const itemId = current.value?.id
  if (!itemId || historyLoading.value) return
  if (reset || historyItemId.value !== itemId) {
    itemHistory.value = []
    historyOffset.value = 0
    historyItemId.value = itemId
    historyHasMore.value = false
  }
  historyLoading.value = true
  historyError.value = false
  try {
    const result = await api<{ history: BoardItemHistory[], hasMore: boolean, nextOffset: number | null }>(`/admin/board-items/${itemId}/history`, { query: { project: id, offset: historyOffset.value, limit: 50 } })
    if (current.value?.id !== itemId) return
    itemHistory.value = reset ? result.history : [...itemHistory.value, ...result.history]
    historyHasMore.value = result.hasMore
    historyOffset.value = result.nextOffset ?? historyOffset.value
  } catch {
    historyError.value = true
  } finally {
    historyLoading.value = false
  }
}

function toggleHistory(open: boolean) {
  historyExpanded.value = open
  if (open && (!itemHistory.value.length || historyItemId.value !== current.value?.id || historyError.value)) void loadHistory(true)
}

function historyValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (field === 'status' && typeof value === 'string') return statusOf(value)?.label || value
  if (field === 'epicId' && typeof value === 'string') return itemById.value.get(value)?.title || value
  if (field === 'releaseId' && typeof value === 'string') return releaseLabel(value) || value
  if (field === 'kind' && typeof value === 'string') return t(`board.kinds.${value}`)
  if (field === 'assignee' && typeof value === 'string') return agents.value.find(agent => agent.id === value)?.name || value
  if (field === 'labels' && Array.isArray(value)) return value.map(label => typeof label === 'string' ? labelOf(label)?.label || label : historyValue('', label)).join(', ') || '—'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (Array.isArray(value)) return value.map(item => historyValue('', item)).join(', ') || '—'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
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
  dragOver.value = key
  // Outside manual order a card has no fixed place to drop before: the drop goes to the end of the column.
  if (order.value !== 'manual') { dropBefore.value = ''; return }
  const list = visibleByColumn.value[key] || []
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const after = event.clientY > rect.top + rect.height / 2
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
  // Reordering within a column only means something in manual order.
  if (order.value !== 'manual' && columnOf(item) === status) return
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
const draft = reactive({ title: '', kind: 'task' as BoardItemKind, epicId: 'none', releaseId: 'none', description: '', publicDescription: '', status: '', priority: 'none' as BoardItemPriority | 'none', assigneeId: 'unassigned', labels: [] as string[], attachments: [] as ItemAttachment[], targetDate: '', estimate: '' as number | '', public: false, posts: [] as { id: string, number: number | null, title: string, voteCount: number }[] })
const draftAssignee = computed(() => agents.value.find(agent => agent.id === draft.assigneeId) || null)
const epicItems = computed(() => [{ label: t('board.noEpic'), value: 'none' }, ...epics.value.map(epic => ({ label: parentLabel(epic.id), value: epic.id }))])
const releaseItems = computed(() => [{ label: t('board.noRelease'), value: 'none' }, ...releases.value.map(release => ({ label: release.version, value: release.id }))])
/** The open epic's or release's cards, and the items it can still take. */
const cards = computed(() => (current.value && current.value.kind !== 'task' ? childrenOf(current.value) : []))
const addableCards = computed(() => {
  const open = current.value
  if (!open || open.kind === 'task') return []
  const field = open.kind === 'epic' ? 'epicId' : 'releaseId'
  return items.value
    .filter(item => item.id !== open.id && item[field] !== open.id && kindCanHave(item.kind, open.kind as 'epic' | 'release'))
    .map(item => ({ label: parentLabel(item.id), value: item.id }))
})
const roadmapStatus = computed(() => ROADMAP_CATEGORIES.includes(statusOf(draft.status)?.category || 'open'))
const editorError = ref('')
const savingItem = ref(false)
/** The last change to the open item has landed; the footer says so until the next one starts. */
const savedItem = ref(false)
const writingTitle = ref(false)
/** Which title request counts: a newer one, or closing the editor, makes an older answer stale. */
let titleRun = 0
const writingPublic = ref(false)
let publicRun = 0
const confirmDelete = ref(false)
const linking = ref(false)
const itemHistory = ref<BoardItemHistory[]>([])
const historyLoading = ref(false)
const historyError = ref(false)
const historyHasMore = ref(false)
const historyOffset = ref(0)
const historyItemId = ref('')
const historyExpanded = ref(false)

watch(() => current.value?.id, () => {
  itemHistory.value = []
  historyItemId.value = ''
  historyOffset.value = 0
  historyHasMore.value = false
  historyExpanded.value = false
})

function fill(item: BoardItem | null) {
  Object.assign(draft, {
    title: item?.title || '',
    kind: item?.kind || 'task',
    epicId: item?.epicId || 'none',
    releaseId: item?.releaseId || 'none',
    description: item?.description || '',
    publicDescription: item?.publicDescription || '',
    status: item?.status || defaultStatus.value,
    priority: item?.priority || 'none',
    assigneeId: item?.assigneeId || 'unassigned',
    labels: [...(item?.labels || [])],
    attachments: [...(item?.attachments || [])],
    targetDate: item?.targetDate ? item.targetDate.slice(0, 10) : '',
    estimate: item?.estimate ?? '',
    public: item?.public || false,
    posts: []
  })
  editorError.value = ''
  confirmDelete.value = false
  savedItem.value = false
  restored.value = false
}

// ---- the new item's unsaved draft ----
// Kept in this browser while the panel is a new item, and brought back the next time it opens.
type DraftSnapshot = Pick<typeof draft, 'title' | 'description' | 'publicDescription' | 'status' | 'priority' | 'assigneeId' | 'labels' | 'attachments' | 'targetDate' | 'estimate' | 'public' | 'posts'>
const saved = useSavedDraft<Partial<DraftSnapshot>>(() => `hb-draft:board:${id}`)
const restored = ref(false)

const hasDraftContent = () => Boolean(draft.title.trim() || draft.description.trim() || draft.publicDescription.trim() || draft.labels.length || draft.attachments.length || draft.posts.length || draft.targetDate || draft.estimate !== '')

watch(draft, () => {
  if (!editorOpen.value || current.value) return
  saved.schedule(() => (hasDraftContent() ? JSON.parse(JSON.stringify(draft)) as DraftSnapshot : null))
}, { deep: true })

/** What was saved, kept to what the board still knows (a status or label may have been removed since). */
function restoreDraft(snapshot: Partial<DraftSnapshot>) {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  Object.assign(draft, {
    title: text(snapshot.title),
    description: text(snapshot.description),
    publicDescription: text(snapshot.publicDescription),
    status: snapshot.status && statusOf(snapshot.status) ? snapshot.status : defaultStatus.value,
    priority: (['low', 'normal', 'high', 'urgent'] as const).find(p => p === snapshot.priority) || 'none',
    assigneeId: snapshot.assigneeId && agents.value.some(agent => agent.id === snapshot.assigneeId) ? snapshot.assigneeId : 'unassigned',
    labels: (Array.isArray(snapshot.labels) ? snapshot.labels : []).filter(label => labelOf(label)),
    attachments: Array.isArray(snapshot.attachments) ? snapshot.attachments : [],
    targetDate: /^\d{4}-\d{2}-\d{2}$/.test(text(snapshot.targetDate)) ? text(snapshot.targetDate) : '',
    estimate: typeof snapshot.estimate === 'number' ? snapshot.estimate : '',
    public: snapshot.public === true,
    posts: Array.isArray(snapshot.posts) ? snapshot.posts : []
  })
}

function discardDraft() {
  saved.clear()
  fill(null)
  restored.value = false
}

function openItem(itemId: string) {
  void router.replace({ query: { ...route.query, item: itemId } })
}

function openNew() {
  titleRun++
  writingTitle.value = false
  publicRun++
  writingPublic.value = false
  editingId.value = ''
  const snapshot = saved.read()
  fill(null)
  restored.value = false
  if (snapshot) {
    restoreDraft(snapshot)
    restored.value = hasDraftContent()
  }
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
  // A field still being edited saves with the panel closing, not only on blur.
  flushText()
  titleRun++
  writingTitle.value = false
  publicRun++
  writingPublic.value = false
  editingId.value = ''
  if (route.query.item) void router.replace({ query: { ...route.query, item: undefined } })
})

/** Existing items save field by field, the way Linear's do. */
async function patch(body: Record<string, unknown>) {
  if (!current.value) return
  savingItem.value = true
  savedItem.value = false
  editorError.value = ''
  try {
    replaceItem((await api<{ item: BoardItem }>(`/admin/board-items/${current.value.id}`, { method: 'PATCH', body })).item)
    savedItem.value = true
    if (historyExpanded.value) await loadHistory(true)
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

/** Puts the type, epic and release pickers back to what the server holds (after a refusal, or a change that clears one). */
function resetParents() {
  const item = current.value
  if (item) Object.assign(draft, { kind: item.kind, epicId: item.epicId || 'none', releaseId: item.releaseId || 'none' })
}

async function changeKind() {
  // Only a card has an epic: the server clears it too.
  if (!kindCanHave(draft.kind, 'epic')) draft.epicId = 'none'
  if (!current.value) return
  await patch({ kind: draft.kind })
  resetParents()
}

async function setParent(field: 'epicId' | 'releaseId') {
  if (!current.value) return
  await patch({ [field]: draft[field] === 'none' ? '' : draft[field] })
  resetParents()
}

/**
 * An epic named in its picker is created now, and the item takes it. A release is a changelog release: the
 * name picks the release with that version, or creates a draft one, which the changelog lists at once.
 */
async function createParent(kind: 'epic' | 'release', name: string) {
  const title = name.trim().slice(0, kind === 'release' ? CHANGELOG_VERSION_MAX_LENGTH : 200)
  if (!title) return
  try {
    if (kind === 'release') {
      const same = releaseRows.value.find(release => release.version.trim().toLowerCase() === title.toLowerCase())
      const release = same || (await api<{ release: ChangelogRelease }>('/admin/changelog/releases', { method: 'POST', query: { project: id }, body: { version: title } })).release
      if (!same) releaseRows.value = [release, ...releaseRows.value]
      draft.releaseId = release.id
      await setParent('releaseId')
      return
    }
    const { item } = await api<{ item: BoardItem }>('/admin/board-items', { method: 'POST', query: { project: id }, body: { kind, title } })
    replaceItem(item)
    draft.epicId = item.id
    await setParent('epicId')
  } catch (e: any) {
    editorError.value = e?.message || t('board.createError')
  }
}

/** Puts an item into the open epic or release; it leaves the one it was in. */
function addCard(cardId: string) {
  const open = current.value
  const card = items.value.find(item => item.id === cardId)
  if (open && card) void quickPatch(card, { [open.kind === 'epic' ? 'epicId' : 'releaseId']: open.id })
}

/** Saves every text field that changed in one request. */
function flushText() {
  const item = current.value
  if (!item) return
  const body: Record<string, unknown> = {}
  for (const key of ['title', 'description', 'publicDescription'] as const) {
    const value = draft[key].trim()
    if (key === 'title' && !value) continue
    if (value !== item[key]) body[key] = value
  }
  if (Object.keys(body).length) void patch(body)
}

/** Cmd or Ctrl and Enter: creates the new item, or saves what is being typed in an existing one. */
function submitShortcut() {
  if (current.value) flushText()
  else void createItem()
}

/** A label typed into the picker joins the board's labels, then the item takes it (saved with the item, or now if it exists). */
async function createLabel(name: string) {
  const label = name.trim().slice(0, 60)
  const key = normalizeFeedbackKey(label)
  if (!key || !board.value) return
  if (!board.value.labels.some(l => l.key === key)) {
    try {
      storeProject((await api<{ project: AdminProject }>(`/admin/projects/${id}`, { method: 'PATCH', body: { board: { labels: [...board.value.labels, { key, label, color: 'neutral' }] } } })).project)
    } catch (e: any) {
      editorError.value = e?.message || t('board.saveError')
      return
    }
  }
  if (!draft.labels.includes(key)) draft.labels.push(key)
  if (current.value) await patch({ labels: draft.labels })
}

/**
 * The AI reads the description and writes the title (shown in the field while it works).
 * `manual` is the AI button: it replaces a title and says why when it fails. Otherwise a title typed in the meantime stays.
 */
async function writeTitle({ manual = false } = {}) {
  const description = draft.description.trim()
  if (!description) return
  const run = ++titleRun
  writingTitle.value = true
  if (manual) editorError.value = ''
  try {
    const { title } = await api<{ title: string }>('/admin/board-items/suggest-title', { method: 'POST', query: { project: id }, body: { description } })
    if (run !== titleRun || (!manual && draft.title.trim())) return
    draft.title = title
    if (current.value) saveText('title')
  } catch (e: any) {
    if (manual && run === titleRun) editorError.value = e?.message || t('board.titleWriteError')
  } finally {
    if (run === titleRun) writingTitle.value = false
  }
}

/** The AI button on the public description: writes the roadmap's text from the title and internal description, replacing it. */
async function writePublicDescription() {
  const description = draft.description.trim()
  if (!description) return
  const run = ++publicRun
  writingPublic.value = true
  editorError.value = ''
  try {
    const { publicDescription } = await api<{ publicDescription: string }>('/admin/board-items/suggest-public-description', { method: 'POST', query: { project: id }, body: { title: draft.title, description } })
    if (run !== publicRun) return
    draft.publicDescription = publicDescription
    if (current.value) saveText('publicDescription')
  } catch (e: any) {
    if (run === publicRun) editorError.value = e?.message || t('board.publicDescriptionWriteError')
  } finally {
    if (run === publicRun) writingPublic.value = false
  }
}

// A new item with no title gets one a second after the description stops changing.
watchDebounced(() => draft.description, () => {
  if (current.value || !editorOpen.value || draft.title.trim() || !draft.description.trim()) return
  void writeTitle()
}, { debounce: BOARD_TITLE_DEBOUNCE_MS })

async function createItem() {
  if (savingItem.value || (!draft.title.trim() && !draft.description.trim())) return
  savingItem.value = true
  editorError.value = ''
  try {
    // Create with no title: the AI writes it now; with no AI, the description's first line stands in.
    if (!draft.title.trim()) {
      await writeTitle()
      if (!draft.title.trim()) draft.title = fallbackBoardTitle(draft.description)
    }
    const { item } = await api<{ item: BoardItem }>('/admin/board-items', {
      method: 'POST',
      query: { project: id },
      body: {
        title: draft.title,
        kind: draft.kind,
        epicId: draft.epicId === 'none' ? '' : draft.epicId,
        releaseId: draft.releaseId === 'none' ? '' : draft.releaseId,
        description: draft.description,
        publicDescription: draft.publicDescription,
        status: draft.status,
        priority: draft.priority === 'none' ? '' : draft.priority,
        assigneeId: draft.assigneeId === 'unassigned' ? '' : draft.assigneeId,
        labels: draft.labels,
        attachments: draft.attachments,
        targetDate: draft.targetDate || null,
        estimate: estimateOf(String(draft.estimate)),
        public: draft.public,
        feedbackPostIds: draft.posts.map(post => post.id)
      }
    })
    replaceItem(item)
    saved.clear()
    restored.value = false
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
    const grouping = current.value.kind !== 'task'
    await api(`/admin/board-items/${itemId}`, { method: 'DELETE' })
    items.value = items.value.filter(i => i.id !== itemId)
    // An epic or release leaves its cards free of it: read them again.
    if (grouping) await loadItems()
    editorOpen.value = false
  } catch (e: any) {
    editorError.value = e?.message || t('board.deleteError')
  }
}

async function setLink(kind: 'feedback' | 'conversation' | 'item', targetId: string, linked: boolean) {
  if (!current.value) return
  linking.value = true
  editorError.value = ''
  try {
    replaceItem((await api<{ item: BoardItem }>(`/admin/board-items/${current.value.id}/links`, { method: 'POST', body: { kind, id: targetId, linked } })).item)
    if (historyExpanded.value) await loadHistory(true)
    // A related item is linked on the other side too, so the list is read again.
    if (kind === 'item') await loadItems()
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
