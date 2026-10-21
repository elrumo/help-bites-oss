import { describe, expect, test } from 'bun:test'
import { ALWAYS_SHOWN_SECTIONS, HIDEABLE_SECTIONS, PROJECT_SECTION_GROUPS, SECTION_GROUPS, groupSections, normalizeHiddenSections, validateHiddenSections } from '../shared/projectSections'
import { projectSections } from '../app/utils/projectSections'

describe('project sections', () => {
  test('the panel lists exactly the sections the shared groups name, in the same order', () => {
    expect(projectSections.map(s => s.path)).toEqual(Object.keys(PROJECT_SECTION_GROUPS))
  })

  test('every group has sections, and only Overview and Settings stand outside them', () => {
    for (const group of SECTION_GROUPS) expect(Object.values(PROJECT_SECTION_GROUPS).includes(group)).toBe(true)
    expect(Object.entries(PROJECT_SECTION_GROUPS).filter(([, group]) => !group).map(([path]) => path)).toEqual(ALWAYS_SHOWN_SECTIONS)
  })

  test('hiding keeps known sections in sidebar order and drops the rest', () => {
    expect(normalizeHiddenSections(['revenue', 'nope', 'conversations', 'revenue', 'settings', 'overview'])).toEqual(['conversations', 'revenue'])
    expect(normalizeHiddenSections('revenue')).toEqual([])
    expect(HIDEABLE_SECTIONS).not.toContain('overview')
    expect(HIDEABLE_SECTIONS).not.toContain('settings')
  })

  test('an update that names a section that cannot be hidden is refused, not trimmed', () => {
    expect(validateHiddenSections(['revenue'])).toEqual({ hidden: ['revenue'], errors: [] })
    expect(validateHiddenSections(['settings', 'overview', 'bogus']).errors).toEqual(['hiddenSections cannot include settings, overview, bogus'])
    expect(validateHiddenSections('revenue').errors).toHaveLength(1)
    expect(validateHiddenSections([]).hidden).toEqual([])
  })

  test('the sidebar is Overview, the groups with something left in them, then Settings', () => {
    const all = groupSections(projectSections)
    expect(all.top.map(s => s.path)).toEqual(['overview'])
    expect(all.bottom.map(s => s.path)).toEqual(['settings'])
    expect(all.groups.map(g => g.group)).toEqual([...SECTION_GROUPS])
    expect(all.groups.flatMap(g => g.sections).length + 2).toBe(projectSections.length)

    const trimmed = groupSections(projectSections, ['pages', 'blog', 'legal', 'brand', 'settings'])
    expect(trimmed.groups.map(g => g.group)).not.toContain('site')
    // Settings is where a hidden section comes back, so it stays however it is asked for.
    expect(trimmed.bottom.map(s => s.path)).toEqual(['settings'])
  })
})
