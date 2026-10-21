import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Static checks that keep every operator route inside its workspace. A route
// that forgets is a cross-tenant leak, so these fail the build instead of
// waiting for someone to notice. See server/utils/tenancy.ts and scoped.ts.

const ROOT = join(import.meta.dir, '..')

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : name.endsWith('.ts') ? [path] : []
  })
}

const rel = (file: string) => relative(ROOT, file)
const serverFiles = [...walk(join(ROOT, 'server')), ...walk(join(ROOT, 'ee/server'))]
const adminRoutes = [...walk(join(ROOT, 'server/routes/v1/admin')), ...walk(join(ROOT, 'ee/server/routes/v1/admin'))]

// Admin routes that are not workspace-scoped on purpose.
const PUBLIC = new Set(['login.post.ts', 'logout.post.ts', 'setup.get.ts', 'setup.post.ts', 'forgot-password.post.ts', 'reset-password.post.ts'])
// Account-level: who you are and which workspaces you are in, not what is in one.
const IDENTITY = new Set(['me.get.ts', 'me.patch.ts', 'workspaces/index.get.ts', 'workspaces/index.post.ts', 'devices/index.post.ts', 'devices/[token].delete.ts'])
const SCOPING_HELPERS = /requireMember\(|requireChangelogWriter\(|resolveFeedbackContext\(|loadFeedbackPost\(|resolveCommentContext\(|authenticateEmailCaller\(|findEmailForApi\(|requireSuperAdmin\(/
const UNSCOPED_LOADERS = /\b(loadProjectUnscoped|getConversation|getMessage|getEmailTemplate|getEmailFolder|getEmailComponent|getEmailLog|getKnowledgeModelById|getKnowledgeNodeById|getFaqById|getKnowledgeDocumentById|getSupportAgentById|loadBoardItem|loadChangelogEntry|loadChangelogRelease|getLegalDocument|getOnboardingFlow|getLeadForm|getPricingTable|getBrandAsset|getCmsComponent|getCmsEntry|getCmsAsset)\(/

const adminName = (file: string) => rel(file).replace(/^(ee\/)?server\/routes\/v1\/admin\//, '')

describe('tenant isolation guards', () => {
  test('nothing authenticates operators without a workspace any more', () => {
    const offenders = serverFiles.filter(file => /\brequireAgent\(/.test(readFileSync(file, 'utf8')))
    expect(offenders.map(rel)).toEqual([])
  })

  test('every admin route acts through a workspace-scoping helper', () => {
    const offenders = adminRoutes.filter((file) => {
      const name = adminName(file)
      if (PUBLIC.has(name)) return false
      const source = readFileSync(file, 'utf8')
      if (IDENTITY.has(name)) return !/requireAgentIdentity\(/.test(source)
      return !SCOPING_HELPERS.test(source)
    })
    expect(offenders.map(rel)).toEqual([])
  })

  test('no admin route loads a row by id without checking its workspace', () => {
    const offenders = adminRoutes.flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n')
      return lines.flatMap((line, i) => UNSCOPED_LOADERS.test(line) ? [`${rel(file)}:${i + 1}: ${line.trim()}`] : [])
    })
    expect(offenders).toEqual([])
  })

  test('"no project" (masters, shared rows) always means "no project in this workspace"', () => {
    // A query for rows without a project must also pin the workspace, within the same statement.
    const offenders = serverFiles.flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n')
      return lines.flatMap((line, i) => {
        if (!line.includes("doesNotExist('project')")) return []
        const statement = lines.slice(Math.max(0, i - 4), i + 2).join('\n')
        return /equalTo\('workspace'/.test(statement) ? [] : [`${rel(file)}:${i + 1}: ${line.trim()}`]
      })
    })
    expect(offenders).toEqual([])
  })
})
