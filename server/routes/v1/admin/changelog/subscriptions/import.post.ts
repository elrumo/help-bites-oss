defineRouteMeta({
  openAPI: {
    tags: ['Changelog'], operationId: 'importChangelogSubscriptions', security: [{ AgentSession: [] }, { AdminApiKey: [] }, { ProjectSecret: [] }],
    summary: 'Import changelog subscribers from another system',
    description: 'Up to 500 `subscriptions` `{ externalId, email, userId, displayName, frequency, pendingFrequency, status, source, confirmedAt, unsubscribedAt, confirmSentAt }`: created, or updated when the `externalId` (or the email) exists. Unsubscribed ones come over as the suppression record they are, and an import never reactivates someone who unsubscribed here. `externalId: "parse:<id>"` keeps links the old system already mailed working (they carry that id), given the same `CHANGELOG_LINK_SECRET`. Also `runs`, the past sends `{ kind, windowStart, windowEnd, finishedAt }`, so the first weekly sweep does not repeat a week already mailed. Nobody is emailed. Not for an admin token.',
    parameters: [{ name: 'project', in: 'query', schema: { type: 'string' }, description: 'Project id. An operator names it; the project secret acts on its own project' }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { subscriptions: { type: 'array', maxItems: 500, items: { type: 'object', required: ['externalId', 'email'], properties: { externalId: { type: 'string' }, email: { type: 'string' }, userId: { type: 'string' }, displayName: { type: 'string' }, frequency: { type: 'string', enum: ['instant', 'weekly'] }, pendingFrequency: { type: 'string', enum: ['instant', 'weekly'], nullable: true }, status: { type: 'string', enum: ['pending', 'active', 'unsubscribed'] }, source: { type: 'string', enum: ['user', 'anonymous'] }, confirmedAt: { type: 'string', format: 'date-time' }, unsubscribedAt: { type: 'string', format: 'date-time' }, confirmSentAt: { type: 'string', format: 'date-time' } } } }, runs: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['instant', 'weekly'] }, windowStart: { type: 'string', format: 'date-time' }, windowEnd: { type: 'string', format: 'date-time' }, finishedAt: { type: 'string', format: 'date-time' } } } } } } } } },
    responses: { 200: { description: 'What was imported and what failed.' }, 400: { description: 'Nothing to import, or too many.' }, 403: { description: 'An admin token cannot import.' } }
  }
})

export default defineEventHandler(async (event) => {
  const writer = await requireChangelogWriter(event)
  requireServerWriter(writer)
  const project = await changelogWriterProject(event, writer)
  return await importChangelogSubscriptions(project, await readBody(event).catch(() => ({})))
})
