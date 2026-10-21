# Languages and AI translation

Show onboarding, legal pages and emails in your users' language. Write each once,
add the languages you serve, and either translate with AI or write the words
yourself. Anything a translation leaves out is shown in the original language, so
a half-translated screen never goes blank.

| | How languages work |
|---|---|
| [Onboarding](ONBOARDING.md#languages) | One flow, a translation per language of its name, titles, bodies, button labels and image descriptions. Apps ask for one with `?locale=`. |
| [Legal documents](LEGAL.md#other-languages) | One linked document per language, each with its own page, versions and publish state. |
| [Emails](EMAIL.md#languages) | One template, a translation per language of its words. A send names the language with `locale`. |

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
  per flow or template. Requests are rate limited per operator.
- Nothing reaches your users until you publish: onboarding translations go out with
  the next publish, translated legal documents are drafts, and emails use a
  translation as soon as it is saved (the send API reads the saved template).

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

### Swift

The onboarding snippet requests the user's first language
(`Locale.preferredLanguages`), or the one you pass:

```swift
ContentView()
  .helpBitesOnboarding(host: URL(string: "https://YOUR-SUPPORT-HOST")!, projectKey: "pk_…", flow: "welcome", locale: "es")
```

Its default button words are your app's own strings, so they follow your app's
localisation.

### API

```bash
# Onboarding: the translation, or the flow's own language when there is none
curl -s "https://YOUR-SUPPORT-HOST/v1/onboarding/PROJECT_PUBLIC_KEY/welcome?locale=es"

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

## What is not translated

- Emails you send as your own `html`, a `document` or a `message`: write them in the
  language you send.
- Campaigns and sequences send the design as it was when they were set up; they are
  not translated yet.
- Mail HelpBites sends by itself (verification codes, conversation replies, digests)
  and the chat, feedback and changelog embeds are in the project's one language.
- A contact has no language of its own yet: pass `locale` on each send.
