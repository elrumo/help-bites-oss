import { expect, test } from 'bun:test'
import { ERROR_COPY_SECTIONS, applyTrackerSettings, bugsinkActionsFor, bugsinkIssueRow, buildErrorPrompt, errorDetailOf, errorDetailText, errorFramePaths, matchRepoPath, issueQuery, pickTrackerSettings } from '#shared/errors'
import { errorLinkOf, errorLinksOf, removeErrorLink, updateErrorLink, verifyErrorWebhook } from '../server/utils/errorTracking'

test('error helpers parse, quote and trim safely', () => {
  expect(issueQuery({ status: 'unresolved', userId: 'a"b', search: 'payment' })).toBe('is:unresolved user.id:"a\\"b" payment')
  expect(buildErrorPrompt({ exception: { values: [{ type: 'Error', value: 'bad' }] }, breadcrumbs: { values: Array.from({ length: 20 }, (_, i) => ({ message: String(i) })) } }).length).toBeLessThan(12_001)
})

test('bugsink helpers shape issues, alerts and status changes', () => {
  const issue = { id: 'u-1', friendly_id: 'HB-3', calculated_type: 'TypeError', calculated_value: 'x is undefined', transaction: '/checkout', digested_event_count: 4, is_resolved: false, is_muted: false }
  expect(bugsinkIssueRow(issue, 'https://bs.example')).toMatchObject({ id: 'u-1', title: 'TypeError: x is undefined', culprit: '/checkout', count: 4, status: 'unresolved', url: 'https://bs.example/issues/issue/u-1/event/last/' })
  expect(bugsinkActionsFor(issue, 'resolved')).toEqual(['resolve'])
  expect(bugsinkActionsFor({ ...issue, is_resolved: true }, 'closed')).toEqual(['reopen', 'mute'])
  expect(bugsinkActionsFor({ ...issue, is_muted: true }, 'open')).toEqual(['unmute'])
  expect(bugsinkActionsFor(issue, 'open')).toEqual([])
})

test('tracker settings resolve whole layers and never carry a token to a new host', () => {
  const required = ['url', 'token', 'org'] as const
  const full = { url: 'https://gt.example', token: 't', org: 'acme' }
  expect(pickTrackerSettings([...required], [['project', { url: 'https://other.example' }], ['global', full], ['env', {}]])).toEqual({ source: 'global', settings: full })
  expect(pickTrackerSettings([...required], [['project', undefined], ['global', undefined], ['env', { url: 'x' }]])).toBeNull()

  expect(applyTrackerSettings(full, { url: 'https://gt.example/', org: 'acme' }, [...required]).settings?.token).toBe('t')
  expect(applyTrackerSettings(full, { url: 'https://evil.example', org: 'acme' }, [...required]).error).toBe('Missing token')
  expect(applyTrackerSettings(full, { url: 'ftp://gt.example', token: 'n', org: 'acme' }, [...required]).error).toMatch(/http/)
  expect(applyTrackerSettings(full, { url: '' }, [...required])).toEqual({ settings: null, error: '' })
})

test('an alert webhook answers an unknown project exactly like a wrong token', () => {
  const error = { provider: 'bugsink', dsn: 'https://k@bs/1', webhookToken: 'secret-token', label: 'web', more: [{ provider: 'bugsink', dsn: 'https://k@bs/2', webhookToken: 'other-secret', label: 'api', linkId: 'ab12' }] }
  const project = { id: 'p1', get: (key: string) => (key === 'errors' ? error : key === 'name' ? 'Acme' : undefined) } as any
  const hook = (token: string) => ({ path: `/v1/webhooks/bugsink/p1?token=${token}` }) as any
  const refusal = (fn: () => unknown) => {
    try { fn() } catch (error) { return { status: (error as { statusCode?: number }).statusCode, message: (error as { statusMessage?: string }).statusMessage } }
    return null
  }
  expect(verifyErrorWebhook(hook('secret-token'), project, 'bugsink')).toMatchObject({ project, link: { linkId: 'main', label: 'web' } })
  expect(verifyErrorWebhook(hook('other-secret'), project, 'bugsink').link).toMatchObject({ linkId: 'ab12', label: 'api' })
  expect(refusal(() => verifyErrorWebhook(hook('secret-token'), project, 'glitchtip'))).toEqual({ status: 401, message: 'Invalid webhook token' })
  expect(refusal(() => verifyErrorWebhook(hook('wrong-token!'), project, 'bugsink'))).toEqual({ status: 401, message: 'Invalid webhook token' })
  expect(refusal(() => verifyErrorWebhook(hook('secret-token'), null, 'bugsink'))).toEqual({ status: 401, message: 'Invalid webhook token' })
})

test('a project lists its tracker projects, the first as main and a legacy one named after the project', () => {
  const project = (errors: unknown) => ({ id: 'p1', get: (key: string) => (key === 'errors' ? errors : key === 'name' ? 'Acme' : undefined) }) as any
  expect(errorLinksOf(project({}))).toEqual([])
  expect(errorLinksOf(project({ dsn: 'https://k@gt/1' }))).toMatchObject([{ linkId: 'main', label: 'Acme' }])
  expect(errorLinksOf(project({ dsn: 'https://k@bs/1', label: 'web', more: [{ dsn: 'https://k@bs/2', linkId: 'ab12', label: 'api' }, { linkId: 'half-made' }] })).map(link => [link.linkId, link.label])).toEqual([['main', 'web'], ['ab12', 'api']])
  expect(errorLinkOf(project({ dsn: 'https://k@bs/1', more: [{ dsn: 'https://k@bs/2', linkId: 'ab12' }] }), 'ab12')?.dsn).toBe('https://k@bs/2')
  expect(errorLinkOf(project({ dsn: 'https://k@bs/1' }), 'gone')).toBeUndefined()
  expect(errorLinkOf(project({ dsn: 'https://k@bs/1' }))?.linkId).toBe('main')
})

const frameEvent = { exception: { values: [{ type: 'TypeError', value: 'x is undefined', stacktrace: { frames: [
  { filename: 'app/pages/index.vue', lineno: 10, in_app: true },
  { filename: 'node_modules/vue/dist/vue.js', lineno: 1, in_app: true },
  { filename: 'https://app.example.com/_nuxt/entry.min.js?v=1', lineno: 1, in_app: true },
  { abs_path: '/build/src/utils/cart.ts', lineno: 42, in_app: true },
  { filename: 'lib/other.ts', lineno: 3, in_app: false },
  { filename: 'src/utils/cart.ts', lineno: 7, in_app: true }
] } }] } }

test('frame paths are the in-app source files, innermost first, without bundles or dependencies', () => {
  expect(errorFramePaths(frameEvent)).toEqual([{ path: 'src/utils/cart.ts', line: 7 }, { path: 'build/src/utils/cart.ts', line: 42 }, { path: 'app/pages/index.vue', line: 10 }])
  expect(errorFramePaths(null)).toEqual([])
})

test('a frame matches one repo path by suffix, either way, or nothing', () => {
  const paths = ['src/utils/cart.ts', 'app/pages/index.vue', 'a/util.ts', 'b/util.ts']
  expect(matchRepoPath('build/src/utils/cart.ts', paths)).toBe('src/utils/cart.ts')
  expect(matchRepoPath('pages/index.vue', paths)).toBe('app/pages/index.vue')
  expect(matchRepoPath('util.ts', paths)).toBeNull()
  expect(matchRepoPath('missing.ts', paths)).toBeNull()
})

test('repo files join the prompt as untrusted data, windowed around the failing line', () => {
  const text = Array.from({ length: 200 }, (_, i) => `line${i + 1}`).join('\n')
  const prompt = buildErrorPrompt(frameEvent, [{ repo: 'acme/web', path: 'src/utils/cart.ts', line: 100, text }])
  expect(prompt).toContain('untrusted data')
  expect(prompt).toContain('--- acme/web/src/utils/cart.ts')
  expect(prompt).toContain('100: line100')
  expect(prompt).not.toContain('line1\n')
  expect(prompt).not.toContain('line200')
  expect(buildErrorPrompt(frameEvent)).not.toContain('untrusted data')
})

test('renaming and removing tracker projects keeps the first one as main', async () => {
  ;(globalThis as any).MASTER = {} // a Nitro auto-import, only passed through to save()
  const stored: Record<string, any> = { dsn: 'https://k@bs/1', webhookToken: 'a', label: 'web', more: [{ dsn: 'https://k@bs/2', webhookToken: 'b', linkId: 'ab12', label: 'api' }, { dsn: 'https://k@bs/3', webhookToken: 'c', linkId: 'cd34', label: 'jobs' }] }
  const project = { id: 'p1', get: (key: string) => (key === 'errors' ? stored.value : key === 'name' ? 'Acme' : undefined), set: (_: string, value: unknown) => { stored.value = value }, save: async () => project } as any
  stored.value = stored
  const labels = () => errorLinksOf(project).map(link => `${link.linkId}:${link.label}`)
  await updateErrorLink(project, 'ab12', { label: ' API server ' })
  await updateErrorLink(project, 'main', { label: 'Web app' })
  expect(labels()).toEqual(['main:Web app', 'ab12:API server', 'cd34:jobs'])
  await expect(updateErrorLink(project, 'ab12', { label: '  ' })).rejects.toMatchObject({ statusCode: 400 })
  await expect(updateErrorLink(project, 'nope', { label: 'x' })).rejects.toMatchObject({ statusCode: 404 })
  await removeErrorLink(project, 'main')
  expect(labels()).toEqual(['main:API server', 'cd34:jobs'])
  expect(errorLinkOf(project, 'main')?.webhookToken).toBe('b')
  await removeErrorLink(project, 'cd34')
  await removeErrorLink(project, 'main')
  expect(errorLinksOf(project)).toEqual([])
  await expect(removeErrorLink(project, 'main')).rejects.toMatchObject({ statusCode: 404 })
})

test('errorDetailText copies the whole error, or just the parts asked for, in a fixed order', () => {
  const detail = errorDetailOf(
    { friendly_id: 'HB-3', is_resolved: false, digested_event_count: 4, first_seen: '2026-11-01', last_seen: '2026-11-02' },
    {
      event_id: 'e1', timestamp: '2026-11-02T10:00:00Z', environment: 'production', request: { method: 'GET', url: '/checkout' },
      exception: { values: [{ type: 'TypeError', value: 'x is undefined', stacktrace: { frames: [{ filename: 'node_modules/lib.js', lineno: 3, function: 'lib', in_app: false }, { filename: 'app/pay.ts', lineno: 9, function: 'pay', in_app: true, context_line: 'x.y()', pre_context: ['const x = a()'], post_context: ['}'] }] } }] },
      breadcrumbs: { values: [{ timestamp: 't1', category: 'ui.click', level: 'info', message: 'Pay' }] },
      tags: [['browser', 'Safari']]
    }
  )
  const meta = { title: 'TypeError: x is undefined', culprit: 'app/pay.ts', url: 'https://gt.example/1', provider: 'GlitchTip', analysis: 'Guard x.' }
  const all = errorDetailText(detail, ERROR_COPY_SECTIONS, meta)
  expect(all.split('\n').filter(line => line.startsWith('## '))).toEqual(['## Stack trace', '## Event details', '## Breadcrumbs', '## Tags', '## AI analysis'])
  expect(all).toContain('# TypeError: x is undefined\n\nException: TypeError: x is undefined\nWhere: app/pay.ts\nIssue: HB-3')
  expect(all).toContain('app/pay.ts:9 in pay\n    const x = a()\n>   x.y()\n    }\nnode_modules/lib.js:3 in lib (library)')
  expect(all).toContain('node_modules/lib.js:3 in lib (library)')
  expect(all).toContain('t1 ui.click [info] Pay')
  expect(all).toContain('## Tags\nbrowser: Safari')
  // Parts are written in a fixed order whatever order they are asked in; unknown parts of an empty event say so.
  expect(errorDetailText(detail, ['tags', 'summary'], meta).indexOf('# TypeError')).toBe(0)
  expect(errorDetailText(detail, ['tags'], meta)).toBe('## Tags\nbrowser: Safari')
  expect(errorDetailText(errorDetailOf({}, {}), ['stack', 'analysis'], { title: 'Error' })).toBe('## Stack trace\n(none)')
})
