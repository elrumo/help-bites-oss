import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BLOG_COMMENT_MAX_LENGTH,
  BLOG_EXCERPT_MAX_LENGTH,
  BLOG_REACTION_EMOJI,
  BLOG_REACTIONS,
  BLOG_RESERVED_SLUGS,
  BLOG_SLUG_MAX_LENGTH,
  BLOG_TAG_MAX_LENGTH,
  BLOG_TAGS_MAX,
  BLOG_TITLE_MAX_LENGTH
} from '../shared/blog'

// The native app hand-ports the blog's limits, reactions and slug rule; this
// keeps the copies in step with shared/blog.ts.

const file = join(import.meta.dir, '../helpbites-native/App/Features/Blog/BlogModels.swift')
const missing = (src: string, values: Array<string | number>) => values.filter(v => typeof v === 'number' ? !new RegExp(`\\b${v}\\b`).test(src) : !src.includes(JSON.stringify(v)))

describe('native blog parity', () => {
  test('BlogModels.swift has every limit, reserved slug and reaction', () => {
    expect(existsSync(file)).toBe(true)
    const swift = readFileSync(file, 'utf8')
    const limits = [BLOG_TITLE_MAX_LENGTH, BLOG_SLUG_MAX_LENGTH, BLOG_EXCERPT_MAX_LENGTH, BLOG_TAGS_MAX, BLOG_TAG_MAX_LENGTH, BLOG_COMMENT_MAX_LENGTH]
    expect(missing(swift, [...limits, ...BLOG_RESERVED_SLUGS, ...BLOG_REACTIONS, ...Object.values(BLOG_REACTION_EMOJI)])).toEqual([])
    // The reactions in the same order, and each with its emoji.
    expect(swift).toContain(`static let reactions = [${BLOG_REACTIONS.map(key => JSON.stringify(key)).join(', ')}]`)
    for (const [key, emoji] of Object.entries(BLOG_REACTION_EMOJI)) expect(swift).toContain(`${JSON.stringify(key)}: ${JSON.stringify(emoji)}`)
  })

  test('the slug rule drops the same combining marks and keeps the same characters', () => {
    const swift = readFileSync(file, 'utf8')
    const shared = readFileSync(join(import.meta.dir, '../shared/blog.ts'), 'utf8')
    expect(shared).toContain('.replace(/[\\u0300-\\u036F]/g, \'\')')
    expect(shared).toContain('.replace(/[^a-z0-9]+/g, \'-\')')
    expect(swift).toContain('(0x0300...0x036F)')
    // a–z and 0–9, by code point.
    expect(swift).toContain('(97...122)')
    expect(swift).toContain('(48...57)')
  })
})
