import { createError } from 'h3'

// Every row an operator's route loads by id comes through here: it fetches
// the row, then answers 404 unless it belongs to the caller's workspace, the
// same answer as an id that does not exist. The plain loaders (getConversation,
// getEmailTemplate, …) stay for workers and public routes, which have already
// resolved their project from a key; tests/tenancy.guard.test.ts keeps them
// out of admin routes.
//
// How a row knows its workspace: its own `workspace` (projects, keys, masters,
// models, assistants), else its `project`, else its parent's.

function notFound(what: string): never {
  throw createError({ statusCode: 404, statusMessage: what })
}

// A knowledge model never leaves its workspace.
const modelWorkspace = new Map<string, string>()

async function workspaceIdOfModel(modelId: string): Promise<string> {
  if (!modelId) return ''
  const hit = modelWorkspace.get(modelId)
  if (hit) return hit
  const model = await new (useParse()).Query('KnowledgeModel').select('workspace').get(modelId, MASTER).catch(() => null)
  const workspaceId = pointerId(model?.get('workspace'))
  if (workspaceId) {
    if (modelWorkspace.size > 20_000) modelWorkspace.delete(modelWorkspace.keys().next().value!)
    modelWorkspace.set(modelId, workspaceId)
  }
  return workspaceId
}

/** 404 unless a node, document or FAQ belongs to one of the caller's knowledge models. */
async function assertModelChild(ctx: MemberContext, row: ParseObject, what: string): Promise<ParseObject> {
  if (await workspaceIdOfModel(pointerId(row.get('knowledgeModel'))) !== ctx.workspaceId) notFound(what)
  // A limited key only reaches the models of its projects.
  if (ctx.apiKeyProjectIds) assertWorkspaceRow(ctx, await getKnowledgeModelById(pointerId(row.get('knowledgeModel'))), what)
  return row
}

async function viaProject(ctx: MemberContext, row: ParseObject, what: string): Promise<ParseObject> {
  await assertProjectRow(ctx, row, what)
  return row
}

function viaWorkspace(ctx: MemberContext, row: ParseObject, what: string): ParseObject {
  assertWorkspaceRow(ctx, row, what)
  return row
}

/** Pin an already-loaded project-owned pair ({ project, row }) to the caller. */
function pinned<T extends { project: ParseObject }>(ctx: MemberContext, found: T, what: string): T {
  assertProjectInWorkspace(ctx, found.project, what)
  return found
}

export const scoped = {
  conversation: async (ctx: MemberContext, id: string) => viaProject(ctx, await getConversation(id), 'Conversation not found'),
  message: async (ctx: MemberContext, id: string) => viaProject(ctx, await getMessage(id), 'Message not found'),
  savedReply: async (ctx: MemberContext, id: string) => viaProject(ctx, await getSavedReply(id), 'Saved reply not found'),

  emailTemplate: async (ctx: MemberContext, id: string) => viaWorkspace(ctx, await getEmailTemplate(id), 'Email template not found'),
  emailFolder: async (ctx: MemberContext, id: string) => viaWorkspace(ctx, await getEmailFolder(id), 'Folder not found'),
  emailComponent: async (ctx: MemberContext, id: string) => viaWorkspace(ctx, await getEmailComponent(id), 'Component not found'),
  /** A project's mail, or mail the workspace sent without a project. */
  emailLog: async (ctx: MemberContext, id: string) => {
    const row = await getEmailLog(id)
    if (pointerId(row.get('project'))) return viaProject(ctx, row, 'Email log entry not found')
    return viaWorkspace(ctx, row, 'Email log entry not found')
  },

  knowledgeModel: async (ctx: MemberContext, id: string) => {
    const row = viaWorkspace(ctx, await getKnowledgeModelById(id), 'Knowledge model not found')
    modelWorkspace.set(row.id || '', ctx.workspaceId)
    return row
  },
  knowledgeNode: async (ctx: MemberContext, id: string) => assertModelChild(ctx, await getKnowledgeNodeById(id), 'Node not found'),
  knowledgeDocument: async (ctx: MemberContext, id: string) => assertModelChild(ctx, await getKnowledgeDocumentById(id), 'Document not found'),
  faq: async (ctx: MemberContext, id: string) => assertModelChild(ctx, await getFaqById(id), 'FAQ not found'),
  supportAgent: async (ctx: MemberContext, id: string) => viaWorkspace(ctx, await getSupportAgentById(id), 'Agent not found'),

  boardItem: async (ctx: MemberContext, id: string, projectId?: string) => {
    if (projectId) await requireProject(ctx, projectId)
    return pinned(ctx, await loadBoardItem(id, projectId), 'Item not found')
  },
  changelogEntry: async (ctx: MemberContext, ref: string, projectId?: string) => {
    if (projectId) await requireProject(ctx, projectId)
    return pinned(ctx, await loadChangelogEntry(ref, projectId), 'Entry not found')
  },
  changelogRelease: async (ctx: MemberContext, id: string) => pinned(ctx, await loadChangelogRelease(id), 'Release not found'),

  blogPost: async (ctx: MemberContext, id: string) => viaProject(ctx, await getBlogPost(id), 'Post not found'),
  /** A comment and the post it is on. */
  blogComment: async (ctx: MemberContext, id: string) => {
    const found = await getBlogComment(id)
    await viaProject(ctx, found.row, 'Comment not found')
    return found
  },

  legalDocument: async (ctx: MemberContext, id: string) => viaProject(ctx, await getLegalDocument(id), 'Document not found'),
  onboardingFlow: async (ctx: MemberContext, id: string) => viaProject(ctx, await getOnboardingFlow(id), 'Flow not found'),
  leadForm: async (ctx: MemberContext, id: string) => viaProject(ctx, await getLeadForm(id), 'Form not found'),
  leadFile: async (ctx: MemberContext, id: string) => viaProject(ctx, await getLeadFile(id), 'File not found'),
  brandAsset: async (ctx: MemberContext, id: string) => viaProject(ctx, await getBrandAsset(id), 'File not found'),
  cmsComponent: async (ctx: MemberContext, id: string) => viaProject(ctx, await getCmsComponent(id), 'Component not found'),
  cmsEntry: async (ctx: MemberContext, id: string) => viaProject(ctx, await getCmsEntry(id), 'Entry not found'),
  cmsAsset: async (ctx: MemberContext, id: string) => viaProject(ctx, await getCmsAsset(id), 'File not found')
}

/** For tests: forget cached model → workspace answers. */
export function forgetModelWorkspaces(): void {
  modelWorkspace.clear()
}
