import { onBeforeUnmount, onMounted } from 'vue'
import type { SupportEvent } from '~~/server/utils/events'
import type { WorkspaceAttention } from '#shared/attention'

// The numbers that follow you across the panel: the inbox's unread badge and how
// much needs attention. The default layout runs this once, so they are right on
// every page, not only on the inbox. Messages move the badge as they arrive (the
// workspace event stream, then a recount); the attention list has no events, so
// it is read again every minute (with a recount, in case an event was missed)
// and whenever the tab comes back.

const EVERY_MS = 60_000
const RECOUNT_AFTER_MS = 400

/** The shared numbers and how to read them again, for pages that change what they say (the layout keeps them live). */
export function useCounts() {
  const { api } = useAgent()
  const unread = useState<number>('inbox-total-unread', () => 0)
  const attention = useState<WorkspaceAttention | null>('attention', () => null)

  async function recountUnread() {
    try { unread.value = (await api<{ unreadMessages: number }>('/admin/unread')).unreadMessages } catch {}
  }
  /** `fresh` skips the server's few seconds of cache, for a page that just changed what it says. */
  async function reloadAttention(fresh = false) {
    try { attention.value = await api<WorkspaceAttention>('/admin/attention', fresh ? { query: { fresh: 1 } } : {}) } catch {}
  }
  return { unread, attention, recountUnread, reloadAttention, refresh: () => Promise.all([recountUnread(), reloadAttention()]) }
}

/** Run once, by the default layout. */
export function useLiveCounts() {
  const { token } = useAgent()
  const { unread, attention, recountUnread, reloadAttention, refresh } = useCounts()

  // A burst of messages recounts once.
  let pending: ReturnType<typeof setTimeout> | undefined
  function recountSoon() {
    clearTimeout(pending)
    pending = setTimeout(recountUnread, RECOUNT_AFTER_MS)
  }
  useEventStream(computed(() => '/v1/admin/events'), token, (event: SupportEvent) => {
    if (event.type !== 'message.updated') recountSoon()
  }, () => { void refresh() })

  let timer: ReturnType<typeof setInterval> | undefined
  const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
  onMounted(() => {
    void refresh()
    timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
  })
  onBeforeUnmount(() => {
    clearTimeout(pending)
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  })

  return { unread, attention, refresh, recountUnread, reloadAttention }
}
