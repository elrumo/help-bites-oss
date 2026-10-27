// An unsaved "new" form in a side panel, kept in this browser so closing the panel or reloading does not lose it.

export function readPanelDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

/** `null` forgets the draft. */
export function writePanelDraft(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage full or blocked: the panel works without it */ }
}
