import { escapeHtmlValue } from '#shared/email/placeholders'

// The "Powered by HelpBites" line on what a project's end users see: the chat
// widget, the feedback board, the hosted pages and the email sent to them.
// It shows when the workspace's plan lacks `removeBranding`. The community
// edition's UNLIMITED_PLAN has every feature, so a self-hosted install never
// shows it.

export type PoweredBy = { url: string }

const LABEL = 'Powered by HelpBites'

/** The badge for a project, or null when its plan removes the branding. */
export async function poweredByFor(project: ParseObject | null | undefined): Promise<PoweredBy | null> {
  // Without plans every workspace is unlimited, so there is nothing to look up.
  if (!project || !edition().planFor) return null
  try {
    const plan = await workspacePlan(await projectWorkspaceId(project))
    return plan.features.removeBranding ? null : { url: edition().brandUrl }
  } catch (error) {
    // The badge is never a reason for a page or an email to fail.
    console.warn('[branding] plan lookup failed:', (error as Error).message)
    return null
  }
}

/** One small, muted, centered line for server-rendered pages and email (inline styles, so mail clients keep them). '' without a badge. */
export function poweredByHtml(badge: PoweredBy | null | undefined): string {
  if (!badge) return ''
  return `<p style="margin: 12px auto 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #94a3b8; text-align: center;"><a href="${escapeHtmlValue(badge.url)}" style="color: #94a3b8; text-decoration: none;">${LABEL}</a></p>`
}

/** The plain-text twin of poweredByHtml. '' without a badge. */
export function poweredByText(badge: PoweredBy | null | undefined): string {
  return badge ? `${LABEL}: ${badge.url}` : ''
}

/** `html` with the badge at the end of its body, or at the end of a fragment. */
export function withPoweredByHtml(html: string, badge: PoweredBy | null | undefined): string {
  const line = poweredByHtml(badge)
  if (!line) return html
  const end = html.toLowerCase().lastIndexOf('</body>')
  return end === -1 ? `${html}\n${line}` : `${html.slice(0, end)}${line}\n${html.slice(end)}`
}

/** `text` with the badge as its last line. */
export function withPoweredByText(text: string, badge: PoweredBy | null | undefined): string {
  const line = poweredByText(badge)
  return line ? `${text.trimEnd()}\n\n${line}` : text
}
