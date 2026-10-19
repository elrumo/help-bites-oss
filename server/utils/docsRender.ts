import MarkdownIt, { type Token } from 'markdown-it'
import { highlightText } from '@speed-highlight/core'
import { resolveDocLink } from '#shared/docs'

// The public docs are the repository's own docs/*.md, so they read the same on
// GitHub and on the site. This turns one of them into the HTML /docs serves.
// Pure (no Nitro, no I/O), so it unit-tests: tests/docs.test.ts renders every
// published guide and checks its links.

export interface DocHeading {
  id: string
  text: string
  level: 2 | 3
}

export interface RenderedDoc {
  html: string
  /** The h2 and h3 of the page, for its "On this page" list. */
  headings: DocHeading[]
}

// speed-highlight has no grammar for most of what the guides fence, so anything
// not listed here (Caddyfile, nginx, the architecture diagram) renders plain.
const FENCE_LANGUAGES: Record<string, string> = {
  bash: 'bash', sh: 'bash', shell: 'bash', console: 'bash',
  js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts',
  json: 'json', html: 'html', xml: 'xml', yaml: 'yaml', yml: 'yaml',
  http: 'http', ini: 'ini', toml: 'toml', sql: 'sql', diff: 'diff', css: 'css',
  docker: 'docker', dockerfile: 'docker', py: 'py', python: 'py'
}

interface FenceMeta {
  lang: string
  html: string
}

// Raw HTML in a guide is shown as text, not rendered: these files are plain
// Markdown, and a stray tag should never reach a visitor's browser as markup.
const md = new MarkdownIt({ html: false, linkify: true, typographer: false })

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]!
  const link = resolveDocLink(token.attrGet('href') ?? '')
  token.attrSet('href', link.href)
  if (link.external) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener')
  }
  return self.renderToken(tokens, idx, options)
}

// The env reference's tables are wider than a phone: they scroll on their own
// instead of stretching the page.
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n'
md.renderer.rules.table_close = () => '</table></div>\n'

md.renderer.rules.heading_close = (tokens, idx) => {
  const token = tokens[idx]!
  const id = (token.meta as { id?: string } | null)?.id
  const anchor = id ? `<a class="heading-anchor" href="#${md.utils.escapeHtml(id)}" aria-label="Link to this section">#</a>` : ''
  return `${anchor}</${token.tag}>\n`
}

md.renderer.rules.fence = (tokens, idx) => {
  const { lang, html } = tokens[idx]!.meta as FenceMeta
  return `<div class="code-block"><button type="button" class="copy-btn" data-copy aria-label="Copy to clipboard">Copy</button><pre class="shj-lang-${lang}"><code>${html}</code></pre></div>\n`
}

/** GitHub's heading ids, so the `#anchor` links written for GitHub keep working. */
export function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-')
}

const headingText = (inline: Token) =>
  (inline.children ?? []).filter(child => child.type === 'text' || child.type === 'code_inline').map(child => child.content).join('')

/** Drops the file's own `# Title` (the page prints the registry title) and, under it, a hand-written "Contents" list the page's "On this page" replaces. */
function dropFrontMatter(tokens: Token[]): Token[] {
  const out: Token[] = []
  let skippingContents = false
  let seenTitle = false
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.type === 'heading_open') {
      const text = headingText(tokens[i + 1]!)
      if (token.tag === 'h1' && !seenTitle) {
        seenTitle = true
        i += 2
        continue
      }
      skippingContents = token.tag === 'h2' && /^(table of )?contents$/i.test(text)
    }
    if (skippingContents) continue
    // A rule right after another (a divider written twice) is one divider.
    if (token.type === 'hr' && out.at(-1)?.type === 'hr') continue
    out.push(token)
  }
  return out
}

function numberHeadings(tokens: Token[]): DocHeading[] {
  const headings: DocHeading[] = []
  const used = new Map<string, number>()
  tokens.forEach((token, i) => {
    if (token.type !== 'heading_open') return
    const text = headingText(tokens[i + 1]!)
    const base = headingSlug(text) || 'section'
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    const id = seen ? `${base}-${seen}` : base
    token.attrSet('id', id)
    tokens[i + 2]!.meta = { id }
    if (token.tag === 'h2' || token.tag === 'h3') headings.push({ id, text, level: token.tag === 'h2' ? 2 : 3 })
  })
  return headings
}

// "- [ ] Changed the key" is a checklist item, as on GitHub. Marked here, drawn
// by the stylesheet.
function markChecklists(tokens: Token[]) {
  tokens.forEach((token, i) => {
    if (token.type !== 'inline' || tokens[i - 2]?.type !== 'list_item_open') return
    const box = /^\[([ xX])\]\s+/.exec(token.content)
    if (!box) return
    token.content = token.content.slice(box[0].length)
    const first = token.children?.[0]
    if (first?.type === 'text') first.content = first.content.slice(box[0].length)
    const item = tokens[i - 2]!
    item.attrSet('class', box[1] === ' ' ? 'task-item' : 'task-item task-done')
  })
}

async function highlightFences(tokens: Token[]) {
  await Promise.all(tokens.map(async (token) => {
    if (token.type !== 'fence') return
    const lang = FENCE_LANGUAGES[token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''] ?? 'plain'
    const code = token.content.replace(/\n$/, '')
    token.meta = { lang, html: await highlightText(code, lang, false) } satisfies FenceMeta
  }))
}

export async function renderDoc(source: string): Promise<RenderedDoc> {
  const tokens = dropFrontMatter(md.parse(source, {}))
  const headings = numberHeadings(tokens)
  markChecklists(tokens)
  await highlightFences(tokens)
  return { html: md.renderer.render(tokens, md.options, {}), headings }
}
