<template>
  <div class="space-y-4">
    <div class="flex items-center gap-3">
      <p class="min-w-0 flex-1 text-[13px] text-muted"><slot name="description">{{ $t('workspaceSettings.team.description') }}</slot></p>
      <template v-if="canManage && !adding">
        <UButton icon="i-lucide-mail-plus" :label="$t('workspaceSettings.team.invite')" color="neutral" variant="outline" size="sm" @click="adding = 'invite'" />
        <UButton v-if="features.teammatePasswords" icon="i-lucide-user-plus" :label="addLabelText" color="neutral" variant="ghost" size="sm" @click="adding = 'account'" />
      </template>
    </div>

    <!-- Invite by email: works everywhere, and is the only way on the hosted edition. -->
    <form v-if="adding === 'invite'" class="space-y-4 rounded-xl border border-default p-4" @submit.prevent="invite">
      <div class="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <UFormField :label="$t('workspaceSettings.team.email')" required><UInput v-model="inviteForm.email" type="email" class="w-full" required autofocus /></UFormField>
        <UFormField :label="$t('workspaceSettings.team.role')"><USelect v-model="inviteForm.role" :items="roleItems" class="w-full" /></UFormField>
      </div>
      <p class="text-xs text-muted">{{ $t('workspaceSettings.team.inviteNote') }}</p>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="adding = ''">{{ $t('common.cancel') }}</UButton>
        <UButton type="submit" :loading="saving">{{ $t('workspaceSettings.team.sendInvitation') }}</UButton>
      </div>
    </form>

    <!-- Make the account yourself and hand over the password (one-team installs). -->
    <form v-if="adding === 'account'" class="space-y-4 rounded-xl border border-default p-4" @submit.prevent="add">
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="$t('common.name')"><UInput v-model="form.name" class="w-full" autofocus /></UFormField>
        <UFormField :label="$t('workspaceSettings.team.email')" :hint="$t('workspaceSettings.team.emailHint')"><UInput v-model="form.email" type="email" class="w-full" /></UFormField>
        <UFormField :label="$t('workspaceSettings.team.username')" required><UInput v-model="form.username" class="w-full" required autocomplete="off" /></UFormField>
        <UFormField :label="$t('workspaceSettings.team.password')" :hint="$t('workspaceSettings.team.passwordHint')" required><UInput v-model="form.password" type="password" class="w-full" required minlength="8" autocomplete="new-password" /></UFormField>
        <UFormField :label="$t('workspaceSettings.team.role')"><USelect v-model="form.role" :items="roleItems" class="w-full" /></UFormField>
      </div>
      <p class="text-xs text-muted">{{ $t('workspaceSettings.team.accountNote') }}</p>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="adding = ''">{{ $t('common.cancel') }}</UButton>
        <UButton type="submit" :loading="saving">{{ addLabelText }}</UButton>
      </div>
    </form>

    <div v-if="inviteLink" class="space-y-2 rounded-xl border border-default bg-elevated p-4">
      <p class="text-[13px] text-highlighted">{{ inviteLink.emailed ? $t('workspaceSettings.team.invitationSent') : $t('workspaceSettings.team.sendLink') }}</p>
      <div class="flex gap-2">
        <UInput :model-value="inviteLink.url" readonly class="min-w-0 flex-1 font-mono" size="sm" />
        <UButton icon="i-lucide-copy" color="neutral" variant="outline" size="sm" :label="$t('workspaceSettings.copy')" @click="copy(inviteLink.url)" />
      </div>
    </div>
    <p v-if="error" class="text-[13px] text-error">{{ error }}</p>

    <div v-if="loading" class="space-y-2"><USkeleton v-for="i in 3" :key="i" class="h-12" /></div>
    <ul v-else class="divide-y divide-default overflow-hidden rounded-xl border border-default">
      <li v-for="member in members" :key="member.id" class="flex min-h-14 items-center gap-3 px-4 py-2">
        <UAvatar :text="initials(member)" size="sm" class="shrink-0" />
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="truncate text-[13px] font-medium text-highlighted">{{ member.name || member.username }}</span>
            <UBadge v-if="member.id === me?.id" size="xs" color="neutral" variant="subtle">{{ $t('workspaceSettings.team.you') }}</UBadge>
          </span>
          <span class="block truncate text-xs text-muted">{{ [member.username, member.email].filter(Boolean).join(' · ') }}</span>
        </span>
        <USelect
          v-if="canManage && member.id !== me?.id && canChange(member)"
          :model-value="member.role"
          :items="roleItems"
          size="xs"
          class="w-24 shrink-0"
          :aria-label="$t('workspaceSettings.team.roleOf', { name: member.name || member.username })"
          @update:model-value="setRole(member, $event)"
        />
        <span v-else class="shrink-0 text-xs text-muted">{{ ROLE_LABELS[member.role] }}</span>
        <UTooltip v-if="removable && canManage && member.id !== me?.id && canChange(member)" :text="$t('workspaceSettings.team.removeTooltip')">
          <UButton icon="i-lucide-user-minus" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('workspaceSettings.removeNamed', { name: member.name || member.username })" @click="remove(member)" />
        </UTooltip>
      </li>
      <li v-for="inv in invitations" :key="inv.id" class="flex min-h-14 items-center gap-3 px-4 py-2">
        <UAvatar icon="i-lucide-mail" size="sm" class="shrink-0" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-medium text-highlighted">{{ inv.email }}</span>
          <span class="block truncate text-xs text-muted">{{ inv.invitedBy ? $t('workspaceSettings.team.invitedBy', { name: inv.invitedBy }) : $t('workspaceSettings.team.invited') }} · {{ ROLE_LABELS[inv.role] }}</span>
        </span>
        <UTooltip :text="$t('workspaceSettings.team.revokeInvitation')">
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square class="text-muted" :aria-label="$t('workspaceSettings.team.revokeInvitationAria', { email: inv.email })" @click="revoke(inv)" />
        </UTooltip>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { can, canGrant, ROLE_LABELS, ROLES, type Role } from '#shared/roles'

// The workspace's team: who is in it and as what (shared/roles.ts), plus the
// invitations still waiting for an answer.
type Member = { id: string, username: string, email: string, name: string, role: Role }
type Invitation = { id: string, email: string, role: Role, invitedBy: string }

const props = withDefaults(defineProps<{ removable?: boolean, addLabel?: string }>(), { removable: true })

const { t } = useI18n()
const addLabelText = computed(() => props.addLabel ?? t('workspaceSettings.team.addWithPassword'))

const { api, agent: me, context } = useAgent()
const myRole = computed<Role>(() => context.value?.role || 'agent')
const canManage = computed(() => can(myRole.value, 'team.manage'))
const features = computed(() => context.value?.features || {})
const roleItems = computed(() => ROLES.filter(role => canGrant(myRole.value, role)).map(role => ({ label: ROLE_LABELS[role], value: role })))

const members = ref<Member[]>([])
const invitations = ref<Invitation[]>([])
const loading = ref(true)
const adding = ref<'' | 'invite' | 'account'>('')
const saving = ref(false)
const error = ref('')
const inviteLink = ref<{ url: string, emailed: boolean } | null>(null)
const form = reactive({ name: '', email: '', username: '', password: '', role: 'admin' as Role })
const inviteForm = reactive({ email: '', role: 'agent' as Role })

function initials(member: Member) {
  return (member.name || member.username || '?').split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase()
}

/** Only owners touch owners. */
function canChange(member: Member) {
  return member.role !== 'owner' || myRole.value === 'owner'
}

async function load() {
  try {
    members.value = (await api<{ agents: Member[] }>('/admin/agents')).agents
    if (canManage.value) invitations.value = (await api<{ invitations: Invitation[] }>('/admin/invitations')).invitations
  } catch (e: any) {
    error.value = e?.message || t('workspaceSettings.team.loadFailed')
  } finally {
    loading.value = false
  }
}

async function add() {
  saving.value = true
  error.value = ''
  try {
    await api('/admin/agents', { method: 'POST', body: form })
    Object.assign(form, { name: '', email: '', username: '', password: '', role: 'admin' })
    adding.value = ''
    await load()
  } catch (e: any) {
    error.value = e?.message || t('workspaceSettings.team.addFailed')
  } finally {
    saving.value = false
  }
}

async function invite() {
  saving.value = true
  error.value = ''
  try {
    const result = await api<{ url: string, emailed: boolean }>('/admin/invitations', { method: 'POST', body: inviteForm })
    inviteLink.value = { url: result.url, emailed: result.emailed }
    Object.assign(inviteForm, { email: '', role: 'agent' })
    adding.value = ''
    await load()
  } catch (e: any) {
    error.value = e?.message || t('workspaceSettings.team.inviteFailed')
  } finally {
    saving.value = false
  }
}

async function setRole(member: Member, role: Role) {
  error.value = ''
  try {
    const { agent } = await api<{ agent: Member }>(`/admin/agents/${member.id}`, { method: 'PATCH', body: { role } })
    member.role = agent.role
  } catch (e: any) {
    error.value = e?.message || t('workspaceSettings.team.roleFailed')
  }
}

async function remove(member: Member) {
  if (!confirm(t('workspaceSettings.team.removeConfirm', { name: member.name || member.username }))) return
  error.value = ''
  try {
    await api(`/admin/agents/${member.id}`, { method: 'DELETE' })
    members.value = members.value.filter(item => item.id !== member.id)
  } catch (e: any) {
    error.value = e?.message || t('workspaceSettings.team.removeFailed')
  }
}

async function revoke(inv: Invitation) {
  error.value = ''
  try {
    await api(`/admin/invitations/${inv.id}`, { method: 'DELETE' })
    invitations.value = invitations.value.filter(item => item.id !== inv.id)
  } catch (e: any) {
    error.value = e?.message || t('workspaceSettings.team.revokeFailed')
  }
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch {}
}

onMounted(load)
</script>
