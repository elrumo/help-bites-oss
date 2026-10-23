import type { DocPage } from '#shared/docs'
import { renderDoc, type RenderedDoc } from './docsRender'
import blog from '../../docs/BLOG.md'
import brand from '../../docs/BRAND.md'
import connecting from '../../docs/CONNECTING.md'
import deployment from '../../docs/DEPLOYMENT.md'
import errors from '../../docs/ERRORS.md'
import feedback from '../../docs/FEEDBACK.md'
import events from '../../docs/EVENTS.md'
import flags from '../../docs/FLAGS.md'
import forms from '../../docs/FORMS.md'
import hub from '../../docs/HUB.md'
import languages from '../../docs/LANGUAGES.md'
import legal from '../../docs/LEGAL.md'
import mcp from '../../docs/MCP.md'
import onboarding from '../../docs/ONBOARDING.md'
import pages from '../../docs/PAGES.md'
import support from '../../docs/SUPPORT.md'
import pricing from '../../docs/PRICING.md'
import revenue from '../../docs/REVENUE.md'
import transfer from '../../docs/TRANSFER.md'

// The text of each published guide, bundled into the server at build time (the
// image ships .output only, never docs/). One import per entry in
// shared/docs.ts; tests/docs.test.ts fails if one is missing.
const SOURCES: Record<string, string> = {
  'BLOG.md': blog,
  'BRAND.md': brand,
  'CONNECTING.md': connecting,
  'DEPLOYMENT.md': deployment,
  'ERRORS.md': errors,
  'FEEDBACK.md': feedback,
  'EVENTS.md': events,
  'FLAGS.md': flags,
  'FORMS.md': forms,
  'HUB.md': hub,
  'LANGUAGES.md': languages,
  'LEGAL.md': legal,
  'MCP.md': mcp,
  'ONBOARDING.md': onboarding,
  'PAGES.md': pages,
  'SUPPORT.md': support,
  'PRICING.md': pricing,
  'REVENUE.md': revenue,
  'TRANSFER.md': transfer
}

const rendered = new Map<string, Promise<RenderedDoc>>()

/** A published guide as HTML. Rendered once per process; the text never changes while it runs. */
export function renderPublishedDoc(doc: DocPage): Promise<RenderedDoc> {
  let page = rendered.get(doc.slug)
  if (!page) {
    const source = SOURCES[doc.file]
    if (source === undefined) throw new Error(`docs/${doc.file} is published but not imported in server/utils/docsSource.ts`)
    page = renderDoc(source)
    rendered.set(doc.slug, page)
  }
  return page
}
