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

  /**
   * New items for the post, each linked to it: the AI decides whether it is one piece of work or
   * several. A toast stays up while it works (it can take several seconds). Resolves to the items,
   * or to none after an error toast.
   */
  async function createFor(post: PostRef): Promise<BoardItem[]> {
    const workingId = `planning-working-${post.id}`
    toast.add({ id: workingId, title: t('feedbackPlan.working'), description: t('feedbackPlan.workingHint'), icon: 'i-lucide-loader-circle', ui: { icon: 'animate-spin' }, duration: 0, close: false })
    try {
      const { items, ai } = await api<{ items: BoardItem[], ai: boolean }>('/admin/board-items/from-feedback', { method: 'POST', query: { project: projectId }, body: { postId: post.id } })
      toast.add({
        title: items.length === 1 ? t('feedbackPlan.created', { name: itemName(items[0]!) }) : t('feedbackPlan.createdMany', { count: items.length }),
        description: items.length === 1 ? (ai ? t('feedbackPlan.createdAi') : t('feedbackPlan.createdPlain')) : items.map(itemName).join(' · '),
        icon: ai ? 'i-lucide-sparkles' : 'i-lucide-square-kanban',
        color: 'success',
        actions: [{ label: t('feedbackPlan.open'), onClick: () => { void navigateTo(itemLink(items[0]!)) } }]
      })
      return items
    } catch (e: any) {
      toast.add({ title: t('feedbackPlan.createFailed'), description: e?.message, icon: 'i-lucide-circle-alert', color: 'error' })
      return []
    } finally {
      toast.remove(workingId)
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
