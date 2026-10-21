// The public documentation: which of the repository's docs/*.md are published
// at /docs, and where a link inside one of them should go. Everything else in
// docs/ (the security analysis, the hosted service's runbook, notes written for
// contributors) stays in the repository and is linked to on GitHub when a
// published page mentions it.

export const REPO_URL = 'https://github.com/elrumo/help-bites-oss'
const BRANCH = 'main'

export const DOC_GROUPS = ['Get started', 'Guides'] as const
export type DocGroup = typeof DOC_GROUPS[number]

export interface DocPage {
  /** The URL: /docs/<slug>. */
  slug: string
  /** The sidebar label and the page heading (the file's own # heading is replaced by it). */
  title: string
  description: string
  group: DocGroup
  /** Under docs/. */
  file: string
}

// Order is the sidebar's and the previous / next links'. Add a guide here and it
// is rendered, listed, prerendered and link-checked (tests/docs.test.ts).
export const DOCS: readonly DocPage[] = [
  {
    slug: 'self-host',
    title: 'Self-hosting',
    description: 'Run HelpBites on your own servers with Docker Compose or Dokploy: the services, every environment variable, backups and upgrades.',
    group: 'Get started',
    file: 'DEPLOYMENT.md'
  },
  {
    slug: 'connect',
    title: 'Connect your app',
    description: 'Create a project, sign an identity token for the user who is signed in, and put the chat on your page or build your own on the API.',
    group: 'Get started',
    file: 'CONNECTING.md'
  },
  {
    slug: 'feedback',
    title: 'Feedback and roadmap',
    description: 'A public feedback page per project with posts, votes, comments, a roadmap and a changelog, and a private planning board behind it: drop it into your site or build on the API.',
    group: 'Guides',
    file: 'FEEDBACK.md'
  },
  {
    slug: 'flags',
    title: 'Feature flags',
    description: 'Turn parts of your app on and off from the panel without a deploy, for everyone, for your admins or for a list.',
    group: 'Guides',
    file: 'FLAGS.md'
  },
  {
    slug: 'transfer',
    title: 'Moving between instances',
    description: 'Export a workspace or one project and import it into another HelpBites, from a file or straight from the other instance: self-hosted to cloud and back.',
    group: 'Guides',
    file: 'TRANSFER.md'
  },
  {
    slug: 'legal',
    title: 'Legal documents',
    description: 'Host your privacy policy, terms, cookie and refund policies on HelpBites: build them from reviewed clauses or with AI, check them against the rules, and link to a styled public page.',
    group: 'Guides',
    file: 'LEGAL.md'
  },
  {
    slug: 'onboarding',
    title: 'Onboarding',
    description: 'Write welcome screens in the panel and show them once in your web or Swift app, from a copy your app keeps, so they still show when HelpBites is unreachable.',
    group: 'Guides',
    file: 'ONBOARDING.md'
  },
  {
    slug: 'pricing',
    title: 'Pricing tables',
    description: 'Plan cards, paywalls and comparison tables for your site, your Swift app and your onboarding, with prices and checkout from Stripe, currencies, translations, A/B tests and AI suggestions.',
    group: 'Guides',
    file: 'PRICING.md'
  },
  {
    slug: 'forms',
    title: 'Lead forms',
    description: 'Waitlists, "notify me" boxes and interest forms on your site, in your app or on a hosted page: every sign-up becomes a contact, with double opt-in, a welcome email and a sequence.',
    group: 'Guides',
    file: 'FORMS.md'
  },
  {
    slug: 'languages',
    title: 'Languages and AI translation',
    description: 'Show onboarding, legal pages and emails in your users\' language: add languages, translate with AI or by hand, and pick one with a locale from your web app, Swift app or the API.',
    group: 'Guides',
    file: 'LANGUAGES.md'
  },
  {
    slug: 'brand',
    title: 'Brand kit',
    description: 'Keep logos, icons, screenshots, colours, fonts and guidelines in one place, and share them on a public press page, an embed for your site, or the API.',
    group: 'Guides',
    file: 'BRAND.md'
  },
  {
    slug: 'blog',
    title: 'Blog and newsletter',
    description: 'Write posts in a rich editor and publish them on a hosted blog, in your own site, by RSS and in your subscribers\' inboxes, with reactions and comments.',
    group: 'Guides',
    file: 'BLOG.md'
  },
  {
    slug: 'pages',
    title: 'Pages and headless CMS',
    description: 'Design landing pages in a visual editor and host them, or read the same copy, images and components from your Vue, JavaScript or Swift app. An assistant writes pages, copy and components.',
    group: 'Guides',
    file: 'PAGES.md'
  },
  {
    slug: 'mcp',
    title: 'AI assistants (MCP)',
    description: 'Connect Claude, ChatGPT, Cursor or any MCP client to your workspace to read the inbox, draft replies, triage feedback and write changelog entries, signed in with your browser or an API key.',
    group: 'Guides',
    file: 'MCP.md'
  },
  {
    slug: 'errors',
    title: 'Error tracking',
    description: 'Connect GlitchTip or Bugsink to browse errors, get alert emails when one spikes, and fix them with AI that reads your GitHub repos.',
    group: 'Guides',
    file: 'ERRORS.md'
  }
]

export const docBySlug = (slug: string) => DOCS.find(doc => doc.slug === slug)
export const docByFile = (file: string) => DOCS.find(doc => doc.file === file)
export const docPath = (doc: DocPage) => `/docs/${doc.slug}`
export const docEditUrl = (doc: DocPage) => `${REPO_URL}/edit/${BRANCH}/docs/${doc.file}`

export interface ResolvedLink {
  href: string
  /** Leaves the site: opens in a new tab. */
  external: boolean
}

/**
 * Where a link written in one of the docs/*.md files goes on the site. The
 * markdown is also read on GitHub, so its links are paths relative to docs/: a
 * published guide links to its page here, and any other file in the repository
 * (a folder too) to its place on GitHub.
 */
export function resolveDocLink(href: string): ResolvedLink {
  if (href.startsWith('#')) return { href, external: false }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    // mailto: and the like stay as written; only web links open a new tab.
    return { href, external: /^https?:/i.test(href) }
  }

  const [pathPart = '', fragment = ''] = href.split('#') as [string, string?]
  const hash = fragment ? `#${fragment}` : ''
  // docs/X.md, ./X.md and X.md are all the same file; ../a/b is repo-relative.
  const segments: string[] = ['docs']
  for (const part of pathPart.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  const repoPath = segments.join('/')

  const published = DOCS.find(doc => repoPath === `docs/${doc.file}`)
  if (published) return { href: docPath(published) + hash, external: false }

  const kind = pathPart.endsWith('/') ? 'tree' : 'blob'
  return { href: `${REPO_URL}/${kind}/${BRANCH}/${repoPath}${hash}`, external: true }
}
