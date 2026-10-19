# Legal documents

Host your privacy policy, terms of service, cookie policy and refund policy on
HelpBites, so you don't have to host anything. Each document gets a public,
styled page you link to from your app, and everything is available over the API.

**This is a drafting tool, not legal advice.** The clause library and the
rulepacks are a starting point. The packs ship marked as unreviewed
(`lastReviewed: null`) until a person has compared them with their sources, so
have a lawyer review your documents before you rely on them.

## How a document is made

1. **From reviewed clauses (no AI).** You answer a short wizard: who you are,
   which platforms, which regions your users are in, what you collect, which
   services you use. HelpBites assembles the document from a library of
   reviewed clauses, keeping only the ones that apply. Most documents never need
   an AI.
2. **Edit it.** Change any section by hand. A section you change is marked
   `human` and is kept when you recompose; you can also **lock** a section.
3. **Bring your own.** Already have a policy? Paste it or upload a Markdown,
   HTML or plain text file (**New document → I already have one**). It is kept
   word for word, split at its headings into sections you can edit, and is never
   sent to an AI unless you choose to analyse it. See
   [Importing a document you already have](#importing-a-document-you-already-have).
4. **Ask AI for help, when you want it.** Rewrite one section, write the summary,
   check the text against the rules, or have the model write the whole
   document. AI needs a provider (the workspace's own key, or the server's
   gateway); without one these calls answer `501`.

The AI is grounded: it is given the requirements that apply to your regions as a
numbered list and told to rely only on them. Anything it cites that is not in
that list is dropped, it cannot change a locked section, and it never replaces a
summary you wrote yourself unless you pass `force: true`.

## Quick start

Create an admin API key (**API keys**), then, with your project id:

```bash
HOST=https://YOUR-SUPPORT-HOST
KEY=ak_...            # an admin API key; a key limited to projects works for those projects

# 1. Create a privacy policy from the wizard answers
curl -s $HOST/v1/admin/legal/documents -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "project": "PROJECT_ID", "type": "privacy", "mode": "template",
  "answers": {
    "app_name": "Acme Notes", "entity_name": "Acme Ltd", "contact_email": "legal@acme.test",
    "platforms": ["ios", "web"], "regions": ["eu", "uk", "us-ca"],
    "data_collected": ["account", "analytics"], "processors": ["stripe", "sentry"],
    "children": "none", "sells_or_shares_data": false
  }
}'

# 2. Publish it (records version 1)
curl -s -X POST $HOST/v1/admin/legal/documents/DOC_ID/publish -H "authorization: Bearer $KEY"
```

It is now public at `HOST/legal/PROJECT_PUBLIC_KEY/privacy`. Put that link in
your app, your store listing and your website.

Document types: `privacy`, `terms`, `cookies`, `refund`. Fetch the questions for
a type with `GET /v1/admin/legal/wizard/:type?project=ID`, and preview a result
without saving with `POST /v1/admin/legal/wizard/:type/compose`.

## Answer the wizard once, or per document

The wizard's answers belong to the document you make with them. Tick **Reuse
these answers for my other documents** (`"saveAnswers": true`) and they are also
remembered for the project: the next document starts pre-filled, over the API as
much as in the panel, so you answer once for the privacy policy and the cookie
policy and terms already know your regions. Leave it off and the answers stay
with that one document.

Reuse only fills what a document asks. A question only one kind of document has,
like the refund window or the governing law, is asked for that document and
never leaks into the others. Who you are (name, address, contact, DPO) is saved
to **Identity and look** instead, and answers you send always win over saved
ones. `GET /v1/admin/legal/wizard/:type?project=ID` returns the pre-filled
`defaults` and `shared: true` once anything is remembered.

## Importing a document you already have

```bash
curl -s $HOST/v1/admin/legal/documents -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "project": "PROJECT_ID", "type": "privacy", "mode": "import",
  "text": "# Privacy Policy\n\n## What we collect\n\nYour email address.\n\n## Contact\n\nlegal@acme.test",
  "answers": { "regions": ["eu", "uk"] }
}'
```

`text` is Markdown, HTML or plain text (up to 200,000 characters). `format`
(`markdown`, `html`, `text`) is detected unless you set it. HTML is converted to
Markdown first: headings, paragraphs, lists, links (`http(s)`, `mailto:`,
relative) and emphasis survive; scripts and anything else are dropped.

- A single top-level `#` heading becomes the title (or pass `title`).
- Sections break at the highest heading level left; deeper headings stay inside
  their section, and text before the first heading becomes an "Introduction".
- Text without Markdown headings splits at numbered (`2. Sharing`) or ALL CAPS
  lines that follow a blank line and carry no punctuation.
- A section longer than 20,000 characters is cut at paragraph breaks.

Imported sections are marked `human`, so a recompose never touches them. `answers`
is optional; its `regions` decide which rules apply when you analyse. The result
is a draft like any other: edit, publish, version, serve over the public API.

**Analyse it afterwards.** Tick **Analyse it against the rules once imported**,
or call `POST /v1/admin/legal/documents/:id/check` with `{ "ai": true }`. The
model reads your text against the requirements for your regions and reports each
as `ok`, `unclear`, `missing` or `conflict`. Imported text is not tied to
requirements, so the document's structural `coverage` has `mapped: false` and
shows no gaps; only the AI check says anything. Recomposing an imported document
adds the reviewed clauses it lacks, next to your text. To check text without
saving it, use `POST /v1/admin/legal/analyse`.

## Suggest answers from your GitHub repos

If the project has GitHub repos (see [GITHUB.md](GITHUB.md)), the wizard shows
**Suggest from my repos**. HelpBites reads each repo's file list and a few
dependency manifests (`package.json`, `requirements.txt`, `pyproject.toml`,
`Gemfile`, `go.mod`, `Cargo.toml`, `composer.json`, `pubspec.yaml`, `Podfile`,
`build.gradle`, `pom.xml`; up to 8 per repo, at most two folders deep), never
anything else and never with write access. Known SDKs map to answers: Stripe,
RevenueCat, in-app purchases, Firebase, Google Analytics, PostHog, Mixpanel,
Sentry, AdMob and other ad networks, OpenAI and Anthropic map to the matching
service, data kind, cookie type or yes/no question; the file tree and mobile or
web frameworks suggest the platforms. Services with no entry in the service
list (Clerk, PayPal, Supabase, …) are added to "Other services".

This needs no AI. Each suggestion lists what it was found in, nothing is applied
until you press **Use these answers**, and you can edit every answer afterwards.
It is a hint from dependency names: a library in a repo does not prove what your
app collects, so check each answer.

`POST /v1/admin/legal/wizard/:type/suggest` with `{ "project": "ID" }` does the
same over the API and returns `{ answers, evidence, repos, ai }`; nothing is
saved. Answers are cleaned like any others: only questions that document asks,
only real options.

**Optional AI.** For the privacy policy you can also tick *Also ask AI about
other services* (`"ai": true`). The model is shown the dependency names the
table did not recognise (names only, never code or file contents), under the
same grounding as the other AI features, and may name third-party services among
them. Each one it names must cite a dependency that really is in your manifests
(others are dropped), and its name and purpose are reduced to plain text before
they are suggested as "Other services". It uses the workspace's AI provider and
answers `501` without one.

## Sections, provenance and the summary

A document is an ordered list of sections `{ id, heading, body, source, locked }`.
`source` is `template` (from a clause), `ai` or `human`. Edit with
`PATCH /v1/admin/legal/documents/:id`; send the full `sections` list. An id you
don't know creates a section, a section you leave out is removed, and changing a
template section's text turns it `human`.

`tldr` is the short summary shown at the top of the public page. Write it
yourself (`PATCH { "tldr": "…" }`, source `human`), or generate one with
`POST …/tldr/generate`. Clear it with `null`.

Change your answers and call `POST …/recompose` to refresh the template sections
and add or remove clauses for the new regions, without touching anything a
person or the AI wrote.

## Checking against the rules

`POST /v1/admin/legal/documents/:id/check` returns `coverage`: which applicable
requirements some section answers and which none does. That check is structural
and needs no AI. Add `{ "ai": true }` and the model reads the text and reports
each requirement as `ok`, `unclear`, `missing` or `conflict`.
`POST /v1/admin/legal/analyse` does the same for any text you paste, such as a
policy you wrote years ago.

`GET /v1/admin/legal/rulepacks` lists the packs: GDPR and ePrivacy, UK GDPR,
CCPA/CPRA and other US state laws, COPPA, LGPD, PIPEDA, the Australian Privacy
Act, Apple App Store and Google Play policy, and best-practice checklists for
terms, cookies and refunds. `GET /v1/admin/legal/clauses` lists the clauses.

## Publishing and versions

`publish` makes a document public and records a version (a snapshot). Editing a
published document changes the live page at once; publish again to record the
next version. `GET …/versions` lists them and `POST …/versions/:n/restore` puts
one back as the working draft (it is not republished). `unpublish` takes the page
down.

## The public page

| URL | What |
|---|---|
| `/legal/:publicKey/:slug` | The styled page |
| `/legal/:publicKey` | A list of the project's published documents |
| `GET /v1/legal/:publicKey/:slug` | JSON: title, summary, dates, sections, `markdown`, `html` |
| `GET /v1/legal/:publicKey/:slug?format=md` or `/v1/legal/:publicKey/:slug.md` | Markdown (`text/markdown`), headed by the title and summary |
| `GET /v1/legal/:publicKey/:slug?format=html` or `/v1/legal/:publicKey/:slug.html` | A sanitised HTML fragment (`text/html`) to embed in your own page |
| `GET /v1/legal/:publicKey/:slug.json` | The JSON, same as without a suffix |

The public endpoints need no key, allow any origin (CORS) and are cached for a
minute, so your own page can fetch the text and style it however it likes.
Drafts answer `404`. `:publicKey` is the project's public key, the one in the
public page URL.

```js
// Render the privacy policy inside your own page and style it with your own CSS.
const res = await fetch('https://YOUR-SUPPORT-HOST/v1/legal/PROJECT_PUBLIC_KEY/privacy.html')
document.querySelector('#policy').innerHTML = await res.text()
```

The HTML is a fragment, one `<section id="…"><h2>…</h2>…</section>` per section,
with no scripts, event handlers or inline styles, so it is safe to insert. The
Markdown is the same text for a renderer of your choice. Both come from the
published text, so imported and written documents are served identically.

## Your brand

Set how the pages look, and who you are, once per project:

```bash
curl -s -X PATCH $HOST/v1/admin/projects/PROJECT_ID -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "legal": {
    "entity": { "name": "Acme Ltd", "address": "1 High St, London", "email": "legal@acme.test", "dpo": "" },
    "accent": "#4f46e5", "font": "serif", "logoUrl": "https://acme.test/logo.png",
    "footerText": "© Acme Ltd"
  }
}'
```

`entity` pre-fills the wizard for every document. `accent` falls back to the
project's theme colour, `logoUrl` to its brand logo, and `font` is one of
`system`, `serif` or `mono`. Pages follow the reader's light or dark setting and
print cleanly.

## API reference

All admin routes are under `/v1/admin/legal`, need `?project=` (or `project` in
the body) and an operator session or admin API key. The full schema is at
`/_docs/scalar`.

| Route | |
|---|---|
| `GET` `POST` `/documents` | List; create (`mode`: `blank`, `template`, `ai`, `import`) |
| `GET` `PATCH` `DELETE` `/documents/:id` | Read (with coverage), edit, delete |
| `POST` `/documents/:id/publish` `unpublish` `recompose` `check` | Lifecycle and checks |
| `POST` `/documents/:id/sections/:sid/rewrite` | AI rewrite of one section (`apply: true` to save it) |
| `POST` `/documents/:id/tldr/generate` | AI summary |
| `GET` `/documents/:id/versions`, `POST` `…/:n/restore` | History |
| `GET` `/wizard/:type`, `POST` `/wizard/:type/compose` | The questions (with pre-filled `defaults`); a preview |
| `POST` `/wizard/:type/suggest` | Suggest answers from the project's GitHub repos |
| `POST` `/analyse` | Check pasted text |
| `GET` `/rulepacks`, `/clauses` | The catalogue |

Full AI drafts (`mode: "ai"`) run as one request and can take a minute or two;
raise your proxy's timeout if it is shorter.
