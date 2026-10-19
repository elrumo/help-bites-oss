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
3. **Ask AI for help, when you want it.** Rewrite one section, write the summary,
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
| `GET /v1/legal/:publicKey/:slug?format=md` | Markdown |
| `GET /v1/legal/:publicKey/:slug?format=html` | A sanitised HTML fragment to embed in your own page |

The public JSON needs no key. Drafts answer `404`.

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
| `GET` `POST` `/documents` | List; create (`mode`: `blank`, `template`, `ai`) |
| `GET` `PATCH` `DELETE` `/documents/:id` | Read (with coverage), edit, delete |
| `POST` `/documents/:id/publish` `unpublish` `recompose` `check` | Lifecycle and checks |
| `POST` `/documents/:id/sections/:sid/rewrite` | AI rewrite of one section (`apply: true` to save it) |
| `POST` `/documents/:id/tldr/generate` | AI summary |
| `GET` `/documents/:id/versions`, `POST` `…/:n/restore` | History |
| `GET` `/wizard/:type`, `POST` `/wizard/:type/compose` | The questions; a preview |
| `POST` `/analyse` | Check pasted text |
| `GET` `/rulepacks`, `/clauses` | The catalogue |

Full AI drafts (`mode: "ai"`) run as one request and can take a minute or two;
raise your proxy's timeout if it is shorter.
