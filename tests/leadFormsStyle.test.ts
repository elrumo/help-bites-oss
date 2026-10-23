import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateLeadFields } from '../shared/leadForms'
import { formStyleOf, leadFormPage, toPublicLeadForm } from '../server/utils/leadForms'

// Lead forms wear the project style, with their own accent, background, text,
// radius and font as a layer over it.

process.env.HELPBITES_SECRET = 'test-secret-that-is-at-least-32-characters-long'

const fake = (id: string, fields: Record<string, unknown>) => ({ id, get: (k: string) => fields[k] }) as any
const project = (style: unknown = undefined) => fake('p1', { name: 'Acme', publicKey: 'pk_1', theme: { accent: '#112233' }, style })
const form = (style: Record<string, unknown> = {}) => fake('lf1', { key: 'waitlist', name: 'Waitlist', fields: validateLeadFields([{ type: 'email' }]).fields, style, settings: {} })

describe('lead form style', () => {
  test('a form that sets nothing wears the project style in light and dark', () => {
    const look = formStyleOf(project({ light: { accent: '#e11d48' }, dark: { background: '#101820' }, shadow: 'strong', radius: 6 }), form().get('style'))
    expect(look).toMatchObject({ shadow: 'strong', radius: 6 })
    expect(look.light.accent).toBe('#e11d48')
    expect(look.dark).toMatchObject({ accent: '#e11d48', background: '#101820' })
  })

  test("the form's own fields win in both schemes, and a default radius follows the project", () => {
    const own = { accent: '#00aa00', background: '#fefefe', text: '#222222', radius: 20, font: 'mono' }
    const look = formStyleOf(project({ radius: 6, dark: { text: '#eeeeee' } }), { ...form().get('style'), ...own })
    expect(look).toMatchObject({ radius: 20 })
    expect(look.light).toMatchObject({ accent: '#00aa00', background: '#fefefe', text: '#222222' })
    expect(look.dark).toMatchObject({ accent: '#00aa00', text: '#222222' })
    expect(look.fontFamily).toContain('mono')
    // radius 12 is the form default: it follows the project's 6.
    expect(formStyleOf(project({ radius: 6 }), { radius: 12 }).radius).toBe(6)
  })

  test('a project without a style keeps the form as it was', () => {
    const look = formStyleOf(project(), { accent: '', radius: 12, font: 'system' } as any)
    expect(look.radius).toBe(12)
    expect(look.light.accent).toBe('#112233')
  })

  test('the public form carries the finished look, and style.accent is filled from it', () => {
    const body = toPublicLeadForm(project({ light: { accent: '#e11d48' } }), form())
    expect(body.look.light.accent).toBe('#e11d48')
    expect(body.style.accent).toBe('#e11d48')
    expect(toPublicLeadForm(project(), form({ accent: '#ff0000' })).style.accent).toBe('#ff0000')
  })

  test('the hosted page carries both palettes, radius and shadow', () => {
    const html = leadFormPage(project({ light: { accent: '#e11d48' }, dark: { background: '#101820' }, shadow: 'medium' }), form())
    expect(html).toContain('--accent:#e11d48')
    expect(html).toContain('@media (prefers-color-scheme:dark)')
    expect(html).toContain('--bg:#101820')
    expect(html).toContain('--shadow:0 4px 12px')
    // A style that fixes the scheme has no media query.
    expect(leadFormPage(project({ scheme: 'dark' }), form())).not.toContain('prefers-color-scheme:dark')
  })

  test('forms.js reads the finished look and takes data-shadow', () => {
    const source = readFileSync(join(import.meta.dir, '../public/forms.js'), 'utf8')
    expect(source).toContain('form.look')
    expect(source).toContain("shadow: attr('shadow')")
    expect(source).toContain('look.scheme')
  })
})
