import { onScopeDispose, watch, type Ref } from 'vue'
import type { SupportEvent } from '~~/server/utils/events'

// SSE over fetch so the token rides in a header. Reconnects with backoff; a
// stream that never connects costs nothing but a log line — the page keeps
// working through the ordinary GETs.

export function useEventStream<T extends { type: string } = SupportEvent>(url: Ref<string | null>, token: Ref<string | null>, onEvent: (event: T) => void, onReconnect?: () => void, options: { anonymous?: boolean } = {}) {
  let controller: AbortController | null = null
  let attempt = 0
  let stopped = false
  let hadConnection = false
  // The landing page's demo has no server behind it to stream from.
  const demo = useState<boolean>('demo')
  const workspace = useState<string>('workspace-id')

  async function connect() {
    // Public streams (a feedback board read with its public key) need no token.
    if (stopped || demo.value || !url.value || (!token.value && !options.anonymous)) return
    controller?.abort()
    controller = new AbortController()
    const current = controller
    try {
      const headers: Record<string, string> = { Accept: 'text/event-stream' }
      if (token.value) headers.Authorization = `Bearer ${token.value}`
      // An operator's stream is for one workspace, like every other admin call.
      if (token.value?.startsWith('r:') && workspace.value) headers['X-Workspace'] = workspace.value
      const res = await fetch(url.value, { headers, signal: current.signal })
      if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`)
      attempt = 0
      if (hadConnection) onReconnect?.()
      hadConnection = true
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const data = chunk.split('\n').find(line => line.startsWith('data:'))
          if (!data) continue
          try {
            const parsed = JSON.parse(data.slice(5))
            if (parsed?.type) onEvent(parsed as T)
          } catch {}
        }
      }
    } catch (error) {
      if (current.signal.aborted) return
      console.warn('[events] stream dropped:', (error as Error).message)
    }
    if (stopped || current.signal.aborted) return
    attempt += 1
    setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)))
  }

  function stop() {
    stopped = true
    controller?.abort()
    controller = null
  }

  watch([url, token], () => {
    stopped = false
    attempt = 0
    void connect()
  }, { immediate: true })

  onScopeDispose(stop)
  return { stop }
}
