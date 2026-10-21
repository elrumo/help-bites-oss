// End-to-end proof that one workspace can never see or touch another's data.
//
// Workspace A (the operator in AGENT_USER) makes one of everything. Workspace B
// is created by A, and gets its own operator by invitation. That operator then
// tries every route with A's ids, lists, searches and listens on the live
// stream. Every by-id attempt must fail (404, or 403 where a role or key is
// refused), no list or search may mention A's rows, B's stream must stay quiet
// while A's inbox is busy, and A's rows must all still be there afterwards.
//
//   AGENT_USER=… AGENT_PASS=… bun scripts/smoke-isolation.mjs   # BASE defaults to the dev server

import { createHmac } from 'node:crypto'

const BASE = (process.env.BASE || 'http://localhost:3100').replace(/\/+$/, '')
const AGENT_USER = process.env.AGENT_USER || ''
const AGENT_PASS = process.env.AGENT_PASS || ''
if (!AGENT_USER || !AGENT_PASS) {
  console.error('Set AGENT_USER and AGENT_PASS to an operator account on the stack under test.')
  process.exit(2)
}
const MARK = `iso${Date.now().toString(36)}`
// B's own rows carry a different tag, so finding MARK in B's lists always means a leak.
const TAG_B = `mal${Date.now().toString(36)}`
let failures = 0

function mint(secret, claims, ttl = 3600) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ iat: now, exp: now + ttl, ...claims })
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`
}

async function call(path, { token, workspace, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspace ? { 'X-Workspace': workspace } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json = {}
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

async function api(path, options = {}) {
  const res = await call(path, options)
  if (res.status >= 300) throw new Error(`${options.method || 'GET'} ${path} → ${res.status} ${res.json.statusMessage || res.text.slice(0, 200)}`)
  return res.json
}

function check(cond, label) {
  if (cond) console.log(`ok  ${label}`)
  else {
    failures++
    console.log(`FAIL ${label}`)
  }
}

/** A multipart upload (brand kit files, onboarding pictures): `fields` plus a tiny PNG as `file`. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
async function upload(path, fields, { token, workspace } = {}) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  form.append('file', new Blob([PNG], { type: 'image/png' }), `${MARK}.png`)
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspace ? { 'X-Workspace': workspace } : {}) } })
  const text = await res.text()
  let json = {}
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

/** Run a creation that may not apply on this stack (no Mailgun, no secret…). */
async function maybe(label, fn) {
  try {
    return await fn()
  } catch (error) {
    console.log(`skip ${label}: ${error.message}`)
    return null
  }
}

// ---- workspace A: the victim ---------------------------------------------------

const login = await api('/v1/admin/login', { method: 'POST', body: { login: AGENT_USER, password: AGENT_PASS } })
const tokenA = login.sessionToken
const me = await api('/v1/admin/me', { token: tokenA })
const WA = me.workspace.id
const A = { token: tokenA, workspace: WA }
console.log(`workspace A ${WA}, marker ${MARK}`)

const { project, secret } = await api('/v1/admin/projects', { ...A, method: 'POST', body: { name: `${MARK} A`, siteUrl: 'https://a.example.test', allowedOrigins: ['https://a.example.test'] } })
const userToken = mint(secret, { iss: project.publicKey, sub: `${MARK}-user`, name: `${MARK} Customer`, email: `${MARK}@a.example.test` })
const started = await api('/v1/conversations', { token: userToken, method: 'POST', body: { subject: `${MARK} subject`, body: `${MARK} hello`, clientId: `${MARK}-1` } })
const conversationId = started.conversation.id
const messageId = started.message.id
const contact = await maybe('contact', () => api('/v1/contacts', { ...A, method: 'POST', body: { project: project.id, email: `${MARK}-c@a.example.test`, name: `${MARK} Contact` } }))
const segment = await maybe('segment', () => api('/v1/segments', { ...A, method: 'POST', body: { project: project.id, name: `${MARK} segment`, filter: { all: [] } } }))
const master = await api('/v1/admin/emails', { ...A, method: 'POST', body: { name: `${MARK} master` } })
const projectTemplate = await api('/v1/admin/emails', { ...A, method: 'POST', body: { name: `${MARK} template`, project: project.id } })
const folder = await api('/v1/admin/email-folders', { ...A, method: 'POST', body: { name: `${MARK} folder` } })
const component = await maybe('component', () => api('/v1/admin/email-components', { ...A, method: 'POST', body: { name: `${MARK} component`, html: '<p>{{@text}}</p>' } }))
const suppression = await maybe('suppression', () => api('/v1/admin/email-suppressions', { ...A, method: 'POST', body: { project: project.id, emails: [`${MARK}-s@a.example.test`], reason: 'manual' } }))
const { model } = await api('/v1/admin/knowledge/models', { ...A, method: 'POST', body: { projectId: project.id, name: `${MARK} model` } })
const node = await maybe('node', () => api('/v1/admin/knowledge/nodes', { ...A, method: 'POST', body: { modelId: model.id, name: `${MARK} node` } }))
const faq = await maybe('faq', () => api('/v1/admin/knowledge/faqs', { ...A, method: 'POST', body: { modelId: model.id, question: `${MARK} question?`, answer: 'An answer', ...(node?.node ? { nodeId: node.node.id } : {}) } }))
const { agent: assistant } = await api('/v1/admin/support-agents', { ...A, method: 'POST', body: { name: `${MARK} assistant`, projectId: project.id } })
const { item } = await api(`/v1/admin/board-items?project=${project.id}`, { ...A, method: 'POST', body: { title: `${MARK} item` } })
const { release } = await api(`/v1/admin/changelog/releases?project=${project.id}`, { ...A, method: 'POST', body: { version: `9.${Date.now() % 1000}` } })
const { entry } = await api(`/v1/admin/changelog/entries?project=${project.id}`, { ...A, method: 'POST', body: { title: `${MARK} entry` } })
await api(`/v1/admin/projects/${project.id}`, { ...A, method: 'PATCH', body: { feedback: { enabled: true } } })
const { post } = await api('/v1/feedback', { token: userToken, method: 'POST', body: { title: `${MARK} idea` } })
const keyA = await api('/v1/admin/api-keys', { ...A, method: 'POST', body: { name: `${MARK} key` } })
const { flow } = await api('/v1/admin/onboarding/flows', { ...A, method: 'POST', body: { project: project.id, name: `${MARK} flow` } })
const { form: leadForm } = await api('/v1/admin/lead-forms', { ...A, method: 'POST', body: { project: project.id, name: `${MARK} form` } })
const leadFile = await maybe('lead form file (needs S3)', async () => {
  const { form } = await api(`/v1/admin/lead-forms/${leadForm.id}`, { ...A, method: 'PATCH', body: { fields: [...leadForm.fields, { type: 'file', key: 'shot', label: 'Shot', accept: 'images' }] } })
  const body = new FormData()
  body.append('email', `${MARK.toLowerCase()}-lead@a.example.test`)
  body.append('shot', new Blob([PNG], { type: 'image/png' }), `${MARK}.png`)
  const res = await fetch(`${BASE}/v1/forms/${project.publicKey}/${form.key}`, { method: 'POST', body })
  if (res.status !== 202) throw new Error(`${res.status} ${await res.text()}`)
  return (await api(`/v1/admin/lead-files?project=${project.id}&form=${leadForm.id}`, A)).files[0]
})
const { table: pricingTable } = await api('/v1/admin/pricing-tables', { ...A, method: 'POST', body: { project: project.id, name: `${MARK} pricing` } })
await api(`/v1/admin/brand?project=${project.id}`, { ...A, method: 'PATCH', body: { tagline: `${MARK} tagline` } })
const brandUpload = await maybe('brand file (needs S3)', async () => {
  const res = await upload('/v1/admin/brand/assets', { project: project.id, name: `${MARK} logo` }, A)
  if (res.status >= 300) throw new Error(`${res.status} ${res.json.statusMessage || ''}`)
  return res.json.asset
})
const { component: cmsComponent } = await api('/v1/admin/cms/components', { ...A, method: 'POST', body: { project: project.id, key: `${MARK}_card`.toLowerCase(), name: `${MARK} card`, fields: [{ key: 'text', type: 'text' }], html: '<div>{{@text}}</div>' } })
const { entry: cmsEntry } = await api('/v1/admin/cms/entries', { ...A, method: 'POST', body: { project: project.id, name: `${MARK} page`, template: 'waitlist' } })
await api(`/v1/admin/cms/settings`, { ...A, method: 'PATCH', body: { project: project.id, brief: { audience: `${MARK} audience` } } })
await api(`/v1/admin/projects/${project.id}`, { ...A, method: 'PATCH', body: { blog: { enabled: true } } })
const { post: blogPost } = await api('/v1/admin/blog/posts', { ...A, method: 'POST', body: { project: project.id, title: `${MARK} story`, body: `${MARK} words`, status: 'published' } })
const { comment: blogComment } = await api(`/v1/blog/${blogPost.slug}/comments`, { token: userToken, method: 'POST', body: { body: `${MARK} reader comment` } })
const cmsUpload = await maybe('pages file (needs S3)', async () => {
  const res = await upload('/v1/admin/cms/assets', { project: project.id, name: `${MARK} shot` }, A)
  if (res.status >= 300) throw new Error(`${res.status} ${res.json.statusMessage || ''}`)
  return res.json.asset
})

// ---- workspace B: the attacker -------------------------------------------------

const { workspace: wb } = await api('/v1/admin/workspaces', { token: tokenA, method: 'POST', body: { name: `${TAG_B} B` } })
const WB = wb.id
const invite = await api('/v1/admin/invitations', { token: tokenA, workspace: WB, method: 'POST', body: { email: `${TAG_B}@b.example.test`, role: 'admin' } })
const inviteToken = invite.url.split('/invite/')[1]
const joined = await api(`/v1/invitations/${inviteToken}/accept`, { method: 'POST', body: { name: 'Mallory', password: `${TAG_B}-pass-123` } })
const tokenB = joined.sessionToken
const B = { token: tokenB, workspace: WB }
const meB = await api('/v1/admin/me', { token: tokenB })
check(meB.workspace.id === WB && meB.workspaces.length === 1, 'B\'s operator belongs to B only')
const keyB = (await api('/v1/admin/api-keys', { ...B, method: 'POST', body: { name: 'b key' } })).key
const { project: projectB } = await api('/v1/admin/projects', { ...B, method: 'POST', body: { name: `${TAG_B} project` } })
const contactB = await maybe('contact in B', () => api('/v1/contacts', { ...B, method: 'POST', body: { project: projectB.id, email: `${TAG_B}-c@b.example.test`, name: `${TAG_B} Contact` } }))
const { agent: assistantB } = await api('/v1/admin/support-agents', { ...B, method: 'POST', body: { name: 'b assistant' } })

const refused = s => s === 404 || s === 403

async function attempt(label, path, options = {}) {
  for (const who of [{ name: 'session', auth: B }, { name: 'api key', auth: { token: keyB } }]) {
    const res = await call(path, { ...who.auth, ...options })
    check(refused(res.status) && !res.text.includes(MARK), `${label} (${who.name}) → ${res.status}`)
  }
}

// By-id: everything of A's, by every verb B could try.
await attempt('read A\'s conversation', `/v1/admin/conversations/${conversationId}`)
await attempt('edit A\'s conversation', `/v1/admin/conversations/${conversationId}`, { method: 'PATCH', body: { priority: 'high' } })
await attempt('read A\'s messages', `/v1/admin/conversations/${conversationId}/messages`)
await attempt('reply in A\'s conversation', `/v1/admin/conversations/${conversationId}/messages`, { method: 'POST', body: { body: 'pwned', notifyByEmail: false } })
await attempt('note on A\'s conversation', `/v1/admin/conversations/${conversationId}/notes`, { method: 'POST', body: { body: 'pwned' } })
await attempt('mark A\'s conversation read', `/v1/admin/conversations/${conversationId}/read`, { method: 'POST' })
await attempt('close A\'s conversation', `/v1/admin/conversations/${conversationId}/status`, { method: 'POST', body: { status: 'done' } })
await attempt('delete A\'s message', `/v1/admin/messages/${messageId}`, { method: 'DELETE' })
await attempt('react to A\'s message', `/v1/admin/messages/${messageId}/reactions`, { method: 'POST', body: { emoji: '👍' } })
await attempt('rename A\'s project', `/v1/admin/projects/${project.id}`, { method: 'PATCH', body: { name: 'pwned' } })
await attempt('read A\'s project secret', `/v1/admin/projects/${project.id}/secret`)
await attempt('rotate A\'s project secret', `/v1/admin/projects/${project.id}/rotate-secret`, { method: 'POST' })
await attempt('read A\'s project overview', `/v1/admin/projects/${project.id}/overview`)
await attempt('read A\'s project setup checklist', `/v1/admin/projects/${project.id}/setup`)
await attempt('read A\'s project email setup', `/v1/admin/projects/${project.id}/email-setup`)
await attempt('hide sections on A\'s project', `/v1/admin/projects/${project.id}`, { method: 'PATCH', body: { hiddenSections: ['revenue'] } })
await attempt('read A\'s conversation types', `/v1/admin/projects/${project.id}/types`)
for (const [label, id] of [['A\'s master template', master.template.id], ['A\'s project template', projectTemplate.template.id]]) {
  await attempt(`read ${label}`, `/v1/admin/emails/${id}`)
  await attempt(`edit ${label}`, `/v1/admin/emails/${id}`, { method: 'PATCH', body: { name: 'pwned' } })
  await attempt(`duplicate ${label}`, `/v1/admin/emails/${id}/duplicate`, { method: 'POST' })
  await attempt(`translate ${label}`, `/v1/admin/emails/${id}/translate`, { method: 'POST', body: { locales: ['es'] } })
  await attempt(`share ${label}`, `/v1/admin/emails/${id}/share`, { method: 'POST', body: { mode: 'edit' } })
  await attempt(`read ${label}'s AI chats`, `/v1/admin/emails/${id}/chats`)
  await attempt(`render ${label} through the API`, `/v1/emails/${id}`)
  await attempt(`delete ${label}`, `/v1/admin/emails/${id}`, { method: 'DELETE' })
}
await attempt('link A\'s master into B', '/v1/admin/emails', { method: 'POST', body: { project: projectB.id, master: master.template.id } })
await attempt('rename A\'s folder', `/v1/admin/email-folders/${folder.folder.id}`, { method: 'PATCH', body: { name: 'pwned' } })
await attempt('delete A\'s folder', `/v1/admin/email-folders/${folder.folder.id}`, { method: 'DELETE' })
if (component) {
  await attempt('edit A\'s component', `/v1/admin/email-components/${component.component.id}`, { method: 'PATCH', body: { name: 'pwned' } })
  await attempt('delete A\'s component', `/v1/admin/email-components/${component.component.id}`, { method: 'DELETE' })
}
if (suppression?.added?.[0]) await attempt('lift A\'s suppression', `/v1/admin/email-suppressions/${suppression.added[0].id}`, { method: 'DELETE' })
await attempt('read A\'s knowledge model', `/v1/admin/knowledge/models/${model.id}`)
await attempt('edit A\'s knowledge model', `/v1/admin/knowledge/models/${model.id}`, { method: 'PATCH', body: { name: 'pwned' } })
await attempt('read A\'s model dashboard', `/v1/admin/knowledge/models/${model.id}/dashboard`)
await attempt('duplicate A\'s model', `/v1/admin/knowledge/models/${model.id}/duplicate`, { method: 'POST' })
await attempt('list A\'s nodes', `/v1/admin/knowledge/nodes?modelId=${model.id}`)
await attempt('list A\'s FAQs', `/v1/admin/knowledge/faqs?modelId=${model.id}`)
await attempt('list A\'s documents', `/v1/admin/knowledge/documents?modelId=${model.id}`)
await attempt('add a node to A\'s model', '/v1/admin/knowledge/nodes', { method: 'POST', body: { modelId: model.id, name: 'pwned' } })
if (node?.node) {
  await attempt('edit A\'s node', `/v1/admin/knowledge/nodes/${node.node.id}`, { method: 'PATCH', body: { name: 'pwned' } })
  await attempt('delete A\'s node', `/v1/admin/knowledge/nodes/${node.node.id}`, { method: 'DELETE' })
}
if (faq?.faq) {
  await attempt('read A\'s FAQ', `/v1/admin/knowledge/faqs/${faq.faq.id}`)
  await attempt('edit A\'s FAQ', `/v1/admin/knowledge/faqs/${faq.faq.id}`, { method: 'PATCH', body: { answer: 'pwned' } })
  await attempt('delete A\'s FAQ', `/v1/admin/knowledge/faqs/${faq.faq.id}`, { method: 'DELETE' })
}
await attempt('read A\'s assistant', `/v1/admin/support-agents/${assistant.id}`)
await attempt('test A\'s assistant\'s answer', `/v1/admin/support-agents/${assistant.id}/test-answer`, { method: 'POST', body: { query: 'hello' } })
await attempt('edit A\'s assistant', `/v1/admin/support-agents/${assistant.id}`, { method: 'PATCH', body: { name: 'pwned' } })
await attempt('read A\'s assistant knowledge', `/v1/admin/support-agents/${assistant.id}/knowledge`)
await attempt('read A\'s assistant assignments', `/v1/admin/support-agents/${assistant.id}/assignments`)
await attempt('give B\'s assistant A\'s model', `/v1/admin/support-agents/${assistantB.id}/assignments`, { method: 'POST', body: { scope: 'model', modelId: model.id } })
await attempt('move B\'s assistant into A\'s project', `/v1/admin/support-agents/${assistantB.id}`, { method: 'PATCH', body: { projectId: project.id } })
await attempt('delete A\'s assistant', `/v1/admin/support-agents/${assistant.id}`, { method: 'DELETE' })
await attempt('edit A\'s board item', `/v1/admin/board-items/${item.id}`, { method: 'PATCH', body: { title: 'pwned' } })
await attempt('list A\'s board', `/v1/admin/board-items?project=${project.id}`)
await attempt('delete A\'s board item', `/v1/admin/board-items/${item.id}`, { method: 'DELETE' })
await attempt('list A\'s changelog', `/v1/admin/changelog/entries?project=${project.id}`)
await attempt('edit A\'s changelog entry', `/v1/admin/changelog/entries/${entry.id}`, { method: 'PATCH', body: { title: 'pwned' } })
await attempt('publish A\'s release', `/v1/admin/changelog/releases/${release.id}/publish`, { method: 'POST' })
await attempt('read A\'s feedback board', `/v1/feedback?project=${project.id}`)
await attempt('edit A\'s feedback post', `/v1/feedback/${post.id}`, { method: 'PATCH', body: { status: 'done' } })
await attempt('list A\'s contacts', `/v1/contacts?project=${project.id}`)
if (contact?.contact) await attempt('read A\'s contact', `/v1/contacts/${contact.contact.id}?project=${project.id}`)
await attempt('list A\'s segments', `/v1/segments?project=${project.id}`)
if (segment?.segment) await attempt('edit A\'s segment', `/v1/segments/${segment.segment.id}`, { method: 'PATCH', body: { project: project.id, name: 'pwned' } })
await attempt('list A\'s sequences', `/v1/sequences?project=${project.id}`)
await attempt('list A\'s campaigns', `/v1/campaigns?project=${project.id}`)
await attempt('read A\'s email log', `/v1/email-logs?project=${project.id}`)
await attempt('read A\'s suppressions', `/v1/email-suppressions?project=${project.id}`)
await attempt('send as A\'s project', '/v1/emails/send', { method: 'POST', body: { project: project.id, to: 'x@b.example.test', subject: 'pwned', text: 'x' } })
await attempt('list A\'s contact sources', `/v1/admin/contact-sources?project=${project.id}`)
await attempt('list A\'s error issues', `/v1/admin/errors?project=${project.id}`)
await attempt('watch A\'s project live', `/v1/admin/events?project=${project.id}`)
await attempt('list A\'s onboarding flows', `/v1/admin/onboarding/flows?project=${project.id}`)
await attempt('read A\'s onboarding flow', `/v1/admin/onboarding/flows/${flow.id}`)
await attempt('edit A\'s onboarding flow', `/v1/admin/onboarding/flows/${flow.id}`, { method: 'PATCH', body: { name: 'pwned' } })
await attempt('publish A\'s onboarding flow', `/v1/admin/onboarding/flows/${flow.id}/publish`, { method: 'POST' })
await attempt('translate A\'s onboarding flow', `/v1/admin/onboarding/flows/${flow.id}/translate`, { method: 'POST', body: { locales: ['es'] } })
await attempt('create a flow in A\'s project', '/v1/admin/onboarding/flows', { method: 'POST', body: { project: project.id, name: 'pwned' } })
await attempt('delete A\'s onboarding flow', `/v1/admin/onboarding/flows/${flow.id}`, { method: 'DELETE' })
await attempt('list A\'s lead forms', `/v1/admin/lead-forms?project=${project.id}`)
await attempt('read A\'s lead form', `/v1/admin/lead-forms/${leadForm.id}`)
await attempt('edit A\'s lead form', `/v1/admin/lead-forms/${leadForm.id}`, { method: 'PATCH', body: { name: 'pwned', settings: { doubleOptIn: false } } })
await attempt('create a lead form in A\'s project', '/v1/admin/lead-forms', { method: 'POST', body: { project: project.id, name: 'pwned' } })
await attempt('list the leads of A\'s form', `/v1/contacts?project=${project.id}&leadForm=${leadForm.id}`)
await attempt('translate A\'s lead form', `/v1/admin/lead-forms/${leadForm.id}/translate`, { method: 'POST', body: { locales: ['es'] } })
await attempt('list the files of A\'s form', `/v1/admin/lead-files?project=${project.id}&form=${leadForm.id}`)
if (leadFile) {
  await attempt('download A\'s lead file', `/v1/admin/lead-files/${leadFile.id}/download`)
  await attempt('delete A\'s lead file', `/v1/admin/lead-files/${leadFile.id}`, { method: 'DELETE' })
}
await attempt('delete A\'s lead form', `/v1/admin/lead-forms/${leadForm.id}`, { method: 'DELETE' })
await attempt('list A\'s blog', `/v1/admin/blog/posts?project=${project.id}`)
await attempt('read A\'s blog post', `/v1/admin/blog/posts/${blogPost.id}`)
await attempt('edit A\'s blog post', `/v1/admin/blog/posts/${blogPost.id}`, { method: 'PATCH', body: { title: 'pwned', status: 'draft' } })
await attempt('send A\'s post as a newsletter', `/v1/admin/blog/posts/${blogPost.id}/newsletter`, { method: 'POST', body: { send: 'draft' } })
await attempt('write a post in A\'s project', '/v1/admin/blog/posts', { method: 'POST', body: { project: project.id, title: 'pwned' } })
await attempt('import a Ghost blog into A\'s project', '/v1/admin/blog/import', { method: 'POST', body: { project: project.id, export: { db: [{ data: { posts: [{ id: 'pwn', title: 'pwned', html: '<p>pwned</p>', status: 'published' }] } }] } } })
await attempt('restyle A\'s blog', `/v1/admin/projects/${project.id}`, { method: 'PATCH', body: { blog: { design: { footer: 'pwned' } } } })
await attempt('list A\'s blog comments', `/v1/admin/blog/comments?project=${project.id}`)
await attempt('hide A\'s blog comment', `/v1/blog/comments/${blogComment.id}`, { method: 'PATCH', body: { status: 'hidden' } })
await attempt('reply on A\'s blog as A\'s team', `/v1/blog/${blogPost.id}/comments?project=${project.id}`, { method: 'POST', body: { body: 'pwned' } })
await attempt('delete A\'s blog comment', `/v1/blog/comments/${blogComment.id}`, { method: 'DELETE' })
await attempt('delete A\'s blog post', `/v1/admin/blog/posts/${blogPost.id}`, { method: 'DELETE' })
await attempt('list A\'s pricing tables', `/v1/admin/pricing-tables?project=${project.id}`)
await attempt('read A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}`)
await attempt('edit A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}`, { method: 'PATCH', body: { name: 'pwned', checkout: { successUrl: 'https://evil.test/' } } })
await attempt('preview A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}/preview`, { method: 'POST', body: {} })
await attempt('publish A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}/publish`, { method: 'POST' })
await attempt('translate A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}/translate`, { method: 'POST', body: { locales: ['es'] } })
await attempt('create a pricing table in A\'s project', '/v1/admin/pricing-tables', { method: 'POST', body: { project: project.id, name: 'pwned' } })
await attempt('read A\'s pricing numbers', `/v1/admin/pricing-tables/${pricingTable.id}/stats?refresh=1`)
await attempt('add a variant to A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}/variants`, { method: 'POST', body: {} })
await attempt('start an A/B test on A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}/experiment/start`, { method: 'POST' })
await attempt('stop an A/B test on A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}/experiment/stop`, { method: 'POST', body: {} })
await attempt('ask AI about A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}/suggest`, { method: 'POST', body: { notes: 'x' } })
await attempt('read A\'s Stripe catalog', `/v1/admin/stripe/catalog?project=${project.id}`)
await attempt('delete A\'s pricing table', `/v1/admin/pricing-tables/${pricingTable.id}`, { method: 'DELETE' })
await attempt('read A\'s brand kit', `/v1/admin/brand?project=${project.id}`)
await attempt('edit A\'s brand kit', `/v1/admin/brand?project=${project.id}`, { method: 'PATCH', body: { tagline: 'pwned', page: { public: true } } })
await attempt('preview A\'s brand page', `/v1/admin/brand/preview?project=${project.id}`, { method: 'POST', body: {} })
for (const [label, path] of [['upload into A\'s brand kit', '/v1/admin/brand/assets'], ['upload an onboarding picture to A\'s project', '/v1/admin/onboarding/images'], ['upload a blog image to A\'s project', '/v1/admin/blog/images']]) {
  for (const who of [{ name: 'session', auth: B }, { name: 'api key', auth: { token: keyB } }]) {
    const res = await upload(path, { project: project.id }, who.auth)
    check(refused(res.status) && !res.text.includes(MARK), `${label} (${who.name}) → ${res.status}`)
  }
}
if (brandUpload) {
  await attempt('edit A\'s brand file', `/v1/admin/brand/assets/${brandUpload.id}`, { method: 'PATCH', body: { name: 'pwned' } })
  await attempt('delete A\'s brand file', `/v1/admin/brand/assets/${brandUpload.id}`, { method: 'DELETE' })
}
await attempt('list A\'s pages', `/v1/admin/cms/entries?project=${project.id}`)
await attempt('read A\'s page', `/v1/admin/cms/entries/${cmsEntry.id}`)
await attempt('edit A\'s page', `/v1/admin/cms/entries/${cmsEntry.id}`, { method: 'PATCH', body: { name: 'pwned' } })
await attempt('publish A\'s page', `/v1/admin/cms/entries/${cmsEntry.id}/publish`, { method: 'POST' })
await attempt('delete A\'s page', `/v1/admin/cms/entries/${cmsEntry.id}`, { method: 'DELETE' })
await attempt('create a page in A\'s project', '/v1/admin/cms/entries', { method: 'POST', body: { project: project.id, name: 'pwned' } })
await attempt('list A\'s components', `/v1/admin/cms/components?project=${project.id}`)
await attempt('read A\'s component', `/v1/admin/cms/components/${cmsComponent.id}`)
await attempt('edit A\'s component', `/v1/admin/cms/components/${cmsComponent.id}`, { method: 'PATCH', body: { name: 'pwned' } })
await attempt('delete A\'s component', `/v1/admin/cms/components/${cmsComponent.id}`, { method: 'DELETE' })
await attempt('list A\'s page files', `/v1/admin/cms/assets?project=${project.id}`)
await attempt('read A\'s Pages settings', `/v1/admin/cms/settings?project=${project.id}`)
await attempt('edit A\'s Pages settings', '/v1/admin/cms/settings', { method: 'PATCH', body: { project: project.id, brief: { audience: 'pwned' } } })
await attempt('read A\'s page assistant chat', `/v1/admin/cms/chat?entry=${cmsEntry.id}`)
await attempt('talk to the assistant on A\'s page', '/v1/admin/cms/chat', { method: 'POST', body: { entry: cmsEntry.id, messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] } })
await attempt('clear A\'s page assistant chat', `/v1/admin/cms/chat?entry=${cmsEntry.id}`, { method: 'DELETE' })
await attempt('read A\'s linked repos', `/v1/admin/cms/repos?project=${project.id}`)
for (const who of [{ name: 'session', auth: B }, { name: 'api key', auth: { token: keyB } }]) {
  const res = await upload('/v1/admin/cms/assets', { project: project.id }, who.auth)
  check(refused(res.status) && !res.text.includes(MARK), `upload into A's page files (${who.name}) → ${res.status}`)
}
if (cmsUpload) {
  await attempt('edit A\'s page file', `/v1/admin/cms/assets/${cmsUpload.id}`, { method: 'PATCH', body: { alt: 'pwned' } })
  await attempt('delete A\'s page file', `/v1/admin/cms/assets/${cmsUpload.id}`, { method: 'DELETE' })
}
await attempt('revoke A\'s API key', `/v1/admin/api-keys/${keyA.apiKey.id}`, { method: 'DELETE' })
await attempt('demote A\'s owner', `/v1/admin/agents/${me.agent.id}`, { method: 'PATCH', body: { role: 'agent' } })

// Crossing over with a header or a key never works either.
check(refused((await call('/v1/admin/projects', { token: tokenB, workspace: WA })).status), 'B\'s operator naming A\'s workspace is refused')
check((await call('/v1/admin/projects', { token: keyA.key, workspace: WB })).status === 403, 'A\'s API key naming B\'s workspace is refused')
// A project secret always acts for its own project: naming B's is ignored, never obeyed.
const viaSecret = await call(`/v1/contacts?project=${projectB.id}`, { token: secret })
check((refused(viaSecret.status) || viaSecret.status < 300) && !viaSecret.text.includes(TAG_B) && !viaSecret.text.includes(projectB.id), 'A\'s project secret cannot reach B\'s project')

// Lists and search: nothing of A's, anywhere.
for (const path of ['/v1/admin/projects', '/v1/admin/conversations', `/v1/admin/end-users?q=${MARK}`, '/v1/admin/emails', '/v1/admin/email-folders', '/v1/admin/email-components', '/v1/admin/email-logs', '/v1/admin/email-suppressions', '/v1/admin/knowledge/models', '/v1/admin/support-agents', '/v1/admin/agents', '/v1/admin/api-keys', '/v1/admin/invitations', `/v1/admin/search?q=${MARK}`, '/v1/admin/errors/providers', '/v1/admin/overview?range=all', '/v1/admin/attention', '/v1/admin/unread']) {
  const res = await call(path, B)
  check(res.status < 300 && !res.text.includes(MARK) && !res.text.includes(project.id), `B's ${path} shows nothing of A's`)
}

// The live stream: B hears nothing while A's inbox is busy.
const streamB = await fetch(`${BASE}/v1/admin/events`, { headers: { Authorization: `Bearer ${tokenB}`, 'X-Workspace': WB } })
const reader = streamB.body.getReader()
let heard = ''
const listening = (async () => {
  const decoder = new TextDecoder()
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ done: true }))
    if (done) return
    heard += decoder.decode(value)
  }
})()
await new Promise(resolve => setTimeout(resolve, 300))
await api(`/v1/conversations/${conversationId}/messages`, { token: userToken, method: 'POST', body: { body: `${MARK} are you there?` } })
await api(`/v1/admin/conversations/${conversationId}/messages`, { ...A, method: 'POST', body: { body: `${MARK} yes`, notifyByEmail: false } })
await new Promise(resolve => setTimeout(resolve, 1500))
await reader.cancel().catch(() => {})
await listening
check(!heard.includes(MARK) && !heard.includes(conversationId), 'B\'s live stream heard none of A\'s events')

// And A's rows are all still there, unchanged.
check((await call(`/v1/admin/conversations/${conversationId}`, A)).json.conversation?.status !== 'done', 'A\'s conversation is untouched')
check((await call(`/v1/admin/projects/${project.id}/secret`, A)).json.secret === secret, 'A\'s project secret is unchanged')
check((await call(`/v1/admin/emails/${master.template.id}`, A)).json.template?.name === `${MARK} master`, 'A\'s master template is untouched')
check((await call(`/v1/admin/support-agents/${assistant.id}`, A)).status === 200, 'A\'s assistant still exists')
check((await call(`/v1/admin/knowledge/models/${model.id}`, A)).json.model?.name === `${MARK} model`, 'A\'s knowledge model is untouched')
const flowAfter = (await call(`/v1/admin/onboarding/flows/${flow.id}`, A)).json.flow
check(flowAfter?.name === `${MARK} flow` && flowAfter.status === 'draft', 'A\'s onboarding flow is untouched')
const formAfter = (await call(`/v1/admin/lead-forms/${leadForm.id}`, A)).json.form
const pricingAfter = (await call(`/v1/admin/pricing-tables/${pricingTable.id}`, A)).json.table
check(pricingAfter?.name === `${MARK} pricing` && pricingAfter.status === 'draft' && pricingAfter.checkout.successUrl === '' && !pricingAfter.experiment.variants.length, 'A\'s pricing table is untouched')
check(formAfter?.name === `${MARK} form` && formAfter.settings.doubleOptIn === true, 'A\'s lead form is untouched')
if (leadFile) check((await call(`/v1/admin/lead-files/${leadFile.id}/download`, A)).status === 200, 'A\'s lead file is untouched')
const kitAfter = (await call(`/v1/admin/brand?project=${project.id}`, A)).json
check(kitAfter.brand?.tagline === `${MARK} tagline` && kitAfter.brand.page.public === false, 'A\'s brand kit is untouched')
if (brandUpload) check(kitAfter.assets?.some(a => a.id === brandUpload.id && a.name === `${MARK} logo`), 'A\'s brand file is untouched')
const blogAfter = (await call(`/v1/admin/blog/posts/${blogPost.id}`, A)).json.post
check(blogAfter?.title === `${MARK} story` && blogAfter.status === 'published', 'A\'s blog post is untouched')
const blogPosts = (await call(`/v1/admin/blog/posts?project=${project.id}`, A)).json.posts || []
check(blogPosts.every(p => p.title !== 'pwned'), 'nothing was imported into A\'s blog')
check((await call(`/v1/admin/projects`, A)).json.projects?.find(p => p.id === project.id)?.blog?.design?.footer !== 'pwned', 'A\'s blog design is untouched')
const blogThread = (await call(`/v1/blog/${blogPost.slug}/comments?pk=${project.publicKey}`)).json
check(blogThread.comments?.length === 1 && blogThread.comments[0].body === `${MARK} reader comment`, 'A\'s blog comment is untouched')
const pageAfter = (await call(`/v1/admin/cms/entries/${cmsEntry.id}`, A)).json.entry
check(pageAfter?.name === `${MARK} page` && pageAfter.status === 'draft', 'A\'s page is untouched')
check((await call(`/v1/admin/cms/components/${cmsComponent.id}`, A)).json.component?.name === `${MARK} card`, 'A\'s component is untouched')
check((await call(`/v1/admin/cms/settings?project=${project.id}`, A)).json.settings?.brief?.audience === `${MARK} audience`, 'A\'s messaging brief is untouched')
if (cmsUpload) check((await call(`/v1/admin/cms/assets?project=${project.id}`, A)).json.assets?.some(a => a.id === cmsUpload.id && a.alt === ''), 'A\'s page file is untouched')

if (failures) {
  console.log(`\n${failures} isolation check(s) FAILED`)
  process.exit(1)
}
console.log('\nisolation smoke passed')
