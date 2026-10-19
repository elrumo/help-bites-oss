defineRouteMeta({
  openAPI: {
    tags: ['Meta'], operationId: 'internalEmbeddings',
    summary: 'Embed texts (internal)',
    description: 'Service to service, not for integrators. The embedder (APP_ROLE embedder, or all) runs the local embedding model for the other app containers, which reach it through EMBEDDING_ENDPOINT with EMBEDDING_API_KEY as the bearer token. Answers 404 on other roles, when EMBEDDING_API_KEY is not set, and for a wrong key. Each text is cut to 2,000 characters.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['input'], properties: { input: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 256, description: 'The texts, 1 to 256. A single string is taken as a list of one.', example: ['How do I reset my password?'] } } } } } },
    responses: {
      200: { description: 'OpenAI-style: one unit-length vector per text, in order.', content: { 'application/json': { schema: { type: 'object', required: ['data', 'model'], properties: { data: { type: 'array', items: { type: 'object', required: ['embedding', 'index'], properties: { embedding: { type: 'array', items: { type: 'number' } }, index: { type: 'integer' } } } }, model: { type: 'string', example: 'Xenova/clip-vit-large-patch14' } } } } } },
      400: { description: '`input` is not a string or a list of 1 to 256 strings' },
      404: { description: 'Not the embedder, or no key or a wrong one' },
      503: { description: 'Embeddings are switched off here, or the model could not load' }
    }
  }
})

export default defineEventHandler(async (event) => {
  if (!embedderAuthorized(getHeader(event, 'authorization'))) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const body = await readBody(event).catch(() => null) as { input?: unknown } | null
  const texts = embeddingInputs(body?.input)
  if (!texts) throw createError({ statusCode: 400, statusMessage: `input must be a string or a list of 1 to ${EMBED_MAX_TEXTS} strings` })
  if (!embeddingsEnabled()) throw createError({ statusCode: 503, statusMessage: 'Embeddings are switched off on this server' })
  const vectors = await localEmbeddingProvider().then(provider => provider.embedBatch(texts)).catch((error) => {
    console.error('[embeddings] embedding failed:', (error as Error).message)
    throw createError({ statusCode: 503, statusMessage: 'The embedding model is not available' })
  })
  return { data: vectors.map((embedding, index) => ({ embedding, index })), model: localEmbeddingModel() }
})
