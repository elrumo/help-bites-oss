import { CHANGELOG_TAG_LABELS, changelogCopy, fillChangelogText, type ChangelogFrequency } from '#shared/changelog'
import { escapeHtmlValue } from '#shared/email/placeholders'

// The pure half of the changelog notifications: when to send, which week a
// weekly digest covers, and the words of the emails. No Parse, no clock of its
// own, so all of it tests without a database.

// ---- when ---------------------------------------------------------------------

/**
 * The trailing debounce: flush once the burst has gone quiet, or once the
 * oldest pending entry has waited out the cap, whichever comes first.
 */
export function shouldFlushPending(pendingTimes: Date[], now: Date, quietMs: number, maxWaitMs: number): boolean {
  if (!pendingTimes.length) return false
  const times = pendingTimes.map(time => time.getTime())
  return now.getTime() - Math.max(...times) >= quietMs || now.getTime() - Math.min(...times) >= maxWaitMs
}

type ZonedParts = { year: number, month: number, day: number, hour: number, minute: number, second: number, weekday: number }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function partsInZone(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hour12: false
  })
  const fields: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) fields[part.type] = part.value
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    // Intl emits hour "24" for midnight in some environments.
    hour: Number(fields.hour) % 24,
    minute: Number(fields.minute),
    second: Number(fields.second),
    weekday: WEEKDAYS.indexOf(String(fields.weekday).slice(0, 3))
  }
}

/** A wall-clock time in a zone → the UTC instant it names. Two correction passes converge across DST transitions. */
export function wallTimeToUtc(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  let guess = Date.UTC(year, month - 1, day, hour)
  for (let i = 0; i < 2; i++) {
    const parts = partsInZone(new Date(guess), timeZone)
    const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    guess += Date.UTC(year, month - 1, day, hour) - wallAsUtc
  }
  return new Date(guess)
}

export type WeeklyWindow = {
  /** Previous Monday 00:00 local, as a UTC instant. */
  windowStart: Date
  /** This Monday 00:00 local: the exclusive end of the covered week. */
  windowEnd: Date
  /** True from Monday at the send hour onward (stays true all week; the ledger stops resends). */
  due: boolean
}

export function weeklyWindowFor(now: Date, timeZone: string, sendHour: number): WeeklyWindow {
  const local = partsInZone(now, timeZone)
  const daysSinceMonday = ((local.weekday % 7) + 7) % 7

  // Wall-clock date arithmetic via a UTC scratch date: only y/m/d are read back.
  const scratch = new Date(Date.UTC(local.year, local.month - 1, local.day))
  scratch.setUTCDate(scratch.getUTCDate() - daysSinceMonday)
  const monday = { year: scratch.getUTCFullYear(), month: scratch.getUTCMonth() + 1, day: scratch.getUTCDate() }

  const windowEnd = wallTimeToUtc(monday.year, monday.month, monday.day, 0, timeZone)
  scratch.setUTCDate(scratch.getUTCDate() - 7)
  const windowStart = wallTimeToUtc(scratch.getUTCFullYear(), scratch.getUTCMonth() + 1, scratch.getUTCDate(), 0, timeZone)
  const sendAt = wallTimeToUtc(monday.year, monday.month, monday.day, sendHour, timeZone)

  return { windowStart, windowEnd, due: now.getTime() >= sendAt.getTime() }
}

export function weeklyWindowLabel(window: WeeklyWindow, timeZone: string): string {
  const format = (date: Date) => new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(date)
  // The window is exclusive of Monday itself: label the Sunday it ends on.
  const lastDay = new Date(window.windowEnd.getTime() - 24 * 60 * 60 * 1000)
  return `${format(window.windowStart)} – ${format(lastDay)}`
}

// ---- the words ----------------------------------------------------------------

export type ChangelogEmailEntry = {
  slug: string
  title: string
  summary?: string | null
  excerpt?: string | null
  tag?: string | null
}

function entryListHtml(entries: ChangelogEmailEntry[], entryUrl: (slug: string) => string): string {
  return entries.map((entry) => {
    const label = CHANGELOG_TAG_LABELS[entry.tag as keyof typeof CHANGELOG_TAG_LABELS] || ''
    const blurb = String(entry.summary || entry.excerpt || '').trim()
    return `<div style="margin: 0 0 20px 0;">
      ${label ? `<p style="margin: 0 0 2px 0; font-size: 11px; line-height: 1.4; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">${escapeHtmlValue(label)}</p>` : ''}
      <p style="margin: 0 0 4px 0; font-size: 16px; line-height: 1.4; font-weight: 600;">
        <a href="${escapeHtmlValue(entryUrl(entry.slug))}" style="color: #0f172a; text-decoration: none;">${escapeHtmlValue(entry.title)}</a>
      </p>
      ${blurb ? `<p style="margin: 0; font-size: 14px; line-height: 1.6; color: #475569;">${escapeHtmlValue(blurb)}</p>` : ''}
    </div>`
  }).join('\n')
}

export type ChangelogDigestInput = {
  entries: ChangelogEmailEntry[]
  /** The project's own words (`changelogCopy`). */
  copy: ReturnType<typeof changelogCopy>
  siteName: string
  entryUrl: (slug: string) => string
  pageUrl: string
  kind: ChangelogFrequency
  /** Human-readable window, weekly only, e.g. "17 Aug – 23 Aug". */
  windowLabel?: string
}

/**
 * Values for the `changelog` email template. Everything is plain text (the
 * template escapes it) except `entriesHtml`: a template can't loop, so the
 * entry list is built here, with every title and blurb escaped; a `<` in a
 * release-note title must not break the email of every subscriber at once.
 * What is different per subscriber (`firstName`, the unsubscribe links) is
 * added by the sender.
 */
export function changelogDigestVariables(input: ChangelogDigestInput): Record<string, string> {
  const { entries, copy, siteName } = input
  const count = entries.length
  const values = { site: siteName, count, window: input.kind === 'weekly' && input.windowLabel ? ` (${input.windowLabel})` : '' }
  const weekly = input.kind === 'weekly'

  const subjectLine = weekly
    ? fillChangelogText(copy.weeklySubject, values)
    : count === 1 ? entries[0]!.title : fillChangelogText(copy.instantSubjectMany, values)
  const intro = fillChangelogText(weekly ? (count === 1 ? copy.weeklyIntroOne : copy.weeklyIntroMany) : (count === 1 ? copy.instantIntroOne : copy.instantIntroMany), values)

  return {
    subjectLine,
    preheader: entries.map(entry => entry.title).join(' · ').slice(0, 140),
    intro,
    entriesHtml: entryListHtml(entries, input.entryUrl),
    changelogUrl: input.pageUrl,
    footerNote: weekly ? copy.footerWeekly : copy.footerInstant
  }
}

/** Values for the `changelog-confirm` template: the confirm link and what the reader signed up for. */
export function changelogConfirmVariables(input: { confirmUrl: string, frequency: ChangelogFrequency, copy: ReturnType<typeof changelogCopy> }): Record<string, string> {
  return {
    cadence: input.frequency === 'weekly' ? input.copy.confirmWeekly : input.copy.confirmInstant,
    confirmUrl: input.confirmUrl
  }
}

/**
 * A greeting-safe first name. Display names are often handles, and greeting
 * someone with their own email (or a `user-…` placeholder) reads like a phish:
 * anything `@`-shaped or placeholder-shaped becomes "there".
 */
export function greetingFirstName(displayName: string | undefined | null): string {
  const trimmed = String(displayName ?? '').replace(/[<>]/g, '').trim()
  if (!trimmed || trimmed.includes('@') || /^user-[A-Za-z0-9]{6,}$/.test(trimmed)) return 'there'
  return trimmed.split(/\s+/)[0]!.slice(0, 40)
}
