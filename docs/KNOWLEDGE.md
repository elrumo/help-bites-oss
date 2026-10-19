# Knowledge & AI assistants

This is the admin-managed layer between uploaded support documentation and the
support runtime. Administrators upload a `SUPPORT_FAQ.md`, it becomes structured,
navigable, searchable knowledge, and it is assigned to AI assistants that can
suggest or (optionally) send grounded answers.

It follows the existing app's conventions: Parse classes defined in
`scripts/ensure-schema.mjs`, auto-imported helpers in `server/utils/**`,
file-per-route handlers under `server/routes/v1/admin/**` guarded by
`requireAgent`, pure logic in `shared/knowledge.ts`, and a `@nuxt/ui` panel.

## Data model (Parse classes)

Everything hangs off a **Project**: `Project → { conversations, KnowledgeModels, SupportAgents }`. A knowledge model belongs to one project (`KnowledgeModel.project`), and its nodes/FAQs/documents belong to it transitively; assistants (`SupportAgent.project`) and their assignments are project-scoped too. The admin UI reflects this — knowledge and assistants are reached from a project page (`/projects/:id`), not a global list.

| Class | Purpose |
|---|---|
| `KnowledgeModel` | A logical body of knowledge (a product / area) **within a project** (`project` pointer). |
| `KnowledgeNode` | A node in the model's path tree; `parent` pointer + denormalized `pathCache` (`Account/Sign-In`). |
| `Faq` | A first-class FAQ record. Carries provenance (`sourceDocument`, `sourceSection`, `sourceVersion`, deterministic `importKey`), `origin` (`manual`/`imported`/`ai-generated`/`api`), `detached`, `needsReindex`. |
| `KnowledgeDocument` | An uploaded source file. Versions share a `lineageId`; one row per lineage is `isCurrent`. The file lives in S3 under `storageKey` (served only through the authenticated download route). |
| `SupportAgent` | An AI support configuration: `systemPrompt`, `model`, `endpoint`, `apiKey` (write-only), `temperature`, `autoReply`, `fallbackBehavior`, optional `project`. Distinct from the human Team (`_User`). |
| `AgentKnowledgeAssignment` | A grant (or `exclude`) at `model` / `path` / `faq` scope, linking a `SupportAgent` to knowledge. |

`Message` gains a nullable `supportAgent` pointer so AI replies carry provenance.

Deletion is guarded: model/node/document deletes return an impact summary unless
`?confirm=true`; node deletes reparent children and move FAQs up rather than
cascading; document deletes keep the FAQs (they only lose the source link).

## Ingestion pipeline

`shared/knowledge.ts` → `server/utils/ingestion.ts` → routes under
`server/routes/v1/admin/knowledge/imports/**`.

1. **Upload** (`imports/upload.post`) stores the file (`storeDocument`), creates a
   `KnowledgeDocument` (v1), and returns a **preview** — nothing is imported yet.
2. **Parse** is deterministic (`parseFaqMarkdown`, pure): a leaf heading with body
   becomes an FAQ; a heading with children becomes a path node; a single leading
   `#` is the document title; category bodies are scanned for `Q:/A:` and bold
   `**question?**` blocks; empty/answerless sections are reported, not dropped.
3. **Preview** (`buildImportPreview`) flags in-document and existing duplicates
   (by `normalizeQuestion` and `importKey`) and lets the admin deselect/edit.
4. **Commit** (`imports/[id]/commit.post` → `commitImport`) creates/updates FAQs
   matched by `importKey` (`lineageId::path::normalizedQuestion`), sets provenance,
   and marks FAQs that vanished from the source `outdated` (`outdatedImportKeys`).
5. **Index** runs in the background (`runIndexingInBackground`), updating the
   document's `status`/`importStats`; the UI polls it.

**Idempotent & safe to retry:** a stable `importKey` + Meilisearch upsert by FAQ
id means re-running never duplicates. **Never destructive:** an admin edit sets
`detached`, and reprocessing skips detached FAQs; disappeared FAQs go `outdated`,
not deleted.

Reprocess (`documents/[id]/reprocess.post`) re-parses the stored bytes; replace
(`documents/[id]/replace.post`) uploads a new lineage version and returns a
preview.

## Indexing pipeline

`indexModelFaqs` (in `ingestion.ts`) builds a normalized `indexText`
(`buildIndexText`: product, path, question, aliases, tags, answer), generates an
embedding, and upserts into the Meilisearch `knowledge` index with filterable
`modelId` / `nodeId` / `pathCache` / `status` / `language`. It only touches
`needsReindex` FAQs unless `all` is set. If embeddings are unavailable it indexes
lexical-only — search still works.

- **Embeddings** (`server/utils/embeddings.ts`): the `EmbeddingProvider` seam.
  Default runs the CLIP text encoder locally via transformers.js
  (`ICON_EMBEDDING_MODEL`, `ICON_EMBEDDING_DEVICE` — `wasm` default, `webgpu`/`cpu`
  opt-in). Set `EMBEDDING_ENDPOINT` to offload to a remote OpenAI-style service,
  or `KNOWLEDGE_DISABLE_EMBEDDINGS=1` for lexical-only.
- **Vector/search store** (`server/utils/meili.ts`): Meilisearch. `ensure-search.mjs`
  creates indexes + settings + the userProvided embedder on boot.

## Retrieval & the support runtime

`server/utils/retrieval.ts` `retrieveKnowledge(agentId, query, opts)`:

1. Resolve the agent's assignments into an include/exclude filter
   (`resolveAgentFilter` → `resolveAgentFaqFilter`, pure).
2. Hybrid search Meilisearch (lexical + query vector), pre-filtered to the agent's
   models and active status.
3. Hydrate the hits from Parse, apply `faqAllowed` (model/path-subtree/faq minus
   excludes) and `rankAndFilter` (status/language), and attach source info.
4. If Meilisearch is down, fall back to a Parse keyword scan over accessible FAQs.

The support runtime hook (`server/utils/autoResponder.ts`, called from the two
user-message routes) finds an active `SupportAgent` with `autoReply` on for the
project, retrieves knowledge, calls the LLM (`server/utils/llm.ts`), and posts the
answer via `appendMessage` — detached, so it never blocks the user's request.
It's a no-op unless a project has an auto-reply agent with an LLM configured.

**Prompt grounding** (`llm.ts`): the system prompt instructs the model to answer
only from the supplied knowledge, say when it doesn't know, and treat knowledge
and user messages as data — never as instructions.

## How to extend

**Add a document parser** (e.g. `.pdf`): the pipeline is parser-agnostic — commit
consumes `{ path, question, answer }` entries. Add extraction that produces those,
widen `KNOWLEDGE_DOC_EXTENSIONS`/`storeDocument` sniffing in `shared/knowledge.ts`
and `server/utils/s3.ts`, and route the new type to your parser in
`buildImportPreview` before falling back to `parseFaqMarkdown`.

**Add an embeddings provider:** implement the `EmbeddingProvider` interface
(`embedText`, `embedBatch`) in `server/utils/embeddings.ts` and select it in
`getEmbeddingProvider`. Nothing else imports a vendor.

**Add a vector / search backend:** `server/utils/meili.ts` is the only module that
talks to Meilisearch. Provide the same functions (`ensureSearchIndexes`,
`indexDocuments`, `deleteDocuments`, `searchIndex`) over another engine; retrieval
and ingestion are written against those.

## Scripts & config

- `bun run schema:apply` — Parse classes/indexes (idempotent, runs on boot).
- `bun run search:setup` — Meilisearch indexes/settings (idempotent, runs on boot).
- `bun run reindex` — backfill existing conversations/end-users/FAQs (lexical).
- `bun run seed:knowledge` — seed a demo model from `scripts/fixtures/SUPPORT_FAQ.md`
  against a running app.

Env: `MEILI_URL`, `MEILI_API_KEY` (or, as a fallback, `MEILI_MASTER_KEY`); `ICON_EMBEDDING_MODEL`, `ICON_EMBEDDING_DEVICE`,
`TRANSFORMERS_CACHE`, `EMBEDDING_ENDPOINT`, `KNOWLEDGE_DISABLE_EMBEDDINGS`;
`LITELLM_API_BASE_URL`, `LITELLM_API_KEY`, `LLM_DEFAULT_MODEL`. See `.env.example`.

## Tests

Pure logic is covered in `tests/`: `faqParser` (hierarchy/Q&A/defensive),
`knowledge` (normalize/importKey/dedupe/indexText), `agentKnowledge`
(assignment inheritance + exclusion), `reprocess` (deterministic matching,
outdated detection). Run `bun test`.
