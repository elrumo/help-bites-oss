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

test('the demo archives, unarchives and deletes conversations', async () => {
  const { conversations } = await demoApi<any>('/admin/conversations', { query: { project: 'acme' } })
  const id = conversations[0].id
  await demoApi(`/admin/conversations/${id}/archive`, { method: 'POST', body: {} })
  expect((await demoApi<any>('/admin/conversations', { query: { project: 'acme' } })).conversations.map((c: any) => c.id)).not.toContain(id)
  const archived = await demoApi<any>('/admin/conversations', { query: { project: 'acme', archived: 'true' } })
  expect(archived.conversations.map((c: any) => c.id)).toEqual([id])
  expect(archived.archivedCount).toBe(1)

  await demoApi(`/admin/conversations/${id}/archive`, { method: 'POST', body: { archived: false } })
  expect((await demoApi<any>('/admin/conversations', { query: { project: 'acme' } })).conversations.map((c: any) => c.id)).toContain(id)

  await demoApi(`/admin/conversations/${id}`, { method: 'DELETE' })
  await expect(demoApi(`/admin/conversations/${id}`)).rejects.toMatchObject({ statusCode: 404 })
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

test('the demo answers the workspace overview, the page the panel opens on', async () => {
  const overview = await demoApi<any>('/admin/overview', { query: { range: '90d' } })
  expect(overview.projects.map((p: any) => p.id)).toEqual(['acme', 'fieldnotes'])
  expect(overview.unread.length).toBeGreaterThan(0)
  expect(overview.unread.every((u: any) => u.unread > 0 && u.conversationId)).toBe(true)
  expect(overview.totals.unread).toBe(overview.projects.reduce((sum: number, p: any) => sum + p.unread, 0))
  const { revenue } = overview
  expect(revenue.range).toBe('90d')
  expect(revenue.totals[0].net).toBe(revenue.projects.reduce((sum: number, p: any) => sum + p.net, 0))
  expect(revenue.totals[0].months).toHaveLength(12)
  expect(revenue.projects[0].net).toBeGreaterThanOrEqual(revenue.projects[1].net)
  expect((await demoApi<any>('/admin/overview', { query: { range: 'all' } })).revenue.totals[0].change).toBeNull()
})

test('the demo answers the Revenue tab with the overview\'s numbers', async () => {
  const { connection } = await demoApi<any>('/admin/stripe', { query: { project: 'acme' } })
  expect(connection).toMatchObject({ connected: true, currency: 'usd' })
  const { report } = await demoApi<any>('/admin/stripe/report', { query: { project: 'acme', range: '90d' } })
  const { revenue } = await demoApi<any>('/admin/overview', { query: { range: '90d' } })
  expect(report.net).toBe(revenue.projects.find((p: any) => p.projectId === 'acme').net)
  expect(report.months).toHaveLength(12)
  expect(report.months.at(-1).mrr).toBe(report.mrr)
  expect(report.plans.reduce((sum: number, p: any) => sum + p.mrr, 0)).toBe(report.mrr)
  const { contacts } = await demoApi<any>('/contacts', { query: { project: 'acme' } })
  expect(contacts.find((c: any) => c.email === 'priya@example.com').attributes.stripe_revenue).toBe(1176)
})

test('the demo blog has Acme\'s posts, opens one, and refuses writes', async () => {
  const { posts } = await demoApi<any>('/admin/blog/posts', { query: { project: 'acme' } })
  expect(posts.map((post: any) => post.status)).toEqual(['published', 'draft'])
  const { post } = await demoApi<any>(`/admin/blog/posts/${posts[0].id}`)
  expect(post.title).toBe(posts[0].title)
  expect(await demoApi<any>('/admin/blog/comments', { query: { project: 'acme' } })).toEqual({ comments: [], total: 0, hasMore: false })
  expect(await demoApi<any>('/admin/blog/posts', { query: { project: 'fieldnotes' } })).toEqual({ posts: [] })
  await expect(demoApi('/admin/blog/posts', { method: 'POST', body: { project: 'acme', title: 'x' } })).rejects.toMatchObject({ statusCode: 403 })
})

test('the demo changelog has Acme\'s release and drafts, and refuses writes', async () => {
  const { entries } = await demoApi<any>('/admin/changelog/entries', { query: { project: 'acme' } })
  expect(entries.some((e: any) => e.status === 'published')).toBe(true)
  expect(entries.some((e: any) => e.status === 'draft')).toBe(true)
  const { releases } = await demoApi<any>('/admin/changelog/releases', { query: { project: 'acme' } })
  expect(entries.filter((e: any) => e.releaseId).every((e: any) => releases.some((r: any) => r.id === e.releaseId))).toBe(true)
  expect(await demoApi<any>('/admin/changelog/entries', { query: { project: 'fieldnotes' } })).toEqual({ entries: [] })
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
