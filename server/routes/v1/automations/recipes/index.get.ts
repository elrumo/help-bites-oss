import { AUTOMATION_RECIPES } from '#shared/automations'

defineRouteMeta({
  openAPI: {
    tags: ['Campaigns'], operationId: 'listAutomationRecipes', security: [{ ProjectSecret: [] }, { AgentSession: [] }, { AdminApiKey: [] }],
    summary: 'Automation recipes',
    description: 'Ready-made sequences started by an event: a welcome series, a follow-up after onboarding, a thank-you for feedback, a check-in after support. Install one with `POST /v1/automations/recipes/{id}/install`.',
    responses: { 200: { description: '`{ recipes: [{ id, name, description, trigger, steps }] }`' } }
  }
})

export default defineEventHandler(async (event) => {
  await authenticateEmailCaller(event)
  return { recipes: AUTOMATION_RECIPES.map(r => ({ id: r.id, name: r.name, description: r.description, trigger: r.trigger, steps: r.steps.map(s => ({ delayMinutes: s.delayMinutes, subject: s.subject })) })) }
})
