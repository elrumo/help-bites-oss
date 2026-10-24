import type { BoardItem } from '#shared/board'

type PostRef = { id: string, number?: number | null, title: string }

// Filing a feedback post on the planning board: a new item written by the AI (or copied from the post
// when no AI is set up) or an item that exists. The post stays linked to every item it feeds.
export function useFeedbackPlanning(projectId: string) {
  const { api, projects } = useAgent()
  const toast = useToast()
  const { t } = useI18n()

  const enabled = computed(() => projects.value.find(p => p.id === projectId)?.board?.enabled === true)
  const itemLink = (item: BoardItem) => `/projects/${projectId}/board?item=${item.id}`
  const itemName = (item: BoardItem) => `${item.number ? `#${item.number} ` : ''}${item.title}`

  /** A new item for the post, linked to it. Resolves to null (after a toast) when it could not be made. */
  async function createFor(post: PostRef): Promise<BoardItem | null> {
    try {
      const { item, ai } = await api<{ item: BoardItem, ai: boolean }>('/admin/board-items/from-feedback', { method: 'POST', query: { project: projectId }, body: { postId: post.id } })
      toast.add({
        title: t('feedbackPlan.created', { name: itemName(item) }),
        description: ai ? t('feedbackPlan.createdAi') : t('feedbackPlan.createdPlain'),
        icon: ai ? 'i-lucide-sparkles' : 'i-lucide-square-kanban',
        color: 'success',
        actions: [{ label: t('feedbackPlan.open'), onClick: () => { void navigateTo(itemLink(item)) } }]
      })
      return item
    } catch (e: any) {
      toast.add({ title: t('feedbackPlan.createFailed'), description: e?.message, icon: 'i-lucide-circle-alert', color: 'error' })
      return null
    }
  }

  /** Links the post to an existing item. Resolves to the item, or null after a toast. */
  async function attachTo(itemId: string, post: PostRef): Promise<BoardItem | null> {
    try {
      const { item } = await api<{ item: BoardItem }>(`/admin/board-items/${itemId}/links`, { method: 'POST', body: { kind: 'feedback', id: post.id, linked: true } })
      toast.add({
        title: t('feedbackPlan.attached', { name: itemName(item) }),
        icon: 'i-lucide-link',
        color: 'success',
        actions: [{ label: t('feedbackPlan.open'), onClick: () => { void navigateTo(itemLink(item)) } }]
      })
      return item
    } catch (e: any) {
      toast.add({ title: t('feedbackPlan.attachFailed'), description: e?.message, icon: 'i-lucide-circle-alert', color: 'error' })
      return null
    }
  }

  return { enabled, createFor, attachTo, itemName }
}
