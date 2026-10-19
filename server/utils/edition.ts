// The seam between the two editions. Wherever community and cloud behave
// differently, core code asks `edition()`; the community answers live here,
// and the cloud build's ee/ layer replaces them by calling registerEdition()
// from a Nitro plugin at boot. Core never imports ee/ (the community image
// does not even contain it), so every difference has to pass through here.

import { UNLIMITED_PLAN, type Plan } from '#shared/entitlements'

export type EditionId = 'community' | 'cloud'

export type EditionPolicy = {
  /** 'setup': the first visitor creates the operator account, teammates are added from the panel. 'open': anyone signs up. */
  signup: 'setup' | 'open'
  /** An admin may create a teammate's account with a password (else teammates come in by invitation only). */
  teammatePasswords: boolean
  /** Removing someone from their last workspace deletes their account (one-team installs), rather than leaving it to sign in to nothing. */
  removeAccountWithLastMembership: boolean
  /** The server's own GLITCHTIP_* and BUGSINK_* env back every workspace that has not set up a tracker of its own. */
  trackerEnvFallback: boolean
  /** Inviting, sending email and creating API keys wait until the workspace owner has confirmed their email address. */
  requireVerifiedEmail: boolean
  /** Bulk mail (campaigns, sequences) pauses for a workspace whose bounces or spam complaints run high (server/utils/emailReputation.ts). */
  reputationGuard: boolean
}

export type EditionHooks = {
  id: EditionId
  policy: EditionPolicy
  /** Whether this operator may create another workspace: true, or the reason they may not. */
  canCreateWorkspace(agent: ParseObject): Promise<true | string>
  /** The plan a workspace is on. Absent: every workspace is unlimited, and nothing loads the workspace to find out. */
  planFor?: (workspace: ParseObject) => Plan | Promise<Plan>
  /** What one call to the platform's AI gateway costs, in credits (0: AI is not metered). */
  aiCredits(call: AiCall): number
  /** Where the "Powered by HelpBites" badge links to. */
  brandUrl: string
  /** Who mail appears to come from; the cloud edition sends from its shared domain. Absent: the project's own settings. */
  rewriteSender?: (sender: EmailSender, project: ParseObject | null) => EmailSender
  /** Called when an owner deletes a workspace, before its data goes (the cloud edition cancels the subscription). */
  onWorkspaceDeleting?: (workspace: ParseObject) => Promise<void>
  /** More for /v1/admin/me, under `extras` (verification, billing state, super-admin). */
  meExtras?: (identity: AgentContext, member: MemberContext | null) => Promise<Record<string, unknown>>
}

/** One finished model call, as aiGateway.ts reports it. `costUsd` is the gateway's own figure when it sends one. */
export type AiCall = { model: string, inputTokens: number, outputTokens: number, costUsd?: number | null }

const COMMUNITY: EditionHooks = {
  id: 'community',
  policy: { signup: 'setup', teammatePasswords: true, removeAccountWithLastMembership: true, trackerEnvFallback: true, requireVerifiedEmail: false, reputationGuard: false },
  canCreateWorkspace: async () => true,
  aiCredits: () => 0,
  brandUrl: 'https://github.com/elrumo/help-bites'
}

let current: EditionHooks = COMMUNITY

/** Replace the community defaults; only what is passed changes. */
export function registerEdition(hooks: Partial<Omit<EditionHooks, 'policy'>> & { id: EditionId, policy?: Partial<EditionPolicy> }): void {
  current = { ...COMMUNITY, ...hooks, policy: { ...COMMUNITY.policy, ...hooks.policy } }
}

export function edition(): EditionHooks {
  return current
}

/** The plan a workspace is on (UNLIMITED_PLAN unless the edition says otherwise). */
export async function planFor(workspace: ParseObject | null | undefined): Promise<Plan> {
  const resolve = current.planFor
  return resolve && workspace ? await resolve(workspace) : UNLIMITED_PLAN
}

/** Back to the community defaults (tests). */
export function resetEdition(): void {
  current = COMMUNITY
}

const REPOSITORY = 'https://github.com/elrumo/help-bites'

/**
 * Where this deployment's source lives. The AGPL asks a modified network
 * deployment to offer its users the source it runs, so a fork sets
 * SOURCE_CODE_URL to its own repository; with GIT_SHA set, a GitHub URL points
 * at the exact commit.
 */
export function sourceCodeUrl(env: Record<string, string | undefined> = process.env): string {
  const base = String(env.SOURCE_CODE_URL || '').trim().replace(/\/+$/, '') || REPOSITORY
  const sha = String(env.GIT_SHA || '').trim()
  return sha && /^[0-9a-f]{7,40}$/i.test(sha) && /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(base) ? `${base}/tree/${sha}` : base
}
