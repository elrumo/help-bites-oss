import { fillChangelogUrl } from '#shared/changelog'
import { escapeHtml } from './messageEmail'
import { pageBrand, renderMarketingPage, type PageBrand } from './marketingPages'
import type { ParseObject } from './parse'

// The hosted pages the changelog emails link to when a project has no pages of
// its own (`changelog.confirmUrl` / `unsubscribeUrl` left empty). Opening one
// only shows a button: mail scanners open every link, and opening must not
// subscribe or unsubscribe anyone. The button POSTs back to the same address.

export const HELPBITES_BRAND: PageBrand = { name: 'HelpBites', logoUrl: '', accent: '#4f46e5' }

/** The changelog on the project's own site, when it has one to link back to. */
function changelogLink(project: ParseObject): string {
  const siteUrl = String(project.get('siteUrl') || '')
  if (!/^https?:\/\//.test(siteUrl)) return ''
  const url = fillChangelogUrl(getChangelogConfig(project).pageUrl, siteUrl, '')
  return `<p class="small"><a href="${escapeHtml(url)}" style="color:var(--accent)">See what is new</a></p>`
}

export function changelogConfirmPage(project: ParseObject, token: string, brand: PageBrand = pageBrand(project)): string {
  return renderMarketingPage(brand, 'Confirm', `<h1>Confirm your subscription</h1><p>One click and you will get ${escapeHtml(brand.name)}'s changelog by email.</p>
<form method="post" action="/u/changelog/confirm/${encodeURIComponent(token)}"><button type="submit">Confirm subscription</button></form>`)
}

export function changelogConfirmedPage(project: ParseObject, brand: PageBrand = pageBrand(project)): string {
  return renderMarketingPage(brand, 'Subscribed', `<h1>You are subscribed</h1><p>Thanks for confirming. You will hear about what ${escapeHtml(brand.name)} ships next.</p>${changelogLink(project)}`)
}

export function changelogUnsubscribePage(token: string, brand: PageBrand): string {
  return renderMarketingPage(brand, 'Unsubscribe', `<h1>Unsubscribe from the changelog</h1><p>You will stop getting emails about what ${escapeHtml(brand.name)} ships.</p>
<form method="post" action="/u/changelog/unsubscribe/${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`)
}

export function changelogUnsubscribedPage(brand: PageBrand): string {
  return renderMarketingPage(brand, 'Unsubscribed', '<h1>You are unsubscribed</h1><p>You will not get any more changelog emails. Subscribe again any time from the changelog.</p>')
}
