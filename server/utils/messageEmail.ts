import messageEmailTemplate from '../emailTemplates/messageEmail.js'
import { poweredByHtml, poweredByText, type PoweredBy } from './branding'

// Rendering for the generic staff → user message email. Everything here is a
// pure function of its inputs so it can be unit-tested without Mailgun or Parse.
//
// The message body is operator-written free text that lands inside an HTML
// email, so escaping is not optional: an unescaped `<` in a reply would break
// the layout at best and inject markup at worst.

const MAX_SUBJECT_LENGTH = 200
const MAX_PREHEADER_LENGTH = 140

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

/**
 * Turn a plain-text message into email-safe HTML: blank lines become separate
 * paragraphs, single newlines become <br>. Returns '' for empty input so the
 * caller can decide whether an empty body is an error.
 */
export function renderMessageBodyHtml(body: unknown): string {
  const text = String(body ?? '').replace(/\r\n/g, '\n').trim()
  if (!text) return ''

  return text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.split('\n').map(escapeHtml).join('<br />'))
    .map(paragraph => `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #475569;">${paragraph}</p>`)
    .join('\n')
}

/**
 * Only http(s) links become a button. A `javascript:` or `mailto:` value would
 * either be inert or actively hostile in a mail client, so anything else is
 * dropped and the email simply renders without a call to action.
 */
export function renderCtaBlock(ctaUrl: unknown, ctaLabel: unknown, appName = 'the app'): string {
  const url = String(ctaUrl ?? '').trim()
  if (!url) return ''

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ''
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''

  const label = String(ctaLabel ?? '').trim() || `Open ${appName}`

  return `<tr>
                <td align="center" style="padding: 8px 36px 16px 36px;">
                  <a
                    href="${escapeHtml(parsed.toString())}"
                    style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; padding: 12px 28px; border-radius: 10px;"
                  >
                    ${escapeHtml(label)}
                  </a>
                </td>
              </tr>`
}

export function renderAttachmentsHtml(urls: unknown): string {
  if (!Array.isArray(urls) || !urls.length) return ''
  return urls
    .map(url => String(url || '').trim())
    .filter(url => /^https?:\/\//.test(url))
    .map(url => `<p style="margin: 0 0 12px 0;"><a href="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="Attachment" style="max-width: 100%; border-radius: 10px; border: 1px solid #e2e8f0;" /></a></p>`)
    .join('\n')
}

export function resolveGreeting(name: unknown): string {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'Hi there,'

  // Usernames are frequently full names; the first token reads better.
  const first = trimmed.split(/\s+/)[0]
  return `Hi ${first},`
}

export function normalizeSubject(subject: unknown, senderName = 'the team'): string {
  const trimmed = String(subject ?? '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return `A message from ${senderName}`
  return trimmed.slice(0, MAX_SUBJECT_LENGTH)
}

export function buildPreheader(body: unknown, senderName = 'the team'): string {
  const flat = String(body ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return `You have a new message from ${senderName}`
  if (flat.length <= MAX_PREHEADER_LENGTH) return flat
  return `${flat.slice(0, MAX_PREHEADER_LENGTH - 1).trimEnd()}…`
}

export type MessageEmailInput = {
  recipientName?: string
  subject?: string
  body: string
  ctaUrl?: string
  ctaLabel?: string
  /** Project name; brands the header and footer. */
  appName?: string
  /** Who the message reads as from; used for default subject/preheader. */
  senderName?: string
  /** Image attachments rendered under the body. */
  attachmentUrls?: string[]
  /** The "Powered by HelpBites" line under the footer, for mail to end users (poweredByFor). */
  poweredBy?: PoweredBy | null
}

export function renderMessageEmail(input: MessageEmailInput): { subject: string, html: string, text: string } {
  const appName = String(input.appName || '').trim() || 'the app'
  const senderName = String(input.senderName || '').trim() || 'the team'
  const subject = normalizeSubject(input.subject, senderName)
  const bodyHtml = renderMessageBodyHtml(input.body) + renderAttachmentsHtml(input.attachmentUrls)

  const substitutions: Record<string, string> = {
    preheader: escapeHtml(buildPreheader(input.body, senderName)),
    subject: escapeHtml(subject),
    greeting: escapeHtml(resolveGreeting(input.recipientName)),
    ctaBlock: renderCtaBlock(input.ctaUrl, input.ctaLabel, appName),
    appName: escapeHtml(appName),
    bodyHtml,
    poweredBy: poweredByHtml(input.poweredBy)
  }

  // Single pass, so a substituted value that happens to contain `{{token}}`
  // text is never re-expanded by a later replacement.
  const html = messageEmailTemplate.replace(
    /\{\{(\w+)\}\}/g,
    (match: string, token: string) => (token in substitutions ? substitutions[token]! : match)
  )

  const text = `${resolveGreeting(input.recipientName)}\n\n${String(input.body ?? '').trim()}${
    (input.attachmentUrls || []).length ? `\n\n${(input.attachmentUrls || []).join('\n')}` : ''
  }${
    input.ctaUrl ? `\n\n${input.ctaLabel || `Open ${appName}`}: ${input.ctaUrl}` : ''
  }${
    input.poweredBy ? `\n\n${poweredByText(input.poweredBy)}` : ''
  }`

  return { subject, html, text }
}
