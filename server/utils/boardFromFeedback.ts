import { extractJson } from '#shared/legal/compose'
import { feedbackPlainText } from '#shared/feedback'
import { boardDraftSystemPrompt, boardDraftUserMessage, readBoardItemDrafts, type BoardItemDraft } from '#shared/boardFromFeedback'
import type { ClientSource } from './clientSource'

// Files planning items from a feedback post and links each to it. With an AI provider configured the
// model decides whether the post is one piece of work or several and writes each item's title,
// description, urgency and labels; without one, or when it fails, there is one item with the post's
// own title and text, so the button always works.

export type BoardItemsFromFeedback = { rows: ParseObject[], ai: boolean }

/** The AI's drafts for a post (one, or several when it holds separate pieces of work), or none when no AI is configured or its answer was unusable. */
async function draftWithAi(member: MemberContext, project: ParseObject, post: ParseObject): Promise<BoardItemDraft[]> {
  const route = await resolveAi(member.workspace)
  if (!route) return []
  await rateLimit(`sb:rl:boarddraft:${member.agentId}`, LIMITS.boardDraftPerAgent.limit, LIMITS.boardDraftPerAgent.window)
  const labels = getBoardConfig(project).labels
  const source = {
    title: String(post.get('title') || ''),
    body: feedbackPlainText(post.get('body'), 8000),
    type: String(post.get('type') || ''),
    voteCount: Number(post.get('voteCount') || 0),
    commentCount: Number(post.get('commentCount') || 0),
    tags: Array.isArray(post.get('tags')) ? (post.get('tags') as unknown[]).map(String) : []
  }
  try {
    const { text } = await chatCompletion(route, {
      messages: [{ role: 'system', content: boardDraftSystemPrompt(labels) }, { role: 'user', content: boardDraftUserMessage(source) }],
      temperature: 0.2,
      max_tokens: 4000
    }, { timeoutMs: 60_000 })
    const parsed = extractJson(text)
    return parsed ? readBoardItemDrafts(parsed, labels) : []
  } catch (error) {
    console.error('[board] AI draft failed, using the post as it is', (error as Error).message)
    return []
  }
}

export async function createBoardItemsFromFeedback(member: MemberContext, project: ParseObject, postRef: string, options: { ai?: boolean, source?: ClientSource } = {}): Promise<BoardItemsFromFeedback> {
  const post = await findFeedbackPost(project, String(postRef || '').trim().replace(/^#/, ''))
  if (!post) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  const drafts = options.ai === false ? [] : await draftWithAi(member, project, post)
  const title = String(post.get('title') || '').trim().slice(0, 200) || 'Untitled'
  // The copy of the post, when there is no AI draft.
  const plain = { title, description: String(post.get('body') || '').trim().slice(0, 20_000), priority: '', labels: [] as string[] }
  const rows: ParseObject[] = []
  for (const draft of drafts.length ? drafts : [plain]) {
    rows.push(await createBoardItem(project, member.agent, {
      title: draft.title,
      description: draft.description,
      ...(draft.priority ? { priority: draft.priority } : {}),
      ...(draft.labels.length ? { labels: draft.labels } : {}),
      feedbackPostIds: [post.id]
    }, options.source))
  }
  return { rows, ai: drafts.length > 0 }
}
