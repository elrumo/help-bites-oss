import { describe, expect, test } from 'bun:test'
import { AUTOMATION_RECIPES, derivedEvents, eventContactId, eventTriggerNames, recipeDocument } from '../shared/automations'
import { DOMAIN_EVENT_TYPES } from '../shared/domainEvents'
import { validateSequenceInput } from '../shared/marketing'
import { extractTemplateVariables } from '../shared/email/placeholders'

describe('automation recipes', () => {
  test('every recipe is a valid sequence on a real event, with steps that fit', () => {
    for (const recipe of AUTOMATION_RECIPES) {
      const steps = recipe.steps.map((s, i) => ({ delayMinutes: s.delayMinutes, template: `${recipe.id}-${i + 1}`, subject: s.subject }))
      const { errors, trigger } = validateSequenceInput({ trigger: recipe.trigger, steps })
      expect(errors).toEqual([])
      if (trigger.type === 'event') expect([...DOMAIN_EVENT_TYPES, 'conversation.resolved']).toContain(trigger.event)
    }
    expect(new Set(AUTOMATION_RECIPES.map(r => r.id)).size).toBe(AUTOMATION_RECIPES.length)
  })

  test('every email carries the unsubscribe link and the postal address activation checks for', () => {
    for (const recipe of AUTOMATION_RECIPES) {
      for (const [i, step] of recipe.steps.entries()) {
        const keys = extractTemplateVariables(recipeDocument(step, i))
        expect(keys).toContain('unsubscribeUrl')
        expect(keys).toContain('project.address')
      }
    }
  })

  test('a resolved conversation also answers to conversation.resolved, an open one does not', () => {
    expect(derivedEvents({ type: 'conversation.status_changed', data: { statusCategory: 'resolved' } })).toEqual(['conversation.resolved'])
    expect(derivedEvents({ type: 'conversation.status_changed', data: { statusCategory: 'closed' } })).toEqual(['conversation.resolved'])
    expect(derivedEvents({ type: 'conversation.status_changed', data: { statusCategory: 'open' } })).toEqual([])
    expect(eventTriggerNames({ type: 'onboarding.completed', data: {} })).toEqual(['onboarding.completed'])
  })

  test('the person an event is about comes from data.contact', () => {
    expect(eventContactId({ data: { contact: { id: 'c1' } } })).toBe('c1')
    expect(eventContactId({ data: { contactId: 'c2' } })).toBe('c2')
    expect(eventContactId({ data: {} })).toBe('')
  })
})
