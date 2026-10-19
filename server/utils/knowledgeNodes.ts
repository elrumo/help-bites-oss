import { createError } from 'h3'
import { slugifyKnowledge } from '#shared/knowledge'

// KnowledgeNodes form the path tree inside a model. A node's pathCache is its
// ancestor names joined by "/", kept denormalized so subtree filtering (for
// agent assignments and Meili) is a cheap prefix match. Renames/moves recompute
// the affected subtree's pathCache/depth.

export type KnowledgeNode = {
  id: string
  modelId: string
  parentId: string
  name: string
  slug: string
  description: string
  order: number
  depth: number
  pathCache: string
  createdAt: string | null
  updatedAt: string | null
}

export async function getKnowledgeNodeById(id: string): Promise<ParseObject> {
  const Parse = useParse()
  try {
    return await new Parse.Query('KnowledgeNode').get(id, MASTER)
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Node not found' })
  }
}

export function serializeKnowledgeNode(node: ParseObject): KnowledgeNode {
  return {
    id: node.id || '',
    modelId: pointerId(node.get('knowledgeModel')),
    parentId: pointerId(node.get('parent')),
    name: String(node.get('name') || ''),
    slug: String(node.get('slug') || ''),
    description: String(node.get('description') || ''),
    order: Number(node.get('order') || 0),
    depth: Number(node.get('depth') || 0),
    pathCache: String(node.get('pathCache') || ''),
    createdAt: iso(node.createdAt),
    updatedAt: iso(node.updatedAt)
  }
}

/** A model's whole tree, in pathCache order (parents before their children). */
export async function listNodesForModel(modelId: string): Promise<ParseObject[]> {
  const Parse = useParse()
  const model = Parse.Object.extend('KnowledgeModel').createWithoutData(modelId)
  const nodes = await collectAll(() => new Parse.Query('KnowledgeNode').equalTo('knowledgeModel', model), { max: 5000 })
  const path = (node: ParseObject) => String(node.get('pathCache') ?? '')
  return nodes.sort((a, b) => (path(a) < path(b) ? -1 : path(a) > path(b) ? 1 : 0))
}

async function nextSiblingOrder(model: ParseObject, parent: ParseObject | null): Promise<number> {
  const Parse = useParse()
  const q = new Parse.Query('KnowledgeNode').equalTo('knowledgeModel', model).descending('order')
  parent ? q.equalTo('parent', parent) : q.doesNotExist('parent')
  const top = await q.first(MASTER)
  const order = top?.get('order')
  return typeof order === 'number' ? order + 1 : 0
}

/** Create a node under an optional parent, computing depth and pathCache. */
export async function createKnowledgeNode(modelId: string, input: { name: string, parentId?: string, description?: string }): Promise<ParseObject> {
  const Parse = useParse()
  const name = String(input.name || '').trim().slice(0, 120)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })
  const model = await getKnowledgeModelById(modelId)
  let parent: ParseObject | null = null
  let depth = 0
  let parentPath = ''
  if (input.parentId) {
    parent = await getKnowledgeNodeById(input.parentId)
    if (pointerId(parent.get('knowledgeModel')) !== modelId) throw createError({ statusCode: 400, statusMessage: 'Parent belongs to another model' })
    depth = Number(parent.get('depth') || 0) + 1
    parentPath = String(parent.get('pathCache') || '')
  }
  const node = new (Parse.Object.extend('KnowledgeNode'))()
  node.set('knowledgeModel', model)
  if (parent) node.set('parent', parent)
  node.set('name', name)
  node.set('slug', slugifyKnowledge(name))
  if (input.description) node.set('description', String(input.description).slice(0, 2000))
  node.set('order', await nextSiblingOrder(model, parent))
  node.set('depth', depth)
  node.set('pathCache', parentPath ? `${parentPath}/${name}` : name)
  await node.save(null, MASTER)
  return node
}

/**
 * Ensure every node along `path` (outermost first) exists in the model; returns
 * the leaf node's id ('' for an empty path). Used by ingestion.
 */
export async function ensurePathNodes(modelId: string, path: string[]): Promise<string> {
  if (!path.length) return ''
  const Parse = useParse()
  const model = Parse.Object.extend('KnowledgeModel').createWithoutData(modelId)
  let parentId = ''
  let leafId = ''
  for (let i = 0; i < path.length; i++) {
    const pathCache = path.slice(0, i + 1).join('/')
    let node = await new Parse.Query('KnowledgeNode').equalTo('knowledgeModel', model).equalTo('pathCache', pathCache).first(MASTER)
    if (!node) node = await createKnowledgeNode(modelId, { name: path[i]!, parentId: parentId || undefined })
    parentId = node.id || ''
    leafId = node.id || ''
  }
  return leafId
}

function isDescendant(candidateId: string, ancestorId: string, byId: Map<string, ParseObject>): boolean {
  let cur = byId.get(candidateId)
  const seen = new Set<string>()
  while (cur) {
    const pid = pointerId(cur.get('parent'))
    if (!pid || seen.has(pid)) return false
    if (pid === ancestorId) return true
    seen.add(pid)
    cur = byId.get(pid)
  }
  return false
}

/** Rename/move/reorder a node, then recompute the model's paths. Returns changed ids. */
export async function updateKnowledgeNode(node: ParseObject, input: Record<string, unknown>): Promise<string[]> {
  const Parse = useParse()
  const modelId = pointerId(node.get('knowledgeModel'))
  if (typeof input.name === 'string' && input.name.trim()) {
    node.set('name', input.name.trim().slice(0, 120))
    node.set('slug', slugifyKnowledge(input.name))
  }
  if ('description' in input) node.set('description', String(input.description ?? '').slice(0, 2000))
  if (typeof input.order === 'number' && Number.isFinite(input.order)) node.set('order', input.order)

  if ('parentId' in input) {
    const parentId = String(input.parentId || '')
    if (parentId === (node.id || '')) throw createError({ statusCode: 400, statusMessage: 'A node cannot be its own parent' })
    if (parentId) {
      const nodes = await listNodesForModel(modelId)
      const byId = new Map(nodes.map(n => [n.id || '', n]))
      if (isDescendant(parentId, node.id || '', byId)) throw createError({ statusCode: 400, statusMessage: 'Cannot move a node under its own descendant' })
      const parent = await getKnowledgeNodeById(parentId)
      if (pointerId(parent.get('knowledgeModel')) !== modelId) throw createError({ statusCode: 400, statusMessage: 'Parent belongs to another model' })
      node.set('parent', parent)
    } else {
      node.unset('parent')
    }
  }
  await node.save(null, MASTER)
  return recomputeModelPaths(modelId)
}

function computePath(node: ParseObject, byId: Map<string, ParseObject>): { pathCache: string, depth: number } {
  const names: string[] = []
  let cur: ParseObject | undefined = node
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur.id || '')) break
    seen.add(cur.id || '')
    names.unshift(String(cur.get('name') || ''))
    const pid = pointerId(cur.get('parent'))
    cur = pid ? byId.get(pid) : undefined
  }
  return { pathCache: names.join('/'), depth: names.length - 1 }
}

/** Recompute pathCache/depth for every node in a model; save + return changed ids. */
export async function recomputeModelPaths(modelId: string): Promise<string[]> {
  const Parse = useParse()
  const nodes = await listNodesForModel(modelId)
  const byId = new Map(nodes.map(n => [n.id || '', n]))
  const changed: ParseObject[] = []
  for (const n of nodes) {
    const { pathCache, depth } = computePath(n, byId)
    if (n.get('pathCache') !== pathCache || n.get('depth') !== depth) {
      n.set('pathCache', pathCache)
      n.set('depth', depth)
      changed.push(n)
    }
  }
  if (changed.length) await Parse.Object.saveAll(changed, MASTER)
  return changed.map(n => n.id || '')
}

/** What deleting a node affects: its direct children and the FAQs attached to it. */
export async function nodeImpact(node: ParseObject): Promise<{ children: number, faqs: number }> {
  const Parse = useParse()
  const [children, faqs] = await Promise.all([
    new Parse.Query('KnowledgeNode').equalTo('parent', node).count(MASTER),
    new Parse.Query('Faq').equalTo('node', node).count(MASTER)
  ])
  return { children, faqs }
}

/**
 * Delete a node without destroying knowledge: its children are reparented to
 * its parent and its FAQs move up too (flagged for re-index), then paths are
 * recomputed. Never cascades a subtree delete.
 */
export async function deleteKnowledgeNode(node: ParseObject): Promise<void> {
  const Parse = useParse()
  const modelId = pointerId(node.get('knowledgeModel'))
  const parent = node.get('parent') as ParseObject | undefined

  await eachBatch(() => new Parse.Query('KnowledgeNode').equalTo('parent', node), async (children) => {
    for (const c of children) parent ? c.set('parent', parent) : c.unset('parent')
    await Parse.Object.saveAll(children, MASTER)
  })

  await eachBatch(() => new Parse.Query('Faq').equalTo('node', node), async (faqs) => {
    for (const f of faqs) { parent ? f.set('node', parent) : f.unset('node'); f.set('needsReindex', true) }
    await Parse.Object.saveAll(faqs, MASTER)
  })

  await node.destroy(MASTER)
  await recomputeModelPaths(modelId)
}

/** All descendant node ids of a node (inclusive), by pathCache prefix. */
export async function descendantNodeIds(node: ParseObject): Promise<string[]> {
  const modelId = pointerId(node.get('knowledgeModel'))
  const prefix = String(node.get('pathCache') || '')
  const nodes = await listNodesForModel(modelId)
  return nodes.filter(n => {
    const pc = String(n.get('pathCache') || '')
    return pc === prefix || pc.startsWith(`${prefix}/`)
  }).map(n => n.id || '')
}
