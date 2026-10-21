defineRouteMeta({
  openAPI: {
    tags: ['Lead forms'], operationId: 'updateLeadForm', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Edit a lead form',
    description: 'Only the keys sent change, and take effect at once. `fields` is the full list, in order: there is always one `email` field (added first when missing), at most one `name`, and every other field\'s `key` is the contact attribute its answer is saved in. `content`, `style` and `settings` merge key by key. `settings.confirmTemplate` must use `{{confirmUrl}}`; `settings.welcomeTemplate` and `settings.sequence` must exist in the project. `active: false` closes the form: its public URL answers 404. Changing `key` moves the public URL. A `file` field takes `accept` (`images`, `documents` or `any`) and `maxMB` (1 to 20), at most three per form, and needs S3 storage on the server. `locale` is the language the form is written in; `translations` (by language tag, each `{ content, fields: { <fieldId>: { label, placeholder, options } } }`) replace that language\'s words, and `null` removes a language. Words a translation leaves out show in the form\'s own language.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', example: { fields: [{ type: 'email', placeholder: 'you@example.com' }, { type: 'select', key: 'platform', label: 'Your phone', options: ['iPhone', 'Android'], required: true }], content: { title: 'Get early access', buttonLabel: 'Count me in' }, style: { layout: 'stacked', radius: 16 }, settings: { doubleOptIn: false, sequence: 'SEQUENCE_ID' } } } } } },
    responses: { 200: { description: '`{ form }`' }, 400: { description: 'Invalid value; every problem is listed.' }, 404: { description: 'Not found.' }, 409: { description: 'The key is taken.' } }
  }
})

export default defineEventHandler(async (event) => {
  const ctx = await requireMember(event, { can: 'content' })
  const { project, row } = await scopedLeadForm(ctx, event)
  await updateLeadForm(project, row, (await readBody(event).catch(() => ({}))) || {})
  return { form: serializeLeadForm(project, row, await leadFormStats(project, row.id || '')) }
})
