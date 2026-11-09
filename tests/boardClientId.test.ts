import { expect, test } from 'bun:test'
import { createBoardItem } from '../server/utils/board'

// The native app's offline outbox retries a create until it gets an answer: the same `clientId` must return the item
// it already made, never a second one. board.ts leans on nitro's auto-imports and Parse, so stub what it calls.

const g = globalThis as Record<string, any>
let rows: { className: string, fields: Record<string, unknown>, get: (key: string) => unknown }[] = []

class Query {
  private equal: [string, unknown][] = []
  constructor(private className: string) {}
  equalTo(field: string, value: unknown) { this.equal.push([field, value]); return this }
  async first() { return rows.find(row => row.className === this.className && this.equal.every(([field, value]) => row.get(field) === value)) }
}

g.useParse = () => ({ Query })
g.MASTER = { useMasterKey: true }

const project = { id: 'p1', get: () => undefined } as any
const row = (fields: Record<string, unknown>) => ({ className: 'BoardItem', fields, get: (key: string) => fields[key] })

test('a repeated clientId returns the item it already created', async () => {
  const existing = row({ project, clientId: 'local-abc', title: 'First' })
  rows = [row({ project: { id: 'p2' }, clientId: 'local-abc' }), existing]
  expect(await createBoardItem(project, {} as any, { title: 'Sent again', clientId: ' local-abc ' }) as unknown).toBe(existing)
})
