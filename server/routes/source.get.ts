// The AGPL's offer of source to everyone using this deployment over the network.
export default defineEventHandler(event => sendRedirect(event, sourceCodeUrl(), 302))
