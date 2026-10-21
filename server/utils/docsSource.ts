import type { DocPage } from '#shared/docs'
import { renderDoc, type RenderedDoc } from './docsRender'
import brand from '../../docs/BRAND.md'
import connecting from '../../docs/CONNECTING.md'
import deployment from '../../docs/DEPLOYMENT.md'
import errors from '../../docs/ERRORS.md'
import feedback from '../../docs/FEEDBACK.md'
import flags from '../../docs/FLAGS.md'
import languages from '../../docs/LANGUAGES.md'
import legal from '../../docs/LEGAL.md'
import onboarding from '../../docs/ONBOARDING.md'
import pages from '../../docs/PAGES.md'
import transfer from '../../docs/TRANSFER.md'

// The text of each published guide, bundled into the server at build time (the
// image ships .output only, never docs/). One import per entry in
// shared/docs.ts; tests/docs.test.ts fails if one is missing.
const SOURCES: Record<string, string> = {
  'BRAND.md': brand,
  'CONNECTING.md': connecting,
  'DEPLOYMENT.md': deployment,
  'ERRORS.md': errors,
  'FEEDBACK.md': feedback,
  'FLAGS.md': flags,
  'LANGUAGES.md': languages,
  'LEGAL.md': legal,
  'ONBOARDING.md': onboarding,
  'PAGES.md': pages,
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
