import { MERGE_LLM_ONLY_MAX, MERGE_GROUNDING, MERGE_WRITE_GROUNDING, jevPairRequest, mergeCandidatePairs, mergeFallback, mergeGroups, mergePrompt, mergeWritePrompt, readMergeSuggestions, type MergeEntryInfo, type MergeSuggestion } from '#shared/changelogMerge'
import { assertAiBudget, chatCompletion, recordAiUsage, type AiRoute } from './aiGateway'

// "Suggest merges". With Jev configured (resolveJev) Jev judges pairs of entries, code joins the pairs
// it is sure of into groups and the chat model writes each merged entry, so a list of hundreds is read
// in parts and every part is small. Without Jev the chat model reads the whole list (up to MERGE_LLM_ONLY_MAX).

const JEV_PARALLEL = 16
const WRITE_PARALLEL = 6
/** Groups written per chat call. */
const WRITE_BATCH = 8
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Runs `fn` over `items`, `limit` at a time, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!) }
  }))
  return out
}

type JevAnswer = { answers?: Record<string, { noul?: number }>, usage?: { input_tokens?: number } }

/** One Jev request; 429 and 529 are retried with a growing pause, as TypeSafe asks. */
async function jevAsk(route: AiRoute, body: { state: unknown, questions: Record<string, unknown> }): Promise<JevAnswer> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${route.endpoint}/v1/systemone`, {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { 'Content-Type': 'application/json', ...(route.apiKey ? { Authorization: `Bearer ${route.apiKey}` } : {}) },
      body: JSON.stringify({ model: route.model, ...body })
    })
    if ((res.status === 429 || res.status === 529) && attempt < 3) { await sleep(1000 * 2 ** attempt); continue }
    if (!res.ok) throw new Error(`Jev returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    return await res.json() as JevAnswer
  }
}

/** Jev's yes probability for each candidate pair of entries. Billed once, for all the requests together. */
async function judgePairs(route: AiRoute, entries: MergeEntryInfo[]): Promise<{ a: number, b: number, p: number }[]> {
  await assertAiBudget(route)
  // One pair per request: Jev's answer drifts when a request carries many comparisons (the same unrelated
  // pair scored 0.94 among twelve and 0.16 among four). It is cheap and fast, so the requests run in parallel.
  let inputTokens = 0
  try {
    return (await mapLimit(mergeCandidatePairs(entries), JEV_PARALLEL, async ([a, b]) => {
      const reply = await jevAsk(route, jevPairRequest(entries, a, [b]))
      inputTokens += Number(reply.usage?.input_tokens || 0)
      return { a, b, p: Number(reply.answers?.[`p${b}`]?.noul) }
    })).filter(e => Number.isFinite(e.p))
  } finally {
    await recordAiUsage(route, { inputTokens }).catch(error => console.warn('[ai] usage not recorded:', (error as Error).message))
  }
}

/** The chat model writes each group's merged entry; a group it skips or botches keeps the sources put together. */
async function writeGroups(route: AiRoute, entries: MergeEntryInfo[], groups: number[][]): Promise<MergeSuggestion[]> {
  const batches = Array.from({ length: Math.ceil(groups.length / WRITE_BATCH) }, (_, n) => groups.slice(n * WRITE_BATCH, (n + 1) * WRITE_BATCH))
  const written = await mapLimit(batches, WRITE_PARALLEL, async (batch) => {
    const { text } = await chatCompletion(route, { messages: [{ role: 'system', content: MERGE_WRITE_GROUNDING }, { role: 'user', content: mergeWritePrompt(entries, batch) }], temperature: 0.2, max_tokens: 12_000 }, { timeoutMs: 120_000 })
    return readMergeSuggestions(text, entries)
  })
  const byGroup = new Map(written.flat().map(m => [[...m.refs].sort().join(','), m]))
  return groups.map((g) => {
    const sources = g.map(i => entries[i]!)
    return byGroup.get(sources.map(e => e.id).sort().join(',')) ?? mergeFallback(sources)
  })
}

export async function suggestChangelogMerges(entries: MergeEntryInfo[], llm: AiRoute, jev: AiRoute | null): Promise<MergeSuggestion[]> {
  if (jev) {
    const groups = mergeGroups(entries.length, await judgePairs(jev, entries))
    return groups.length ? await writeGroups(llm, entries, groups) : []
  }
  if (entries.length > MERGE_LLM_ONLY_MAX) throw createError({ statusCode: 400, statusMessage: `Too many entries: without Jev, select at most ${MERGE_LLM_ONLY_MAX} to suggest merges` })
  const { text } = await chatCompletion(llm, { messages: [{ role: 'system', content: MERGE_GROUNDING }, { role: 'user', content: mergePrompt(entries) }], temperature: 0.2, max_tokens: 12_000 }, { timeoutMs: 120_000 })
  // A reply that parses to no merges is a valid "nothing to merge"; one that is not JSON at all is a failure.
  if (!/[[{]/.test(text)) throw new Error('the reply was not JSON, it may have been cut off')
  return readMergeSuggestions(text, entries)
}
