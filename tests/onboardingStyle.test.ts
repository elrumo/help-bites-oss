import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flowStyleOf, serializeOnboardingFlow } from '../server/utils/onboarding'

// Onboarding flows wear the project style, with their own accent, background,
// text, radius and font as a layer over it.

const fake = (id: string, fields: Record<string, unknown>) => ({ id, get: (k: string) => fields[k] }) as any
const project = (style: unknown = undefined) => fake('p1', { name: 'Acme', publicKey: 'pk_1', theme: { accent: '#112233' }, style })

describe('onboarding style', () => {
  test('a flow that sets nothing wears the project style in light and dark', () => {
    const look = flowStyleOf(project({ light: { accent: '#e11d48' }, dark: { surface: '#222233' }, shadow: 'strong', radius: 6 }), { accent: '', background: '', text: '', radius: 20, font: 'system' })
    expect(look).toMatchObject({ shadow: 'strong', radius: 6 })
    expect(look.dark).toMatchObject({ accent: '#e11d48', surface: '#222233' })
  })

  test("the flow's own fields win, and without a project style nothing changes", () => {
    const own = { accent: '#00aa00', background: '#fefefe', text: '#222222', radius: 10, font: 'serif' as const }
    const look = flowStyleOf(project({ radius: 6, font: 'mono' }), own)
    expect(look.radius).toBe(10)
    expect(look.dark.accent).toBe('#00aa00')
    expect(look.fontFamily).toContain('serif')
    const plain = flowStyleOf(project(), { accent: '', background: '', text: '', radius: 20, font: 'system' })
    expect(plain.radius).toBe(20)
    expect(plain.light.accent).toBe('#112233')
  })

  test('the published flow carries the look', () => {
    // The route helpers are Nitro auto-imports; stand in for the one this reads.
    ;(globalThis as any).iso = () => null
    const published = { name: 'Welcome', steps: [], style: { accent: '', background: '', text: '', radius: 20, font: 'system' }, options: {}, locale: 'en', translations: {} }
    const row = fake('f1', { key: 'welcome', name: 'Welcome', status: 'published', published, version: 1 })
    const flow = serializeOnboardingFlow(project({ light: { accent: '#e11d48' } }), row).published!
    expect(flow.look.light.accent).toBe('#e11d48')
    expect(flow.style.accent).toBe('#e11d48')
  })

  test('onboarding.js reads the finished look and takes data-shadow', () => {
    const source = readFileSync(join(import.meta.dir, '../public/onboarding.js'), 'utf8')
    expect(source).toContain('flow.look')
    expect(source).toContain("shadow: attr('shadow')")
  })
})
