// Timestamp formatting shared by the chat UI. Kept out of the components so
// the inbox and the admin panel render identical stamps, and so the rules live
// in one place rather than being copy-pasted per pane.

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

/**
 * Compact stamp for a conversation row: time today, weekday within the week,
 * else a short date — the same ladder Messages.app uses.
 */
export function formatChatListStamp(value: string | null | undefined, now = new Date()): string {
  const date = toDate(value)
  if (!date) return ''

  if (isSameDay(date, now)) {
    return date.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  const daysAgo = (now.getTime() - date.getTime()) / 86_400_000
  if (daysAgo < 7) return date.toLocaleString(undefined, { weekday: 'short' })

  return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })
}

/**
 * Centred separator inside a transcript: "Today 14:23", "Yesterday 09:02",
 * "Sat 02:11", "16 May 2026 02:11".
 */
export function formatChatSeparator(value: string | null | undefined, now = new Date()): string {
  const date = toDate(value)
  if (!date) return ''

  const time = date.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })

  if (isSameDay(date, now)) return `Today ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return `Yesterday ${time}`

  const daysAgo = (now.getTime() - date.getTime()) / 86_400_000
  if (daysAgo < 7) return `${date.toLocaleString(undefined, { weekday: 'short' })} ${time}`

  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`
}

/**
 * The same separator, split so the day can be set in bold above the time —
 * the way Messages weights it.
 */
export function chatSeparatorParts(value: string | null | undefined, now = new Date()): { day: string, time: string } {
  const text = formatChatSeparator(value, now)
  if (!text) return { day: '', time: '' }
  const parts = text.split(' ')
  // The time is the last token, plus an AM/PM marker where the locale uses one.
  const size = /^(AM|PM)$/i.test(parts[parts.length - 1] || '') ? 2 : 1
  return { day: parts.slice(0, -size).join(' '), time: parts.slice(-size).join(' ') }
}
