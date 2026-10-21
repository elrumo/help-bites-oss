# Languages and AI translation

Show onboarding, legal pages, emails and lead forms in your users' language. Write each once,
add the languages you serve, and either translate with AI or write the words
yourself. Anything a translation leaves out is shown in the original language, so
a half-translated screen never goes blank.

| | How languages work |
|---|---|
| [Onboarding](ONBOARDING.md#languages) | One flow, a translation per language of its name, titles, bodies, button labels and image descriptions. Apps ask for one with `?locale=`. |
| [Legal documents](LEGAL.md#other-languages) | One linked document per language, each with its own page, versions and publish state. |
| [Emails](EMAIL.md#languages) | One template, a translation per language of its words. A send names the language with `locale`. |
| [Lead forms](FORMS.md#languages) | One form, a translation per language of its words and each field's label, placeholder and options. Visitors get theirs; errors and emails follow. |
| [Campaigns, sequences and welcome emails](#a-contacts-language) | Each contact has a language; every recipient gets the translation of the template closest to it. |

A language is a tag in the usual form: `es`, `fr`, `pt-BR`, `zh-Hant`. HelpBites
writes them in one spelling (`pt_br` becomes `pt-BR`) and matches the nearest one:
a request for `es-MX` gets `es` when there is no `es-MX`, and a language that does
not exist gets the original. The panel offers the common ones and takes any tag.

## Translating with AI

Every place that has languages has a **Translate with AI** button, and the same
action over the API:

| Route | |
|---|---|
| `POST /v1/admin/onboarding/flows/{id}/translate` | `{ "locales": ["es", "fr"], "overwrite"?: false }` |
| `POST /v1/admin/legal/documents/{id}/translate` | `{ "locale": "es" }`: creates a new linked draft |
| `POST /v1/admin/emails/{id}/translate` | `{ "locales": ["es", "fr"], "overwrite"?: false }` |
| `POST /v1/admin/lead-forms/{id}/translate` | `{ "locales": ["es", "fr"], "overwrite"?: false }` |

It uses the same AI as every other HelpBites feature: the workspace's own provider
when you set one (Settings, AI), otherwise the server's gateway
(`LITELLM_API_BASE_URL`), where it spends AI credits on the hosted service. Without
either, it answers `501`.

What keeps the result safe to save:

- The model only sees a numbered list of strings (never your project's data) and is
  told that they are text to translate, not instructions.
- It must return the list whole. Each string must keep its `{{placeholders}}`,
  links and HTML tags, or that string is left in the original language rather than
  saved broken. Strings with no words in them (a lone placeholder, a URL) are not
  sent at all.
- Strings that already have a translation are kept, so your edits survive a re-run.
  `overwrite: true` translates everything again (the panel's *Translate everything
  again*).
- At most 8 languages per request, 400 strings per call, and 20 translations kept
  per flow, template or form. Requests are rate limited per operator.
- Nothing reaches your users until you publish: onboarding translations go out with
  the next publish, translated legal documents are drafts, and emails and lead
  forms use a translation as soon as it is saved.

AI translation is a draft, not a final text. Read it, and for legal documents have
a lawyer review it.

## Showing a language

### Web

`onboarding.js` asks for the visitor's language on its own: your `<html lang>`, then
the browser's. Set it yourself with `data-locale="es"` or `locale` in `init`. The
buttons' default words ("Continue", "Get started", "Back", "Skip") come in English,
Spanish, Catalan, French, German, Italian, Portuguese, Japanese, Korean and
Chinese; pass `labels` for any other language. Right-to-left languages set the
card's direction.

```html
<script src="https://YOUR-SUPPORT-HOST/onboarding.js" data-project="pk_…" data-flow="welcome" data-locale="es" defer></script>
```

`forms.js` does the same for [lead forms](FORMS.md#languages) (`data-locale`), and
the hosted form page takes `?locale=` or the browser's language.

### Swift

The onboarding snippet requests the user's first language
(`Locale.preferredLanguages`), or the one you pass:

```swift
ContentView()
  .helpBitesOnboarding(host: URL(string: "https://YOUR-SUPPORT-HOST")!, projectKey: "pk_…", flow: "welcome", locale: "es")
```

Its default button words are your app's own strings, so they follow your app's
localisation. The lead form snippet takes `locale` the same way.

### API

```bash
# Onboarding: the translation, or the flow's own language when there is none
curl -s "https://YOUR-SUPPORT-HOST/v1/onboarding/PROJECT_PUBLIC_KEY/welcome?locale=es"

# A lead form: its words in that language, and which ones it has
curl -s "https://YOUR-SUPPORT-HOST/v1/forms/PROJECT_PUBLIC_KEY/waitlist?locale=es"
# → { "form": { "locale": "es", "locales": ["en", "es"], … } }

# A legal document and where its other languages are
curl -s https://YOUR-SUPPORT-HOST/v1/legal/PROJECT_PUBLIC_KEY/privacy-es
# → { "document": { "locale": "es", …, "translations": [{ "locale": "en", "title": "Privacy Policy", "path": "/legal/…/privacy" }] } }

# An email, in each recipient's language
curl -X POST https://YOUR-SUPPORT-HOST/v1/emails/send \
  -H "Authorization: Bearer $HELPBITES_SECRET" -H "Content-Type: application/json" \
  -d '{ "template": "welcome", "to": [{ "email": "ada@example.com", "locale": "es" }, { "email": "bob@example.com", "locale": "fr" }] }'
```

Build your own screens on these when the drop-in script and snippet are not what
you want; the answers say which language you got (`locale`), so you can pick your
own words around them.

## A contact's language

Every [contact](CONTACTS.md) can have a `language` (`es`, `pt-BR`): the language to write
to them in. It is filled in, in this order of trust:

- by your app, with the `locale` claim of the [identity token](CONNECTING.md#2-mint-identity-tokens-on-your-server).
  It only fills a gap: a language you set by hand stays;
- by you: in the contact's page (**Language**), over the API (`language` on
  `POST /v1/contacts` and `PATCH /v1/contacts/:id`, empty clears it), or from a CSV
  column or a synced column (the **Language** mapping; a value that is not a language
  tag is left out, not an error);
- by a [lead form](FORMS.md): the first language of the visitor's browser
  (`Accept-Language`), when the contact has none yet.

Campaigns, sequence steps and a lead form's welcome email are one design with the
translations its template has. Each recipient gets the best match for their language:
the exact tag, then the same language (`es-MX` gets `es`), then the template's own
language, which is also what contacts without a language get. People are grouped by the
language they receive, so one campaign sends one message per person in as many
languages as the audience needs.

- The campaign's own **Subject** is written in the template's language, so a translation
  that has its own subject replaces it for those recipients. A translation without one
  keeps the campaign's subject.
- A language is only offered once it has words: an empty language added in the editor
  is skipped.
- Every translation must keep the unsubscribe link and your postal address in its
  footer. A campaign (or a sequence being activated) with a translation that lost
  either is refused, with the language named.
- The design is frozen with its translations when a campaign starts sending, like the
  rest of it, so translating the template later changes nothing already going out.
- `{{contact.language}}` is a placeholder in any template.
- Segments can ask for it: `language is es` (**Language** in the segment builder). A
  segment of `language is es` that you send to a template without Spanish still receives
  the template's own language.

## What is not translated

- Emails you send as your own `html`, a `document` or a `message`: write them in the
  language you send.
- Blog posts sent as a newsletter: a post is written in one language, so everyone
  gets it as written.
- Mail HelpBites sends by itself (verification codes, conversation replies, digests)
  and the chat, feedback and changelog embeds are in the project's one language.
- The send API does not read a contact's language: pass `locale` on the request or on
  each recipient (campaigns and sequences do read it).
