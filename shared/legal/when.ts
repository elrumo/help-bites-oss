import type { LegalAnswers, When } from './types'

/** The regions an answer set covers: what was picked, or `row` when nothing was. */
export function answeredRegions(answers: LegalAnswers): string[] {
  const picked = answers.regions
  return Array.isArray(picked) && picked.length ? picked : ['row']
}

/** Does `when` hold for these answers? No condition always holds. */
export function matches(when: When | undefined, answers: LegalAnswers): boolean {
  if (!when) return true
  if (when.regions) {
    const have = answeredRegions(answers)
    if (!when.regions.some(region => have.includes(region))) return false
  }
  if (when.has) {
    for (const [id, wanted] of Object.entries(when.has)) {
      const value = answers[id]
      const have = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []
      if (!wanted.some(item => have.includes(item))) return false
    }
  }
  if (when.is) {
    for (const [id, want] of Object.entries(when.is)) {
      const value = answers[id]
      if (value === want) continue
      if (want === false && value === undefined) continue
      return false
    }
  }
  if (when.anyOf && !when.anyOf.some(option => matches(option, answers))) return false
  return true
}
