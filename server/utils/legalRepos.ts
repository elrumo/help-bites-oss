import { createError } from 'h3'
import { detectLegalAnswers, unknownNames } from '#shared/legal/detect'
import type { LegalAnswers, LegalDocType } from '#shared/legal/types'
import { validateAnswers } from '#shared/legal/wizard'
import { fetchRepoSnapshot, projectRepos } from './github'
import { suggestExtraServices } from './legalAi'

// "Suggest from my repos": reads the project's connected GitHub repos (read-only)
// and proposes wizard answers. Nothing is saved; the person confirms in the
// wizard. The dependency table does the work; AI is an opt-in extra that only
// adds services the table does not know, each tied to a real dependency name.

export async function suggestLegalFromRepos(ctx: MemberContext, project: ParseObject, type: LegalDocType, ai: boolean) {
  const repos = projectRepos(project)
  if (!repos.length) throw createError({ statusCode: 400, statusMessage: 'This project has no GitHub repos. Connect GitHub in Settings and pick its repos first.' })
  await rateLimit(`sb:rl:legalscan:${ctx.agentId}`, LIMITS.legalScanPerAgent.limit, LIMITS.legalScanPerAgent.window)

  const settled = await Promise.allSettled(repos.map(repo => fetchRepoSnapshot(repo)))
  const scans = settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
  if (!scans.length) throw createError({ statusCode: 502, statusMessage: 'Could not read any of this project\'s repos on GitHub. Check the connection in Settings.' })
  const read = repos.map((repo, i) => ({ repo: repo.fullName, read: settled[i]!.status === 'fulfilled' }))

  const found = detectLegalAnswers(scans)
  // Only the privacy policy has a place for services outside the built-in list.
  const useAi = ai && type === 'privacy'
  if (useAi) {
    const extras = await suggestExtraServices(ctx, unknownNames(scans), (found.answers.processors as string[] | undefined) || [])
    if (extras.length) {
      const lines = [...String(found.answers.processors_other || '').split('\n').filter(Boolean), ...extras.map(e => `${e.name} (${e.purpose})`)]
      found.answers.processors_other = lines.join('\n')
      found.answers.processors = [...new Set([...(found.answers.processors as string[] | undefined || []), 'other'])]
      found.evidence.processors_other = [...(found.evidence.processors_other || []), ...extras.map(e => `AI: ${e.name}, from dependency ${e.dependency}`)].slice(0, 8)
    }
  }

  // The same cleaning every answer set gets: only questions this document asks, only real options.
  const { answers } = validateAnswers(type, found.answers)
  const evidence = Object.fromEntries(Object.entries(found.evidence).filter(([id]) => answers[id] !== undefined))
  return { answers: answers as LegalAnswers, evidence, repos: read, ai: useAi }
}
