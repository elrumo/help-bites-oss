import { DEFAULT_SETTINGS, type EmailBlock, type EmailDocument } from './email/blocks'
import type { SequenceTrigger } from './marketing'
import type { DomainEvent } from './domainEvents'

// Automation recipes: ready-made sequences (shared/marketing.ts) started by a
// domain event (shared/domainEvents.ts). Installing one writes a *draft*
// sequence and its emails into the project, ready to read, change and
// activate; nothing is sent until the operator activates it. A sequence only
// emails people who agreed to marketing mail (`subscription: subscribed`).

export type RecipeStep = { delayMinutes: number, subject: string, heading: string, paragraphs: string[], cta?: { label: string, href: string } }

export type AutomationRecipe = {
  id: string
  name: string
  description: string
  /** What starts it: a sign-up, or the name of a domain event (or one of the derived names in `derivedEvents`). */
  trigger: SequenceTrigger
  steps: RecipeStep[]
}

export const AUTOMATION_RECIPES: AutomationRecipe[] = [
  {
    id: 'welcome-subscribers',
    name: 'Welcome new subscribers',
    description: 'A welcome, a few tips three days later and a check-in after ten days, for everyone who subscribes.',
    trigger: { type: 'subscribed' },
    steps: [
      { delayMinutes: 0, subject: 'Welcome to {{project.name}}', heading: 'Welcome!', paragraphs: ['Thanks for signing up, {{firstName}}. We will only write when we have something worth your time.', 'Reply to this email any time: a person reads it.'] },
      { delayMinutes: 3 * 1440, subject: 'Getting the most out of {{project.name}}', heading: 'Three things worth knowing', paragraphs: ['Replace this with the three things new people ask about most.'] },
      { delayMinutes: 10 * 1440, subject: 'How is it going?', heading: 'How is it going?', paragraphs: ['You joined a little while ago, {{firstName}}. Is there anything we could do better? Just hit reply.'] }
    ]
  },
  {
    id: 'after-onboarding',
    name: 'Follow up after onboarding',
    description: 'When someone finishes your onboarding flow, send tips the next day and a nudge to share feedback a week later.',
    trigger: { type: 'event', event: 'onboarding.completed' },
    steps: [
      { delayMinutes: 1440, subject: 'You are all set, {{firstName}}', heading: 'You are all set', paragraphs: ['Thanks for taking the tour. Here is where to go next.'] },
      { delayMinutes: 7 * 1440, subject: 'What would make {{project.name}} better?', heading: 'We would love your ideas', paragraphs: ['You have had a week with us. What is missing? Tell us on the feedback board and vote on what matters most.'] }
    ]
  },
  {
    id: 'thank-for-feedback',
    name: 'Thank people for their ideas',
    description: 'Ten minutes after someone posts on your feedback board, thank them and tell them what happens next.',
    trigger: { type: 'event', event: 'feedback.post.created' },
    steps: [
      { delayMinutes: 10, subject: 'Thanks for your idea', heading: 'Thanks for sharing that', paragraphs: ['We read every post, {{firstName}}. You will get an email when its status changes.'] }
    ]
  },
  {
    id: 'check-in-after-support',
    name: 'Check in after support',
    description: 'Three days after a conversation is resolved, ask whether the problem is really gone.',
    trigger: { type: 'event', event: 'conversation.resolved' },
    steps: [
      { delayMinutes: 3 * 1440, subject: 'Did we solve it?', heading: 'Did we solve it?', paragraphs: ['We closed your conversation a few days ago, {{firstName}}. If anything is still not right, reply to this email and we will pick it up.'] }
    ]
  }
]

export const recipeById = (id: string): AutomationRecipe | undefined => AUTOMATION_RECIPES.find(r => r.id === id)

/**
 * Event names a sequence can wait for beyond the catalogue's: friendlier
 * names for one case of an event. `conversation.resolved` is
 * `conversation.status_changed` into a resolved or closed status.
 */
export function derivedEvents(event: Pick<DomainEvent, 'type' | 'data'>): string[] {
  if (event.type === 'conversation.status_changed' && (event.data.statusCategory === 'resolved' || event.data.statusCategory === 'closed')) return ['conversation.resolved']
  return []
}

/** Every name a sequence may use as its trigger event for a domain event: its own type and the derived ones. */
export const eventTriggerNames = (event: Pick<DomainEvent, 'type' | 'data'>): string[] => [event.type, ...derivedEvents(event)]

/** The contact id an event is about, when its data says. */
export function eventContactId(event: Pick<DomainEvent, 'data'>): string {
  const contact = event.data.contact as { id?: unknown } | undefined
  return typeof contact?.id === 'string' ? contact.id : typeof event.data.contactId === 'string' ? event.data.contactId : ''
}

/** One step as an email design: a headline, paragraphs, an optional button, and the footer every marketing email must carry. */
export function recipeDocument(step: RecipeStep, index: number): EmailDocument {
  const id = (name: string) => `recipe_${index}_${name}`
  const blocks: EmailBlock[] = [
    { id: id('heading'), type: 'heading', text: step.heading, level: 1, align: 'left', padding: 16 },
    ...step.paragraphs.map((html, i): EmailBlock => ({ id: id(`p${i}`), type: 'text', html, align: 'left', fontSize: 16, padding: 10 })),
    ...(step.cta ? [{ id: id('cta'), type: 'button', label: step.cta.label, href: step.cta.href, align: 'left', backgroundColor: '#4f46e5', color: '#ffffff', padding: 18 } as EmailBlock] : []),
    { id: id('divider'), type: 'divider', thickness: 1, padding: 14 } as EmailBlock,
    { id: id('footer'), type: 'text', html: '{{project.name}} · {{project.address}}<br><a href="{{unsubscribeUrl}}">Unsubscribe</a> · <a href="{{preferencesUrl}}">Email preferences</a>', align: 'center', fontSize: 12, padding: 18 }
  ]
  return { settings: { ...DEFAULT_SETTINGS, title: step.subject, preheader: step.paragraphs[0]?.replace(/<[^>]+>/g, '').slice(0, 120) || '' }, blocks }
}
