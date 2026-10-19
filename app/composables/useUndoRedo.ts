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

export function useUndoRedo(opts: UseUndoRedoOptions = {}) {
  const maxSize = opts.maxSize ?? 50

  const undoStack: EditorSnapshot[] = []
  const redoStack: EditorSnapshot[] = []

  const canUndo = ref(false)
  const redoable = ref(false)

  function updateFlags() {
    canUndo.value = undoStack.length > 0
    redoable.value = redoStack.length > 0
  }

  /** Save a snapshot before a user-initiated mutation. */
  function push(snapshot: EditorSnapshot) {
    undoStack.push(snapshot)
    if (undoStack.length > maxSize) undoStack.shift()
    redoStack.length = 0
    updateFlags()
  }

  /** Pop the last snapshot for undo; returns it or null. */
  function undo(current: EditorSnapshot): EditorSnapshot | null {
    const prev = undoStack.pop()
    if (!prev) return null
    redoStack.push(current)
    updateFlags()
    return prev
  }

  /** Pop the last redo snapshot; returns it or null. */
  function redo(current: EditorSnapshot): EditorSnapshot | null {
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
