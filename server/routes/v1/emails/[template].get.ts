import { senderVariables } from '#shared/email/resolve'
import { parseAcceptLanguage } from '#shared/locales'

defineRouteMeta({
  openAPI: {
    tags: ['Email'], operationId: 'getEmail', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Get a rendered email',
    description: 'Renders one template with the project\'s brand and your variables, ready to hand to any mail provider. Variables are query parameters (`?firstName=Ada`); anything you leave out falls back to its default. With the project secret, `template` is the send key (e.g. `welcome`) or the id; operators and admin keys pass any template id (a master renders with its sample values). `?format=html` returns the HTML document itself instead of JSON, `?format=text` the plain-text part. `?locale=es` renders the Spanish translation, when there is one; `locale` in the answer says which language you got.',
    parameters: [
      { name: 'template', in: 'path', required: true, schema: { type: 'string', example: 'welcome' } },
      { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'html', 'text'] } },
      { name: 'locale', in: 'query', schema: { type: 'string', example: 'es' }, description: 'The language to render in when the template has a translation for it; the template\'s own language otherwise. `Accept-Language` is used when this is left out.' }
    ],
    responses: {
      200: { description: '`{ id, key, name, subject, locale, html, text, variables }`, or `text/html` with `format=html`.', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' }, subject: { type: 'string' }, html: { type: 'string' }, text: { type: 'string' }, variables: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, defaultValue: { type: 'string' } } } } } } }, 'text/html': { schema: { type: 'string' } } } },
      401: { description: 'Project secret, admin key or session required.' },
      404: { description: 'No such template (in this project).' }
    }
  }
})

export default defineEventHandler(async (event) => {
  const { row, project } = await findEmailForApi(event, getRouterParam(event, 'template') || '')
  const { format, locale, ...values } = getQuery(event)
  const rendered = renderEmailTemplate(row, project, cleanVariableValues(values, 10_000), [locale, ...parseAcceptLanguage(getHeader(event, 'accept-language'))])
  if (format === 'html') {
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return rendered.html
  }
  if (format === 'text') {
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return rendered.text
  }
  const template = serializeEmailTemplate(row)
  return { id: template.id, key: template.key, name: template.master?.name || template.name, ...rendered, variables: senderVariables(template, template.master) }
})
