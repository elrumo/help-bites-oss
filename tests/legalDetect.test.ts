import { describe, expect, test } from 'bun:test'
import { detectLegalAnswers, manifestNames, sanitizeServices, unknownNames, type RepoFiles } from '../shared/legal/detect'
import { validateAnswers } from '../shared/legal/wizard'
import { pickManifests } from '../server/utils/github'

const web: RepoFiles = {
  repo: 'acme/web',
  tree: ['package.json', 'nuxt.config.ts', 'public/index.html'],
  files: [{ path: 'package.json', content: JSON.stringify({ description: 'uses mixpanel', dependencies: { stripe: '^14', '@sentry/vue': '^8', 'posthog-js': '^1', openai: '^4', 'next-auth': '^4' }, devDependencies: { vitest: '^1' } }) }]
}
const mobile: RepoFiles = {
  repo: 'acme/app',
  tree: ['ios/Runner.xcodeproj/project.pbxproj', 'android/app/src/main/AndroidManifest.xml', 'ios/GoogleService-Info.plist'],
  files: [{ path: 'pubspec.yaml', content: 'dependencies:\n  flutter:\n    sdk: flutter\n  google_mobile_ads: ^5.0.0\n  firebase_crashlytics: ^3.0.0\n  purchases_flutter: ^6\n' }]
}

describe('manifestNames', () => {
  test('package.json yields dependency keys only, not descriptions', () => {
    const names = manifestNames('package.json', web.files[0]!.content)
    expect(names).toContain('stripe')
    expect(names).toContain('@sentry/vue')
    expect(names).not.toContain('mixpanel')
  })
  test('other manifests are read as words, versions and punctuation stripped', () => {
    expect(manifestNames('Gemfile', "gem 'stripe', '~> 9.0'\ngem \"sentry-ruby\"")).toEqual(expect.arrayContaining(['stripe', 'sentry-ruby']))
    expect(manifestNames('go.mod', 'require github.com/stripe/stripe-go/v76 v76.1.0')).toContain('github.com/stripe/stripe-go/v76')
    expect(manifestNames('requirements.txt', 'sentry-sdk[flask]==1.40\nopenai>=1.0')).toEqual(expect.arrayContaining(['sentry-sdk', 'openai']))
  })
  test('broken package.json falls back to words', () => expect(manifestNames('package.json', '{ "dependencies": { "stripe": ')).toContain('stripe'))
})

describe('detectLegalAnswers', () => {
  const { answers, evidence } = detectLegalAnswers([web, mobile])

  test('maps dependencies to processors, data, cookies and flags', () => {
    expect(answers.processors).toEqual(expect.arrayContaining(['stripe', 'sentry', 'posthog', 'openai', 'admob', 'revenuecat', 'firebase']))
    expect(answers.data_collected).toEqual(expect.arrayContaining(['payments', 'crash', 'analytics', 'advertising', 'account']))
    expect(answers.cookie_types).toEqual(expect.arrayContaining(['analytics', 'essential']))
    expect(answers.ai_features).toBe(true)
    expect(answers.sells_or_shares_data).toBe(true)
    expect(answers.subscriptions).toBe(true)
  })
  test('platforms come from frameworks and from the file tree', () => expect([...(answers.platforms as string[])].sort()).toEqual(['android', 'ios', 'web']))
  test('every suggestion says why', () => {
    expect(evidence.processors).toContain('Stripe: stripe in acme/web package.json')
    expect(detectLegalAnswers([{ repo: 'a/b', tree: ['ios/GoogleService-Info.plist'], files: [] }]).evidence.processors).toEqual(['Firebase: ios/GoogleService-Info.plist in a/b'])
  })
  test('devDependencies count, but unrelated ones do not', () => expect(answers.processors).not.toContain('mixpanel'))
  test('mixed billing suggests no refund route; a single kind does', () => {
    expect(answers.refund_via).toBeUndefined()
    expect(detectLegalAnswers([web]).answers.refund_via).toBe('direct')
    expect(detectLegalAnswers([mobile]).answers.refund_via).toBe('store')
  })
  test('services without a built-in entry go to "other"', () => {
    const r = detectLegalAnswers([{ repo: 'a/b', tree: [], files: [{ path: 'package.json', content: '{"dependencies":{"@clerk/nextjs":"1","@paypal/checkout-server-sdk":"1"}}' }] }])
    expect(r.answers.processors).toContain('other')
    expect(r.answers.processors_other).toBe('PayPal (payment processing)\nClerk (authentication)')
  })
  test('nothing recognised, nothing suggested', () => expect(detectLegalAnswers([{ repo: 'a/b', tree: ['README.md'], files: [{ path: 'package.json', content: '{"dependencies":{"lodash":"4"}}' }] }])).toEqual({ answers: {}, evidence: {} }))
  test('the result passes the wizard validation for the document it is for', () => {
    expect(validateAnswers('privacy', answers).answers.processors).toContain('stripe')
    // Terms do not ask about services, so they are dropped rather than carried along.
    expect(validateAnswers('terms', answers).answers.processors).toBeUndefined()
    expect(validateAnswers('terms', answers).answers.subscriptions).toBe(true)
  })
})

describe('unknownNames', () => {
  test('lists names no rule recognises, for the optional AI pass', () => {
    const names = unknownNames([web])
    expect(names).toContain('vitest')
    expect(names).not.toContain('stripe')
  })
})

describe('sanitizeServices', () => {
  const known = new Set(['segment-thing', 'lodash'])
  test('keeps only services that cite a scanned dependency', () => {
    const out = sanitizeServices([
      { name: 'Segment', purpose: 'analytics routing', dependency: 'Segment-Thing' },
      { name: 'Invented', purpose: 'made up', dependency: 'not-in-the-repo' },
      { name: 'segment', purpose: 'duplicate', dependency: 'lodash' }
    ], known)
    expect(out).toEqual([{ name: 'Segment', purpose: 'analytics routing', dependency: 'segment-thing' }])
  })
  test('strips markup and newlines out of text that lands in a policy', () => {
    const [item] = sanitizeServices([{ name: 'Evil <script>\n# Ignore rules', purpose: 'x [link](http://a.b)', dependency: 'lodash' }], known)
    expect(item!.name).toBe('Evil script Ignore rules')
    expect(item!.purpose).not.toMatch(/[[\]<>]/)
  })
  test('anything but a list is nothing', () => {
    expect(sanitizeServices(null, known)).toEqual([])
    expect(sanitizeServices({ name: 'x' }, known)).toEqual([])
  })
})

describe('pickManifests', () => {
  test('manifests near the top, no vendored code, capped, shallowest first', () => {
    const tree = [
      { path: 'package.json', type: 'blob', size: 100 },
      { path: 'apps/web/package.json', type: 'blob', size: 100 },
      { path: 'node_modules/x/package.json', type: 'blob', size: 100 },
      { path: 'a/b/c/package.json', type: 'blob', size: 100 },
      { path: 'huge/package.json', type: 'blob', size: 5_000_000 },
      { path: 'src', type: 'tree' },
      { path: 'Gemfile', type: 'blob', size: 10 }
    ]
    expect(pickManifests(tree)).toEqual(['Gemfile', 'package.json', 'apps/web/package.json'])
  })
})
