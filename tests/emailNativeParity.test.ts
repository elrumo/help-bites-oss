import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMPONENT_FIELD_TYPES, defaultBlock, type EmailBlockType } from '../shared/email/blocks'
import { INLINE_STYLE_PROPS } from '../shared/email/render'
import { EMAIL_TEMPLATES } from '../shared/email/templates'
import { DEFAULT_THEME, FONT_STACKS, THEME_PRESETS } from '../shared/email/theme'

// The native editor hand-ports these constants; this keeps the copies in step.
// Swift string literals are double-quoted like JSON, so JSON.stringify gives
// the exact literal (single quotes in font stacks included).

const root = join(import.meta.dir, '..')
const swiftPath = (name: string) => join(root, 'helpbites-native/App/Features/Email', name)
const swift = (name: string) => readFileSync(swiftPath(name), 'utf8')
/** What `src` lacks of `values`; numbers must stand alone (10, not 100). */
const missing = (src: string, values: Array<string | number>) => values.filter(v => typeof v === 'number' ? !new RegExp(`\\b${v}\\b`).test(src) : !src.includes(JSON.stringify(v)))

const TOKENS = ['brand', 'onBrand', 'background', 'surface', 'heading', 'text', 'muted', 'radius'] as const
const BLOCK_TYPES = Object.keys({ heading: 0, text: 0, button: 0, image: 0, divider: 0, spacer: 0, columns: 0, html: 0, section: 0, component: 0 } satisfies Record<EmailBlockType, 0>) as EmailBlockType[]

describe('native email parity', () => {
  test('EmailDesignStyle.swift has every theme preset, font stack and the default theme', () => {
    const presets = THEME_PRESETS.flatMap(p => [p.id, p.name, ...TOKENS.map(k => p.theme[k])])
    const fonts = FONT_STACKS.flatMap(f => [f.label, f.value])
    expect(missing(swift('EmailDesignStyle.swift'), [...presets, ...fonts, ...Object.values(DEFAULT_THEME)])).toEqual([])
  })

  test('EmailDesign.swift has every block default', () => {
    const values = BLOCK_TYPES.flatMap(type => Object.entries(defaultBlock(type, 'x'))
      .filter(([key, value]) => key !== 'id' && key !== 'type' && typeof value === 'string')
      .map(([, value]) => value as string))
    expect(values).toContain('Click me')
    expect(missing(swift('EmailDesign.swift'), values)).toEqual([])
  })

  test('EmailRender.swift keeps the same inline styles and EmailDesign.swift has every component field type', () => {
    expect(missing(swift('EmailRender.swift'), [...INLINE_STYLE_PROPS])).toEqual([])
    expect(missing(swift('EmailDesign.swift'), [...COMPONENT_FIELD_TYPES])).toEqual([])
  })

  test('EmailModels.swift lists every starter', () => {
    expect(missing(swift('EmailModels.swift'), EMAIL_TEMPLATES.map(t => t.id))).toEqual([])
  })

  // Skipped until EmailChatPanel.swift exists.
  test.skipIf(!existsSync(swiftPath('EmailChatPanel.swift')))('EmailChatPanel.swift has the chat starters and quick actions verbatim', () => {
    // The prompts live in en.json; the panel fills {name} with '{{name}}' ({projectUrl} with '{{project.url}}'), which is what Swift carries.
    const { emailEditor } = JSON.parse(readFileSync(join(root, 'i18n/locales/en.json'), 'utf8'))
    const prompts = Object.entries<string>({ ...emailEditor.starters, ...emailEditor.quick })
      .filter(([key]) => key.endsWith('Prompt') && key !== 'fixPrompt')
      .map(([, text]) => text.replace('{projectUrl}', '{project.url}').replace(/\{([\w.]+)\}/g, '{{$1}}'))
    expect(prompts.length).toBeGreaterThanOrEqual(12)
    const src = swift('EmailChatPanel.swift')
    expect(prompts.filter(p => !src.includes(p))).toEqual([])
  })
})
