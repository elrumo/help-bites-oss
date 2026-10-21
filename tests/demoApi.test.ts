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

test('the demo answers lead forms, their leads and where each contact came from', async () => {
  const { forms } = await demoApi<any>('/admin/lead-forms', { query: { project: 'acme' } })
  expect(forms[0].key).toBe('waitlist')
  const { contacts } = await demoApi<any>('/contacts', { query: { project: 'acme', leadForm: forms[0].id } })
  expect(contacts.length).toBe(forms[0].stats.leads)
  expect(contacts.length).toBeGreaterThan(0)
  expect(contacts.every((c: any) => c.origin.type === 'lead_form')).toBe(true)
  expect((await demoApi<any>('/segments', { query: { project: 'acme' } })).segments.some((s: any) => s.auto && s.id === forms[0].segment)).toBe(true)
})

test('the demo answers a project overview, the page a project lands on', async () => {
  const overview = await demoApi<any>('/admin/projects/acme/overview')
  expect(overview.stats.length).toBeGreaterThan(0)
  expect(overview.health).toBeUndefined()
  expect(overview.setup.total).toBeGreaterThan(0)
  expect(overview.setup.done).toBe(overview.setup.items.filter((item: any) => item.state === 'done').length)
  expect(overview.activity.length).toBeGreaterThan(0)
  expect(overview.activity.every((item: any) => item.conversationId)).toBe(true)
  expect(overview.attention.every((item: any) => item.count > 0)).toBe(true)
})

test('the demo answers the setup checklist, the email setup, the unread badge and what needs attention', async () => {
  const setup = await demoApi<any>('/admin/projects/acme/setup')
  expect(setup).toEqual((await demoApi<any>('/admin/projects/acme/overview')).setup)
  expect(setup.items.find((item: any) => item.key === 'widget').state).toBe('done')
  expect(setup.items.find((item: any) => item.key === 'stripe').state).toBe('done')
  // Fieldnotes has no error tracker yet, and the checklist says so.
  expect((await demoApi<any>('/admin/projects/fieldnotes/setup')).items.find((item: any) => item.key === 'errors').state).toBe('todo')

  const email = await demoApi<any>('/admin/projects/acme/email-setup')
  expect(email).toMatchObject({ sending: true, bulk: true })

  const { unreadMessages } = await demoApi<any>('/admin/unread')
  const attention = await demoApi<any>('/admin/attention')
  expect(unreadMessages).toBeGreaterThan(0)
  expect(attention.unreadMessages).toBe(unreadMessages)
  expect(attention.total).toBe(attention.items.reduce((sum: number, item: any) => sum + item.count, 0))
  expect(attention.items.every((item: any) => item.projectId && item.count > 0)).toBe(true)
  // The bounced address in the demo's log is something to look at.
  expect(attention.items.some((item: any) => item.kind === 'bounces')).toBe(true)
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
  expect(posts.map((post: any) => `${post.type}:${post.status}`)).toEqual(['post:published', 'post:draft', 'page:published'])
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

test('the demo answers the customer panel and the reply picker, so the inbox page loads', async () => {
  const { conversations } = await demoApi<any>('/admin/conversations', { query: { project: 'acme' } })
  for (const { id } of conversations) {
    const context = await demoApi<any>(`/admin/conversations/${id}/context`)
    expect(context.contact.id).toBeTruthy()
    expect(context.pastConversations.every((c: any) => c.id !== id)).toBe(true)
    expect(context.faqModels).toEqual({ models: [], defaultModelId: '' })
    if (context.billing) expect(context.billing).toMatchObject({ currency: 'usd', customerId: expect.stringMatching(/^cus_/) })
  }
  // At least one demo customer pays, so the billing card shows somewhere.
  const all = await Promise.all(conversations.map((c: any) => demoApi<any>(`/admin/conversations/${c.id}/context`)))
  expect(all.some(context => context.billing)).toBe(true)
  const { savedReplies, faqs } = await demoApi<any>(`/admin/conversations/${conversations[0].id}/suggestions`)
  expect(savedReplies.length).toBeGreaterThan(0)
  expect(faqs).toEqual([])
  expect((await demoApi<any>('/admin/saved-replies', { query: { project: 'acme' } })).replies.length).toBe(savedReplies.length)
  await expect(demoApi(`/admin/conversations/${conversations[0].id}/draft`, { method: 'POST' })).rejects.toMatchObject({ statusCode: 403 })
})

test('the demo shows a published pricing table with written prices', async () => {
  const { tables } = await demoApi<any>('/admin/pricing-tables', { query: { project: 'acme' } })
  expect(tables).toHaveLength(1)
  const { table } = await demoApi<any>(`/admin/pricing-tables/${tables[0].id}`)
  expect(table.published.plans.map((p: any) => p.key)).toEqual(['starter', 'pro', 'team'])
  expect(table.published.plans[1].prices.year.amount).toBe(120)
  expect((await demoApi<any>('/admin/stripe/catalog', { query: { project: 'acme' } })).connected).toBe(false)
  const stats = await demoApi<any>(`/admin/pricing-tables/${tables[0].id}/stats`, { query: { days: 30 } })
  expect(stats.total.visitors).toBe(stats.days.reduce((sum: number, d: any) => sum + d.visitors, 0))
  expect(stats.total.revenue.usd).toBeGreaterThan(0)
})
