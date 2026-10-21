import { createError } from 'h3'
import { eventContactId, eventTriggerNames, recipeById, recipeDocument, type AutomationRecipe } from '#shared/automations'
import type { DomainEvent } from '#shared/domainEvents'
import type { SequenceTrigger } from '#shared/marketing'
import { contactQuery } from './contacts'
import { onDomainEvent } from './domainEvents'
import { freeKey, reconcileVariables } from './emails'
import { MASTER, useParse, type ParseObject } from './parse'
import { applySequenceInput, enrollContact, serializeSequence } from './sequences'
import { assertFeature, projectWorkspaceId } from './usage'

// Automation recipes (shared/automations.ts) and the bridge that lets a
// domain event start a sequence: the sequence's trigger names the event
// (`{ type: 'event', event: 'onboarding.completed' }`), the bus delivers it.

/** Write a recipe into a project as a draft sequence with its emails. Nothing is sent until the sequence is activated. */
export async function installRecipe(project: ParseObject, recipe: AutomationRecipe) {
  const workspaceId = await projectWorkspaceId(project)
  await assertFeature(workspaceId, 'sequences')
  const Parse = useParse()
  const steps: { delayMinutes: number, template: string, subject: string }[] = []
  for (const [index, step] of recipe.steps.entries()) {
    const document = recipeDocument(step, index)
    const row = new (Parse.Object.extend('EmailTemplate'))() as ParseObject
    row.set('workspace', Parse.Object.extend('Workspace').createWithoutData(workspaceId))
    row.set('project', project)
    row.set('name', `${recipe.name} ${index + 1}`)
    row.set('key', await freeKey(project.id || null, workspaceId, `${recipe.id}-${index + 1}`))
    row.set('document', document)
    row.set('variables', reconcileVariables(document, undefined))
    await row.save(null, MASTER)
    steps.push({ delayMinutes: step.delayMinutes, template: String(row.get('key')), subject: step.subject })
  }
  const sequence = new (Parse.Object.extend('Sequence'))() as ParseObject
  sequence.set('project', project)
  sequence.set('status', 'draft')
  await applySequenceInput(project, sequence, { name: recipe.name, trigger: recipe.trigger, steps })
  await sequence.save(null, MASTER)
  return serializeSequence(sequence)
}

export function requireRecipe(id: string): AutomationRecipe {
  const recipe = recipeById(id)
  if (!recipe) throw createError({ statusCode: 404, statusMessage: 'No such recipe' })
  return recipe
}

/**
 * Start the active sequences that wait for this event for the person it is
 * about. Cheap when nothing waits: one query for the project's event
 * sequences, and the contact is only loaded when one matches.
 */
export async function startSequencesForEvent(event: DomainEvent, project: ParseObject): Promise<number> {
  // Someone who skipped the tour is not someone who finished it.
  if (event.type === 'onboarding.completed' && event.data.outcome === 'skipped') return 0
  const names = eventTriggerNames(event)
  const waiting = (await new (useParse()).Query('Sequence').equalTo('project', project).equalTo('status', 'active').equalTo('trigger.type', 'event').limit(100).find(MASTER))
    .filter(sequence => names.includes((sequence.get('trigger') as SequenceTrigger).event || ''))
  const contactId = eventContactId(event)
  if (!waiting.length || !contactId) return 0
  const contact = await contactQuery(project).equalTo('objectId', contactId).first(MASTER)
  if (!contact) return 0
  let started = 0
  for (const sequence of waiting) if (await enrollContact(sequence, contact)) started++
  return started
}

export function registerAutomations(): void {
  onDomainEvent('automations', '*', async (event, project) => { await startSequencesForEvent(event, project) })
}
