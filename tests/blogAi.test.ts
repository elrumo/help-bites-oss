import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeOrigin } from '../server/utils/projects'

// How the model's answer becomes a blog proposal, and that the native app offers the same modes.

Object.assign(globalThis, { normalizeOrigin })
const { BLOG_AI_MODES, readBlogAiReply } = await import('../server/utils/blogAi')

describe('blog AI reply', () => {
  test('a JSON answer is cleaned and capped', () => {
    const tags = Array.from({ length: 14 }, (_, i) => `tag${i}`)
    const out = readBlogAiReply('write', JSON.stringify({ title: '  Offline mode ', excerpt: 'x'.repeat(400), tags: [...tags, 'tag1', 5], body: '## Hi', notes: 'ok' }))!
    expect(out.title).toBe('Offline mode')
    expect(out.excerpt.length).toBe(300)
    expect(out.tags).toEqual(tags.slice(0, 10))
    expect(out.body).toBe('## Hi')
  })

  test('meta never returns a body, and needs JSON', () => {
    expect(readBlogAiReply('meta', '{"title":"T","body":"leaked"}')!.body).toBe('')
    expect(readBlogAiReply('meta', 'just words')).toBeNull()
  })

  test('insert keeps its body', () => {
    expect(readBlogAiReply('insert', '{"body":"A passage."}')!.body).toBe('A passage.')
  })

  test('plain text from a writing mode is taken as the body', () => {
    expect(readBlogAiReply('continue', '## More\n\nText')!.body).toBe('## More\n\nText')
  })

  test('the native app offers the same modes (insert is the rich editor\'s)', () => {
    const swift = readFileSync(join(import.meta.dir, '../helpbites-native/App/Features/Blog/BlogAi.swift'), 'utf8')
    expect(swift).toContain(`case ${BLOG_AI_MODES.filter(m => m !== 'insert').map(m => (m === 'continue' ? '`continue`' : m)).join(', ')}`)
  })
})
