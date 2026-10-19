// Seed a small, representative knowledge example against a RUNNING app (like
// scripts/smoke.mjs). Creates a "WebBites" knowledge model, imports the sample
// scripts/fixtures/SUPPORT_FAQ.md through the real ingestion pipeline, and adds
// an assistant with access to the whole model. Dev only — nothing is hardcoded
// into production; run it deliberately.
//
//   bun scripts/seed-knowledge.mjs                 # AGENT_USER / AGENT_PASS

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = (process.env.BASE || 'http://localhost:3100').replace(/\/+$/, '')
const AGENT_USER = process.env.AGENT_USER || ''
const AGENT_PASS = process.env.AGENT_PASS || ''
if (!AGENT_USER || !AGENT_PASS) {
  console.error('Set AGENT_USER and AGENT_PASS to an operator account on the stack under test.')
  process.exit(2)
}
const here = dirname(fileURLToPath(import.meta.url))

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.statusMessage || json.message || ''}`)
  return json
}

const login = await api('/v1/admin/login', { method: 'POST', body: { username: AGENT_USER, password: AGENT_PASS } })
const token = login.sessionToken
console.log('ok  signed in as agent')

// Knowledge and assistants belong to a project, so make one first.
const created = await api('/v1/admin/projects', { token, method: 'POST', body: { name: `WebBites ${Date.now() % 10000}`, siteUrl: 'https://example.test', fromName: 'Support', allowedOrigins: ['https://example.test'] } })
const project = created.project
console.log(`ok  created project ${project.name} (${project.id})`)

const { model } = await api('/v1/admin/knowledge/models', { token, method: 'POST', body: { projectId: project.id, name: 'Product Support', description: 'Demo knowledge for the WebBites bookmarking app.' } })
console.log(`ok  created model ${model.name} (${model.id})`)

// Upload the sample document through the real multipart ingestion endpoint.
const md = readFileSync(join(here, 'fixtures', 'SUPPORT_FAQ.md'))
const form = new FormData()
form.append('file', new File([md], 'SUPPORT_FAQ.md', { type: 'text/markdown' }))
const uploadRes = await fetch(`${BASE}/v1/admin/knowledge/imports/upload?modelId=${model.id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
const { preview } = await uploadRes.json()
if (!uploadRes.ok) throw new Error(`upload → ${uploadRes.status}`)
console.log(`ok  parsed ${preview.counts.faqs} FAQs across ${preview.counts.nodes} paths (${preview.counts.duplicates} dup, ${preview.counts.existing} existing)`)

const entries = preview.entries.map(e => ({ path: e.path, question: e.question, answer: e.answer }))
const { stats } = await api(`/v1/admin/knowledge/imports/${preview.documentId}/commit`, { token, method: 'POST', body: { entries } })
console.log(`ok  imported: ${stats.created} created, ${stats.updated} updated, ${stats.nodes} paths`)

const { agent } = await api('/v1/admin/support-agents', { token, method: 'POST', body: { projectId: project.id, name: 'WebBites Support', description: 'Answers general WebBites questions.', status: 'active' } })
await api(`/v1/admin/support-agents/${agent.id}/assignments`, { token, method: 'POST', body: { scope: 'model', modelId: model.id } })
console.log(`ok  created assistant ${agent.name} with access to the whole model`)

console.log(`\nSeeded. Open /projects/${project.id} → Knowledge base to browse it, and Assistants to try "Test retrieval".`)
console.log('Tip: if Meilisearch is up, run a per-model reindex from the model page to generate embeddings.')
