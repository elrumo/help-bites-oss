// Scores the AI designer on converting an HTML email into blocks. It runs the
// designer in-process (the same prompt, tools and conversion check as the
// chat route, on a blank template of a project, no database), sends the
// request a person would type, then checks the result: nothing dropped or
// invented, the copy in blocks rather than one custom HTML block, every
// variable declared, and the fixture's own expectations. Writes
// original.html, converted.html and compare.html for a side-by-side look.
//
//   bun scripts/email-ai-eval.mjs [--tier ultra|high] [--fixture submission-approved] [--out dir]
//   needs LITELLM_API_BASE_URL (and LITELLM_API_KEY) in .env, like the server

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stepCountIs, streamText } from 'ai'
import { emailAiDrafts, emailAiModel, emailAiTools, emailSystemPrompt } from '../server/utils/emailAi.ts'
import { EMAIL_AI_MAX_OUTPUT_TOKENS } from '../shared/email/ai.ts'
import { conversionGaps, conversionSource } from '../shared/email/convert.ts'
import { normalizeDocument } from '../shared/email/ops.ts'
import { renderEmailHtml } from '../shared/email/render.ts'
import { applyTemplateVariables, extractTemplateVariables } from '../shared/email/placeholders.ts'
import { cloneBlankEmailDocument } from '../shared/email/templates.ts'
import { walkBlocks } from '../shared/email/blocks.ts'
import { currentTheme } from '../shared/email/theme.ts'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const tier = arg('tier', 'ultra')
const fixture = arg('fixture', 'submission-approved')
const out = arg('out', join(tmpdir(), 'helpbites-email-eval'))

// What each fixture must come out as, beyond the generic checks.
const EXPECT = {
  'password-reset': (doc, all) => ({
    'the header is two columns (logo, sign-in link)': all.some(b => b.type === 'columns' && b.columns.length === 2),
    'the card is a bordered/rounded section or the card itself': all.some(b => b.type === 'section' && (b.radius || 0) >= 8) || doc.settings.contentBackground?.toLowerCase() === '#ffffff',
    'the code stays monospaced and spaced out': all.some(b => (b.type === 'text' || b.type === 'heading' || b.type === 'component' || b.type === 'html') && /\{\{code\}\}/.test(JSON.stringify(b)) && /courier|monospace|letter-spacing/i.test(JSON.stringify(b))),
    'the button goes to {{resetUrl}}': all.some(b => b.type === 'button' && b.href === '{{resetUrl}}' && /choose a new password/i.test(b.label)),
    'subject from <title>': doc.settings.title === 'Reset your Lumen password',
    'preheader from the hidden text': /expires in 15 minutes/.test(doc.settings.preheader || '')
  }),
  'submission-approved': (doc, all) => {
    const sections = all.filter(b => b.type === 'section')
    return {
      'the card is a rounded section': sections.some(s => (s.radius || 0) >= 20),
      'the hero is a gradient section': sections.some(s => s.gradientTo),
      'the card is melted into the page': doc.settings.contentBackground?.toLowerCase() === doc.settings.backgroundColor?.toLowerCase(),
      'the pill sits above the card, not in it': (() => {
        const card = sections.find(s => (s.radius || 0) >= 20)
        const inCard = []
        if (card) walkBlocks(card.blocks, b => inCard.push(b))
        return !!card && all.some(b => b.type === 'button' && /^acme\.com$/i.test(b.label)) && !inCard.some(b => b.type === 'button' && /^acme\.com$/i.test(b.label))
      })(),
      'the title is a 34px heading': all.some(b => b.type === 'heading' && /approved/i.test(b.text) && b.fontSize === 34),
      'the title keeps its tight tracking': all.some(b => b.type === 'heading' && b.letterSpacing < 0),
      'the logo is 62px wide': all.some(b => b.type === 'image' && /logo/.test(b.src) && b.width === 62),
      'the coffee badge is not full width': all.some(b => b.type === 'image' && /buymeacoffee/.test(b.src) && ((b.width > 0 && b.width < 300) || b.height > 0)),
      'links keep their colour': all.some(b => b.type === 'text' && /color:\s*#2563eb/i.test(b.html)),
      'Share on X is a bare link': all.some(b => b.type === 'button' && /share on x/i.test(b.label) && String(b.backgroundColor).toLowerCase() === 'transparent'),
      'the brand colour isn\'t the white pill': !/^#fff(fff)?$/i.test(currentTheme(doc).brand)
    }
  }
}

const source = readFileSync(join(import.meta.dir, 'fixtures', `${fixture}.html`), 'utf8')
const text = `Convert this plain html into components:\n${source}`
const state = { doc: normalizeDocument(cloneBlankEmailDocument()), variables: [], changed: false, components: [], saved: 0 }
const ctx = {
  scope: 'project',
  brand: { name: 'Acme', siteUrl: 'https://example.com' },
  source: conversionSource(state.doc, text),
  saveComponent: async input => ({ ...input, id: `cmp_eval_${state.saved + 1}`, projectId: 'eval', updatedAt: new Date().toISOString() })
}

const started = Date.now()
const calls = []
// What the editor's preview would show while the model writes: blocks per draft, and when.
const drafts = []
const countBlocks = (blocks) => { let n = 0; walkBlocks(blocks, () => n++); return n }
const updates = []
const stamp = (part) => `${((Date.now() - started) / 1000).toFixed(0)}s:${countBlocks(part.data.blocks)}`
const writer = { write: (part) => (part.type === 'data-draft' ? drafts.push(stamp(part)) : part.type === 'data-document' && updates.push(stamp(part))) }
let reply = ''
let error = ''
const result = streamText({
  model: emailAiModel(tier),
  system: emailSystemPrompt(state, ctx),
  messages: [{ role: 'user', content: text }],
  tools: emailAiTools(state, writer, ctx),
  onChunk: emailAiDrafts(state, writer),
  stopWhen: stepCountIs(16),
  maxOutputTokens: EMAIL_AI_MAX_OUTPUT_TOKENS,
  maxRetries: 2
})
for await (const part of result.fullStream) {
  if (part.type === 'text-delta') reply += part.text ?? part.delta ?? ''
  if (part.type === 'tool-call') calls.push({ name: part.toolName, output: '', input: part.input })
  if (part.type === 'tool-result') Object.assign(calls.findLast(c => c.name === part.toolName) || {}, { output: String(part.output) })
  if (part.type === 'tool-error') Object.assign(calls.findLast(c => c.name === part.toolName) || {}, { output: `ERROR ${part.error?.message || part.error}` })
  if (part.type === 'error') error = String(part.error?.message || part.error)
}
const seconds = ((Date.now() - started) / 1000).toFixed(0)
const steps = await result.steps
const usage = steps.map(st => `${st.finishReason}:${st.usage?.outputTokens ?? '?'}`).join(' ')

const doc = state.doc
const all = []
walkBlocks(doc.blocks, b => all.push(b))
const textOf = html => String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length
const htmlShare = all.filter(b => b.type === 'html').reduce((n, b) => n + textOf(b.html), 0) / Math.max(1, textOf(renderEmailHtml(doc)))
const declared = new Set(state.variables.filter(v => v.defaultValue).map(v => v.key))
const gaps = conversionGaps(source, doc)
const checks = {
  'nothing dropped or invented': gaps.length === 0,
  'the copy is in blocks, not custom HTML': htmlShare < 0.1,
  'every variable has a sample value': extractTemplateVariables(doc).every(k => declared.has(k)),
  'subject and preheader written': !!doc.settings.title && doc.settings.title !== 'Untitled email' && !!doc.settings.preheader,
  ...(EXPECT[fixture]?.(doc, all) || {})
}

mkdirSync(out, { recursive: true })
const samples = Object.fromEntries(state.variables.map(v => [v.key, v.defaultValue || v.key]))
writeFileSync(join(out, 'converted.html'), renderEmailHtml(applyTemplateVariables(doc, samples)))
writeFileSync(join(out, 'original.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">${source.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => samples[k] ?? m)}</body></html>`)
writeFileSync(join(out, 'compare.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0;display:flex}div{flex:1}iframe{border:0;width:100%;height:1200px}h3{font:12px sans-serif;margin:6px}</style><div><h3>original</h3><iframe src="original.html"></iframe></div><div><h3>converted</h3><iframe src="converted.html"></iframe></div>')
writeFileSync(join(out, 'document.json'), JSON.stringify({ document: doc, variables: state.variables }, null, 2))
writeFileSync(join(out, 'calls.json'), JSON.stringify(calls, null, 2))

console.log(`\n${fixture} on ${tier}: ${seconds}s, steps (finish:output tokens) ${usage}${error ? `\nerror: ${error}` : ''}`)
for (const c of calls) console.log(`  ${c.name}: ${c.output.replace(/\s+/g, ' ').slice(0, 160)}`)
console.log(`  preview updates (time:blocks): ${updates.join(' ') || 'none'}; drafts: ${drafts.join(' ') || 'none'}`)
for (const [label, ok] of Object.entries(checks)) console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
if (gaps.length) console.log(`\ngaps:\n${gaps.map(g => `  ${g}`).join('\n')}`)
console.log(`\nreply: ${reply.trim()}\n\nscore ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length} · files in ${out}`)
process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
