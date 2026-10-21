# Connecting an app to help-bites

Three steps. Nothing in help-bites knows about your app beyond what you put
on the project; your users keep their existing accounts.

## 1. Create a project

Admin panel → Projects → New project. You get:

- a **public key** `pk_…` — safe to ship to browsers; identifies the project
- a **secret** `sk_…` — server only; signs identity tokens

Set the site URL (used in email links), the origins allowed to host the widget,
the name replies are signed with, and the email addresses to notify when a user
writes.

## 2. Mint identity tokens on your server

Add one authenticated route to your backend that returns a short-lived HS256
JWT for the signed-in user. Claims:

| claim | value |
|---|---|
| `iss` | the project public key |
| `sub` | your user's id (stable, unique per project) |
| `name` | optional display name |
| `email` | optional; enables email notifications for that user |
| `username` | optional; the public handle feedback boards show and `@mention` by — never an email address |
| `avatar` | optional; an http(s) image URL for feedback boards |
| `locale` | optional; the person's language, a tag such as `es` or `pt-BR`. It fills the contact's language the first time (one set in the panel or over the API is never replaced), and campaigns and sequences then send the matching translation of a template. See [Languages](LANGUAGES.md#a-contacts-language) |
| `role` | optional; `admin` lets one of your staff moderate the feedback board |
| `iat`, `exp` | issued-at and expiry (an hour is plenty) |

Node, no dependencies:

```js
import { createHmac } from 'node:crypto'

export function mintSupportToken(user) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ iss: process.env.HELP_BITES_PROJECT_KEY, sub: user.id, name: user.name, email: user.email, iat: now, exp: now + 3600 })
  const sig = createHmac('sha256', process.env.HELP_BITES_SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}
```

Any JWT library works too (`jose`, `jsonwebtoken`, PyJWT, …): algorithm HS256,
secret = the project secret.

Never send the secret to a browser. Rotate it from the project page if it leaks;
tokens minted with the old one stop verifying immediately.

## 3. Show the chat

### Drop-in widget

```html
<script src="https://YOUR-SUPPORT-HOST/widget.js" data-project="pk_…" defer></script>
<script>
  window.HelpBites = window.HelpBites || []
  HelpBites.push(['init', {
    getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token),
    context: { type: 'bookmark', id: 'abc', label: 'The thing they are looking at', url: location.href } // optional
  }])
</script>
```

- `getToken` is called when the chat opens and again whenever a token expires.
- `context` is attached to new conversations so you know what the user was
  looking at. Update it with `HelpBites.push(['setContext', {...}])`.
- `HelpBites.push(['open'])` / `(['close'])` control the panel.
- `data-position="left"` and `data-accent="#hex"` on the script tag tweak the launcher.
- A link with `?sb=<conversationId>` (what notification emails use) opens that
  conversation on load.

Only origins listed on the project can host the widget; anything else sees an
error inside the frame and never gets a token.

### One tag for everything

Instead of a script per feature, `helpbites.js` asks the project what it has and
adds the chat, the feedback board, the changelog and onboarding that are set up:

```html
<script src="https://YOUR-SUPPORT-HOST/helpbites.js" data-project="pk_…" async></script>
```

It adds the chat by default; name more with `data-features="chat,feedback"` or
give one its own setting (`data-changelog-target="#changelog"`, `data-flow="welcome"`).
`data-position`, `data-accent`, `data-mode`, `data-token` and `data-locale` pass
through to the scripts, `HelpBites.push([...])` keeps working, and a script
already on the page is never added twice. The project can also turn on a Home
tab in the chat (what's new, top feedback, onboarding) and a public page at
`/hub/<pk>`. All of it is in [Public hub and the one-tag loader](HUB.md).

### Your own UI

Everything the widget does is on the API: `GET /_docs/scalar`. Send
`Authorization: Bearer <identity token>` and use:

- `GET /v1/conversations`, `POST /v1/conversations`
- `GET /v1/conversations/:id/messages?before=`, `POST /v1/conversations/:id/messages`
- `POST /v1/conversations/:id/read`, `DELETE /v1/messages/:id`, `GET /v1/unread`
- `POST /v1/attachments` (multipart `file`)
- `GET /v1/events` — server-sent events; use `fetch` + a stream reader so the token stays in a header

Retries are safe: pass a `clientId` with each message and a repeated POST
returns the message that already landed.

## Email-only users (no backend)

An app with no server of its own (a native app, a static site) cannot sign
identity tokens, and must never hold the project secret. Turn on **Allow
email-only users** in Project > Settings and the app can use chat and feedback
with just an email address:

```
POST /v1/anonymous/session   { "pk": "pk_…", "email": "ann@example.com", "name": "Ann" }
```

- A **new address** gets `200 { status: "token", token: "eu_…", externalId, verified: false }`.
  Send `Authorization: Bearer eu_…` on every end-user route (conversations,
  messages, attachments, `/v1/events`, feedback, changelog comments). Keep the
  token (the Keychain on iOS); the person does not enter their email again.
- An address **already known** (someone used it before, or it is a contact) never
  gets a token from this call. It gets `202 { status: "code_sent" }` and a
  6-digit code by email, valid 10 minutes. Trade it with
  `POST /v1/anonymous/verify/confirm { pk, email, code }` for a verified token;
  `POST /v1/anonymous/verify { pk, email }` sends a new code. Five wrong guesses
  lock the code. Confirming ends every earlier session of that address.
- After **5 writes** (messages, posts, comments, votes, ...) an unverified person
  gets `403` with `data.code = "email_verification_required"` on the next
  write. Show a code field and call the two verify routes above. Verified people
  are never asked again.
- Until verified, the address is a claim only: the session has no `email`, so it
  cannot trigger reply mail, flag allow-lists or changelog subscriptions, and
  unverified people cannot upload images.
- `DELETE /v1/anonymous/me` with the token erases everything the person left.
- Turning the setting off ends all email-only access at once.

An email-only user is an ordinary contact whose `externalId` starts with
`anon_`, so conversations, feedback and the CRM work as for any other user.

## Feedback board

The same token also signs users into the project's public feedback board.
Turn it on under Project → Feedback, then either drop in the board:

```html
<div id="feedback"></div>
<script src="https://YOUR-SUPPORT-HOST/feedback.js" data-project="pk_…" data-target="#feedback" defer></script>
<script>
  window.HelpBitesFeedback = window.HelpBitesFeedback || []
  HelpBitesFeedback.push(['init', {
    getToken: () => fetch('/api/support/token').then(r => r.ok ? r.json() : null).then(r => r && r.token),
    onSignIn: () => openLoginModal()
  }])
</script>
```

or build your own on `/v1/feedback` (public reads with `?pk=`). Add
`role: "admin"` to the token claims of your own staff to let them moderate.
Everything — options, the API, importing an existing board, account deletion —
is in [FEEDBACK.md](FEEDBACK.md).

## Feature flags

Switch features of your app from Project → Flags: each flag is `off`, `on`, or
`admins` (your admins plus a per-flag allow list), with an optional fallback for
when HelpBites can't be reached. Read them with `GET /v1/flags` — from your
server with the secret, or from a browser with `?pk=` or the identity token.
Details in [FLAGS.md](FLAGS.md).

## Error tracking

If the operator enables Project → Dev → Error tracking, copy its DSN into any
Sentry-compatible SDK and call `Sentry.setUser({ id: user.id })`, where `user.id`
is the same stable value used as this document's token `sub`. That associates a
customer's recent errors with their HelpBites conversations. See [ERRORS.md](ERRORS.md).

## Typed tickets and host actions

`support` is available on every project. Create additional types under
`/v1/admin/projects/:id/types` to define their statuses, intake fields, and
operator actions. New conversations accept `type`, `fields`, and `subjectRef`
(`{ type, id, label, url?, thumbnailUrl? }`); URL values are restricted to
http(s).

For a host backend to file a ticket for one of its users, call `POST /v1/tickets`
with the project secret—not an identity token:

```js
await fetch('https://support.example.com/v1/tickets', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.HELP_BITES_SECRET}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    externalId: user.id, name: user.name, email: user.email,
    type: 'report', subject: 'Report an icon', body: details,
    fields: { reason: 'copyright', sourceUrl },
    subjectRef: { type: 'icon', id: icon.id, label: icon.name, url: icon.url },
    idempotencyKey: `report:${user.id}:${icon.id}`
  })
})
```

Set `actionWebhookUrl` and `actionWebhookSecret` on the project. Operator
actions POST JSON to that URL with `X-HelpBites-Signature:
sha256=<HMAC-SHA256(body)>`; verify it before applying the host-side effect.
The payload includes `actionKey`, the ticket snapshot, and an idempotency key.

## Work with an AI assistant

The operator side has an [MCP server](MCP.md) too: connect Claude, ChatGPT or
Cursor to `https://YOUR-SUPPORT-HOST/mcp` and it can read the inbox, reply,
triage feedback and write changelog entries as you.
