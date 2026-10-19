import { computed } from 'vue'

/**
 * Messages that were written but never accepted by the server.
 *
 * Both the embed and the admin panel render a message the moment it is
 * composed and settle the delivery afterwards. A rejected send lands here, in
 * localStorage, where it survives a reload, and the transcript keeps showing
 * it with a retry button until it is delivered or discarded.
 *
 * One store for every conversation on the device, partitioned by `scope`
 * (a conversation id, or 'new:<projectId>' for a conversation not yet created).
 * The entry id doubles as the message's `clientId`, which the server uses to
 * dedupe a retry that actually did land the first time.
 */

const STORAGE_KEY = 'help-bites:outbox'
const MAX_ENTRIES = 50

export type OutboxEntry = {
  id: string
  scope: string
  body: string
  subject: string
  /** Conversation type for a not-yet-created conversation; '' means the default. */
  type?: string
  conversationId: string
  replyToId: string
  attachments: { url: string, mime: string, size: number }[]
  context: Record<string, unknown> | null
  createdAt: string
  error: string
}

export function newOutboxId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return `c_${random || `${Date.now()}-${Math.round(Math.random() * 1e9)}`}`
}

function isEntry(value: unknown): value is OutboxEntry {
  const entry = value as OutboxEntry | null
  return Boolean(entry && typeof entry.id === 'string' && typeof entry.scope === 'string' && typeof entry.body === 'string')
}

export function useChatOutbox() {
  const entries = useState<OutboxEntry[]>('chat-outbox', () => [])
  const hydrated = useState<boolean>('chat-outbox-hydrated', () => false)

  function hydrate() {
    if (!import.meta.client || hydrated.value) return
    hydrated.value = true
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      entries.value = Array.isArray(parsed) ? parsed.filter(isEntry) : []
    } catch {
      // Third-party iframe storage (Safari) or a corrupt store: the in-memory copy still works.
      entries.value = []
    }
  }

  function persist() {
    if (!import.meta.client) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.value))
    } catch {}
  }

  function forScope(scope: string): OutboxEntry[] {
    return entries.value.filter(entry => entry.scope === scope).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  function remember(entry: OutboxEntry) {
    entries.value = [...entries.value.filter(existing => existing.id !== entry.id), entry].slice(-MAX_ENTRIES)
    persist()
  }

  function forget(id: string) {
    const next = entries.value.filter(entry => entry.id !== id)
    if (next.length === entries.value.length) return
    entries.value = next
    persist()
  }

  return { entries, hasFailures: computed(() => entries.value.length > 0), hydrate, forScope, remember, forget }
}
