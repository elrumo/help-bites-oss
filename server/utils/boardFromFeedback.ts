import { extractJson } from '#shared/legal/compose'
import { feedbackPlainText } from '#shared/feedback'
import { boardDraftSystemPrompt, boardDraftUserMessage, readBoardItemDraft, type BoardItemDraft } from '#shared/boardFromFeedback'

// Files a planning item from a feedback post and links the two. With an AI provider configured the
// model writes the title, description, urgency and labels; without one, or when it fails, the item
// is the post's own title and text, so the button always works.

export type BoardItemFromFeedback = { row: ParseObject, ai: boolean }

/** The AI's draft for a post, or null when no AI is configured or its answer was unusable. */
async function draftWithAi(member: MemberContext, project: ParseObject, post: ParseObject): Promise<BoardItemDraft | null> {
  const route = await resolveAi(member.workspace)
  if (!route) return null
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
      max_tokens: 2000
    }, { timeoutMs: 60_000 })
    const parsed = extractJson(text)
    return parsed ? readBoardItemDraft(parsed, labels) : null
  } catch (error) {
    console.error('[board] AI draft failed, using the post as it is', (error as Error).message)
    return null
  }
}

export async function createBoardItemFromFeedback(member: MemberContext, project: ParseObject, postRef: string, options: { ai?: boolean } = {}): Promise<BoardItemFromFeedback> {
  const post = await findFeedbackPost(project, String(postRef || '').trim().replace(/^#/, ''))
  if (!post) throw createError({ statusCode: 404, statusMessage: 'Post not found' })
  const draft = options.ai === false ? null : await draftWithAi(member, project, post)
  const title = String(post.get('title') || '').trim().slice(0, 200)
  const row = await createBoardItem(project, member.agent, {
    title: draft?.title || title || 'Untitled',
    description: draft ? draft.description : String(post.get('body') || '').trim().slice(0, 20_000),
    ...(draft?.priority ? { priority: draft.priority } : {}),
    ...(draft?.labels.length ? { labels: draft.labels } : {}),
    feedbackPostIds: [post.id]
  })
  return { row, ai: Boolean(draft) }
}
