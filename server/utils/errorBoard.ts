import { createError } from 'h3'
import { BOARD_ERROR_REFS_MAX, errorRefKey, readErrorRefs, type BoardErrorRef } from '#shared/board'
import { errorBoardDraft, errorDetailOf, flattenEvent, trackerIssueUrl } from '#shared/errors'
import { createBoardItem, getBoardConfig, linkBoardItem } from './board'
import { emitDomainEvent } from './domainEvents'
import { errorConversationKey, errorIssueDetail, issuesUrlOf, providerOf, MAIN_LINK, type ErrorConfig } from './errorTracking'
import type { ParseObject } from './parse'

// "File on board": an error from the tracker becomes a board item, once. The
// item remembers which issue it came from (`errorRefs`, with the tracker link;
// `errorKeys` is the same issues as plain strings, which is what a second
// press looks up), and when the error already has a conversation in the inbox
// that is linked too, so the team sees one thread on both sides.

export type FiledError = { item: ParseObject, created: boolean }

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

/** The item an issue was filed as, if any. */
export async function findFiledError(project: ParseObject, link: ErrorConfig, issueId: string): Promise<ParseObject | undefined> {
  return await new (useParse()).Query('BoardItem').equalTo('project', project).equalTo('errorKeys', errorRefKey(providerOf(link).id, issueId)).first(MASTER)
}

async function linkErrorConversation(project: ParseObject, agent: ParseObject, item: ParseObject, link: ErrorConfig, issueId: string): Promise<string> {
  const conversation = await new (useParse()).Query('Conversation').equalTo('project', project).equalTo('idempotencyKey', errorConversationKey(providerOf(link).id, issueId)).first(MASTER)
  if (!conversation) return ''
  try {
    await linkBoardItem(project, agent, item, 'conversation', conversation.id || '', true)
  } catch (error) {
    // The item exists either way; a conversation it could not take is not worth failing the filing.
    console.warn('[errors] could not link the error conversation to the board item:', (error as Error).message)
  }
  return conversation.id || ''
}

/**
 * File an issue of one of the project's tracker links as a board item (the
 * board's first status). Idempotent: an issue already filed answers with its
 * item. The board must be switched on.
 */
export async function fileErrorOnBoard(project: ParseObject, agent: ParseObject, link: ErrorConfig, issueId: string): Promise<FiledError> {
  if (!getBoardConfig(project).enabled) badRequest('Turn the project board on first (Board → Settings).')
  const providerId = providerOf(link).id
  const key = errorRefKey(providerId, issueId)

  // Two people pressing at once file one item.
  const held = await runExclusive(`sb:errboard:${project.id}:${key}`, 30, async (): Promise<FiledError> => {
    const existing = await findFiledError(project, link, issueId)
    if (existing) {
      await linkErrorConversation(project, agent, existing, link, issueId)
      return { item: existing, created: false }
    }
    const { issue, event } = await errorIssueDetail(project, providerId, issueId, link.linkId)
    const url = trackerIssueUrl(providerId, issuesUrlOf(link), issueId)
    const draft = errorBoardDraft(issue, errorDetailOf(issue, flattenEvent(event)), { providerName: providerOf(link).name, url })
    const item = await createBoardItem(project, agent, { title: draft.title, description: draft.description })
    const ref: BoardErrorRef = { provider: providerId, issueId, linkId: link.linkId || MAIN_LINK, title: draft.title, url }
    item.set('errorRefs', [ref].slice(0, BOARD_ERROR_REFS_MAX))
    item.set('errorKeys', [key])
    await item.save(null, MASTER)
    const conversationId = await linkErrorConversation(project, agent, item, link, issueId)
    await emitDomainEvent(project, 'errors.filed_on_board', { itemId: item.id, number: item.get('number') ?? null, provider: providerId, issueId, linkId: ref.linkId, conversationId: conversationId || null })
    return { item, created: true }
  }, { failOpen: true, waitMs: 5000 })
  if (!held.ran) throw createError({ statusCode: 409, statusMessage: 'This error is being filed right now. Try again in a moment.' })
  return held.value
}

/** Refs as stored on an item, for callers that only have the row. */
export const errorRefsOf = (item: ParseObject): BoardErrorRef[] => readErrorRefs(item.get('errorRefs'))
