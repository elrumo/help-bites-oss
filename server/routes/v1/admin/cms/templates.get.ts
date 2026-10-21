import { CMS_TEMPLATES } from '#shared/cms/library'

defineRouteMeta({
  openAPI: {
    tags: ['Pages'], operationId: 'listCmsTemplates', security: [{ AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'List page templates',
    description: 'The templates a new page can start from (`template` when creating an entry): id, name, description, style and content. `{project}` in their copy becomes the project\'s name.',
    responses: { 200: { description: '`{ templates }`' } }
  }
})

export default defineEventHandler(async (event) => {
  await requireMember(event, { can: 'content' })
  return { templates: CMS_TEMPLATES }
})
