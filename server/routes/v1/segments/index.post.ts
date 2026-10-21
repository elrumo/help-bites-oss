import { EMPTY_SEGMENT } from '#shared/segments'

defineRouteMeta({
  openAPI: {
    tags: ['Contacts'], operationId: 'createSegment', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Create a segment',
    description: '`filter` is `{ match: "all" | "any", rules: [{ field, op, value }] }`. Fields: email, name, externalId, subscription, tags, unsubscribedTopics, sources, origin (how they were added: app, lead_form, signup, import, sync, stripe, api, panel or feedback), leadForms (a lead form id), createdAt, lastSeenAt, updatedAt, or `attributes.<key>`. Ops: is, is_not, contains, starts_with, exists, not_exists, gt, lt, before, after, within_days, not_within_days, includes, excludes.',
    requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, filter: { type: 'object' }, project: { type: 'string' } } }, example: { name: 'Pro users seen this month', filter: { match: 'all', rules: [{ field: 'attributes.plan', op: 'is', value: 'pro' }, { field: 'lastSeenAt', op: 'within_days', value: 30 }] } } } } },
    responses: { 200: { description: '`{ segment }`' }, 400: { description: 'No name, or an invalid filter.' } }
  }
})

export default defineEventHandler(async (event) => {
  const caller = await authenticateEmailCaller(event)
  const body = await readObjectBody(event)
  const project = await callerProject(event, caller, body.project)
  const name = String(body.name || '').trim().slice(0, 80)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'A segment needs a name' })
  const row = new (useParse().Object.extend('ContactSegment'))()
  row.set('project', project)
  row.set('name', name)
  row.set('filter', readSegmentFilter(body.filter ?? EMPTY_SEGMENT))
  await row.save(null, MASTER)
  return { segment: serializeSegment(row) }
})
