// The public documentation: which of the repository's docs/*.md are published
// at /docs, and where a link inside one of them should go. Everything else in
// docs/ (the security analysis, the hosted service's runbook, notes written for
// contributors) stays in the repository and is linked to on GitHub when a
// published page mentions it.

export const REPO_URL = 'https://github.com/elrumo/help-bites'
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
    title: 'Feedback boards',
    description: 'A public board per project with posts, votes, comments, a roadmap and a changelog: drop it into your site or build on the API.',
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
    slug: 'errors',
    title: 'Error tracking',
    description: 'Connect GlitchTip or Bugsink so new errors become conversations in your inbox, tied to the customer who hit them.',
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
