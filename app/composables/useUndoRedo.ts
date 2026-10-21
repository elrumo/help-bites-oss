import type { EmailDocument } from '#shared/email/blocks'
import type { TemplateVariable } from '#shared/email/resolve'

export interface EditorSnapshot {
  document: EmailDocument
  name: string
  variables: TemplateVariable[]
}

export interface UseUndoRedoOptions {
  maxSize?: number
}

/** History of editor snapshots; `T` is what one holds (the email editor's by default). */
export function useUndoRedo<T = EditorSnapshot>(opts: UseUndoRedoOptions = {}) {
  const maxSize = opts.maxSize ?? 50

  const undoStack: T[] = []
  const redoStack: T[] = []

  const canUndo = ref(false)
  const redoable = ref(false)

  function updateFlags() {
    canUndo.value = undoStack.length > 0
    redoable.value = redoStack.length > 0
  }

  /** Save a snapshot before a user-initiated mutation. */
  function push(snapshot: T) {
    undoStack.push(snapshot)
    if (undoStack.length > maxSize) undoStack.shift()
    redoStack.length = 0
    updateFlags()
  }

  /** Pop the last snapshot for undo; returns it or null. */
  function undo(current: T): T | null {
    const prev = undoStack.pop()
    if (!prev) return null
    redoStack.push(current)
    updateFlags()
    return prev
  }

  /** Pop the last redo snapshot; returns it or null. */
  function redo(current: T): T | null {
    const next = redoStack.pop()
    if (!next) return null
    undoStack.push(current)
    updateFlags()
    return next
  }

  /** Clear all history (e.g. on template apply or initial load). */
  function clear() {
    undoStack.length = 0
    redoStack.length = 0
    updateFlags()
  }

  return { push, undo, redo, clear, canUndo, canRedo: redoable }
}
