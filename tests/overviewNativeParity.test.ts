import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ATTENTION_KINDS } from '../shared/attention'
import { EMAIL_SETUP_CHECKS } from '../shared/emailSetup'
import { SETUP_KEYS, SETUP_REASONS } from '../shared/setup'

// The native app words the setup checklist, the needs-attention list, the
// assistant readiness strip and its test answer by hand (it has no
// translations). This keeps those sentences, and the ticket-action webhook
// warning, the same as the web's in en.json.

const root = join(import.meta.dir, '..')
const en = JSON.parse(readFileSync(join(root, 'i18n/locales/en.json'), 'utf8'))
const app = (path: string) => join(root, 'helpbites-native/App', path)
const read = (path: string) => readFileSync(app(path), 'utf8')
const folder = (path: string) => readdirSync(app(path)).filter(name => name.endsWith('.swift')).map(name => read(`${path}/${name}`)).join('\n')
const get = (key: string): string => key.split('.').reduce((o: any, k) => o?.[k], en)

/** The words of an en.json string that Swift must spell out: each piece between `{placeholders}` and plural bars. */
const pieces = (text: string) => text.split(/\{\w+\}|\s\|\s/).map(piece => piece.trim()).filter(piece => piece.length > 2)
const missing = (source: string, keys: string[]) => keys.flatMap(key => pieces(get(key)).filter(piece => !source.includes(piece)).map(piece => `${key}: ${piece}`))

describe('native overview parity', () => {
  const setup = read('Features/Projects/ProjectsModels.swift')
  const overview = read('Features/Overview/OverviewModels.swift')

  test('every setup row and reason is worded as on the web', () => {
    const pairs = SETUP_KEYS.flatMap(key => SETUP_REASONS[key].map(reason => `${key}.${reason}`))
    expect(pairs.filter(pair => !setup.includes(`case "${pair}"`))).toEqual([])
    expect(missing(setup, pairs.map(pair => `setup.${pair}`))).toEqual([])
    expect(missing(setup, SETUP_KEYS.map(key => `setup.${key}.title`))).toEqual([])
  })

  test('every needs-attention kind is worded as on the web', () => {
    expect(ATTENTION_KINDS.filter(kind => !overview.includes(`case "${kind}"`))).toEqual([])
    expect(missing(overview, ATTENTION_KINDS.map(kind => `attention.${kind}`))).toEqual([])
  })

  test('the project overview lists needs attention, setup and the latest activity, and no longer reads health', () => {
    const screen = read('Features/Projects/ProjectScreen.swift')
    expect(screen).not.toContain('health')
    expect(missing(screen + read('Features/Overview/OverviewScreen.swift'), ['overview.needsAttention', 'projectPages.overview.allClear', 'setup.title'])).toEqual([])
  })
})

describe('native assistant parity', () => {
  const assistants = folder('Features/Assistants')

  test('the readiness strip says what the web says', () => {
    const keys = ['llm', 'knowledge', 'active', 'autoReply'].flatMap(key => [`assistants.readiness.${key}.ok`, `assistants.readiness.${key}.todo`, `assistants.readiness.${key}.fix`])
    expect(missing(assistants, [...keys.filter(key => get(key)), 'assistants.readiness.live', 'assistants.readiness.notLive'])).toEqual([])
  })

  test('the test answer words its outcome, its reason and what it found like the web', () => {
    const keys = ['answer', 'handoff', 'silent'].map(o => `assistants.test.outcome.${o}`)
      .concat(['rule', 'default', 'noKnowledge', 'lowConfidence', 'confident'].map(r => `assistants.test.reason.${r}`))
      .concat(['title', 'run', 'notLive', 'ruleLetThrough', 'ruleType', 'ruleKeywords', 'wouldSend', 'noProvider', 'found', 'supportType'].map(k => `assistants.test.${k}`))
    expect(missing(assistants, keys)).toEqual([])
  })

  test('the Swift models decode what the test-answer and readiness endpoints return', () => {
    for (const field of ['outcome', 'reason', 'ruleIndex', 'best', 'minConfidence', 'canAnswer', 'live', 'faqs', 'knowledge', 'pathCache', 'answer', 'model']) expect(assistants).toContain(field)
  })
})

describe('native email setup parity', () => {
  const email = folder('Features/Email') + folder('Features/Campaigns')

  test('the strip words every check the server can fail, and its header, as the web does', () => {
    const states: Record<string, string> = { mailer: 'todo', sender: 'todo', webhook: 'warn', postalAddress: 'todo', paused: 'todo' }
    expect(Object.keys(states)).toEqual([...EMAIL_SETUP_CHECKS])
    const keys = EMAIL_SETUP_CHECKS.flatMap(key => [`emailSetup.${key}.title`, `emailSetup.${key}.${states[key]}`])
    expect(missing(email, [...keys, 'emailSetup.blocked', 'emailSetup.nudge', 'emailSetup.openSettings'])).toEqual([])
  })

  test('a project\'s email tabs are the web\'s five, with the component library and suppressions behind two of them', () => {
    const tabs = /enum EmailTab[^{]*\{[\s\S]*?case ([^\n]+)/.exec(email)?.[1]?.split(',').map(c => c.trim()) || []
    expect(tabs).toEqual(['templates', 'components', 'campaigns', 'sequences', 'log', 'suppressed', 'settings'])
    expect(email).toContain('[.templates, .campaigns, .sequences, .log, .settings]')
    expect(missing(email, ['emailSettings.sender', 'emailSettings.separate', 'emailSettings.separateDescription'])).toEqual([])
  })
})

describe('native ticket action warning parity', () => {
  test('the ticket type editor and the inbox warn about a missing action webhook in the web\'s words', () => {
    expect(missing(folder('Features/Tickets'), ['projectTools.types.noWebhookTitle', 'projectTools.types.noWebhookDescription', 'projectTools.types.noWebhookFix'])).toEqual([])
    expect(missing(folder('Features/Inbox'), ['inbox.actionsNoWebhook', 'inbox.actionsNoWebhookFix'])).toEqual([])
  })
})
