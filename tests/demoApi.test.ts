import { expect, test } from 'bun:test'
import { demoApi } from '../app/utils/demoApi'

test('the demo answers the inbox from memory and refuses what it does not fake', async () => {
  const { conversations, totalUnread } = await demoApi<any>('/admin/conversations', { query: { project: 'acme', status: undefined } })
  expect(conversations.length).toBeGreaterThan(0)
  expect(conversations.every((c: any) => c.projectId === 'acme')).toBe(true)
  expect(totalUnread).toBeGreaterThan(0)

  const id = conversations[0].id
  const sent = await demoApi<any>(`/admin/conversations/${id}/messages`, { method: 'POST', body: { body: 'On it!' } })
  expect(sent.conversation.lastMessagePreview).toBe('On it!')
  const { messages } = await demoApi<any>(`/admin/conversations/${id}/messages`)
  expect(messages.at(-1).body).toBe('On it!')

  const { conversation } = await demoApi<any>(`/admin/conversations/${id}/status`, { method: 'POST', body: { status: 'done' } })
  expect(conversation.statusCategory).toBe('resolved')

  await expect(demoApi('/admin/knowledge/models', { method: 'POST', body: {} })).rejects.toMatchObject({ statusCode: 403 })
})

test('the demo answers the CRM: contacts, segments and sources', async () => {
  const { contacts } = await demoApi<any>('/contacts', { query: { project: 'acme' } })
  expect(contacts.length).toBeGreaterThan(0)
  expect(contacts[0]).toMatchObject({ subscription: expect.any(String), attributes: expect.any(Object) })
  const { segment } = await demoApi<any>('/segments', { method: 'POST', body: { project: 'acme', name: 'Pro', filter: { match: 'all', rules: [] } } })
  expect((await demoApi<any>('/segments', { query: { project: 'acme' } })).segments.map((s: any) => s.id)).toContain(segment.id)
  expect((await demoApi<any>('/segments/preview', { method: 'POST', body: { project: 'acme' } })).count).toBe(contacts.length)
  expect((await demoApi<any>('/admin/contact-sources', { query: { project: 'acme' } })).kinds).toHaveLength(3)
})

test('the demo answers a project overview, the page a project lands on', async () => {
  const overview = await demoApi<any>('/admin/projects/acme/overview')
  expect(overview.stats.length).toBeGreaterThan(0)
  expect(overview.health.length).toBeGreaterThan(0)
  expect(overview.activity.length).toBeGreaterThan(0)
  expect(overview.activity.every((item: any) => item.conversationId)).toBe(true)
  expect(overview.attention.every((item: any) => item.count > 0)).toBe(true)
})

test('the demo changelog starts empty and refuses writes', async () => {
  expect(await demoApi<any>('/admin/changelog/entries', { query: { project: 'acme' } })).toEqual({ entries: [] })
  expect(await demoApi<any>('/admin/changelog/releases', { query: { project: 'acme' } })).toEqual({ releases: [] })
  await expect(demoApi('/admin/changelog/entries', { method: 'POST', query: { project: 'acme' }, body: { title: 'x' } })).rejects.toMatchObject({ statusCode: 403 })
})

test('the demo is on the unlimited plan, so the panel shows no plan or limits', async () => {
  const me = await demoApi<any>('/admin/me')
  expect(me.plan).toEqual({ id: 'unlimited', name: 'Unlimited', unlimited: true })
  expect(me.features).toMatchObject({ teammatePasswords: true, byoLlm: true, campaigns: true })

  const usage = await demoApi<any>('/admin/usage')
  expect(usage.unlimited).toBe(true)
  expect(Object.values(usage.limits).every(limit => limit === null)).toBe(true)
  expect(usage.usage.projects).toBeGreaterThan(0)

  expect(await demoApi<any>('/admin/workspace/ai')).toEqual({ ai: null, platform: { available: true, metered: false }, allowed: true })
  await expect(demoApi('/admin/workspace/ai', { method: 'PUT', body: { endpoint: 'https://api.openai.com/v1' } })).rejects.toMatchObject({ statusCode: 403 })
})
