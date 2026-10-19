import { describe, expect, test } from 'bun:test'
import { pickSequenceSteps, sequenceShare, SEQUENCE_LIMITS } from '../server/utils/sequences'

// Sharing a tick's sequence steps out across projects (server/utils/sequences.ts).

const step = (projectId: string, dueAt: number) => ({ id: `${projectId}${dueAt}`, projectId, dueAt })
const backlog = (projectId: string, count: number, from = 0) => Array.from({ length: count }, (_, i) => step(projectId, from + i))
const countBy = (steps: { projectId: string }[]) => steps.reduce<Record<string, number>>((out, s) => ({ ...out, [s.projectId]: (out[s.projectId] || 0) + 1 }), {})

describe('picking due sequence steps', () => {
  test('one project\'s big enrollment does not hold up the others', () => {
    // A's thousand steps all came due before anyone else's.
    const due = [...backlog('A', 1000), ...backlog('B', 3, 5000), ...backlog('C', 2, 6000)]
    const picked = pickSequenceSteps(due, 200, 50)
    expect(countBy(picked)).toEqual({ A: 50, B: 3, C: 2 })
    // B and C go out in this tick's first rounds, not after A's fifty.
    expect(picked.slice(0, 3).map(s => s.projectId)).toEqual(['A', 'B', 'C'])
  })

  test('oldest first within a project; projects take turns, the one waiting longest first', () => {
    const due = [step('A', 5), step('B', 4), step('A', 1), step('B', 2), step('A', 3)]
    expect(pickSequenceSteps(due, 10, 10).map(s => s.id)).toEqual(['A1', 'B2', 'A3', 'B4', 'A5'])
  })

  test('the tick\'s budget is shared evenly when every project has more than enough', () => {
    const due = ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'].flatMap((projectId, i) => backlog(projectId, 50, i * 100))
    const picked = pickSequenceSteps(due, 200, 50)
    expect(picked).toHaveLength(200)
    expect(Object.values(countBy(picked))).toEqual(Array(10).fill(20))
  })

  test('within each project, the steps taken are its oldest', () => {
    const due = [...backlog('A', 80), ...backlog('B', 80, 40)].reverse()
    const picked = pickSequenceSteps(due, 200, 50)
    expect(picked.filter(s => s.projectId === 'A').map(s => s.dueAt)).toEqual(backlog('A', 50).map(s => s.dueAt))
    expect(picked.filter(s => s.projectId === 'B').map(s => s.dueAt)).toEqual(backlog('B', 50, 40).map(s => s.dueAt))
  })

  test('nothing due, nothing picked; the input is left as it was', () => {
    expect(pickSequenceSteps([], 200, 50)).toEqual([])
    const due = [step('A', 2), step('A', 1)]
    pickSequenceSteps(due, 200, 50)
    expect(due.map(s => s.id)).toEqual(['A2', 'A1'])
  })
})

describe('a project\'s share of a tick', () => {
  test('alone, a project has the whole tick, as before there were shares', () => {
    expect(sequenceShare(1)).toBe(SEQUENCE_LIMITS.perTick)
    expect(pickSequenceSteps(backlog('A', 1000), SEQUENCE_LIMITS.perTick, sequenceShare(1))).toHaveLength(SEQUENCE_LIMITS.perTick)
  })

  test('with others waiting, an even split, never below the per-project floor', () => {
    expect(sequenceShare(2)).toBe(100)
    expect(sequenceShare(4)).toBe(SEQUENCE_LIMITS.perProject)
    expect(sequenceShare(40)).toBe(SEQUENCE_LIMITS.perProject)
    expect(sequenceShare(0)).toBe(SEQUENCE_LIMITS.perTick)
    expect(sequenceShare(1, 20)).toBe(20)
  })
})
