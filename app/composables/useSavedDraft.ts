/**
 * A form's unsaved content, kept in this browser so a side panel that is closed and opened again brings it back.
 * `schedule` stores a snapshot a moment after the last change (or drops it when the form holds nothing);
 * `clear` forgets it for good, such as once the item is created.
 */
export function useSavedDraft<T extends object>(key: () => string) {
  let timer: ReturnType<typeof setTimeout> | undefined

  function read(): T | null {
    try {
      const value = JSON.parse(localStorage.getItem(key()) || 'null')
      return value && typeof value === 'object' && !Array.isArray(value) ? value as T : null
    } catch {
      return null
    }
  }

  function clear() {
    clearTimeout(timer)
    try { localStorage.removeItem(key()) } catch {}
  }

  function schedule(snapshot: () => T | null) {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const value = snapshot()
      if (!value) return clear()
      try { localStorage.setItem(key(), JSON.stringify(value)) } catch {}
    }, 300)
  }

  onBeforeUnmount(() => clearTimeout(timer))

  return { read, schedule, clear }
}
