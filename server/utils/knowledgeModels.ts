import { createError } from 'h3'
import { KNOWLEDGE_MODEL_STATUSES, DEFAULT_LANGUAGE, KNOWLEDGE_NAME_MAX_LENGTH, slugifyKnowledge, type KnowledgeModelStatus } from '#shared/knowledge'

// A KnowledgeModel is a logical body of support knowledge (a product, an area).
// Mirrors server/utils/projects.ts: a serialized type, get-by-id (404), an
// input applier that whitelists + clamps, and a serializer.

export type KnowledgeModel = {
  id: string
  projectId: string
  name: string
  slug: string
  description: string
  status: KnowledgeModelStatus
  icon: string
  defaultLanguage: string
  metadata: Record<string, unknown>
  createdBy: string
  createdAt: string | null
  updatedAt: string | null
}

export async function getKnowledgeModelById(id: string): Promise<ParseObject> {
  const Parse = useParse()
  try {
    return await new Parse.Query('KnowledgeModel').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Knowledge model not found' })
  }
}

/** Apply an admin POST/PATCH body onto a model row; unknown keys are ignored. */
export function applyKnowledgeModelInput(model: ParseObject, input: Record<string, unknown>): void {
  if (typeof input.name === 'string' && input.name.trim()) {
    model.set('name', input.name.trim().slice(0, KNOWLEDGE_NAME_MAX_LENGTH))
    if (!model.get('slug')) model.set('slug', slugifyKnowledge(input.name))
  }
  if (typeof input.slug === 'string' && input.slug.trim()) model.set('slug', slugifyKnowledge(input.slug))
  if ('description' in input) model.set('description', String(input.description ?? '').trim().slice(0, 2000))
  if (typeof input.status === 'string' && (KNOWLEDGE_MODEL_STATUSES as readonly string[]).includes(input.status)) model.set('status', input.status)
  if ('icon' in input) model.set('icon', String(input.icon ?? '').trim().slice(0, 60))
  if ('defaultLanguage' in input) model.set('defaultLanguage', String(input.defaultLanguage || DEFAULT_LANGUAGE).trim().slice(0, 12))
  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) model.set('metadata', input.metadata)
}

export function serializeKnowledgeModel(model: ParseObject): KnowledgeModel {
  return {
    id: model.id || '',
    projectId: pointerId(model.get('project')),
    name: String(model.get('name') || ''),
    slug: String(model.get('slug') || ''),
    description: String(model.get('description') || ''),
    status: (model.get('status') as KnowledgeModelStatus) || 'draft',
    icon: String(model.get('icon') || ''),
    defaultLanguage: String(model.get('defaultLanguage') || DEFAULT_LANGUAGE),
    metadata: (model.get('metadata') as Record<string, unknown>) || {},
    createdBy: pointerId(model.get('createdBy')),
    createdAt: iso(model.createdAt),
    updatedAt: iso(model.updatedAt)
  }
}

export type ModelDashboard = {
  faqsTotal: number
  faqsActive: number
  faqsDraft: number
  faqsOutdated: number
  nodes: number
  documents: number
  failedDocuments: number
  needsReindex: number
  agents: number
  lastIngestion: string | null
}

const faqQuery = (modelId: string) => {
  const Parse = useParse()
  const model = Parse.Object.extend('KnowledgeModel').createWithoutData(modelId)
  return () => new Parse.Query('Faq').equalTo('knowledgeModel', model)
}

/** Operational counts for the model dashboard. */
export async function modelDashboard(modelId: string): Promise<ModelDashboard> {
  const Parse = useParse()
  const model = Parse.Object.extend('KnowledgeModel').createWithoutData(modelId)
  const faq = faqQuery(modelId)
  const [faqsTotal, faqsActive, faqsDraft, faqsOutdated, needsReindex, nodes, documents, failedDocuments, lastDoc, assignments] = await Promise.all([
    faq().count(MASTER),
    faq().equalTo('status', 'active').count(MASTER),
    faq().equalTo('status', 'draft').count(MASTER),
    faq().equalTo('status', 'outdated').count(MASTER),
    faq().equalTo('needsReindex', true).count(MASTER),
    new Parse.Query('KnowledgeNode').equalTo('knowledgeModel', model).count(MASTER),
    new Parse.Query('KnowledgeDocument').equalTo('knowledgeModel', model).count(MASTER),
    new Parse.Query('KnowledgeDocument').equalTo('knowledgeModel', model).equalTo('status', 'failed').count(MASTER),
    new Parse.Query('KnowledgeDocument').equalTo('knowledgeModel', model).descending('processedAt').first(MASTER),
    new Parse.Query('AgentKnowledgeAssignment').equalTo('knowledgeModel', model).limit(1000).find(MASTER)
  ])
  const agents = new Set(assignments.map(a => pointerId(a.get('supportAgent')))).size
  return { faqsTotal, faqsActive, faqsDraft, faqsOutdated, needsReindex, nodes, documents, failedDocuments, agents, lastIngestion: iso(lastDoc?.get('processedAt')) }
}

/** Copy a model with its node tree and FAQs (as draft, manual, detached from source). */
export async function duplicateKnowledgeModel(source: ParseObject, agentId: string): Promise<ParseObject> {
  const Parse = useParse()
  const modelId = source.id || ''
  const srcModel = Parse.Object.extend('KnowledgeModel').createWithoutData(modelId)
  // Both limits are checked before anything is written, so a refused copy leaves nothing half made.
  const workspaceId = pointerId(source.get('workspace'))
  await checkGauge(workspaceId, 'knowledgeModels')
  const srcFaqs = await collectAll(() => new Parse.Query('Faq').equalTo('knowledgeModel', srcModel).include('node').notEqualTo('status', 'archived'), { max: 10_000 })
  await checkGauge(workspaceId, 'faqs', srcFaqs.length)
  const srcNodes = await listNodesForModel(modelId)

  const copy = new (Parse.Object.extend('KnowledgeModel'))()
  copy.set('workspace', source.get('workspace'))
  if (source.get('project')) copy.set('project', source.get('project'))
  copy.set('name', `${String(source.get('name') || 'Model')} (copy)`)
  copy.set('slug', `${slugifyKnowledge(source.get('slug') || source.get('name'))}-copy`.slice(0, 40))
  copy.set('description', String(source.get('description') || ''))
  copy.set('status', 'draft')
  copy.set('icon', String(source.get('icon') || ''))
  copy.set('defaultLanguage', String(source.get('defaultLanguage') || DEFAULT_LANGUAGE))
  if (agentId) copy.set('createdBy', Parse.Object.extend('_User').createWithoutData(agentId))
  await copy.save(null, MASTER)

  // Recreate nodes by pathCache (parents before children thanks to path sort).
  const newNodeByPath = new Map<string, string>()
  for (const n of srcNodes) {
    const path = String(n.get('pathCache') || '').split('/').filter(Boolean)
    const id = await ensurePathNodes(copy.id || '', path)
    newNodeByPath.set(String(n.get('pathCache') || ''), id)
  }

  const clones: ParseObject[] = []
  for (const f of srcFaqs) {
    const node = f.get('node') as ParseObject | undefined
    const pc = node && typeof node.get === 'function' ? String(node.get('pathCache') || '') : ''
    const clone = new (Parse.Object.extend('Faq'))()
    clone.set('knowledgeModel', copy)
    if (pc && newNodeByPath.get(pc)) clone.set('node', Parse.Object.extend('KnowledgeNode').createWithoutData(newNodeByPath.get(pc)!))
    clone.set('question', String(f.get('question') || ''))
    clone.set('normalizedQuestion', String(f.get('normalizedQuestion') || ''))
    clone.set('answer', String(f.get('answer') || ''))
    clone.set('aliases', f.get('aliases') || [])
    clone.set('tags', f.get('tags') || [])
    clone.set('keywords', f.get('keywords') || [])
    clone.set('language', String(f.get('language') || DEFAULT_LANGUAGE))
    clone.set('status', 'draft')
    clone.set('origin', 'manual')
    clone.set('needsReindex', true)
    if (agentId) clone.set('createdBy', Parse.Object.extend('_User').createWithoutData(agentId))
    clones.push(clone)
  }
  if (clones.length) await Parse.Object.saveAll(clones, MASTER)
  return copy
}

/** Permanently delete a model and everything under it (nodes, FAQs, documents, assignments, index, files). */
export async function deleteModelCascade(modelId: string): Promise<void> {
  const Parse = useParse()
  const model = Parse.Object.extend('KnowledgeModel').createWithoutData(modelId)
  let stored = 0
  await eachBatch(() => new Parse.Query('KnowledgeDocument').equalTo('knowledgeModel', model), async (docs) => {
    for (const d of docs) await deleteDocumentObject(String(d.get('storageKey') || ''))
    stored += docs.reduce((sum, d) => sum + Number(d.get('size') || 0), 0)
  }, { keys: ['storageKey', 'size'] })
  for (const className of ['Faq', 'AgentKnowledgeAssignment', 'KnowledgeDocument', 'KnowledgeNode']) {
    await eachBatch(() => new Parse.Query(className).equalTo('knowledgeModel', model), rows => Parse.Object.destroyAll(rows, MASTER), { keys: ['objectId'] })
  }
  const row = await new Parse.Query('KnowledgeModel').get(modelId, MASTER).catch(() => null)
  await row?.destroy(MASTER).catch(() => {})
  // The files are gone, so their bytes stop counting against the workspace's storage.
  if (row && stored) await chargeUsage(pointerId(row.get('workspace')), 'storageBytes', -stored)
  if (meiliConfigured()) await deleteByFilter(KNOWLEDGE_INDEX, `modelId = ${JSON.stringify(modelId)}`).catch(() => {})
}
