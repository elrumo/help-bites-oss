import { homePathFor } from '#shared/domains'

// What "/" is on a custom host: its target page. The reverse proxy sends "/"
// here for hosts that are not the app's own (the prerendered landing page
// would otherwise answer). On any other host this does not exist.

export default defineEventHandler((event) => {
  const custom = event.context.customHost as { publicKey: string, target: Parameters<typeof homePathFor>[0] } | undefined
  if (!custom) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return sendRedirect(event, homePathFor(custom.target, custom.publicKey), 302)
})
