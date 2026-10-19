import { docBySlug } from '#shared/docs'

// The body of one /docs page, for the page component to fetch. A production
// build prerenders every page with this already inside it, so this answers in
// development and for any page the build did not prerender.
export default defineEventHandler(async (event) => {
  const doc = docBySlug(getRouterParam(event, 'slug') ?? '')
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'No such page' })
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return renderPublishedDoc(doc)
})
